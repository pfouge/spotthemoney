// Is every data source still updating on its own?   node scripts/freshness-check.mjs
//
// The question this answers used to need a person reading GitHub Actions logs: a source can
// be "green" and frozen (senate_lda re-read January for a week), "red" for a missing key
// (FEC), or ingested but invisible (unpublished filings). This script reads the database —
// `ingest_runs` is the diagnostic of record — and reports one line per source:
//
//   OK              ran recently and its newest record is recent
//   NOT CONFIGURED  the job no-ops because a key/account is missing (listed, never fails)
//   STALE           ran, but the newest record is older than the source's allowance
//   FAILING         the last run failed, or there has been no successful run recently
//
// Exit code 1 when anything is STALE or FAILING (ingest.yml runs this last, so GitHub emails
// the failure). Writes the same table to $GITHUB_STEP_SUMMARY when set. `--json` prints JSON.
//
// Allowances are in days and deliberately loose enough for weekends and federal holidays.
import postgres from "postgres";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const asJson = process.argv.includes("--json");

// code: ingest_runs source code · runDays: max age of the last successful run ·
// newest: SQL returning the newest record date (or null) · dataDays: max age of that date.
const CHECKS = [
  { code: "treasury_yield_curve", label: "Treasury yield curve", runDays: 2, dataDays: 6,
    newest: `select max(o.obs_date) from rate_observations o join rate_series s on s.id = o.series_id where s.code = 'UST_PAR_10Y'` },
  { code: "treasury_real_yield_curve", label: "TIPS real yields", runDays: 2, dataDays: 6,
    newest: `select max(o.obs_date) from rate_observations o join rate_series s on s.id = o.series_id where s.code = 'UST_REAL_10Y'` },
  { code: "ibonds", label: "I-Bond composite rate", runDays: 2, dataDays: 200,
    newest: `select max(o.obs_date) from rate_observations o join rate_series s on s.id = o.series_id where s.code = 'IBOND_COMPOSITE'` },
  { code: "bls_cpi", label: "CPI-U (BLS)", runDays: 2, dataDays: 80,
    newest: `select max(o.obs_date) from rate_observations o join rate_series s on s.id = o.series_id where s.code = 'CPI_U_NSA'` },
  { code: "congress_roster", label: "Congress roster (party/state)", runDays: 2 },
  { code: "congress_ptr", label: "House PTRs (Congress trades)", runDays: 2, dataDays: 14,
    newest: `select max(filed_at)::date from filings where source = 'house_ptr'` },
  { code: "sec_form4", label: "SEC Form 4 (insider trades)", runDays: 2, dataDays: 6,
    newest: `select max(filed_at)::date from filings where source = 'sec_form4'` },
  { code: "senate_lda", label: "Senate lobbying filings", runDays: 2, dataDays: 7,
    newest: `select max(posted_at)::date from lobbying` },
  // Both feeds carry future-dated records (planned contract actions, filer typos); without the
  // <= current_date guard the newest date is always "fresh" and a frozen feed never trips.
  { code: "usaspending", label: "USAspending contracts", runDays: 2, dataDays: 10,
    newest: `select max(action_date) from contracts where action_date <= current_date` },
  { code: "fec_committees", label: "FEC committees", runDays: 8 },
  // Receipts appear only after a committee files (monthly or quarterly), hence the long allowance.
  { code: "fec_schedule_a", label: "FEC donations", runDays: 2, dataDays: 75,
    newest: `select max(donated_at) from donations where donated_at <= current_date` },
  // Switched off 2026-10-04 (docs/04 #33): the job reports a skip, which lists here as NOT CONFIGURED and never fails.
  { code: "twelvedata_eod", label: "Stock prices (Twelve Data)", runDays: 2, dataDays: 6,
    newest: `select max(price_date) from security_prices` },
  { code: "universe", label: "Tracked-ticker universe", runDays: 2 },
];

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const days = (d) => (d == null ? null : Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
const rows = [];
let bad = 0;

try {
  const last = await sql`
    select distinct on (s.code) s.code, r.status::text as status, r.finished_at, r.rows_seen, r.rows_changed,
           left(r.error, 140) as error, r.stats->>'skipped' as skipped
      from ingest_runs r join sources s on s.id = r.source_id
     where r.status <> 'running'
     order by s.code, r.id desc`;
  const lastOk = await sql`
    select s.code, max(r.finished_at) as at
      from ingest_runs r join sources s on s.id = r.source_id
     where r.status in ('success','partial') group by s.code`;
  const byCode = new Map(last.map((r) => [r.code, r]));
  const okByCode = new Map(lastOk.map((r) => [r.code, r.at]));

  for (const c of CHECKS) {
    const run = byCode.get(c.code);
    const okAge = days(okByCode.get(c.code));
    let newest = null;
    if (c.newest) { const [n] = await sql.unsafe(c.newest); newest = n ? Object.values(n)[0] : null; }
    const newestStr = newest ? new Date(newest).toISOString().slice(0, 10) : "—";
    const dataAge = days(newest);

    let state = "OK", why = "";
    if (!run) { state = "FAILING"; why = "never ran"; }
    else if (run.skipped) { state = "NOT CONFIGURED"; why = run.skipped; }
    else if (run.status === "failed") { state = "FAILING"; why = run.error ?? "last run failed"; }
    else if (okAge == null || okAge > c.runDays) { state = "FAILING"; why = `no successful run in ${okAge ?? "∞"} days`; }
    else if (c.newest && (dataAge == null || dataAge > c.dataDays)) { state = "STALE"; why = `newest record ${newestStr}, allowance ${c.dataDays} days`; }
    if (state === "STALE" || state === "FAILING") bad++;

    rows.push({
      source: c.label, code: c.code, state,
      lastRun: run?.finished_at ? new Date(run.finished_at).toISOString().slice(0, 16).replace("T", " ") : "—",
      seen: run?.rows_seen ?? 0, written: run?.rows_changed ?? 0, newest: newestStr, note: why,
    });
  }

  // Classification checks: things that ingest fine and still never reach a filter.
  const [pub] = await sql`
    select count(*)::int as n from filings f join publish_gates g on g.source = f.source
     where not f.is_published and f.review in ('auto_approved','approved') and f.confidence >= 0.9`;
  const [held] = await sql`select count(*)::int as n from filings where not is_published and (review = 'pending' or confidence < 0.9)`;
  const [noParty] = await sql`
    select count(distinct p.id)::int as n from people p
      join person_roles r on r.person_id = p.id and r.role_kind = 'congress'
     where r.party is null and exists (select 1 from transactions t where t.person_id = p.id)`;
  const [noTicker] = await sql`
    select count(*)::int as n from transactions t join filings f on f.id = t.filing_id
     where f.source in ('house_ptr','senate_ptr') and t.security_id is null`;
  const extra = [
    { check: "Publishable filings still unpublished", n: pub.n, fail: pub.n > 0, note: "should be 0 after every run (publish_approved_filings)" },
    { check: "Members with trades but no party", n: noParty.n, fail: noParty.n > 0, note: "party filter drops these; congress_roster seat match should clear them" },
    { check: "Filings held for human review", n: held.n, fail: false, note: "scanned PTRs / low confidence — expected, review when convenient" },
    { check: "Congress trades with no ticker", n: noTicker.n, fail: false, note: "bonds, funds, private assets — shown in tables, not on the map" },
  ];
  bad += extra.filter((e) => e.fail).length;

  if (asJson) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ok: bad === 0, sources: rows, classification: extra }, null, 2));
  } else {
    const md = [
      `## Data freshness — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      "",
      "| Source | State | Last run (UTC) | Seen | Written | Newest record | Note |",
      "|---|---|---|---:|---:|---|---|",
      ...rows.map((r) => `| ${r.source} | ${r.state} | ${r.lastRun} | ${r.seen} | ${r.written} | ${r.newest} | ${r.note} |`),
      "",
      "| Classification check | Count | Result | Note |",
      "|---|---:|---|---|",
      ...extra.map((e) => `| ${e.check} | ${e.n} | ${e.fail ? "FAIL" : "ok"} | ${e.note} |`),
      "",
      bad === 0 ? "All configured sources are updating." : `${bad} problem(s) — see STALE / FAILING / FAIL rows.`,
    ].join("\n");
    console.log(md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
} finally {
  await sql.end();
}
process.exit(bad === 0 ? 0 : 1);
