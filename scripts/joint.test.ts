import { test } from "node:test";
import assert from "node:assert/strict";
import { jointDuplicates, type JointRow } from "../web/src/lib/joint.ts";

const row = (id: number, filingId: number, personId: number, o: Partial<JointRow> = {}): JointRow =>
  ({ id, filingId, personId, securityId: 7, date: "2026-03-10", code: "S", isDerivative: false, shares: 26105840, price: 41, value: 26105840 * 41, ...o });

test("the same sale under seven reporting owners counts once", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(100 + i, 50 + i, 900 + i));
  const d = jointDuplicates(rows);
  assert.equal(d.size, 6);
  assert.ok(!d.has(100));
  assert.ok([...d.values()].every((v) => v === 100));
});
test("the earliest filing keeps the transaction, whatever the row order", () => {
  const d = jointDuplicates([row(3, 30, 1), row(1, 10, 2), row(2, 20, 3)]);
  assert.deepEqual([...d.entries()].sort(), [[2, 1], [3, 1]]);
});
test("two identical lots reported by each of two joint filers: the first filer keeps both", () => {
  const d = jointDuplicates([row(1, 10, 1), row(2, 10, 1), row(3, 11, 2), row(4, 11, 2)]);
  assert.deepEqual([...d.keys()].sort(), [3, 4]);
});
test("one filer repeating a lot is not a duplicate", () => {
  assert.equal(jointDuplicates([row(1, 10, 1), row(2, 10, 1)]).size, 0);
});
test("different price, shares, date, code or stock are different trades", () => {
  const base = row(1, 10, 1);
  for (const o of [{ price: 41.01 }, { shares: 26105841 }, { date: "2026-03-11" }, { code: "P" }, { securityId: 8 }, { isDerivative: true }])
    assert.equal(jointDuplicates([base, row(2, 11, 2, o)]).size, 0, JSON.stringify(o));
});
test("small identical trades by different insiders are left alone", () => {
  const o = { shares: 1000, price: 50, value: 50000 };
  assert.equal(jointDuplicates([row(1, 10, 1, o), row(2, 11, 2, o)]).size, 0);
});
test("rows with no price or no filer are ignored", () => {
  assert.equal(jointDuplicates([row(1, 10, 1, { price: null, value: null }), row(2, 11, 2, { price: null, value: null })]).size, 0);
  assert.equal(jointDuplicates([row(1, 10, 1), { ...row(2, 11, 2), personId: null }]).size, 0);
});
