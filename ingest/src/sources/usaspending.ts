// Source: USAspending.gov award search (api.usaspending.gov). Keyless.
// Contract: integration contract §4.4 (contracts table, interim action_date rule).
//
// WHAT THIS STORES (rewritten 2026-10-05). The table is a defined slice of federal
// contracts, not every award:
//   1. LARGEST NEW AWARDS — for each 30-day slice of the last USASPENDING_WINDOW_DAYS
//      (default 180), the largest contract awards by total award amount
//      (USASPENDING_PAGES_PER_SLICE pages of 100, default 3).
//   2. TRACKED COMPANIES — for every company with a tracked ticker, a recipient search
//      over the same window; only rows whose recipient name normalises to exactly the
//      company's name are kept (the same rule the site uses to put awards on a company
//      page — normalizeOrgName in @stm/shared).
// Every stored row is an award whose START DATE falls inside the window. Before this
// rewrite the job stored the 1,000 largest awards with any activity in the last 30 days,
// dated by their start date; most started years ago, so the site's 180-day pages showed
// only the ~100 that happened to start recently.
//
// ENDPOINT: POST /api/v2/search/spending_by_award/ with a JSON filter body. Response
// rows are keyed by the LITERAL requested field-name strings (e.g. "Award ID",
// "Recipient Name") plus a generated_internal_id used as our natural key
// (contracts.source_ref, unique per migration 0003).
//
// DATES (contract §4.4 interim rule, still in force): contracts.action_date holds the
// award's "Start Date". The API rejected "Action Date" as a field (HTTP 400) in every
// production run, so it is no longer requested. `amount` is the award's total amount.
//
// REQUEST SHAPE IS NEGOTIATED, NEVER ASSUMED (the API could not be reached while this was
// written — it was returning HTTP 500 on 2026-10-05):
//   - time_period.date_type "new_awards_only" asks for awards that began in the slice. If
//     the API answers 400/422, it is dropped for the rest of the run (stats.new_awards_filter
//     = false) and the slice falls back to "any activity in the slice".
//   - "NAICS" is requested; on 400/422 it is dropped (stats.naics_field = false).
//   Either way rows are filtered here by Start Date, so what is stored always means the
//   same thing; the stats say how many rows each path kept.
//
// PAGINATION: no total count is returned — page while page_metadata.hasNext, capped per
// slice. Every request repeats an explicit sort+order (stable ORDER BY lesson — see
// lib/run.ts header).

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { optionalEnv, normalizeOrgName } from "@stm/shared";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "usaspending";
const SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const PAGE_LIMIT = 100;
const SLICE_DAYS = 30;
const SORT = "Award Amount";

const BASE_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Start Date",
  "End Date",
  "Description",
] as const;

type AwardRow = Record<string, unknown> & { generated_internal_id?: string };

interface SearchResponse {
  results: AwardRow[];
  page_metadata: { hasNext: boolean };
}

export interface Slice { start: string; end: string }

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Consecutive slices covering the last `windowDays` up to `today`, newest first, no overlap. */
export function windowSlices(today: Date, windowDays: number, sliceDays = SLICE_DAYS): Slice[] {
  const out: Slice[] = [];
  const day = 86_400_000;
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let back = 0; back < windowDays; back += sliceDays) {
    const end = t0 - back * day;
    const start = t0 - (Math.min(back + sliceDays, windowDays) - 1) * day;
    out.push({ start: isoDate(new Date(start)), end: isoDate(new Date(end)) });
  }
  return out;
}

function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "NAICS" has come back as a plain code and as {code, description}; store the code. */
export function naicsCode(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return String(v).trim() || null;
  if (typeof v === "object" && "code" in (v as Record<string, unknown>)) {
    const c = (v as Record<string, unknown>).code;
    return c == null ? null : String(c).trim() || null;
  }
  return null;
}

/** The words to search a recipient by: the name without punctuation or corporate suffixes. */
export function recipientSearchText(companyName: string): string {
  return normalizeOrgName(companyName).replace(/\s+-\s+.*$/, "").trim();
}

function isShapeRejection(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return m.includes("HTTP 400") || m.includes("HTTP 422");
}

export async function ingestUsaspending(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const windowDays = Number(optionalEnv("USASPENDING_WINDOW_DAYS") ?? "180");
  const pagesPerSlice = Number(optionalEnv("USASPENDING_PAGES_PER_SLICE") ?? "3");
  const companyCap = Number(optionalEnv("USASPENDING_MAX_COMPANIES") ?? "400");

  const today = new Date();
  const slices = windowSlices(today, windowDays);
  const windowStart = slices[slices.length - 1]!.start;
  const windowEnd = slices[0]!.end;

  // Negotiated once per run (see header).
  let useNewAwardsFilter = true;
  let useNaics = true;
  let shapeSettled = false; // after the first accepted request a 400 is that request's problem

  let requests = 0;
  let outsideWindow = 0;

  async function search(slice: Slice, page: number, recipientText?: string): Promise<SearchResponse> {
    for (;;) {
      const fields = useNaics ? [...BASE_FIELDS, "NAICS"] : [...BASE_FIELDS];
      const period: Record<string, string> = { start_date: slice.start, end_date: slice.end };
      if (useNewAwardsFilter) period.date_type = "new_awards_only";
      const filters: Record<string, unknown> = {
        award_type_codes: ["A", "B", "C", "D"],
        time_period: [period],
      };
      if (recipientText) filters.recipient_search_text = [recipientText];
      try {
        requests++;
        const resp = await fetchJson<SearchResponse>(SEARCH_URL, {
          method: "POST",
          body: { filters, fields, limit: PAGE_LIMIT, page, order: "desc", sort: SORT },
        });
        shapeSettled = true;
        return resp;
      } catch (err) {
        if (shapeSettled || !isShapeRejection(err)) throw err;
        // Drop one optional piece at a time and try again; give up when none are left.
        if (useNewAwardsFilter) {
          useNewAwardsFilter = false;
          ctx.warn(`usaspending: date_type "new_awards_only" rejected (${(err as Error).message}) — falling back to any activity in the slice, filtered by Start Date here.`);
        } else if (useNaics) {
          useNaics = false;
          ctx.warn(`usaspending: "NAICS" field rejected (${(err as Error).message}) — continuing without it.`);
        } else {
          throw err;
        }
      }
    }
  }

  /** Store one API row if its Start Date is inside the window. Returns true when written. */
  async function store(row: AwardRow, where: string): Promise<boolean> {
    const sourceRef = row.generated_internal_id;
    if (!sourceRef || typeof sourceRef !== "string") {
      ctx.quarantine(`${where} row "${String(row["Award ID"] ?? "unknown").slice(0, 40)}"`, "missing generated_internal_id");
      return false;
    }
    const clean = scrubDeep(row);
    const startDate = ((clean["Start Date"] as string | null | undefined) ?? "").slice(0, 10) || null;
    if (!startDate || startDate < windowStart || startDate > windowEnd) {
      outsideWindow++;
      return false;
    }
    if (!ctx.markSeen(sourceRef)) return false;
    ctx.rowsSeen++;

    const recipient = (clean["Recipient Name"] as string | null | undefined) ?? null;
    const awardingAgency = (clean["Awarding Agency"] as string | null | undefined) ?? null;
    const amount = parseAmount(clean["Award Amount"]);
    const naics = naicsCode(clean["NAICS"]);
    const cleanSourceRef = clean.generated_internal_id as string;

    const result = await sql`
      insert into contracts (recipient, awarding_agency, amount, action_date, naics, source_ref)
      values (${recipient}, ${awardingAgency}, ${amount}, ${startDate}, ${naics}, ${cleanSourceRef})
      on conflict (source_ref) where source_ref is not null do update
        set recipient = excluded.recipient,
            awarding_agency = excluded.awarding_agency,
            amount = excluded.amount,
            action_date = excluded.action_date,
            naics = coalesce(excluded.naics, contracts.naics)
    `;
    ctx.rowsChanged += result.count ?? 0;
    return true;
  }

  // 1. Largest new awards, slice by slice.
  let largestKept = 0;
  for (const slice of slices) {
    let page = 1;
    let hasNext = true;
    while (hasNext && page <= pagesPerSlice) {
      const resp = await search(slice, page);
      for (const row of resp.results ?? []) {
        if (await store(row, `slice ${slice.start} page ${page}`)) largestKept++;
      }
      hasNext = resp.page_metadata?.hasNext ?? false;
      page++;
    }
  }

  // 2. Awards to tracked companies (exact normalised-name matches only).
  const companyRows = await sql`
    select distinct c.name
      from companies c
      join securities s on s.ticker = c.primary_ticker
     where s.is_active = true and s.type in ('equity','etf','adr') and c.name is not null
     order by c.name
     limit ${companyCap}
  `;
  const wholeWindow: Slice = { start: windowStart, end: windowEnd };
  let companiesSearched = 0;
  let companiesWithAwards = 0;
  let companyKept = 0;
  let companyFailures = 0;
  for (const r of companyRows) {
    const name = String(r.name);
    const key = normalizeOrgName(name);
    const text = recipientSearchText(name);
    if (text.length < 3) continue; // nothing distinctive to search by
    try {
      const resp = await search(wholeWindow, 1, text);
      companiesSearched++;
      let kept = 0;
      for (const row of resp.results ?? []) {
        if (normalizeOrgName(row["Recipient Name"] as string | null) !== key) continue;
        if (await store(row, `company "${name.slice(0, 30)}"`)) kept++;
      }
      if (kept > 0) companiesWithAwards++;
      companyKept += kept;
    } catch (err) {
      // One company's failed search must not lose the rest; the breaker still trips if
      // the API is down for everyone.
      companyFailures++;
      ctx.quarantine(`company "${name.slice(0, 40)}"`, err instanceof Error ? err.message : String(err));
    }
  }

  ctx.extra["window_days"] = windowDays;
  ctx.extra["window_start"] = windowStart;
  ctx.extra["window_end"] = windowEnd;
  ctx.extra["slices"] = slices.length;
  ctx.extra["requests"] = requests;
  ctx.extra["new_awards_filter"] = useNewAwardsFilter;
  ctx.extra["naics_field"] = useNaics;
  ctx.extra["largest_rows_kept"] = largestKept;
  ctx.extra["rows_outside_window"] = outsideWindow;
  ctx.extra["companies_searched"] = companiesSearched;
  ctx.extra["companies_with_awards"] = companiesWithAwards;
  ctx.extra["company_rows_kept"] = companyKept;
  ctx.extra["company_search_failures"] = companyFailures;
  ctx.extra["interim_start_date"] = true;

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
