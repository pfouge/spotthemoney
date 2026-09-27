// Source: USAspending.gov award search (api.usaspending.gov). Keyless.
// Contract: integration contract §4.4 (contracts table, interim action_date rule).
//
// ENDPOINT: POST /api/v2/search/spending_by_award/ with a JSON filter body. Response
// rows are keyed by the LITERAL requested field-name strings (e.g. "Award ID",
// "Recipient Name") plus a generated_internal_id used as our natural key
// (contracts.source_ref, unique per migration 0003).
//
// INTERIM ACTION_DATE RULE (contract §4.4, binding): the primary request asks for
// "Action Date" and "NAICS" directly. If the API 400s on that shape (IIF's connector
// treats these as award-level fields the API may not accept on every deployment),
// retry once with a reduced field set/sort and fall back to "Start Date" as the
// action date. This fallback is recorded in stats via interim_start_date=true and a
// ctx.warn(), never silently.
//
// PAGINATION: no total count is returned — page while page_metadata.hasNext, capped
// at USASPENDING_MAX_PAGES (default 10) to bound a single run. Every request repeats
// an explicit sort+order (stable ORDER BY lesson — see lib/run.ts header).

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { optionalEnv } from "@stm/shared";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "usaspending";
const SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const PAGE_LIMIT = 100;

const PRIMARY_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Start Date",
  "End Date",
  "Description",
  "Action Date",
  "NAICS",
] as const;
const PRIMARY_SORT = "Action Date";

const FALLBACK_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Start Date",
  "End Date",
  "Description",
] as const;
const FALLBACK_SORT = "Award Amount";

type AwardRow = Record<string, unknown> & { generated_internal_id?: string };

interface SearchResponse {
  results: AwardRow[];
  page_metadata: { hasNext: boolean };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchPage(
  fields: readonly string[],
  sort: string,
  startDate: string,
  endDate: string,
  page: number,
): Promise<SearchResponse> {
  return fetchJson<SearchResponse>(SEARCH_URL, {
    method: "POST",
    body: {
      filters: {
        award_type_codes: ["A", "B", "C", "D"],
        time_period: [{ start_date: startDate, end_date: endDate }],
      },
      fields,
      limit: PAGE_LIMIT,
      page,
      order: "desc",
      sort,
    },
  });
}

export async function ingestUsaspending(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const lookbackDays = Number(optionalEnv("USASPENDING_LOOKBACK_DAYS") ?? "30");
  const maxPages = Number(optionalEnv("USASPENDING_MAX_PAGES") ?? "10");

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - lookbackDays);
  const startDate = isoDate(start);
  const endDate = isoDate(end);

  let fields: readonly string[] = PRIMARY_FIELDS;
  let sort = PRIMARY_SORT;
  let interimStartDate = false;

  let page = 1;
  let pagesFetched = 0;
  let hasNext = true;

  while (hasNext && page <= maxPages) {
    let resp: SearchResponse;
    try {
      resp = await fetchPage(fields, sort, startDate, endDate, page);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (page === 1 && fields === PRIMARY_FIELDS && message.includes("HTTP 400")) {
        // Fall back once: drop Action Date / NAICS and retry with the reduced shape.
        fields = FALLBACK_FIELDS;
        sort = FALLBACK_SORT;
        interimStartDate = true;
        ctx.warn(
          "usaspending: primary request (Action Date/NAICS) returned HTTP 400 — " +
            "retrying with fields/sort excluding Action Date and NAICS. " +
            "action_date falls back to Start Date per contract §4.4 interim rule.",
        );
        resp = await fetchPage(fields, sort, startDate, endDate, page);
      } else {
        throw err;
      }
    }

    pagesFetched++;
    const rows = resp.results ?? [];

    for (const row of rows) {
      const sourceRef = row.generated_internal_id;
      if (!sourceRef || typeof sourceRef !== "string") {
        ctx.quarantine(
          `page ${page} row "${String(row["Award ID"] ?? "unknown").slice(0, 40)}"`,
          "missing generated_internal_id",
        );
        continue;
      }
      if (!ctx.markSeen(sourceRef)) continue;
      ctx.rowsSeen++;

      const clean = scrubDeep(row);

      const recipient = (clean["Recipient Name"] as string | null | undefined) ?? null;
      const awardingAgency = (clean["Awarding Agency"] as string | null | undefined) ?? null;
      const amount = parseAmount(clean["Award Amount"]);
      const actionDate =
        (clean["Action Date"] as string | null | undefined) ??
        (clean["Start Date"] as string | null | undefined) ??
        null;
      const naics = (clean["NAICS"] as string | null | undefined) ?? null;
      const cleanSourceRef = clean.generated_internal_id as string;

      const result = await sql`
        insert into contracts (recipient, awarding_agency, amount, action_date, naics, source_ref)
        values (${recipient}, ${awardingAgency}, ${amount}, ${actionDate}, ${naics}, ${cleanSourceRef})
        on conflict (source_ref) where source_ref is not null do update
          set recipient = excluded.recipient,
              awarding_agency = excluded.awarding_agency,
              amount = excluded.amount,
              action_date = excluded.action_date,
              naics = excluded.naics
      `;
      ctx.rowsChanged += result.count ?? 0;
    }

    hasNext = resp.page_metadata?.hasNext ?? false;
    page++;
  }

  ctx.extra["pages_fetched"] = pagesFetched;
  ctx.extra["lookback_days"] = lookbackDays;
  ctx.extra["window_start"] = startDate;
  ctx.extra["window_end"] = endDate;
  if (interimStartDate) ctx.extra["interim_start_date"] = true;

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: "success",
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- usaspending`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestUsaspending()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
