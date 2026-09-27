// Source: Senate Office of Public Records — Lobbying Disclosure Act (LDA) filings API.
// Contract: integration contract §4.3 (one lobbying row PER FILING).
//
// Base: https://lda.gov/api/v1 — lda.senate.gov is RETIRED, never use it (verified
// against the IIF connector source).
//
// AUTH: optional. LDA_API_KEY, if set, is sent as `Authorization: Token <key>`. If a
// keyed request 401s, we defensively retry that one request without the header (a bad
// key shouldn't kill an otherwise-keyless-capable run) and note the fallback in stats.
//
// RATE: keyless target is 15 req/min. lib/http.ts already enforces a >=1.5s gap per
// host; when running keyless we add another 2500ms sleep after each page so the
// effective gap is >=4s (~15/min). With a key, lib/http's gap alone is fine.
//
// WAF: lda.gov 403s some non-browser clients. lib/http.ts throws a clear policy error
// on 403 — we do NOT catch/retry 403s here, and we never spoof browser headers. Let it
// propagate per policy (see lib/http.ts).

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "senate_lda";
const BASE_URL = "https://lda.gov/api/v1";
const PAGE_SIZE = 25; // API max

interface LobbyingActivity {
  general_issue_code?: string | null;
  general_issue_code_display?: string | null;
  description?: string | null;
}

interface Filing {
  filing_uuid?: string | null;
  filing_type?: string | null;
  filing_type_display?: string | null;
  filing_year?: number | null;
  filing_period?: string | null;
  filing_period_display?: string | null;
  registrant?: { name?: string | null } | null;
  client?: { name?: string | null } | null;
  income?: string | number | null;
  expenses?: string | number | null;
  lobbying_activities?: LobbyingActivity[] | null;
  filing_document_url?: string | null;
}

interface FilingsPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: Filing[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** filing_period token → calendar quarter, per contract §4.3. */
const PERIOD_TO_QUARTER: Record<string, number> = {
  first_quarter: 1,
  second_quarter: 2,
  third_quarter: 3,
  fourth_quarter: 4,
  mid_year: 2,
  year_end: 4,
};

function parseAmount(income: unknown, expenses: unknown): number | null {
  const fromIncome = income == null ? NaN : Number(income);
  if (Number.isFinite(fromIncome)) return fromIncome;
  const fromExpenses = expenses == null ? NaN : Number(expenses);
  if (Number.isFinite(fromExpenses)) return fromExpenses;
  return null;
}

function filingsUrl(filingYear: number, page: number): string {
  const u = new URL(`${BASE_URL}/filings/`);
  u.searchParams.set("filing_year", String(filingYear));
  u.searchParams.set("page_size", String(PAGE_SIZE));
  u.searchParams.set("page", String(page));
  return u.toString();
}

export async function ingestSenateLda(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const filingYear = Number(process.env.LDA_FILING_YEAR ?? new Date().getFullYear());
  const maxPages = Number(process.env.LDA_MAX_PAGES ?? 20);
  const apiKey = process.env.LDA_API_KEY;
  const keyless = !apiKey;

  const warnedUnknownPeriods = new Set<string>();
  let pagesFetched = 0;
  let usedNoKeyFallback = false;

  let page = 1;
  let hasNext = true;

  while (hasNext && pagesFetched < maxPages) {
    const url = filingsUrl(filingYear, page);
    let data: FilingsPage;

    if (apiKey) {
      try {
        data = await fetchJson<FilingsPage>(url, {
          headers: { Authorization: `Token ${apiKey}` },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("401")) {
          // Defensive: bad token — retry once without the auth header.
          usedNoKeyFallback = true;
          ctx.warn(`page ${page}: 401 with LDA_API_KEY set — retrying without auth header`);
          data = await fetchJson<FilingsPage>(url);
        } else {
          throw err;
        }
      }
    } else {
      data = await fetchJson<FilingsPage>(url);
    }

    pagesFetched++;

    for (const filing of data.results ?? []) {
      const ref = filing.filing_uuid ?? `${SOURCE}:page${page}:${filing.filing_type ?? "unknown"}:${filing.registrant?.name ?? "unknown"}`;

      if (!filing.filing_uuid) {
        ctx.quarantine(ref, "missing filing_uuid");
        continue;
      }
      if (!ctx.markSeen(filing.filing_uuid)) continue;
      ctx.rowsSeen++;

      const activities = filing.lobbying_activities ?? [];
      const firstActivity = activities[0];

      let periodQuarter: number | null = null;
      const periodToken = filing.filing_period ?? undefined;
      if (periodToken != null) {
        if (periodToken in PERIOD_TO_QUARTER) {
          periodQuarter = PERIOD_TO_QUARTER[periodToken]!;
        } else if (!warnedUnknownPeriods.has(periodToken)) {
          warnedUnknownPeriods.add(periodToken);
          ctx.warn(`unrecognized filing_period token "${periodToken}" — period_quarter set to null`);
        }
      }

      const issues = activities.map((a) => ({
        code: a.general_issue_code ?? null,
        display: a.general_issue_code_display ?? null,
        description: a.description ?? null,
      }));

      const row = scrubDeep({
        filing_uuid: filing.filing_uuid,
        filing_type: filing.filing_type ?? null,
        registrant: filing.registrant?.name ?? null,
        client: filing.client?.name ?? null,
        amount: parseAmount(filing.income, filing.expenses),
        period_year: filing.filing_year ?? null,
        period_quarter: periodQuarter,
        issue_area: firstActivity?.general_issue_code ?? null,
        issues,
        source_ref: filing.filing_document_url ?? null,
      });

      const result = await sql`
        insert into lobbying (
          filing_uuid, filing_type, registrant, client, amount,
          period_year, period_quarter, issue_area, issues, source_ref
        )
        values (
          ${row.filing_uuid}, ${row.filing_type}, ${row.registrant}, ${row.client}, ${row.amount},
          ${row.period_year}, ${row.period_quarter}, ${row.issue_area}, ${sql.json(row.issues)}, ${row.source_ref}
        )
        on conflict (filing_uuid) where filing_uuid is not null do update
          set filing_type = excluded.filing_type,
              registrant = excluded.registrant,
              client = excluded.client,
              amount = excluded.amount,
              period_year = excluded.period_year,
              period_quarter = excluded.period_quarter,
              issue_area = excluded.issue_area,
              issues = excluded.issues,
              source_ref = excluded.source_ref
      `;
      ctx.rowsChanged += result.count ?? 0;
    }

    hasNext = data.next != null;
    page++;

    if (hasNext && pagesFetched < maxPages && keyless) {
      // Keyless target is 15 req/min; lib/http's 1.5s gap alone isn't enough headroom.
      await sleep(2500);
    }
  }

  ctx.extra["pages_fetched"] = pagesFetched;
  ctx.extra["filing_year"] = filingYear;
  ctx.extra["keyless"] = keyless;
  ctx.extra["used_no_key_fallback"] = usedNoKeyFallback;

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: "success",
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- senate_lda`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSenateLda()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
