import test from "node:test";
import assert from "node:assert/strict";
import { monthKeys, monthOf, monthlyCounts, monthlyDirection } from "../web/src/lib/glancespark.ts";

test("monthOf reads year and month only", () => {
  assert.equal(monthOf("2026-11-23"), "2026-11");
  assert.equal(monthOf("2026-13-01"), null);
  assert.equal(monthOf(null), null);
  assert.equal(monthOf("soon"), null);
});
test("monthKeys runs 12 months ending in the month of now, across a year end", () => {
  const k = monthKeys("2026-02-10");
  assert.equal(k.length, 12);
  assert.equal(k[0], "2025-03");
  assert.equal(k[11], "2026-02");
});
test("monthlyCounts counts by month and ignores rows outside the window", () => {
  const s = monthlyCounts(["2026-11-01", "2026-11-20", "2026-09-05", "2025-01-01", null, "2027-01-01"], "2026-11-23");
  assert.equal(s.length, 12);
  assert.equal(s[11], 2);
  assert.equal(s[9], 1);
  assert.equal(s.reduce((a, b) => a + b, 0), 3);
  assert.deepEqual(monthlyCounts(["2020-01-01"], "2026-11-23"), []);
  assert.deepEqual(monthlyCounts([], "2026-11-23"), []);
});
test("monthlyDirection separates buys and sells and skips other sides", () => {
  const s = monthlyDirection([
    { date: "2026-11-02", side: "buy" }, { date: "2026-11-03", side: "sell" }, { date: "2026-10-03", side: "sell" },
    { date: "2026-10-04", side: "option" }, { date: "2026-10-05", side: "other" },
  ], "2026-11-23");
  assert.deepEqual(s[11], { up: 1, down: 1 });
  assert.deepEqual(s[10], { up: 0, down: 1 });
  assert.deepEqual(monthlyDirection([{ date: "2026-11-02", side: "option" }], "2026-11-23"), []);
});
