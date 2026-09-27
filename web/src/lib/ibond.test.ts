// npx tsx --test web/src/lib/ibond.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextResetDate, resetOutlook } from "./ibond.ts";

test("next reset date across the year", () => {
  assert.equal(nextResetDate(new Date("2026-09-27T12:00:00Z")).date, "2026-11-01");
  assert.equal(nextResetDate(new Date("2026-11-01T12:00:00Z")).date, "2027-05-01");
  assert.equal(nextResetDate(new Date("2027-02-10T12:00:00Z")).date, "2027-05-01");
  assert.equal(nextResetDate(new Date("2027-05-01T12:00:00Z")).date, "2027-11-01");
});

test("implied semiannual from March→September CPI, partial and final", () => {
  const today = new Date("2026-09-27T12:00:00Z");
  const cpi = [
    { month: "2026-03-01", value: 320.0 }, { month: "2026-04-01", value: 321.0 }, { month: "2026-05-01", value: 322.0 },
    { month: "2026-06-01", value: 322.5 }, { month: "2026-07-01", value: 323.2 }, { month: "2026-08-01", value: 324.0 },
  ];
  const partial = resetOutlook(cpi, 1.1, today);
  assert.equal(partial.nextResetDate, "2026-11-01");
  assert.equal(partial.monthsKnown, 5);
  assert.equal(partial.isFinal, false);
  assert.equal(partial.impliedSemiannual, 1.25); // 324/320 − 1
  assert.equal(partial.impliedComposite, Math.round((1.1 + 2 * 1.25 + (1.1 * 1.25) / 100) * 100) / 100);
  const final = resetOutlook([...cpi, { month: "2026-09-01", value: 324.8 }], 1.1, today);
  assert.equal(final.monthsKnown, 6);
  assert.equal(final.isFinal, true);
  assert.equal(final.impliedSemiannual, 1.5);
});

test("no CPI → nulls, never throws", () => {
  const o = resetOutlook([], null, new Date("2026-09-27T12:00:00Z"));
  assert.equal(o.impliedSemiannual, null);
  assert.equal(o.monthsKnown, 0);
});
