import { test } from "node:test";
import assert from "node:assert/strict";
import {
  payMarked, payMoney, payFilingUrl, shownYears, sortYears, paySummary, payGlance, PAY_YEARS, PAY_CAVEAT, PAY_MARK_NOTE, PAY_ROW_LABEL, payCoverageSentence,
  packPayHub, unpackPayHub, payScreen, parsePayHash, toPayHash, isPayViewHash, payViewCsv, DEFAULT_PAY_VIEW, NO_PAY_FILTER, PAY_CSV_COLUMNS, payLog, emptyPay, sortPay,
  type PayYear, type PayHubCompany,
} from "../web/src/lib/execpay";

const y = (fye: string, v: PayYear["values"], accession: string | null = "0000000001-26-000001"): PayYear => ({ fiscalYearEnd: fye, values: v, accession });
const co = (name: string, cik: string, div = "manufacturing"): PayHubCompany => ({ name, path: `/companies/${name.toLowerCase()}/`, ticker: name.slice(0, 3).toUpperCase(), cik, division: { name: "Manufacturing", slug: div } });

test("marks: 1 billion or more either way, or a total between 0 and 1,000", () => {
  assert.equal(payMarked("peo_total", 999_999_999), false);
  assert.equal(payMarked("peo_total", 1_000_000_000), true);
  assert.equal(payMarked("peo_actually_paid", -2_400_000_000), true);
  assert.equal(payMarked("peo_total", 1), true);
  assert.equal(payMarked("peo_total", 999), true);
  assert.equal(payMarked("peo_total", 1000), false);
  assert.equal(payMarked("peo_total", 0), true);
  assert.equal(payMarked("neo_avg_total", 500), true);
  assert.equal(payMarked("peo_actually_paid", 500), false);   // actually paid is not a total
  assert.equal(payMarked("peo_actually_paid", -500), false);
  assert.equal(payMarked("peo_total", null), false);
});
test("money prints with a real minus sign, dollars only", () => {
  assert.equal(payMoney(21_400_000), "$21.4M");
  assert.equal(payMoney(-3_100_000), "−$3.1M");
});
test("filing folder address", () => {
  assert.equal(payFilingUrl("0001045810", "0001045810-26-000123"), "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000123/");
  assert.equal(payFilingUrl("0001045810", null), null);
  assert.equal(payFilingUrl("1045810", "0001045810-26-000123"), null);
  assert.equal(payFilingUrl("0001045810", "../x"), null);
});
test("years: newest first, the cap shows 4", () => {
  const ys = ["2022-01-30", "2026-01-25", "2023-01-29", "2025-01-26", "2024-01-28"].map((d) => y(d, { peo_total: 1e7 }));
  assert.equal(PAY_YEARS, 4);
  assert.deepEqual(shownYears(ys).map((x) => x.fiscalYearEnd), ["2026-01-25", "2025-01-26", "2024-01-28", "2023-01-29"]);
  assert.deepEqual(sortYears([y("bad", {}), ...ys]).length, 5);
  assert.match(paySummary("Acme", ys), /figures on file for 5 fiscal years, the newest ending January 25, 2026\. The table shows the newest 4\./);
  assert.match(paySummary("Acme", [ys[0]!]), /for 1 fiscal year, .*shows that year/);
});
test("glance tile: needs the principal executive officer total", () => {
  assert.deepEqual(payGlance([y("2026-01-25", { peo_total: 21_400_000 })]), { value: "$21.4M", note: "year ending Jan 25, 2026" });
  assert.equal(payGlance([y("2026-01-25", { neo_avg_total: 5e6 })]), null);
});
test("wording: no names, no verdicts, no dashes as punctuation", () => {
  for (const t of [PAY_CAVEAT, PAY_MARK_NOTE, ...Object.values(PAY_ROW_LABEL)]) assert.ok(!/[—–]/.test(t), t);
  assert.match(PAY_CAVEAT, /names no person/);
  assert.equal(PAY_ROW_LABEL.peo_total, "Principal executive officer: total, Summary Compensation Table");
});
test("hub: newest year per company, sorted by total, missing last both ways", () => {
  const pay = new Map<string, PayYear[]>([
    ["0000000001", [y("2025-12-31", { peo_total: 5e6 }), y("2024-12-31", { peo_total: 9e9 })]],
    ["0000000002", [y("2026-03-31", { peo_total: 20e6, peo_actually_paid: -3e6 })]],
    ["0000000003", [y("2025-12-31", { neo_avg_total: 2e6 })]],
    ["0000000004", []],
  ]);
  const cos = [co("Aaa", "0000000001"), co("Bbb", "0000000002"), co("Ccc", "0000000003"), co("Ddd", "0000000004")];
  const d = packPayHub("2026-11-20", cos, pay);
  assert.equal(d.rows.length, 3);
  assert.equal(d.pages, 4);
  const rows = unpackPayHub(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(payScreen(rows, DEFAULT_PAY_VIEW).rows.map((r) => r.c.name), ["Bbb", "Aaa", "Ccc"]);
  assert.deepEqual(sortPay(rows, "peo_total", "asc").map((r) => r.c.name), ["Aaa", "Bbb", "Ccc"]);
  assert.deepEqual(sortPay(rows, "neo_avg_total", "desc").map((r) => r.c.name), ["Ccc", "Aaa", "Bbb"]);
  assert.equal(payScreen(rows, { ...DEFAULT_PAY_VIEW, f: { ...NO_PAY_FILTER, min: 10_000_000 } }).total, 1);
  assert.equal(payScreen(rows, { ...DEFAULT_PAY_VIEW, f: { ...NO_PAY_FILTER, fy: "2026" } }).total, 1);
  assert.equal(payScreen(rows, { ...DEFAULT_PAY_VIEW, f: { ...NO_PAY_FILTER, q: "cc" } }).total, 1);
  assert.equal(rows.find((r) => r.c.name === "Aaa")!.fye, "2025-12-31");
});
test("coverage sentence", () => {
  assert.match(payCoverageSentence(394, 998), /394 of the 998 companies with a page on this site have figures on file, about 4 in 10/);
});
test("address round trip and junk", () => {
  const v = parsePayHash("#division=manufacturing&fy=2025&min=50000000&q=ac&sort=peo_actually_paid&dir=asc&page=3&n=25");
  assert.equal(toPayHash(v), "#division=manufacturing&fy=2025&min=50000000&q=ac&sort=peo_actually_paid&dir=asc&page=3&n=25");
  assert.equal(toPayHash(DEFAULT_PAY_VIEW), "");
  assert.deepEqual(parsePayHash("#fy=99&min=7&sort=x&page=0&n=3"), DEFAULT_PAY_VIEW);
  assert.equal(isPayViewHash("#about"), false);
});
test("csv: header, marked column, formula guard", () => {
  const pay = new Map([["0000000001", [y("2025-12-31", { peo_total: 1, peo_actually_paid: 2_400_000_000 })]]]);
  const rows = unpackPayHub(packPayHub("2026-11-20", [co("=X", "0000000001")], pay));
  const lines = payViewCsv(rows, DEFAULT_PAY_VIEW).replace(/^﻿/, "").split("\r\n");
  assert.equal(lines[0], PAY_CSV_COLUMNS.map((c) => c.key).join(","));
  assert.equal(lines[0], "company,cik,ticker,fiscal_year_end,peo_total,peo_actually_paid,neo_avg_total,neo_avg_actually_paid,marked,accession,source_url,page_url");
  assert.match(lines[1]!, /^'=X,0000000001,=?[A-Z']*/);
  assert.match(lines[1]!, /,1,2400000000,,,true,/);
});
test("log line", () => {
  const d = emptyPay();
  d.byCik.set("0000000001", [y("2025-12-31", { peo_total: 1, peo_actually_paid: 2_400_000_000 })]);
  assert.match(payLog(d, new Set(["0000000001"])), /2 figures for 1 companies on the site, newest year end 2025-12-31; 0 companies with more than 4 years; 0 with no principal executive total; 2 marked figures/);
});
