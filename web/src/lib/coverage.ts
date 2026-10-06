// What the database holds against what the sources publish — built on every deploy and served
// at /data/coverage.json, with a summary on /methodology/#coverage.
//
// Added 2026-10-06 after a run of display bugs (a $68T bar, joint filings counted seven times,
// a 30-day Congress view showing six members) made it clear nobody, including the site, could
// see at a glance how complete each data set was. Counts only: no names, no error text, no
// run-log strings (only numeric stats are copied from ingest_runs).
import { flagshipSql } from "./flagship";

export interface FilingMonth {
  source: string; month: string; filings: number; published: number; pendingReview: number; needsOcr: number;
  paper: number; withRows: number; withTickerRows: number;
}
export interface TxnMonth { source: string; month: string; rows: number; publishedRows: number; withTicker: number; buy: number; sell: number; other: number; derivative: number }
export interface RunRow { source: string; startedAt: string; finishedAt: string | null; status: string; rowsSeen: number | null; rowsChanged: number | null; stats: Record<string, number> }
export interface Coverage {
  builtAt: string; connected: boolean;
  filings: FilingMonth[]; txns: TxnMonth[]; runs: RunRow[];
  tables: Record<string, { month: string; rows: number }[]>;
  totals: Record<string, number>;
  quality: Record<string, number>;
  errors: string[];
}

let memo: Promise<Coverage> | null = null;
export function getCoverage(): Promise<Coverage> { return (memo ??= load()); }

const numericStats = (stats: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (stats && typeof stats === "object") for (const [k, v] of Object.entries(stats as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
};

async function load(): Promise<Coverage> {
  const c: Coverage = { builtAt: new Date().toISOString(), connected: false, filings: [], txns: [], runs: [], tables: {}, totals: {}, quality: {}, errors: [] };
  const sql = flagshipSql();
  if (!sql) return c;
  c.connected = true;
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { c.errors.push(name); console.warn(`[coverage] ${name} failed: ${e instanceof Error ? e.message : String(e)}`); } };

  await step("filings", async () => {
    c.filings = (await sql<FilingMonth[]>`
      select f.source::text as source, coalesce(to_char(f.filed_at, 'YYYY-MM'), 'none') as month,
             count(*)::int as filings,
             count(*) filter (where f.is_published)::int as published,
             count(*) filter (where f.review::text = 'pending')::int as "pendingReview",
             count(*) filter (where f.payload->>'needs_ocr' = 'true')::int as "needsOcr",
             count(*) filter (where f.source::text = 'house_ptr' and left(f.external_id, 1) in ('8', '9'))::int as paper,
             count(*) filter (where exists (select 1 from transactions t where t.filing_id = f.id))::int as "withRows",
             count(*) filter (where exists (select 1 from transactions t where t.filing_id = f.id and t.security_id is not null))::int as "withTickerRows"
        from filings f group by 1, 2 order by 1, 2`).map((r) => ({ ...r }));
  });
  await step("txns", async () => {
    c.txns = (await sql<TxnMonth[]>`
      select f.source::text as source, coalesce(to_char(coalesce(t.disclosed_at, f.filed_at::date), 'YYYY-MM'), 'none') as month,
             count(*)::int as rows,
             count(*) filter (where f.is_published)::int as "publishedRows",
             count(*) filter (where t.security_id is not null)::int as "withTicker",
             count(*) filter (where t.side::text = 'buy')::int as buy,
             count(*) filter (where t.side::text = 'sell')::int as sell,
             count(*) filter (where t.side::text not in ('buy', 'sell'))::int as other,
             count(*) filter (where t.is_derivative)::int as derivative
        from transactions t join filings f on f.id = t.filing_id group by 1, 2 order by 1, 2`).map((r) => ({ ...r }));
  });
  await step("runs", async () => {
    const rows = await sql<{ source: string; started_at: string; finished_at: string | null; status: string; rows_seen: number | null; rows_changed: number | null; stats: unknown }[]>`
      select source, started_at, finished_at, status, rows_seen, rows_changed, stats from (
        select s.code as source, r.started_at::text as started_at, r.finished_at::text as finished_at, r.status::text as status,
               r.rows_seen, r.rows_changed, r.stats, row_number() over (partition by s.code order by r.started_at desc) as n
          from ingest_runs r join sources s on s.id = r.source_id) x
       where n <= 6 order by source, started_at desc`;
    c.runs = rows.map((r) => ({ source: r.source, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, rowsSeen: r.rows_seen, rowsChanged: r.rows_changed, stats: numericStats(r.stats) }));
  });
  const byMonth = async (name: string, q: Promise<{ month: string; rows: number }[]>) => step(name, async () => { c.tables[name] = (await q).map((r) => ({ ...r })); });
  await byMonth("lobbying", sql<{ month: string; rows: number }[]>`select period_year || '-Q' || period_quarter as month, count(*)::int as rows from lobbying group by 1 order by 1`);
  await byMonth("contracts", sql<{ month: string; rows: number }[]>`select coalesce(to_char(action_date, 'YYYY-MM'), 'none') as month, count(*)::int as rows from contracts group by 1 order by 1`);
  await byMonth("donations", sql<{ month: string; rows: number }[]>`select coalesce(to_char(donated_at, 'YYYY-MM'), 'none') as month, count(*)::int as rows from donations group by 1 order by 1`);
  await step("totals", async () => {
    const [t] = await sql<Record<string, number>[]>`
      select (select count(*) from people)::int as people,
             (select count(distinct person_id) from person_roles where role_kind::text = 'congress')::int as "congressPeople",
             (select count(distinct person_id) from person_roles where role_kind::text = 'congress' and chamber::text = 'senate')::int as "senators",
             (select count(distinct f.filer_person_id) from filings f where f.source::text = 'house_ptr')::int as "houseFilers",
             (select count(distinct f.filer_person_id) from filings f where f.source::text = 'house_ptr' and f.is_published)::int as "houseFilersPublished",
             (select count(distinct f.filer_person_id) from filings f where f.source::text = 'senate_ptr')::int as "senateFilers",
             (select count(*) from securities)::int as securities,
             (select count(*) from committees)::int as committees,
             (select count(*) from committees where donations_history_floor is not null)::int as "committeesWithHistory",
             (select count(*) from review_queue where status::text = 'pending')::int as "reviewQueuePending",
             (select (pg_database_size(current_database()) / 1048576)::int) as "databaseMb"`;
    c.totals = { ...t };
  });
  await step("quality", async () => {
    const [q] = await sql<Record<string, number>[]>`
      select count(*) filter (where t.txn_date > current_date)::int as "tradeDateInFuture",
             count(*) filter (where t.txn_date > coalesce(t.disclosed_at, f.filed_at::date))::int as "tradeDateAfterFiling",
             count(*) filter (where t.txn_date is null)::int as "noTradeDate",
             count(*) filter (where f.source::text = 'sec_form4' and t.shares is not null and t.price is not null and t.shares * t.price > 1e12)::int as "form4ValueOverTrillion",
             count(*) filter (where t.security_id is null)::int as "noTicker",
             count(*) filter (where t.person_id is null)::int as "noPerson"
        from transactions t join filings f on f.id = t.filing_id`;
    c.quality = { ...q };
  });
  return c;
}

/** Month rows for one filing source, newest first. */
export function filingMonths(c: Coverage, source: string, months = 13): FilingMonth[] {
  return c.filings.filter((f) => f.source === source && f.month !== "none").sort((a, b) => b.month.localeCompare(a.month)).slice(0, months);
}
/** The newest numeric stat of that name from a source's recent runs (e.g. index_ptrs_2026). */
export function latestStat(c: Coverage, source: string, key: string): number | null {
  for (const r of c.runs) if (r.source === source && typeof r.stats[key] === "number") return r.stats[key]!;
  return null;
}
