import test from "node:test";
import assert from "node:assert/strict";
import { holdingsChange, heldAfter, changeLabel, changeSortKey, changeCsv } from "../web/src/lib/holdings";

const f4 = { source: "sec_form4", isDerivative: false };
test("partial sale", () => {
  const c = holdingsChange({ ...f4, side: "sell", shares: 120, ownedAfter: 880 });
  assert.equal(c, -12);
  assert.equal(changeLabel(c), "−12.0%");
});
test("full exit is -100", () => {
  assert.equal(holdingsChange({ ...f4, side: "sell", shares: 30000, ownedAfter: 0 }), -100);
  assert.equal(changeLabel(-100), "−100%");
});
test("purchase adds to a holding", () => {
  const c = holdingsChange({ ...f4, side: "buy", shares: 30, ownedAfter: 1030 }) as number;
  assert.ok(Math.abs(c - 3) < 1e-9);
  assert.equal(changeLabel(c), "+3.0%");
});
test("first purchase is new", () => {
  assert.equal(holdingsChange({ ...f4, side: "buy", shares: 12000, ownedAfter: 12000 }), "new");
  assert.equal(changeLabel("new"), "new");
  assert.equal(changeCsv("new"), null);
});
test("unknown direction, derivative, congress, missing values give null", () => {
  assert.equal(holdingsChange({ ...f4, side: "other", shares: 10, ownedAfter: 100 }), null);
  assert.equal(holdingsChange({ ...f4, side: "option", shares: 10, ownedAfter: 100 }), null);
  assert.equal(holdingsChange({ ...f4, side: null, shares: 10, ownedAfter: 100 }), null);
  assert.equal(holdingsChange({ source: "sec_form4", isDerivative: true, side: "sell", shares: 10, ownedAfter: 100 }), null);
  assert.equal(holdingsChange({ source: "house_ptr", isDerivative: false, side: "sell", shares: 10, ownedAfter: 100 }), null);
  assert.equal(holdingsChange({ ...f4, side: "sell", shares: 10, ownedAfter: null }), null);
  assert.equal(holdingsChange({ ...f4, side: "sell", shares: 0, ownedAfter: 10 }), null);
  assert.equal(holdingsChange({ ...f4, side: "sell", shares: null, ownedAfter: 10 }), null);
  assert.equal(heldAfter({ source: "house_ptr", isDerivative: false, ownedAfter: 5 }), null);
  assert.equal(heldAfter({ source: "sec_form4", isDerivative: true, ownedAfter: 5 }), null);
  assert.equal(heldAfter({ source: "sec_form4", isDerivative: false, ownedAfter: 0 }), 0);
});
test("inconsistent and absurd filings give null", () => {
  assert.equal(holdingsChange({ ...f4, side: "buy", shares: 500, ownedAfter: 100 }), null);
  assert.equal(holdingsChange({ ...f4, side: "buy", shares: 1_000_000, ownedAfter: 1_000_001 }), null); // +100,000,000% > cap
  assert.equal(holdingsChange({ ...f4, side: "sell", shares: 10, ownedAfter: Number.NaN }), null);
});
test("labels and keys", () => {
  assert.equal(changeLabel(null), "—");
  assert.equal(changeLabel(-12.44), "−12.4%");
  assert.equal(changeLabel(0.004), "0.0%");
  assert.equal(changeLabel(2500), "+2,500%");
  assert.equal(changeSortKey("new")! > changeSortKey(99999)!, true);
  assert.equal(changeSortKey(null), null);
  assert.equal(changeCsv(-12.3456), -12.35);
});
