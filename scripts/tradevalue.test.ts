import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeValue, unitPrice, priceIsRowTotal, median } from "../shared/src/tradevalue.ts";

test("ordinary stock sale is shares × price", () => {
  assert.equal(tradeValue({ shares: 1000, price: 110.5, isDerivative: false, refPrice: 108 }), 110500);
});
test("Magnetar CRWV call sale: the price box holds the row total", () => {
  const row = { shares: 627486, price: 12502658.55, isDerivative: true, refPrice: 110 };
  assert.equal(priceIsRowTotal(row), true);
  assert.equal(tradeValue(row), 12502658.55);
  assert.ok(Math.abs(unitPrice(row)! - 19.925) < 0.001);
});
test("warrant sold near the share price stays per-unit", () => {
  assert.equal(tradeValue({ shares: 2000, price: 105.45, isDerivative: true, refPrice: 110 }), 210900);
});
test("derivative with no reference price: only absurd prices are totals", () => {
  assert.equal(tradeValue({ shares: 500, price: 40, isDerivative: true }), 20000);
  assert.equal(tradeValue({ shares: 41654, price: 828914.6, isDerivative: true }), 828914.6);
});
test("stock row fifty times above the stock's other trades is a total", () => {
  assert.equal(tradeValue({ shares: 10000, price: 1_000_000, isDerivative: false, refPrice: 100 }), 1_000_000);
  // a pre-split price ten times higher is left alone
  assert.equal(tradeValue({ shares: 100, price: 1000, isDerivative: false, refPrice: 100 }), 100000);
});
test("no price, zero price, or a value above a trillion gives null", () => {
  assert.equal(tradeValue({ shares: 100, price: null }), null);
  assert.equal(tradeValue({ shares: 100, price: 0 }), null);
  assert.equal(tradeValue({ shares: 5e9, price: 900, isDerivative: false }), null);
});
test("median", () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null); });
