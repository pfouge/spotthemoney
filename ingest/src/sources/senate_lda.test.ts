// Tests for the daily lobbying job's gap handling (2026-11-15).
//   Pure helpers always run. The end-to-end tests run against a fake lda.gov API and a REAL
//   LOCAL database only when STM_TEST_DB_URL points at a localhost database that has all
//   migrations applied (they write rows). Run:
//     STM_TEST_DB_URL=postgresql://postgres@127.0.0.1:5433/stm_ingest_test \
//       npx tsx --test ingest/src/sources/senate_lda.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mergeGaps, minPosted, cursorBefore } from "./senate_lda.js";

test("minPosted keeps the earliest naive timestamp", () => {
  assert.equal(minPosted(null, "2026-10-21T10:00:00.123-04:00"), "2026-10-21T10:00:00");
  assert.equal(minPosted("2026-10-21T10:00:00", "2026-10-20T09:00:00-04:00"), "2026-10-20T09:00:00");
  assert.equal(minPosted("2026-10-21T10:00:00", null), "2026-10-21T10:00:00");
});

test("mergeGaps: union from the earlier start to the later end", () => {
  assert.equal(mergeGaps(null, null), null);
  const a = { from: "2026-10-01T00:00:00", to: "2026-10-05T00:00:00" };
  const b = { from: "2026-10-04T00:00:00", to: "2026-10-09T00:00:00" };
  assert.deepEqual(mergeGaps(a, null), a);
  assert.deepEqual(mergeGaps(a, b), { from: "2026-10-01T00:00:00", to: "2026-10-09T00:00:00" });
});

test("cursorBefore steps one second back", () => {
  assert.equal(cursorBefore("2026-10-21T10:00:00-04:00"), "2026-10-21T09:59:59");
});

// ── end-to-end ────────────────────────────────────────────────────────────
const DB = process.env.STM_TEST_DB_URL;
const e2e = DB && /@(127\.0\.0\.1|localhost)[:/]/.test(DB) ? test : test.skip;

const HOUR = 3_600_000;
const BASE = Date.parse("2026-10-01T00:00:00Z");
let total = 0; // the fake API holds filings 0..total-1, filing i posted at BASE + i hours
const naive = (i: number) => new Date(BASE + i * HOUR).toISOString().slice(0, 19);
const filing = (i: number) => ({
  filing_uuid: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  filing_type: "Q3", filing_year: 2026, filing_period: "third_quarter",
  registrant: { name: `Reg ${i}` }, client: { name: `Client ${i}` }, income: null, expenses: "1000",
  lobbying_activities: [{ general_issue_code: "TAX", general_issue_code_display: "Taxes", description: "d" }],
  filing_document_url: `https://example.test/${i}`, dt_posted: `${naive(i)}-04:00`,
});

let server: http.Server;
let sqlMod: typeof import("../lib/db.js");
let lda: typeof import("./senate_lda.js");

before(async () => {
  if (!DB || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    const desc = u.searchParams.get("ordering") === "-dt_posted";
    const after = u.searchParams.get("filing_dt_posted_after");
    const page = Number(u.searchParams.get("page") ?? 1);
    const size = Number(u.searchParams.get("page_size") ?? 25);
    let idx = Array.from({ length: total }, (_, i) => i);
    if (after) idx = idx.filter((i) => naive(i) > after.slice(0, 19));
    if (desc) idx.reverse();
    const slice = idx.slice((page - 1) * size, page * size);
    const more = page * size < idx.length;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ count: idx.length, next: more ? "more" : null, previous: null, results: slice.map(filing) }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.DATABASE_URL = DB;
  process.env.LDA_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.LDA_API_KEY = "fake"; // keyed pacing; the fake ignores it
  process.env.LDA_KEYED_GAP_MS = "1"; // http.ts floors this at 200 ms
  process.env.LDA_FILING_YEAR = "2026";
  delete process.env.LDA_MAX_PAGES;
  sqlMod = await import("../lib/db.js");
  lda = await import("./senate_lda.js");
  const sql = sqlMod.getDb();
  await sql`delete from ingest_runs where source_id in (select id from sources where code = 'senate_lda')`;
  await sql`delete from lobbying`;
});

after(async () => {
  server?.close();
  if (sqlMod) await sqlMod.closeDb();
});

/** A clock that advances one minute per reading, so a budget of N.5 minutes allows N requests. */
const clock = () => { let t = 0; return () => (t += 60_000) - 60_000; };

async function record(result: Awaited<ReturnType<typeof import("./senate_lda.js").ingestSenateLda>>) {
  const sql = sqlMod.getDb();
  const [src] = await sql`insert into sources (code, label, cadence) values ('senate_lda', 'x', 'daily')
    on conflict (code) do update set label = excluded.label returning id`;
  await sql`insert into ingest_runs (source_id, status, finished_at, stats)
    values (${src!.id}, ${result.status}, now(), ${sql.json(result.stats as never)})`;
}
async function stored(): Promise<number> {
  const [r] = await sqlMod.getDb()`select count(*)::int as n from lobbying`;
  return r!.n;
}
async function run(budgetMin: string) {
  process.env.LDA_MAX_MINUTES = budgetMin;
  const r = await lda.ingestSenateLda({ now: clock() });
  await record(r);
  return r;
}

e2e("stops at the first page whose filings are all stored", async () => {
  total = 60;
  const first = await run("60");
  assert.equal(first.status, "success");
  assert.equal(await stored(), 60);
  const again = await run("60");
  assert.equal(again.status, "success");
  assert.equal(again.stats!["pages_fetched"], 1);
  assert.equal(again.stats!["caught_up_on_page"], 1);
  assert.equal(again.stats!["gap_possible"], false);
});

e2e("a busy day beyond the budget is partial with a gap; the next runs close it and report success", async () => {
  total = 60 + 400; // 400 new filings = 16 pages
  const busy = await run("4.5"); // 4 pages = 100 filings
  assert.equal(busy.status, "partial");
  assert.equal(busy.stats!["stopped"], "time budget");
  assert.equal(busy.stats!["gap_possible"], true);
  assert.equal(busy.stats!["pages_fetched"], 4);
  assert.equal(busy.stats!["oldest_posted_seen"], naive(total - 100));
  assert.equal(await stored(), 160);
  const gapFrom1 = busy.stats!["gap_from"] as string;
  assert.equal(busy.stats!["gap_to"], naive(total - 100));

  // Next run: little time, so the gap walk only advances (still partial, gap_from moves up).
  const slow = await run("4.5");
  assert.equal(slow.status, "partial");
  assert.equal(slow.stats!["gap_possible"], true);
  assert.ok((slow.stats!["gap_pages_fetched"] as number) > 0);
  assert.ok((slow.stats!["gap_from"] as string) > gapFrom1, "gap_from advances");
  assert.equal(slow.stats!["gap_to"], naive(total - 100));
  assert.equal(slow.stats!["gap_closed"], false);

  // Next run: plenty of time — closes the gap.
  const closing = await run("60");
  assert.equal(closing.status, "success");
  assert.equal(closing.stats!["gap_closed"], true);
  assert.equal(closing.stats!["gap_possible"], false);
  assert.equal(await stored(), total);

  // And the run after that has nothing left to do.
  const quiet = await run("60");
  assert.equal(quiet.status, "success");
  assert.equal(quiet.stats!["previous_gap"], null);
  assert.equal(quiet.stats!["pages_fetched"], 1);
});

e2e("an explicit LDA_MAX_PAGES still caps the newest-first pass, and the gap is recorded", async () => {
  total += 200; // 8 pages
  process.env.LDA_MAX_PAGES = "2";
  try {
    const capped = await run("60");
    assert.equal(capped.status, "partial");
    assert.equal(capped.stats!["stopped"], "page cap");
    assert.equal(capped.stats!["pages_fetched"], 2);
    assert.equal(capped.stats!["gap_possible"], true);
  } finally {
    delete process.env.LDA_MAX_PAGES;
  }
  const healed = await run("60");
  assert.equal(healed.status, "success");
  assert.equal(await stored(), total);
});
