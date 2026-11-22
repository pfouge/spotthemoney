// Offline tests for the ecd frames reader. Run: npx tsx --test ingest/src/lib/execpay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFrame } from "./execpay.js";

const e = (o: Record<string, unknown>) => ({ accn: "0001-25-000001", cik: 1045810, entityName: "X", loc: "-", end: "2024-12-31", val: 100, ...o });

test("reads facts, pads the CIK, keeps start", () => {
  const r = readFrame({ data: [e({ start: "2024-01-01" }), e({ cik: "320193", end: "2024-09-28", val: 5 })] });
  assert.equal(r.hasShape, true);
  assert.equal(r.facts.length, 2);
  assert.equal(r.facts[0]!.cik, "0001045810");
  assert.equal(r.facts[0]!.periodStart, "2024-01-01");
  assert.equal(r.facts[1]!.cik, "0000320193");
  assert.equal(r.facts[1]!.periodStart, null);
});

test("keeps a negative value, drops a non-finite, bad date, bad cik, missing accession", () => {
  const r = readFrame({ data: [
    e({ val: -2500000 }),
    e({ cik: 2, val: Number.NaN }), e({ cik: 3, val: "9" }), e({ cik: 4, end: "2024-02-30" }),
    e({ cik: "abc" }), e({ cik: 6, accn: "" }), "junk",
  ] });
  assert.equal(r.facts.length, 1);
  assert.equal(r.facts[0]!.value, -2500000);
  assert.equal(r.dropped, 6);
  assert.equal(r.seen, 7);
});

test("a repeated company and period keeps the greater accession", () => {
  const r = readFrame({ data: [e({ accn: "0001-25-000009", val: 1 }), e({ accn: "0001-25-000002", val: 2 })] });
  assert.equal(r.facts.length, 1);
  assert.equal(r.facts[0]!.value, 1);
});

test("shape: not an object, no data, wrong keys, empty array", () => {
  assert.equal(readFrame(null).isArray, false);
  assert.equal(readFrame({ message: "x" }).hasShape, false);
  assert.equal(readFrame({ data: [{ cik: 1 }] }).hasShape, false);
  const empty = readFrame({ data: [] });
  assert.equal(empty.isArray, true);
  assert.equal(empty.hasShape, false);
  assert.equal(empty.seen, 0);
});
