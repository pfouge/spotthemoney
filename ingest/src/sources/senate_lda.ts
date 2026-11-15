// Source: Senate Office of Public Records — Lobbying Disclosure Act (LDA) filings API.
// Contract: integration contract §4.3 (one lobbying row PER FILING).
//
// Base: https://lda.gov/api/v1 (LDA_API_BASE overrides it in tests only) — lda.senate.gov is RETIRED, never use it (verified
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
  dt_posted?: string | null;
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
  const u = new URL(`${baseUrl()}/filings/`);
  u.searchParams.set("filing_year", String(filingYear));
  // The API's default order is OLDEST first. Without this the job re-read the same January
  // filings every day and never saw a new one (found 2026-10-04).
  u.searchParams.set("ordering", "-dt_posted");
  u.searchParams.set("page_size", String(PAGE_SIZE));
  u.searchParams.set("page", String(page));
  return u.toString();
}

// ──────────────────────────────────────────────────────────────────────────
// Daily pass (rewritten 2026-11-15 after the quarterly-deadline gap).
//
// The old job read at most LDA_MAX_PAGES (60) pages = 1,500 filings a run. Around the 20 Oct
// 2026 deadline the Senate posted 1,200–2,000 filings a day, so ~14,000 filings were never
// read and nothing said so. Now:
//   1. NEWEST-FIRST pass: pages newest → oldest until a page is ALL already stored (caught
//      up) or LDA_MAX_MINUTES (default 20) runs out. LDA_MAX_PAGES is an optional hard cap,
//      applied only when set explicitly.
//   2. If that pass stops on the budget or the cap before an all-known page, the run is
//      "partial" with gap_possible=true and a gap range {gap_from, gap_to} in its stats:
//      gap_to = oldest dt_posted it reached, gap_from = just below the newest filing stored
//      before the run (database max(posted_at) minus 12 h, because dt_posted is wall-clock
//      text and the database holds an instant).
//   3. The NEXT run reads that range from the last run's stats and, after its own newest-first
//      pass, walks it OLDEST-first (`filing_dt_posted_after`, the history pass's request) with
//      the time left, saving progress as the new gap_from. When the walk reaches gap_to the
//      gap is closed (gap_closed=true) and the run reports "success".
// Overlap is harmless: rows upsert by filing_uuid. Freshness treats "partial" as a healthy run.
// ──────────────────────────────────────────────────────────────────────────

export function baseUrl(): string {
  // LDA_API_BASE exists for the local fake-API test only; production never sets it.
  return process.env.LDA_API_BASE ?? "https://lda.gov/api/v1";
}

/** Request options shared by the daily and history passes (keyed clients: published 120/min). */
export function ldaFetchOptions(apiKey: string | undefined): { headers?: Record<string, string>; minGapMs?: number } {
  return apiKey
    ? { headers: { Authorization: `Token ${apiKey}` }, minGapMs: Number(process.env.LDA_KEYED_GAP_MS ?? 750) }
    : {};
}

/** Sleep after a page when keyless (~15/min target). LDA_KEYLESS_SLEEP_MS is for tests only. */
function keylessSleepMs(): number {
  const v = Number(process.env.LDA_KEYLESS_SLEEP_MS ?? 2500);
  return Number.isFinite(v) && v >= 0 ? v : 2500;
}

export interface GapRange { from: string; to: string }

/** Smaller of two naive `YYYY-MM-DDTHH:MM:SS` strings (lexicographic == chronological). */
export function minPosted(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  const bb = b.slice(0, 19);
  return a == null || bb < a ? bb : a;
}

/** Union of two unresolved gaps: from the earlier start to the later end. */
export function mergeGaps(a: GapRange | null, b: GapRange | null): GapRange | null {
  if (!a) return b;
  if (!b) return a;
  return { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
}

interface DailyDeps { now?: () => number }

type SqlClient = ReturnType<typeof getDb>;

/** Upsert one page of API filings (issue descriptions included — the daily pass keeps them). */
async function storeFilings(sql: SqlClient, ctx: ReturnType<typeof createRunContext>, filings: Filing[], label: string, warned: Set<string>): Promise<void> {
  for (const filing of filings) {
    const ref = filing.filing_uuid ?? `${SOURCE}:${label}:${filing.filing_type ?? "unknown"}:${filing.registrant?.name ?? "unknown"}`;

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
      } else if (!warned.has(periodToken)) {
        warned.add(periodToken);
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
      posted_at: filing.dt_posted ?? null,
    });

    const result = await sql`
      insert into lobbying (
        filing_uuid, filing_type, registrant, client, amount,
        period_year, period_quarter, issue_area, issues, source_ref, posted_at
      )
      values (
        ${row.filing_uuid}, ${row.filing_type}, ${row.registrant}, ${row.client}, ${row.amount},
        ${row.period_year}, ${row.period_quarter}, ${row.issue_area}, ${sql.json(row.issues)}, ${row.source_ref}, ${row.posted_at}
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
            source_ref = excluded.source_ref,
            posted_at = excluded.posted_at
    `;
    ctx.rowsChanged += result.count ?? 0;
  }
}

export async function ingestSenateLda(deps: DailyDeps = {}): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const budgetMin = Number(process.env.LDA_MAX_MINUTES ?? 20);
  const deadline = startedAt + (Number.isFinite(budgetMin) && budgetMin > 0 ? budgetMin : 20) * 60_000;

  const filingYear = Number(process.env.LDA_FILING_YEAR ?? new Date().getFullYear());
  // Optional hard cap on the newest-first pass; only when explicitly set.
  const capRaw = process.env.LDA_MAX_PAGES;
  const maxPages = capRaw != null && capRaw !== "" && Number(capRaw) > 0 ? Number(capRaw) : null;
  const apiKey = process.env.LDA_API_KEY;
  const keyless = !apiKey;
  const opts = ldaFetchOptions(apiKey);

  const warned = new Set<string>();
  let usedNoKeyFallback = false;

  // State from the previous run, and the newest filing stored before this one.
  const [prev] = await sql<{ gap_possible: string | null; gap_from: string | null; gap_to: string | null }[]>`
    select r.stats->>'gap_possible' as gap_possible, r.stats->>'gap_from' as gap_from, r.stats->>'gap_to' as gap_to
      from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.status <> 'running' and r.stats ? 'gap_possible'
     order by r.id desc limit 1
  `;
  const prevGap: GapRange | null =
    prev?.gap_possible === "true" && prev.gap_from && prev.gap_to ? { from: prev.gap_from, to: prev.gap_to } : null;
  const [top] = await sql<{ lower_bound: string | null }[]>`
    select to_char((max(posted_at) - interval '12 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as lower_bound
      from lobbying where period_year = ${filingYear} and posted_at is not null
  `;
  const storedFloor = top?.lower_bound ?? `${filingYear}-01-01T00:00:00`;

  async function fetchPage(url: string): Promise<FilingsPage> {
    try {
      return await fetchJson<FilingsPage>(url, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (apiKey && msg.includes("401")) {
        // Defensive: bad token — retry once without the auth header.
        usedNoKeyFallback = true;
        ctx.warn(`401 with LDA_API_KEY set — retrying without auth header`);
        return fetchJson<FilingsPage>(url);
      }
      throw err;
    }
  }

  // ── 1. newest-first pass ────────────────────────────────────────────────
  let pagesFetched = 0;
  let caughtUp = false;
  let stopped: string | null = null;
  let oldestPosted: string | null = null;
  let newestPosted: string | null = null;
  let page = 1;

  for (;;) {
    if (now() >= deadline) { stopped = "time budget"; break; }
    if (maxPages != null && pagesFetched >= maxPages) { stopped = "page cap"; break; }
    let data: FilingsPage;
    try {
      data = await fetchPage(filingsUrl(filingYear, page));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Policy: a 403 (WAF) is never worked around, and nothing-read-at-all is a real failure.
      if (pagesFetched === 0 || msg.includes("403")) throw err;
      stopped = `request failed: ${msg}`;
      ctx.warn(stopped);
      break;
    }
    pagesFetched++;

    // Newest-first paging: once a whole page is already stored we have caught up.
    const pageUuids = (data.results ?? []).map((f) => f.filing_uuid).filter((u): u is string => !!u);
    const knownRows = pageUuids.length
      ? await sql<{ filing_uuid: string }[]>`select filing_uuid from lobbying where filing_uuid = any(${pageUuids}) and posted_at is not null`
      : [];
    const pageAllKnown = pageUuids.length > 0 && knownRows.length === pageUuids.length;

    await storeFilings(sql, ctx, data.results ?? [], `page${page}`, warned);
    for (const f of data.results ?? []) {
      oldestPosted = minPosted(oldestPosted, f.dt_posted);
      if (f.dt_posted && (newestPosted == null || f.dt_posted.slice(0, 19) > newestPosted)) newestPosted = f.dt_posted.slice(0, 19);
    }

    const hasNext = data.next != null;
    page++;
    if (pageAllKnown) {
      ctx.extra["caught_up_on_page"] = page - 1;
      caughtUp = true;
      break;
    }
    if (!hasNext) { caughtUp = true; break; } // reached the oldest filing of the year
    if (keyless) await sleep(keylessSleepMs());
  }

  // A gap exists when the pass stopped before reaching known ground.
  const newGap: GapRange | null =
    !caughtUp && oldestPosted ? { from: storedFloor, to: oldestPosted } : !caughtUp ? { from: storedFloor, to: `${filingYear}-12-31T23:59:59` } : null;

  // ── 2. close the previous run's gap (oldest-first walk) with the time left ──
  let remainingGap: GapRange | null = prevGap;
  let gapPages = 0;
  let gapClosed = false;
  if (prevGap) {
    let after = prevGap.from;
    let walkPage = 1;
    let reached: string | null = null;
    let done = false;
    for (;;) {
      if (now() >= deadline) break;
      let data: FilingsPage;
      try {
        data = await fetchPage(historyUrl(after, walkPage));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403")) throw err;
        ctx.warn(`gap walk stopped: ${msg}`);
        break;
      }
      gapPages++;
      await storeFilings(sql, ctx, data.results ?? [], `gap${walkPage}`, warned);
      const last = (data.results ?? []).map((f) => f.dt_posted).filter((d): d is string => !!d).pop();
      if (last) reached = last;
      if (data.next == null || (last != null && last.slice(0, 19) >= prevGap.to)) { done = true; break; }
      walkPage++;
      if (keyless) await sleep(keylessSleepMs());
    }
    if (done) {
      remainingGap = null;
      gapClosed = true;
    } else {
      remainingGap = { from: reached ? cursorBefore(reached) : prevGap.from, to: prevGap.to };
    }
  }

  const finalGap = mergeGaps(remainingGap, newGap);
  const gapPossible = finalGap != null;

  ctx.extra["pages_fetched"] = pagesFetched;
  ctx.extra["gap_pages_fetched"] = gapPages;
  ctx.extra["filing_year"] = filingYear;
  ctx.extra["keyless"] = keyless;
  ctx.extra["used_no_key_fallback"] = usedNoKeyFallback;
  ctx.extra["oldest_posted_seen"] = oldestPosted;
  ctx.extra["newest_posted_seen"] = newestPosted;
  ctx.extra["stopped"] = stopped;
  ctx.extra["gap_possible"] = gapPossible;
  ctx.extra["gap_from"] = finalGap?.from ?? null;
  ctx.extra["gap_to"] = finalGap?.to ?? null;
  ctx.extra["gap_closed"] = gapClosed;
  ctx.extra["previous_gap"] = prevGap ? `${prevGap.from} .. ${prevGap.to}` : null;
  if (gapPossible) {
    console.warn(`senate_lda: PARTIAL — stopped on ${stopped ?? "an unfinished gap walk"}; filings between ${finalGap!.from} and ${finalGap!.to} are read by the next run`);
  }

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: gapPossible ? "partial" : "success",
    stats: ctx.stats(),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// History pass (2026-10-05) — `senate_lda_history`, run by name only.
//
// The daily job above reads the newest 60 pages of the current filing year, so until this
// pass has run the table is a sample. This pass walks EVERY filing posted since
// LDA_HISTORY_SINCE (default 2025-10-01, Peter 2026-10-05), oldest first
// (`filing_dt_posted_after`, `ordering=dt_posted` — both confirmed against the live API on
// 2026-10-05: 112,256 filings in that window), and stops cleanly on a time budget.
// RESUME: the last posted time reached is saved in ingest_runs.stats.cursor; the next run
// starts one second before it (upserts make the overlap harmless). Re-run until
// stats.history_complete is true — after that the daily newest-first job keeps it current.
// Rows are written one page per statement, and issue descriptions are not stored (the site
// uses the codes only; descriptions are most of a filing's bytes).
// PACING: lda.gov publishes 120 requests/minute for keyed clients, so with a key this pass
// uses a 750 ms gap (80/minute); keyless it keeps the daily job's ~4 s.
// ──────────────────────────────────────────────────────────────────────────

export const LDA_HISTORY_FLOOR = "2025-10-01";

/** `after` for the next request: the wall-clock time as lda.gov printed it, minus one second. */
export function cursorBefore(dtPosted: string): string {
  const naive = Date.parse(`${dtPosted.slice(0, 19)}Z`);
  if (!Number.isFinite(naive)) return dtPosted.slice(0, 10);
  return new Date(naive - 1000).toISOString().slice(0, 19);
}

export function historyUrl(after: string, page: number): string {
  const u = new URL(`${baseUrl()}/filings/`);
  u.searchParams.set("filing_dt_posted_after", after);
  u.searchParams.set("ordering", "dt_posted");
  u.searchParams.set("page_size", String(PAGE_SIZE));
  u.searchParams.set("page", String(page));
  return u.toString();
}

/** One API filing → one lobbying row (issue codes and names only). Null when it has no uuid. */
export function historyRow(filing: Filing): Record<string, unknown> | null {
  if (!filing.filing_uuid) return null;
  const activities = filing.lobbying_activities ?? [];
  const token = filing.filing_period ?? "";
  return scrubDeep({
    filing_uuid: filing.filing_uuid,
    filing_type: filing.filing_type ?? null,
    registrant: filing.registrant?.name ?? null,
    client: filing.client?.name ?? null,
    amount: parseAmount(filing.income, filing.expenses),
    period_year: filing.filing_year ?? null,
    period_quarter: token in PERIOD_TO_QUARTER ? PERIOD_TO_QUARTER[token]! : null,
    issue_area: activities[0]?.general_issue_code ?? null,
    issues: activities.map((a) => ({ code: a.general_issue_code ?? null, display: a.general_issue_code_display ?? null })),
    source_ref: filing.filing_document_url ?? null,
    posted_at: filing.dt_posted ?? null,
  });
}

export async function ingestSenateLdaHistory(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext("senate_lda_history");
  const startedAt = Date.now();
  const budgetMs = Number(process.env.LDA_HISTORY_BUDGET_MIN ?? 42) * 60_000;
  const since = process.env.LDA_HISTORY_SINCE ?? LDA_HISTORY_FLOOR;
  const apiKey = process.env.LDA_API_KEY;
  const opts = ldaFetchOptions(apiKey);

  // Resume from the last run that got anywhere (same floor only).
  const [prev] = await sql<{ cursor: string | null; done: string | null }[]>`
    select r.stats->>'cursor' as cursor, r.stats->>'history_complete' as done
      from ingest_runs r join sources s on s.id = r.source_id
     where s.code = 'senate_lda_history' and r.stats->>'cursor' is not null
       and r.stats->>'history_since' = ${since}
     order by r.id desc limit 1
  `;
  const startAfter = prev?.cursor ? cursorBefore(prev.cursor) : since;

  let page = 1;
  let pagesFetched = 0;
  let cursor: string | null = prev?.cursor ?? null;
  let complete = false;
  let stopped: string | null = null;
  let total: number | null = null;

  for (;;) {
    if (Date.now() - startedAt > budgetMs) { stopped = "time budget reached"; break; }
    let data: FilingsPage;
    try {
      data = await fetchJson<FilingsPage>(historyUrl(startAfter, page), opts);
    } catch (err) {
      // Nothing read at all = a real failure. Otherwise keep what was stored and let the
      // next run resume from the saved cursor.
      if (pagesFetched === 0) throw err;
      stopped = `request failed: ${err instanceof Error ? err.message : String(err)}`;
      ctx.warn(stopped);
      break;
    }
    pagesFetched++;
    if (total == null) total = data.count ?? null;

    const rows: Record<string, unknown>[] = [];
    for (const filing of data.results ?? []) {
      const row = historyRow(filing);
      if (!row) { ctx.quarantine(`senate_lda_history:page${page}`, "missing filing_uuid"); continue; }
      if (!ctx.markSeen(row.filing_uuid as string)) continue;
      ctx.rowsSeen++;
      rows.push(row);
    }
    if (rows.length > 0) {
      const result = await sql`
        insert into lobbying (
          filing_uuid, filing_type, registrant, client, amount,
          period_year, period_quarter, issue_area, issues, source_ref, posted_at
        )
        select filing_uuid, filing_type, registrant, client, amount,
               period_year, period_quarter, issue_area, issues, source_ref, posted_at
          from jsonb_to_recordset(${sql.json(rows as never)}::jsonb) as t(
            filing_uuid text, filing_type text, registrant text, client text, amount numeric,
            period_year int, period_quarter int, issue_area text, issues jsonb,
            source_ref text, posted_at timestamptz)
        on conflict (filing_uuid) where filing_uuid is not null do update
          set filing_type = excluded.filing_type,
              registrant = excluded.registrant,
              client = excluded.client,
              amount = excluded.amount,
              period_year = excluded.period_year,
              period_quarter = excluded.period_quarter,
              issue_area = excluded.issue_area,
              source_ref = excluded.source_ref,
              posted_at = excluded.posted_at
      `;
      ctx.rowsChanged += result.count ?? 0;
      const last = (data.results ?? []).map((f) => f.dt_posted).filter((d): d is string => !!d).pop();
      if (last) cursor = last;
    }

    if (data.next == null) { complete = true; break; }
    page++;
    if (!apiKey) await sleep(keylessSleepMs());
  }

  const [size] = await sql<{ mb: number }[]>`select round(pg_database_size(current_database()) / 1048576.0)::int as mb`;
  console.log(`senate_lda_history: ${pagesFetched} pages from ${startAfter}, reached ${cursor ?? "nothing"}, ` +
    `${complete ? "COMPLETE" : `stopped (${stopped})`}; window holds ${total ?? "?"} filings from this start; database ${size?.mb ?? "?"} MB`);

  ctx.extra["history_since"] = since;
  ctx.extra["started_after"] = startAfter;
  ctx.extra["cursor"] = cursor;
  ctx.extra["history_complete"] = complete;
  ctx.extra["stopped"] = stopped;
  ctx.extra["pages_fetched"] = pagesFetched;
  ctx.extra["filings_from_start"] = total;
  ctx.extra["keyless"] = !apiKey;
  ctx.extra["db_size_mb"] = size?.mb ?? null;

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: complete ? "success" : "partial",
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
