// Offline tests for the freshness rule (2026-10-12). Run:  npx tsx --test scripts/freshness.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs module
import { classify, FAILS } from "./lib/freshness-rule.mjs";

const base = { runDays: 2, hasNewest: true, dataAgeDays: 1, dataDays: 7, newestStr: "2026-10-11" };

test("one failed day warns, a persisting failure fails", () => {
  const ok = classify({ ...base, run: { status: "success" }, okAgeHours: 20 });
  assert.equal(ok.state, "OK");
  const partial = classify({ ...base, run: { status: "partial" }, okAgeHours: 1 });
  assert.equal(partial.state, "OK", "partial counts as a successful run");
  const warn = classify({ ...base, run: { status: "failed", error: "HTTP 503" }, okAgeHours: 25 });
  assert.equal(warn.state, "WARN");
  assert.match(warn.why, /HTTP 503.*25 h ago.*48 h/);
  assert.equal(FAILS.has(warn.state), false);
  const failing = classify({ ...base, run: { status: "failed", error: "HTTP 503" }, okAgeHours: 49 });
  assert.equal(failing.state, "FAILING");
  assert.match(failing.why, /49 h.*allowance 48 h.*HTTP 503/);
  assert.equal(FAILS.has(failing.state), true);
});

test("never ran, never succeeded, not configured", () => {
  assert.equal(classify({ ...base, run: null, okAgeHours: null }).state, "FAILING");
  assert.match(classify({ ...base, run: { status: "failed" }, okAgeHours: null }).why, /no successful run in ever/);
  const nc = classify({ ...base, run: { status: "success", skipped: "FEC_API_KEY not set" }, okAgeHours: null });
  assert.equal(nc.state, "NOT CONFIGURED");
  assert.equal(FAILS.has(nc.state), false);
});

test("runs succeed but the data is old → STALE; weekly sources get a longer allowance", () => {
  const stale = classify({ ...base, run: { status: "success" }, okAgeHours: 3, dataAgeDays: 9 });
  assert.equal(stale.state, "STALE");
  assert.equal(classify({ ...base, run: { status: "success" }, okAgeHours: 3, dataAgeDays: null }).state, "STALE");
  assert.equal(classify({ ...base, hasNewest: false, run: { status: "success" }, okAgeHours: 3, dataAgeDays: null }).state, "OK");
  assert.equal(classify({ ...base, runDays: 8, run: { status: "failed" }, okAgeHours: 150 }).state, "WARN");
});
