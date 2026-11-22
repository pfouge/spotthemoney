// Tests for the 13F holdings source. The reading tests need no database. The end-to-end test runs
// the real job against a LOCAL database and only when INST_13F_E2E=1 (DATABASE_URL must name a
// local database; it inserts and removes rows of its own).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSubs, setDirs, ingestSec13fHoldings } from "./sec_13f_holdings.js";
import { getDb, closeDb } from "../lib/db.js";

type Table = { name: string; header: string[]; rows: string[][] };

function writeSet(root: string, folder: string, tables: Table[]): string {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  for (const t of tables) {
    const body = [t.header.join("\t"), ...t.rows.map((r) => r.join("\t"))].join("\n") + "\n";
    fs.writeFileSync(path.join(dir, `${t.name}.tsv`), body);
  }
  return dir;
}

const SUB_H = ["ACCESSION_NUMBER", "FILING_DATE", "SUBMISSIONTYPE", "CIK", "PERIODOFREPORT"];
const COV_H = ["ACCESSION_NUMBER", "ISAMENDMENT", "AMENDMENTNO", "AMENDMENTTYPE", "FILINGMANAGER_NAME", "REPORTTYPE"];
const INF_H = ["ACCESSION_NUMBER", "INFOTABLE_SK", "NAMEOFISSUER", "TITLEOFCLASS", "CUSIP", "VALUE", "SSHPRNAMT", "SSHPRNAMTTYPE", "PUTCALL"];

const NVDA = "67066G104", AAPL = "037833100", AAPL_FB = "037833109", MSFT_AMBIG = "594918104", UNKNOWN = "88160R101";

function setA(root: string) {
  return writeSet(root, "2026q1_form13f", [
    { name: "SUBMISSION", header: SUB_H, rows: [
      ["A1", "15-MAY-2026", "13F-HR", "0000111111", "31-MAR-2026"],
      ["A2", "10-MAY-2026", "13F-HR", "0000222222", "31-MAR-2026"],
      ["A3", "20-MAY-2026", "13F-HR/A", "0000222222", "31-MAR-2026"],
      ["A4", "11-MAY-2026", "13F-NT", "0000333333", "31-MAR-2026"],
    ] },
    { name: "COVERPAGE", header: COV_H, rows: [
      ["A1", "N", "", "", "ALPHA CAPITAL", "13F HOLDINGS REPORT"],
      ["A2", "N", "", "", "BETA PARTNERS", "13F HOLDINGS REPORT"],
      ["A3", "Y", "1", "RESTATEMENT", "BETA PARTNERS", "13F HOLDINGS REPORT"],
      ["A4", "N", "", "", "GAMMA", "13F NOTICE"],
    ] },
    { name: "INFOTABLE", header: INF_H, rows: [
      ["A1", "1", "NVIDIA CORP", "COM", NVDA, "1000", "10", "SH", ""],
      ["A1", "2", "NVIDIA CORP", "COM", NVDA, "500", "5", "SH", ""],
      ["A1", "3", "APPLE INC", "COM", AAPL, "2000", "20", "SH", ""],
      ["A1", "4", "APPLE INC", "COM", AAPL_FB, "300", "3", "SH", ""],
      ["A1", "5", "MICROSOFT", "COM", MSFT_AMBIG, "400", "4", "SH", ""],
      ["A1", "6", "TESLA", "COM", UNKNOWN, "900", "9", "SH", ""],
      ["A2", "7", "NVIDIA CORP", "COM", NVDA, "111", "1", "SH", ""],
      ["A3", "8", "NVIDIA CORP", "COM", NVDA, "700", "7", "SH", ""],
      ["A3", "9", "NVIDIA CORP", "COM", NVDA, "50", "5", "SH", "Put"],
      ["A3", "10", "APPLE INC", "COM", AAPL, "abc", "5", "SH", ""],
      ["A4", "11", "NVIDIA CORP", "COM", NVDA, "99999", "99", "SH", ""],
    ] },
  ]);
}

function setB(root: string) {
  return writeSet(root, "01apr2026-30jun2026_form13f", [
    { name: "SUBMISSION", header: SUB_H, rows: [
      ["B1", "14-AUG-2026", "13F-HR", "0000111111", "30-JUN-2026"],
      ["B2", "20-AUG-2026", "13F-HR/A", "0000111111", "31-MAR-2026"],
      ["B3", "12-AUG-2026", "13F-HR", "0000444444", "30-JUN-2026"],
    ] },
    { name: "COVERPAGE", header: COV_H, rows: [
      ["B1", "N", "", "", "ALPHA CAPITAL", "13F HOLDINGS REPORT"],
      ["B2", "Y", "1", "NEW HOLDINGS", "ALPHA CAPITAL", "13F HOLDINGS REPORT"],
      ["B3", "N", "", "", "DELTA", "13F HOLDINGS REPORT"],
    ] },
    { name: "INFOTABLE", header: INF_H, rows: [
      ["B1", "1", "NVIDIA CORP", "COM", NVDA, "1200", "12", "SH", ""],
      ["B1", "2", "APPLE INC", "COM", AAPL, "2100", "21", "SH", ""],
      ["B2", "3", "APPLE INC", "COM", AAPL, "250", "2", "SH", ""],
      ["B2", "4", "NVIDIA CORP", "COM", NVDA, "100", "1", "SH", ""],
      ["B3", "5", "NVIDIA CORP", "COM", NVDA, "5000", "50", "SH", ""],
    ] },
  ]);
}

test("readSubs keeps only 13F-HR and 13F-HR/A and joins the cover page", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f13-"));
  const dir = setA(root);
  const { subs, rowsSubmission } = await readSubs(dir, new Set());
  assert.equal(rowsSubmission, 4);
  assert.deepEqual(subs.map((s) => s.accession).sort(), ["A1", "A2", "A3"]);
  const a3 = subs.find((s) => s.accession === "A3")!;
  assert.equal(a3.isAmendment, true);
  assert.equal(a3.amendType, "RESTATEMENT");
  assert.equal(a3.period, "2026-03-31");
  assert.equal(a3.filed, "2026-05-20");
  assert.equal(a3.managerCik, "0000222222");
  assert.equal(a3.managerName, "BETA PARTNERS");
});

test("readSubs fails with the column name when a required column is missing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f13-"));
  const dir = writeSet(root, "bad_form13f", [
    { name: "SUBMISSION", header: ["ACCESSION_NUMBER", "FILING_DATE", "SUBMISSIONTYPE", "CIK"], rows: [] },
    { name: "COVERPAGE", header: COV_H, rows: [] },
  ]);
  await assert.rejects(readSubs(dir, new Set()), /PERIODOFREPORT/);
});

test("setDirs finds set folders under a root, or the root itself", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f13-"));
  setA(root);
  setB(root);
  fs.mkdirSync(path.join(root, "not_a_set"));
  assert.deepEqual(setDirs(root).map((d) => path.basename(d)), ["01apr2026-30jun2026_form13f", "2026q1_form13f"]);
  assert.deepEqual(setDirs(path.join(root, "2026q1_form13f")).length, 1);
});

// ── End to end (local database only) ───────────────────────────────────────

const E2E = process.env.INST_13F_E2E === "1";

test("end to end on a local database", { skip: !E2E }, async () => {
  const url = process.env.DATABASE_URL ?? "";
  assert.ok(/127\.0\.0\.1|localhost/.test(url), "DATABASE_URL must be a local database");
  const sql = getDb();
  const cleanDb = async () => {
    await sql`delete from inst_holdings`;
    await sql`delete from inst_holdings_loaded`;
    await sql`delete from inst_managers`;
    await sql`delete from schedule13_filings where accession like 'T13F-%'`;
  };
  const insertClaim = async (acc: string, cik: string, cusip: string) => sql`
    insert into schedule13_filings (accession, form_type, schedule, filed_at, issuer_cik, issuer_cusip)
    values (${acc}, 'SCHEDULE 13G', '13G', '2026-02-01', ${cik}, ${cusip})`;
  const run = async (env: Record<string, string | undefined>) => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    try { return await ingestSec13fHoldings(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  };
  const holdings = async () => (await sql`
    select period::text as period, manager_cik, cusip, put_call, shares::float8 as shares, value::float8 as value, rows, accession
      from inst_holdings order by period, manager_cik, cusip, put_call`);

  await cleanDb();
  try {
    await insertClaim("T13F-1", "0001045810", NVDA);
    await insertClaim("T13F-2", "0000320193", AAPL);
    await insertClaim("T13F-3", "0000789019", MSFT_AMBIG);
    await insertClaim("T13F-4", "0000002488", MSFT_AMBIG);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "f13e-"));
    setA(root);
    setB(root);

    // 1. first run
    const r1 = await run({ INST_13F_DIR: root, INST_MAX_MINUTES: "40" });
    assert.equal(r1.status, "success", r1.error);
    const h = await holdings();
    assert.equal(h.length, 8);
    const find = (period: string, mgr: string, cusip: string, pc = "") =>
      h.find((x) => x.period === period && x.manager_cik === mgr && x.cusip === cusip && x.put_call === pc)!;
    // A1, Q1: two NVDA lines summed, then the NEW HOLDINGS addition (B2) added on top
    assert.deepEqual([find("2026-03-31", "0000111111", NVDA).shares, find("2026-03-31", "0000111111", NVDA).value, find("2026-03-31", "0000111111", NVDA).rows], [16, 1600, 3]);
    assert.deepEqual([find("2026-03-31", "0000111111", AAPL).shares, find("2026-03-31", "0000111111", AAPL).value], [22, 2250]);
    assert.deepEqual([find("2026-03-31", "0000111111", AAPL_FB).shares, find("2026-03-31", "0000111111", AAPL_FB).value], [3, 300]);
    // 222222: the restatement replaced the original (111/1 is gone), the put is its own row
    assert.deepEqual([find("2026-03-31", "0000222222", NVDA).shares, find("2026-03-31", "0000222222", NVDA).value], [7, 700]);
    assert.deepEqual([find("2026-03-31", "0000222222", NVDA, "PUT").shares, find("2026-03-31", "0000222222", NVDA, "PUT").value], [5, 50]);
    assert.equal(find("2026-06-30", "0000444444", NVDA).value, 5000);
    assert.equal(h.some((x) => x.cusip === MSFT_AMBIG || x.cusip === UNKNOWN), false);
    assert.equal(h.some((x) => x.manager_cik === "0000333333"), false);
    const sqlCount = Number((await sql`select count(*)::int as n from inst_holdings`)[0]!.n);
    assert.equal(sqlCount, 8);
    assert.equal(r1.stats!["ambiguous_cusips"], 1);
    assert.equal(r1.stats!["fallback_matches"], 1);
    assert.equal(r1.stats!["non_finite_skipped"], 1);
    assert.equal(r1.stats!["sets_loaded"], 2);
    assert.equal(r1.stats!["additions_applied"], 1);
    assert.equal(r1.stats!["restatements_applied"], 1);
    assert.equal(JSON.stringify(r1.stats).includes("@"), false);

    // 2. second run changes nothing
    const before = JSON.stringify(await holdings());
    const r2 = await run({ INST_13F_DIR: root });
    assert.equal(r2.status, "success", r2.error);
    assert.equal(r2.stats!["sets_loaded"], 0);
    assert.equal(r2.stats!["sets_skipped_loaded"], 2);
    assert.equal(JSON.stringify(await holdings()), before);

    // 2b. a forced reload gives the same table
    const r2b = await run({ INST_13F_DIR: root, INST_RELOAD: "1" });
    assert.equal(r2b.status, "success", r2b.error);
    assert.equal(JSON.stringify(await holdings()), before);

    // 3. unknown shape: nothing written
    await cleanDb();
    await insertClaim("T13F-1", "0001045810", NVDA);
    const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), "f13bad-"));
    writeSet(badRoot, "zzz_form13f", [
      { name: "SUBMISSION", header: SUB_H, rows: [["Z1", "01-SEP-2026", "13F-HR", "0000555555", "30-JUN-2026"]] },
      { name: "COVERPAGE", header: COV_H, rows: [["Z1", "N", "", "", "ZETA", "X"]] },
      { name: "INFOTABLE", header: ["ACCESSION_NUMBER", "ISSUER", "SOMETHING"], rows: [["Z1", "X", "1"]] },
    ]);
    const r3 = await run({ INST_13F_DIR: badRoot });
    assert.equal(r3.status, "failed");
    assert.match(r3.error ?? "", /CUSIP|NAMEOFISSUER|TITLEOFCLASS|VALUE|SSHPRNAMT/);
    assert.equal(Number((await sql`select count(*)::int as n from inst_holdings`)[0]!.n), 0, "a failed set wrote nothing");
    assert.equal(Number((await sql`select count(*)::int as n from inst_holdings_loaded where set_name = 'zzz_form13f'`)[0]!.n), 0);

    // 4. source down (folder missing)
    const r4 = await run({ INST_13F_DIR: path.join(os.tmpdir(), "f13-does-not-exist") });
    assert.equal(r4.status, "failed");

    // 5. tiny budget: partial, then a later run resumes
    await cleanDb();
    await insertClaim("T13F-1", "0001045810", NVDA);
    await insertClaim("T13F-2", "0000320193", AAPL);
    const r5 = await run({ INST_13F_DIR: root, INST_MAX_MINUTES: "0.00001" });
    assert.equal(r5.status, "partial", r5.error);
    assert.equal(r5.stats!["sets_loaded"], 1);
    assert.equal(r5.stats!["sets_remaining"], 1);
    const r6 = await run({ INST_13F_DIR: root });
    assert.equal(r6.status, "success", r6.error);
    assert.equal(r6.stats!["sets_loaded"], 1);
    assert.equal(Number((await sql`select count(*)::int as n from inst_holdings`)[0]!.n), 8 - 0 - 0 - 0, "the resumed run completed the table (MSFT is not claimed in this scenario)");
  } finally {
    await cleanDb();
    await closeDb();
  }
});
