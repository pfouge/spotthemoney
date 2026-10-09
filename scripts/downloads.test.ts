// Offline tests for the pieces of lib/downloads.ts that need no database. Run:
//   npx tsx --test scripts/downloads.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitByPeriod, sizeLabel, memberCsvPath, stockCsvPath, tradeColumns } from "../web/src/lib/downloads";
import { toCsv, parseCsv } from "../web/src/lib/csv";
import type { Flagship, Txn } from "../web/src/lib/flagship";

const row = (d: string | null) => ({ d });
test("splitByPeriod: by quarter, newest first, nothing lost", () => {
  const rows = ["2026-01-05", "2026-03-31", "2026-04-01", "2025-12-31", null].map(row);
  const out = splitByPeriod(rows, (r) => r.d, 10);
  assert.deepEqual(out.map((p) => [p.period, p.label, p.rows.length]), [["undated", "no date", 1], ["2026-q2", "2026 Q2", 1], ["2026-q1", "2026 Q1", 2], ["2025-q4", "2025 Q4", 1]]);
  assert.equal(out.reduce((n, p) => n + p.rows.length, 0), rows.length);
});
test("splitByPeriod: a quarter over the limit is cut by month, a month over the limit into parts", () => {
  const rows = [...Array(3).fill("2026-07-10"), ...Array(2).fill("2026-08-10"), "2026-09-10", "2026-04-02"].map(row);
  const out = splitByPeriod(rows, (r) => r.d, 2);
  assert.deepEqual(out.map((p) => [p.period, p.rows.length]), [["2026-09", 1], ["2026-08", 2], ["2026-07-part1", 2], ["2026-07-part2", 1], ["2026-q2", 1]]);
  assert.equal(out[1]!.label, "August 2026");
  assert.equal(out[2]!.label, "July 2026, part 1");
  assert.ok(out.every((p) => p.rows.length <= 2));
  assert.equal(out.reduce((n, p) => n + p.rows.length, 0), rows.length);
  assert.equal(new Set(out.map((p) => p.period)).size, out.length);
});
test("paths and sizes", () => {
  assert.equal(memberCsvPath("lloyd-doggett"), "/downloads/congress/lloyd-doggett.csv");
  assert.equal(stockCsvPath("NVDA"), "/downloads/stocks/nvda.csv");
  assert.equal(sizeLabel(512), "512 bytes");
  assert.equal(sizeLabel(20480), "20 KB");
  assert.equal(sizeLabel(3 * 1024 * 1024), "3.0 MB");
});
test("trade columns: a congressional row gives a range and no value; a Form 4 row gives a value and no range", () => {
  const people = new Map([[1, { id: 1, name: "Ann Able", slug: "ann-able", isCongress: true, isInsider: false, roles: [{ kind: "congress", chamber: "house", state: "TX", district: "8", party: "Democrat" }] }],
    [2, { id: 2, name: "=EVIL CORP OFFICER", slug: "evil", isCongress: false, isInsider: true, roles: [{ kind: "insider", companyId: 5, officerTitle: "CFO" }] }]]);
  const m = { people, securities: new Map([[9, { id: 9, ticker: "AAA", name: "Triple A, Inc.", companyId: 5 }]]), companies: new Map([[5, { id: 5, name: "Triple A, Inc." }]]),
    filings: new Map([[7, { externalId: "20031234" }], [8, { externalId: "0001-26-000001" }]]) } as unknown as Flagship;
  const base = { securityId: 9, isDerivative: false, disclosedAt: "2026-03-01", is10b51: false, assetType: "stock", filedAt: "2026-03-01", isPublished: true };
  const ptr = { ...base, id: 1, filingId: 7, personId: 1, side: "buy", code: "p", txnDate: "2026-01-01", amountLow: 1001, amountHigh: 15000, shares: null, price: null, lagDays: 59, ownerType: "spouse", source: "house_ptr", sourceUrl: "https://disclosures-clerk.house.gov/x.pdf", value: 15000 } as unknown as Txn;
  const f4 = { ...base, id: 2, filingId: 8, personId: 2, side: "sell", code: "S", txnDate: "2026-02-27", amountLow: null, amountHigh: null, shares: 100, price: 12.345, lagDays: 2, ownerType: null, source: "sec_form4", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000126000001/form4.xml", value: 1234.5, jointOf: 99, isPublished: false } as unknown as Txn;
  const cols = tradeColumns(m);
  const [head, a, b] = parseCsv(toCsv(cols, [ptr, f4]));
  const get = (r: string[], k: string) => r[head!.indexOf(k)];
  assert.equal(new Set(head).size, head!.length);
  assert.deepEqual([get(a!, "source"), get(a!, "filer"), get(a!, "chamber"), get(a!, "state"), get(a!, "party"), get(a!, "owner")], ["House PTR", "Ann Able", "house", "TX", "Democrat", "spouse"]);
  assert.deepEqual([get(a!, "amount_low"), get(a!, "amount_high"), get(a!, "value"), get(a!, "shares"), get(a!, "late"), get(a!, "lag_days")], ["1001", "15000", "", "", "true", "59"]);
  assert.equal(get(a!, "page_url"), "https://spotthemoney.com/congress/ann-able/");
  assert.equal(get(a!, "security"), "Triple A, Inc.");
  assert.deepEqual([get(b!, "source"), get(b!, "filer"), get(b!, "chamber"), get(b!, "owner")], ["SEC Form 4", "'=EVIL CORP OFFICER", "", ""]);
  assert.deepEqual([get(b!, "amount_low"), get(b!, "amount_high"), get(b!, "shares"), get(b!, "price"), get(b!, "value")], ["", "", "100", "12.35", "1234.5"]);
  assert.deepEqual([get(b!, "also_in_another_filing"), get(b!, "under_review"), get(b!, "late"), get(b!, "filing_id")], ["true", "true", "false", "0001-26-000001"]);
  assert.equal(get(b!, "filing_url"), "https://www.sec.gov/Archives/edgar/data/1/000126000001/");
  assert.ok(!head!.some((k) => /donor|email|address|ssn|phone/i.test(k)));
});
