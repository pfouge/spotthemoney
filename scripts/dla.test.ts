// Military parts orders (lib/dla.ts): order rule, supplier matching, per-company summary, links.
// Run: npx tsx --test scripts/dla.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOrder, makeMatcher, companyDla, monthKeys, dashedNsn, nsnUrl, supplierUrl, trimDivision, dlaLog, emptyDla, TOP_PARTS, LATEST_ORDERS, type OrderRow } from "../web/src/lib/dla";

test("isOrder: delivery orders and purchase orders count, base contracts and agreements do not", () => {
  assert.equal(isOrder("SPE4A726F1234", "SPE4A721D0001"), true);   // delivery order under a D contract
  assert.equal(isOrder(null, "SPE4A726P1234"), true);              // purchase order
  assert.equal(isOrder("", "SPE4A726V1234"), true);
  assert.equal(isOrder(null, "SPE4A721D0001"), false);             // base IDIQ: a ceiling
  assert.equal(isOrder(null, "SPE4A721G0001"), false);
  assert.equal(isOrder("  ", "spe4a721a0001"), false);              // case and blanks
  assert.equal(isOrder(null, null), true);                         // nothing says it is a ceiling
});

const cos = [
  { id: 1, name: "LOCKHEED MARTIN CORP", ticker: "LMT" },
  { id: 2, name: "NORTHROP GRUMMAN CORP /DE/", ticker: "NOC" },
  { id: 3, name: "RTX Corp", ticker: "RTX" },
  { id: 4, name: "Parker-Hannifin Corp", ticker: "PH" },
  { id: 5, name: "ACME CO", ticker: "ACM" },
  { id: 6, name: "ACME INC", ticker: "ACX" },             // same normalised name as 5: ambiguous
  { id: 7, name: "AAR CORP", ticker: "AIR" },
  { id: 8, name: "BOEING CO", ticker: "BA" },
];
const match = makeMatcher(cos);

test("matcher: same name, division and trade names trimmed", () => {
  assert.deepEqual(match(["Lockheed Martin Corporation"]), { companyId: 1, rule: "name" });
  assert.deepEqual(match(["LOCKHEED MARTIN CORP DIV MISSILES AND FIRE CONTROL"]), { companyId: 1, rule: "name" });
  assert.equal(trimDivision("FOO INC DBA BAR"), "FOO INC");
  assert.equal(match(["ACME COMPANY"]), null, "two companies share the name: no match");
  assert.equal(makeMatcher([{ id: 9, name: "Viking Holdings Ltd", ticker: "VIK" }])(["VIKING INCORPORATED DBA VIKING INC"]), null, "a name on the not-the-company list");
});

test("matcher: prefix needs the company's whole name and a long enough name", () => {
  assert.deepEqual(match(["NORTHROP GRUMMAN SYSTEMS CORPORATION"]), { companyId: 2, rule: "prefix" });
  assert.equal(match(["LOCKHEEDMARTINX"]), null);
  assert.equal(match(["AAR AIRCRAFT SERVICES"]), null, "AAR is too short to be a prefix");
  assert.equal(match(["BOEINGS PARTS LLC"]), null, "a prefix must end at a word");
});

test("matcher: known subsidiaries go to their parent only when the parent has a page", () => {
  assert.deepEqual(match(["SIKORSKY AIRCRAFT CORPORATION"]), { companyId: 1, rule: "subsidiary" });
  assert.deepEqual(match(["Hamilton Sundstrand Corporation"]), { companyId: 3, rule: "subsidiary" });
  assert.deepEqual(match(["AAR MANUFACTURING, INC."]), { companyId: 7, rule: "subsidiary" });
  assert.deepEqual(match(["LORD CORPORATION"]), { companyId: 4, rule: "subsidiary" });
  assert.equal(match(["LORDSTOWN MOTORS"]), null, "LORD is an exact-name alias only");
  assert.deepEqual(match(["AVIALL SERVICES INC"]), { companyId: 8, rule: "subsidiary" });
  assert.equal(makeMatcher([{ id: 9, name: "Other Co", ticker: "OTH" }])(["SIKORSKY AIRCRAFT"]), null);
});

test("matcher: the second name is tried when the first is missing or unknown", () => {
  assert.deepEqual(match([null, "Lockheed Martin Corp"]), { companyId: 1, rule: "name" });
  assert.deepEqual(match(["UNKNOWN SUPPLIER LLC", "Lockheed Martin Corp"]), { companyId: 1, rule: "name" });
  assert.equal(match([null, ""]), null);
});

test("monthKeys: twelve calendar months ending with the build month, across a year end", () => {
  const k = monthKeys("2026-02-10");
  assert.equal(k.length, 12);
  assert.equal(k[0], "2025-03");
  assert.equal(k[11], "2026-02");
});

const row = (date: string, nsn: string, value: number, item = "WIDGET", piid = "SPE4A726P0001"): OrderRow => ({ cage: "1ABC2", date, nsn, item, piid, value, url: "https://www.dibbs.bsm.dla.mil/x" });

test("companyDla: totals, months, parts by value, latest first; zero and negative rows left out", () => {
  const rows = [row("2026-11-20", "5340013494824", 100), row("2026-11-21", "5340013494824", 50, "WIDGET, NEW NAME"), row("2026-10-02", "1560000000001", 1000), row("2026-10-03", "1560000000002", 0), row("2026-09-01", "1560000000003", -5)];
  const d = companyDla([{ cage: "1ABC2", name: "X", rule: "name", orders: 3, value: 1150 }], rows, "2026-11-24")!;
  assert.equal(d.orders, 3);
  assert.equal(d.value, 1150);
  assert.equal(d.parts, 2);
  assert.equal(d.first, "2026-10-02");
  assert.equal(d.last, "2026-11-21");
  assert.equal(d.months[11]!.key, "2026-11");
  assert.equal(d.months[11]!.value, 150);
  assert.equal(d.months[10]!.orders, 1);
  assert.equal(d.topParts[0]!.nsn, "1560000000001");
  assert.equal(d.topParts[1]!.item, "WIDGET, NEW NAME", "the newest name of a part is shown");
  assert.equal(d.latest[0]!.date, "2026-11-21");
  assert.equal(companyDla([], [row("2026-11-01", "1", 0)], "2026-11-24"), null);
});

test("companyDla: lists are capped", () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(`2026-11-${String(1 + (i % 28)).padStart(2, "0")}`, String(1000000000000 + i), 10 + i));
  const d = companyDla([], rows, "2026-11-24")!;
  assert.equal(d.topParts.length, TOP_PARTS);
  assert.equal(d.latest.length, LATEST_ORDERS);
  assert.equal(d.parts, 60);
});

test("links: dashed NSN on nsnexplorer, CAGE upper case", () => {
  assert.equal(dashedNsn("5340013494824"), "5340-01-349-4824");
  assert.equal(dashedNsn("5340-01-349-4824"), "5340-01-349-4824");
  assert.equal(dashedNsn("ABC"), "ABC");
  assert.equal(nsnUrl("5340013494824"), "https://nsnexplorer.com/nsn/5340-01-349-4824/");
  assert.equal(supplierUrl(" 1abc2 "), "https://nsnexplorer.com/supplier/1ABC2/");
});

test("dlaLog: says when nothing was read", () => {
  assert.match(dlaLog(emptyDla()), /not read/);
});
