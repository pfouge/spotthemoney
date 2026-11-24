// Home first screen rules (web/src/lib/hometop.ts): windows, weekly sparks, tile order, no future dates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countIn, weeklyCounts, buildRoutes, topActive, type HomeInputs } from "../web/src/lib/hometop";

const B = "2026-11-23";
test("countIn: 30 days, both edges inclusive, no future date", () => {
  assert.equal(countIn(["2026-11-23", "2026-10-24", "2026-10-23", "2026-11-24", null, "bad"], B), 2);
});
test("weeklyCounts: 12 buckets, last ends on the build day, future and old dates dropped", () => {
  const w = weeklyCounts(["2026-11-23", "2026-11-17", "2026-11-16", "2026-09-01", "2026-08-31", "2026-11-24"], B);
  assert.equal(w.length, 12);
  assert.equal(w[11], 2);   // age 0 and 6
  assert.equal(w[10], 1);   // age 7
  assert.equal(w[0], 1);    // age 83 -> oldest bucket (2026-09-01)
  assert.equal(w.reduce((a, b) => a + b, 0), 4);
});
const base: HomeInputs = { built: B, congress: null, insiders: null, stocks: null, planned: null, holders: null, events: null, votes: null, lobbying: null, contracts: null, donations: null, rates: null };
test("buildRoutes: absent datasets give no tile; order is fixed", () => {
  assert.deepEqual(buildRoutes(base), []);
  const r = buildRoutes({ ...base, rates: { tenYear: "4.1%", ibond: "5.5%" }, lobbying: { dates: ["2026-11-20"] }, congress: { dates: ["2026-11-22", "2026-11-01"], members: 1 }, stocks: { pages: 3 },
    donations: { receipts: 1200, committees: 1, windowDays: 90 } });
  assert.deepEqual(r.map((t) => t.key), ["congress", "stocks", "lobbying", "donations", "rates"]);
  assert.equal(r[0]!.figure, "2");
  assert.equal(r[0]!.caption, "1 member on record");
  assert.equal(r[0]!.spark.length, 12);
  assert.equal(r[1]!.spark.length, 0);
  assert.match(r[3]!.unit, /held on this site/);
  assert.ok(!/total\b/.test(r[3]!.unit));
  assert.equal(r[4]!.caption, "I-bond composite 5.5%");
  for (const t of r) assert.ok(!/—/.test(JSON.stringify(t)));
});
test("topActive: most rows in the window, ties by name, counts only", () => {
  const rows = [
    { key: "a", text: "AAA", href: "/a/", date: "2026-11-20" }, { key: "a", text: "AAA", href: "/a/", date: "2026-11-21" },
    { key: "b", text: "BBB", href: "/b/", date: "2026-11-20" }, { key: "c", text: "CCC", href: "/c/", date: "2026-11-19" },
    { key: "d", text: "DDD", href: null, date: "2026-11-19" }, { key: "e", text: "EEE", href: "/e/", date: "2026-01-01" },
  ];
  assert.deepEqual(topActive(rows, B, 3).map((x) => x.text), ["AAA", "BBB", "CCC"]);
});
