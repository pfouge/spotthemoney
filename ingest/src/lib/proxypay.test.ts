// Offline tests for the proxy statement readers. Run: npx tsx --test ingest/src/lib/proxypay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { filingFolder, pickInstance, pickProxies, readProxyInstance } from "./proxypay.js";

const CIK = "0001045810";

function ctx(id: string, start: string, end: string, dims: Record<string, string> = {}, cik = CIK): string {
  const seg = Object.entries(dims).map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join("");
  return `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${cik}</identifier>${seg ? `<segment>${seg}</segment>` : ""}</entity>` +
    `<period><startDate>${start}</startDate><endDate>${end}</endDate></period></context>`;
}
const fact = (tag: string, c: string, v: string, p = "ecd") => `<${p}:${tag} contextRef="${c}" decimals="0" id="f${Math.random()}" unitRef="usd">${v}</${p}:${tag}>`;
const doc = (body: string, ns = "http://xbrl.sec.gov/ecd/2025", p = "ecd") =>
  `<?xml version="1.0"?><xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:${p}="${ns}">${body}</xbrl>`;

test("pickProxies: newest DEF 14A filings since the floor, other forms ignored", () => {
  const recent = {
    form: ["8-K", "DEF 14A", "DEFA14A", "DEF 14A", "DEF 14A", "DEF 14A", "DEF 14A"],
    accessionNumber: ["0001-26-000001", "0001045810-26-000002", "0001045810-26-000003", "0001045810-25-000004", "0001045810-22-000005", "bad", "0001045810-24-000006"],
    filingDate: ["2026-05-01", "2026-04-01", "2026-04-02", "2025-04-01", "2022-04-01", "2026-06-01", "2024-04-01"],
  };
  const r = pickProxies({ filings: { recent } });
  assert.equal(r.hasShape, true);
  assert.deepEqual(r.proxies.map((p) => p.accession), ["0001045810-26-000002", "0001045810-25-000004", "0001045810-24-000006"]);
  assert.equal(pickProxies({ filings: { recent } }, "2023-01-01", 1).proxies.length, 1);
  assert.equal(pickProxies({ message: "x" }).hasShape, false);
  assert.equal(pickProxies({ filings: { recent: { form: ["DEF 14A"], accessionNumber: [], filingDate: [] } } }).hasShape, false);
  assert.deepEqual(pickProxies({ filings: { recent: { form: [], accessionNumber: [], filingDate: [] } } }), { hasShape: true, proxies: [] });
});

test("filingFolder and pickInstance", () => {
  assert.equal(filingFolder("https://x", CIK, "0001045810-26-000002"), "https://x/Archives/edgar/data/1045810/000104581026000002");
  const item = [{ name: "nvda-20260401.htm" }, { name: "nvda-20260401.xsd" }, { name: "nvda-20260401_def.xml" }, { name: "nvda-20260401_htm.xml" }, { name: "../evil_htm.xml" }];
  assert.deepEqual(pickInstance({ directory: { item } }), { hasShape: true, name: "nvda-20260401_htm.xml" });
  assert.deepEqual(pickInstance({ directory: { item: [{ name: "a.htm" }, { name: "FilingSummary.xml" }] } }), { hasShape: true, name: null });
  assert.equal(pickInstance({ nothing: 1 }).hasShape, false);
});

test("a figure with no dimension is one row; years newest first", () => {
  const r = readProxyInstance(doc(
    ctx("a", "2025-01-27", "2026-01-25") + ctx("b", "2024-01-29", "2025-01-26") +
    fact("PeoTotalCompAmt", "a", "49866251") + fact("PeoTotalCompAmt", "b", "34167902") +
    fact("PeoActuallyPaidCompAmt", "a", "-1200.5") + fact("NonPeoNeoAvgTotalCompAmt", "a", "11000000") +
    fact("NonPeoNeoAvgCompActuallyPaidAmt", "a", "9000000") + fact("PeoTotalCompAmt", "a", "49866251"),
  ), CIK);
  assert.equal(r.hasShape && r.hasEcd, true);
  assert.equal(r.facts.length, 5);
  const peo = r.facts.filter((f) => f.measure === "peo_total");
  assert.deepEqual(peo.map((f) => [f.fiscalYearEnd, f.value, f.seq, f.persons, f.dimensioned]), [["2026-01-25", 49866251, 0, 0, false], ["2025-01-26", 34167902, 0, 0, false]]);
  assert.equal(r.facts.find((f) => f.measure === "peo_actually_paid")!.value, -1200.5);
  assert.equal(r.facts.find((f) => f.measure === "neo_avg_total")!.periodStart, "2025-01-27");
  assert.equal(r.skipped.conflicts, 0);
});

test("a principal executive's figure filed per person: one row each, largest first, no name kept", () => {
  const r = readProxyInstance(doc(
    ctx("p1", "2025-01-01", "2025-12-31", { "ecd:IndividualAxis": "abc:MsSecretNameMember" }) +
    ctx("p2", "2025-01-01", "2025-12-31", { "ecd:IndividualAxis": "abc:MrOtherPersonMember", "ecd:ExecutiveCategoryAxis": "ecd:PeoMember" }) +
    ctx("q", "2024-01-01", "2024-12-31", { "ecd:IndividualAxis": "abc:MsSecretNameMember" }) +
    ctx("n", "2025-01-01", "2025-12-31", { "ecd:ExecutiveCategoryAxis": "ecd:NonPeoNeoMember" }) +
    fact("PeoTotalCompAmt", "p1", "5000000") + fact("PeoTotalCompAmt", "p2", "9000000") + fact("PeoTotalCompAmt", "q", "7000000") +
    fact("NonPeoNeoAvgTotalCompAmt", "n", "2000000") + fact("NonPeoNeoAvgTotalCompAmt", "p1", "1"),
  ), CIK);
  const y25 = r.facts.filter((f) => f.measure === "peo_total" && f.fiscalYearEnd === "2025-12-31");
  assert.deepEqual(y25.map((f) => [f.value, f.seq, f.persons, f.dimensioned]), [[9000000, 0, 2, true], [5000000, 1, 2, true]]);
  const y24 = r.facts.filter((f) => f.measure === "peo_total" && f.fiscalYearEnd === "2024-12-31");
  assert.deepEqual(y24.map((f) => [f.value, f.seq, f.persons, f.dimensioned]), [[7000000, 0, 1, true]]);
  const neo = r.facts.filter((f) => f.measure === "neo_avg_total");
  assert.deepEqual(neo.map((f) => [f.value, f.persons, f.dimensioned]), [[2000000, 1, false]]);
  assert.equal(/Secret|OtherPerson/.test(JSON.stringify(r)), false);
});

test("an average filed only per person is skipped; a total and per-person figures together keep the total", () => {
  const r = readProxyInstance(doc(
    ctx("t", "2025-01-01", "2025-12-31") + ctx("p", "2025-01-01", "2025-12-31", { "ecd:IndividualAxis": "x:AMember" }) +
    fact("PeoTotalCompAmt", "t", "10") + fact("PeoTotalCompAmt", "p", "6") + fact("NonPeoNeoAvgCompActuallyPaidAmt", "p", "3"),
  ), CIK);
  assert.deepEqual(r.facts.map((f) => [f.measure, f.value, f.persons, f.dimensioned]), [["peo_total", 10, 1, false]]);
  assert.equal(r.skipped.neoPerPerson, 1);
});

test("what is skipped: adjustment axes, wrong member, other company, odd periods, bad numbers, lost contexts, conflicts", () => {
  const r = readProxyInstance(doc(
    ctx("ok", "2025-01-01", "2025-12-31") +
    ctx("adj", "2025-01-01", "2025-12-31", { "ecd:AdjToCompAxis": "ecd:PnsnAdjsPrrSvcCstMember", "ecd:IndividualAxis": "x:AMember" }) +
    ctx("wrong", "2025-01-01", "2025-12-31", { "ecd:ExecutiveCategoryAxis": "ecd:NonPeoNeoMember" }) +
    ctx("other", "2025-01-01", "2025-12-31", {}, "0000320193") +
    ctx("short", "2025-10-01", "2025-12-31") +
    `<context id="inst"><entity><identifier scheme="s">${CIK}</identifier></entity><period><instant>2025-12-31</instant></period></context>` +
    fact("PeoTotalCompAmt", "ok", "100") + fact("PeoTotalCompAmt", "ok", "101") + fact("PeoTotalCompAmt", "adj", "5") +
    fact("PeoTotalCompAmt", "wrong", "6") + fact("PeoTotalCompAmt", "other", "7") + fact("PeoTotalCompAmt", "short", "8") +
    fact("PeoTotalCompAmt", "inst", "9") + fact("PeoTotalCompAmt", "gone", "10") + fact("PeoActuallyPaidCompAmt", "ok", "n/a") +
    `<ecd:PeoName contextRef="ok">Jane Secret</ecd:PeoName>`,
  ), CIK);
  assert.deepEqual(r.facts.map((f) => [f.measure, f.value]), [["peo_total", 100]]);
  assert.deepEqual(r.skipped, { otherAxis: 1, otherMember: 1, badPeriod: 2, otherEntity: 1, noContext: 1, notNumber: 1, conflicts: 1, neoPerPerson: 0 });
  assert.deepEqual(r.axes, ["AdjToCompAxis"]);
  assert.equal(r.seen, 9);
  assert.equal(JSON.stringify(r).includes("Secret"), false);
});

test("prefixes: xbrli-prefixed contexts, another ecd prefix and year; no ecd namespace; not XBRL", () => {
  const body = `<xbrli:context id="a"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1045810</xbrli:identifier></xbrli:entity>` +
    `<xbrli:period><xbrli:startDate>2024-07-01</xbrli:startDate><xbrli:endDate>2025-06-30</xbrli:endDate></xbrli:period></xbrli:context>` +
    fact("PeoTotalCompAmt", "a", "42", "e1");
  const r = readProxyInstance(doc(body, "http://xbrl.sec.gov/ecd/2023", "e1"), CIK);
  assert.deepEqual(r.facts.map((f) => [f.fiscalYearEnd, f.value]), [["2025-06-30", 42]]);
  const none = readProxyInstance(doc(ctx("a", "2025-01-01", "2025-12-31"), "http://fasb.org/us-gaap/2025", "us-gaap"), CIK);
  assert.deepEqual([none.hasShape, none.hasEcd, none.facts.length], [true, false, 0]);
  const html = readProxyInstance("<html><body>Just a moment...</body></html>", CIK);
  assert.deepEqual([html.hasShape, html.hasEcd, html.facts.length], [false, false, 0]);
  assert.equal(readProxyInstance("", CIK).hasShape, false);
});
