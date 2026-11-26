// Executive pay from two sources: the frames data first, a proxy statement's figure where frames has
// none, and a year with several principal executive figures kept apart (web/src/lib/execpay.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergePay, proxyFigure, emptySources, eachOf, peoFigures, yearHasFigure, yearMarked, payGlance, packPayHub, unpackPayHub, payScreen, sortPay, payEachSentence,
  eachCellText, payShareWords, payCoverageSentence, payViewCsv, DEFAULT_PAY_VIEW, PAY_CSV_COLUMNS, PAY_EACH_NOTE, PAY_HUB_EACH_NOTE, payLog,
  type PayFact, type ProxyPayFact, type PayHubCompany, type PayData,
} from "../web/src/lib/execpay";
import { toCsv } from "../web/src/lib/csv";

const F = (measure: string, fye: string, value: number, accession = "0000000001-26-000001"): PayFact => ({ measure, fiscalYearEnd: fye, value, accession });
const P = (measure: string, fye: string, seq: number, value: number, dimensioned: boolean, accession = "0000000001-26-000099"): ProxyPayFact => ({ measure, fiscalYearEnd: fye, value, accession, seq, dimensioned });
const co = (name: string, cik: string): PayHubCompany => ({ name, path: `/stocks/${name.toLowerCase()}/`, ticker: name.slice(0, 3).toUpperCase(), cik, division: null });

test("one measure and year of a proxy statement: a figure filed without a person is the figure", () => {
  assert.deepEqual(proxyFigure([P("peo_total", "2025-12-31", 0, 5e6, false)]), { value: 5e6, dropped: 0 });
  assert.deepEqual(proxyFigure([P("peo_total", "2025-12-31", 0, 0, false)]), { value: 0, dropped: 0 });
  assert.equal(proxyFigure([]), null);
  assert.equal(proxyFigure([P("peo_total", "2025-12-31", 0, Number.NaN, true)]), null);
});
test("per-person lines: zero lines are empty lines; one left is the figure; two or more stay apart, largest first", () => {
  assert.deepEqual(proxyFigure([P("peo_total", "2025-12-31", 0, 9e6, true)]), { value: 9e6, dropped: 0 });
  assert.deepEqual(proxyFigure([P("peo_total", "2025-12-31", 0, 9e6, true), P("peo_total", "2025-12-31", 1, 0, true)]), { value: 9e6, dropped: 1 });
  assert.deepEqual(proxyFigure([P("peo_total", "2025-12-31", 1, 3e6, true), P("peo_total", "2025-12-31", 0, 9e6, true), P("peo_total", "2025-12-31", 2, 0, true)]), { each: [9e6, 3e6], dropped: 1 });
  // A negative "actually paid" is a figure, not an empty line, and sorts after the positive one.
  assert.deepEqual(proxyFigure([P("peo_actually_paid", "2025-12-31", 0, 4e6, true), P("peo_actually_paid", "2025-12-31", 1, -2e6, true)]), { each: [4e6, -2e6], dropped: 0 });
  // Every line zero: the company reports zero; one figure of zero.
  assert.deepEqual(proxyFigure([P("peo_total", "2025-12-31", 0, 0, true), P("peo_total", "2025-12-31", 1, 0, true)]), { value: 0, dropped: 1 });
});

test("frames first; the proxy statement fills what frames lacks, measure by measure", () => {
  const s = emptySources();
  const ys = mergePay(
    [F("peo_total", "2025-12-31", 10_000_139, "0000000001-26-000001"), F("neo_avg_total", "2024-12-31", 2e6)],
    [
      P("peo_total", "2025-12-31", 0, 10_000_000, false),            // a rounded copy: ignored
      P("peo_actually_paid", "2025-12-31", 0, 12e6, false),           // filled
      P("peo_total", "2024-12-31", 0, 8e6, true),                     // filled, one person
      P("peo_total", "2023-12-31", 0, 7e6, false),                    // a year frames does not have
      P("made_up", "2023-12-31", 0, 1, false), P("peo_total", "not a date", 0, 1, false),
    ], s);
  assert.deepEqual(ys.map((y) => y.fiscalYearEnd), ["2025-12-31", "2024-12-31", "2023-12-31"]);
  assert.deepEqual(ys[0]!.values, { peo_total: 10_000_139, peo_actually_paid: 12e6 });
  assert.equal(ys[0]!.from, "both");
  assert.equal(ys[0]!.accession, "0000000001-26-000001");            // the total's filing
  assert.deepEqual(ys[1]!.values, { neo_avg_total: 2e6, peo_total: 8e6 });
  assert.equal(ys[1]!.accession, "0000000001-26-000099");            // the total came from the proxy statement
  assert.equal(ys[2]!.from, "proxy");
  assert.deepEqual([s.framesFigures, s.proxyFigures, s.eachCells, s.eachYears, s.eachCompanies, s.proxyOnlyCompanies, s.emptyLines], [2, 3, 0, 0, 0, 0, 0]);
  assert.ok(ys.every((y) => y.each == null));
});

test("a year with several people: every figure kept, none in `values`, none added, each line ordered on its own", () => {
  const s = emptySources();
  const ys = mergePay([], [
    P("peo_total", "2025-12-31", 0, 20e6, true), P("peo_total", "2025-12-31", 1, 6e6, true), P("peo_total", "2025-12-31", 2, 0, true),
    P("peo_actually_paid", "2025-12-31", 0, 9e6, true), P("peo_actually_paid", "2025-12-31", 1, 0, true), P("peo_actually_paid", "2025-12-31", 2, -1e6, true),
    P("neo_avg_total", "2025-12-31", 0, 3e6, false),
    P("peo_total", "2024-12-31", 0, 18e6, true), P("peo_total", "2024-12-31", 1, 0, true),
  ], s);
  const y = ys[0]!;
  assert.equal(y.values.peo_total, undefined);
  assert.equal(y.values.peo_actually_paid, undefined);
  assert.deepEqual(eachOf(y, "peo_total"), [20e6, 6e6]);
  assert.deepEqual(eachOf(y, "peo_actually_paid"), [9e6, -1e6]);
  assert.deepEqual(eachOf(y, "neo_avg_total"), []);
  assert.equal(peoFigures(y), 2);
  assert.equal(peoFigures(ys[1]!), 1);
  assert.equal(ys[1]!.values.peo_total, 18e6);
  assert.ok(yearHasFigure(y));
  assert.deepEqual([s.eachCells, s.eachYears, s.eachCompanies, s.eachNewest, s.emptyLines, s.proxyFigures, s.proxyOnlyCompanies], [2, 1, 1, 1, 3, 2, 1]);
  // No tile from a year with several figures: the tile needs one figure for the newest year.
  assert.equal(payGlance(ys), null);
  // A second company whose several-figure year is not its newest.
  const t = emptySources();
  mergePay([], [P("peo_total", "2025-12-31", 0, 5e6, false), P("peo_total", "2024-12-31", 0, 4e6, true), P("peo_total", "2024-12-31", 1, 3e6, true)], t);
  assert.deepEqual([t.eachYears, t.eachCompanies, t.eachNewest], [1, 1, 0]);
});

test("frames beats several: a frames figure for the measure and year leaves the per-person lines unread", () => {
  const ys = mergePay([F("peo_total", "2025-12-31", 15e6)], [P("peo_total", "2025-12-31", 0, 15e6, true), P("peo_total", "2025-12-31", 1, 2e6, true)]);
  assert.equal(ys[0]!.values.peo_total, 15e6);
  assert.equal(ys[0]!.each, undefined);
  assert.equal(ys[0]!.from, "frames");
});

test("marks reach figures inside a several-figure cell", () => {
  const ys = mergePay([], [P("peo_total", "2025-12-31", 0, 20e6, true), P("peo_total", "2025-12-31", 1, 857, true)]);
  assert.equal(yearMarked(ys[0]!), true);
  const zs = mergePay([], [P("peo_total", "2025-12-31", 0, 20e6, true), P("peo_total", "2025-12-31", 1, 5e6, true)]);
  assert.equal(yearMarked(zs[0]!), false);
});

test("the list: a several-figure year is a row with a count, no amount; it sorts last and passes no size filter", () => {
  const pay = new Map([
    ["0000000001", mergePay([F("peo_total", "2025-12-31", 5e6)], [])],
    ["0000000002", mergePay([], [P("peo_total", "2025-12-31", 0, 90e6, true), P("peo_total", "2025-12-31", 1, 80e6, true), P("peo_actually_paid", "2025-12-31", 0, 1e6, true), P("peo_actually_paid", "2025-12-31", 1, 2e6, true), P("peo_actually_paid", "2025-12-31", 2, 3e6, true)])],
    ["0000000003", mergePay([], [P("peo_total", "2025-12-31", 0, 7e6, true)])],
  ]);
  const d = packPayHub("2026-11-26", [co("Aaa", "0000000001"), co("Bbb", "0000000002"), co("Ccc", "0000000003")], pay);
  assert.equal(d.rows.length, 3);
  const b = d.rows.find((r) => d.companies[r[0]]![3] === "0000000002")!;
  assert.deepEqual([b[2], b[3], b[7], b[8]], [null, null, 2, 3]);
  assert.equal(d.rows.find((r) => d.companies[r[0]]![3] === "0000000001")!.length, 7);   // nothing appended to an ordinary row
  const rows = unpackPayHub(JSON.parse(JSON.stringify(d)));
  const bb = rows.find((r) => r.c.cik === "0000000002")!;
  assert.deepEqual(bb.each, { peo_total: 2, peo_actually_paid: 3 });
  assert.deepEqual(sortPay(rows, "peo_total", "desc").map((r) => r.c.cik), ["0000000003", "0000000001", "0000000002"]);
  assert.deepEqual(sortPay(rows, "peo_total", "asc").map((r) => r.c.cik), ["0000000001", "0000000003", "0000000002"]);
  assert.equal(payScreen(rows, { ...DEFAULT_PAY_VIEW, f: { ...DEFAULT_PAY_VIEW.f, min: 1_000_000 } }).total, 2);
  assert.equal(eachCellText(2), "2 figures");
  assert.match(payEachSentence(rows), /^1 of these companies reports principal executive figures for more than one person/);
  assert.equal(payEachSentence(rows.filter((r) => r.c.cik !== "0000000002")), "");
  const csv = payViewCsv(rows, DEFAULT_PAY_VIEW).split("\r\n");
  assert.ok(csv[0]!.endsWith("peo_figures"));
  assert.ok(!csv[0]!.includes("peo_total_each") && !csv[0]!.includes("read_from"));
  assert.ok(csv.find((l) => l.includes("Bbb"))!.endsWith(",3"), csv.join("|"));
  assert.ok(csv.find((l) => l.includes("Aaa"))!.endsWith(",1"));
});

test("the CSV: one figure in peo_total, or the list in peo_total_each, never both", () => {
  const ys = mergePay([F("neo_avg_total", "2025-12-31", 3e6)], [P("peo_total", "2025-12-31", 0, 20e6, true), P("peo_total", "2025-12-31", 1, 6e6, true), P("peo_total", "2024-12-31", 0, 5e6, false)]);
  const lines = toCsv(PAY_CSV_COLUMNS, ys.map((y) => ({ company: "Acme", cik: "0000000001", ticker: "ACM", pagePath: "https://spotthemoney.com/stocks/acm/", y }))).replace(/^\uFEFF/, "").split("\r\n");
  const head = lines[0]!.split(",");
  for (const k of ["peo_figures", "peo_total_each", "peo_actually_paid_each", "read_from"]) assert.ok(head.includes(k), k);
  const cell = (line: string, k: string) => line.split(",")[head.indexOf(k)];
  assert.equal(cell(lines[1]!, "peo_total"), "");
  assert.equal(cell(lines[1]!, "peo_total_each"), "20000000;6000000");
  assert.equal(cell(lines[1]!, "peo_figures"), "2");
  assert.equal(cell(lines[1]!, "read_from"), "both");
  assert.equal(cell(lines[2]!, "peo_total"), "5000000");
  assert.equal(cell(lines[2]!, "peo_total_each"), "");
  assert.equal(cell(lines[2]!, "peo_figures"), "1");
  assert.equal(cell(lines[2]!, "read_from"), "proxy");
});

test("wording: no name, no sum, no verdict, no dash as punctuation", () => {
  for (const t of [PAY_EACH_NOTE, PAY_HUB_EACH_NOTE, payCoverageSentence(820, 1000), payEachSentence([])]) {
    assert.ok(!/[\u2014\u2013]/.test(t), t);
    assert.ok(!/\b(overpaid|underpaid|excessive|deserved|recommend)\b/i.test(t), t);
  }
  assert.match(PAY_EACH_NOTE, /never added together/);
  assert.match(PAY_EACH_NOTE, /may belong to different people/);
  assert.equal(payShareWords(820, 1000), "about 8 in 10");
  assert.equal(payShareWords(990, 1000), "nearly all");
  assert.equal(payShareWords(0, 1000), "");
  assert.match(payCoverageSentence(820, 1000), /^820 of the 1,000 companies with a page on this site have figures on file, about 8 in 10\./);
});

test("the build-log line counts sources and several-figure years", () => {
  const sources = emptySources();
  const byCik = new Map([
    ["0000000001", mergePay([F("peo_total", "2025-12-31", 5e6)], [P("peo_actually_paid", "2025-12-31", 0, 6e6, false)], sources)],
    ["0000000002", mergePay([], [P("peo_total", "2025-12-31", 0, 9e6, true), P("peo_total", "2025-12-31", 1, 8e6, true), P("peo_total", "2025-12-31", 2, 0, true)], sources)],
  ]);
  sources.proxyRows = 4;
  const d: PayData = { byCik, rows: 1, newestYearEnd: "2025-12-31", sources };
  const line = payLog(d, new Set(byCik.keys()));
  assert.match(line, /1 frames rows and 4 proxy-statement rows read; 3 measure and year cells for 2 companies/);
  assert.match(line, /sources: 1 figures from frames, 1 from proxy statements, 1 companies only from proxy statements/);
  assert.match(line, /several principal executive figures: 1 cells in 1 company years of 1 companies, 1 of them in the newest year; 1 zero lines left out/);
  assert.match(line, /1 with no single principal executive total/);
});

test("the CSV: a list that starts with a negative figure carries the file's apostrophe for text beginning with a minus sign", () => {
  const ys = mergePay([], [P("peo_actually_paid", "2025-12-31", 0, -1_500_000, true), P("peo_actually_paid", "2025-12-31", 1, -2_000_000, true), P("peo_total", "2025-12-31", 0, 9e6, true), P("peo_total", "2025-12-31", 1, 4e6, true)]);
  const lines = toCsv(PAY_CSV_COLUMNS, ys.map((y) => ({ company: "Acme", cik: "0000000001", ticker: "ACM", pagePath: null, y }))).split("\r\n");
  const head = lines[0]!.split(",");
  assert.equal(lines[1]!.split(",")[head.indexOf("peo_actually_paid_each")], "'-1500000;-2000000");
  assert.equal(lines[1]!.split(",")[head.indexOf("peo_total_each")], "9000000;4000000");
});
