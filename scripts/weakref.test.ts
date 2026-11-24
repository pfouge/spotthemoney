// Price check for weakly referenced stocks (shared/tradevalue: priceUnusable) and the reference
// counts that feed it (web/src/lib/txnbuild: refStatsMap, buildTxn). Cases are production rows
// seen on 2026-11-24.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeValue, priceUnusable, WEAK_REF_ROWS } from "../shared/src/tradevalue.ts";
import { refStatsMap, buildTxn, unusablePriceLog, type RawTxn } from "../web/src/lib/txnbuild.ts";

test("SPPL: four rows, the median is itself a total; a price above $100,000 a share is not used", () => {
  const ref = 141942; // the corrupted median
  for (const [shares, price] of [[189309, 270711.87], [62894, 162219.43], [47171, 121664.57]] as const) {
    const row = { shares, price, isDerivative: false, refPrice: ref, refRows: 4, sharesOutstanding: 5786184 };
    assert.equal(priceUnusable(row), true);
    assert.equal(tradeValue(row), null);
  }
});
test("INFY in rupees: a price that values the company above $500 billion is not used when shares outstanding are known", () => {
  const row = { shares: 95800, price: 1177.86, isDerivative: false, refPrice: 1091, refRows: 4, sharesOutstanding: 4.056e9 };
  assert.equal(tradeValue(row), null);
  // the same row without the shares outstanding (on-demand pages): only the per-share ceiling applies
  assert.equal(tradeValue({ ...row, sharesOutstanding: null }), 95800 * 1177.86);
});
test("well referenced stocks are never touched: a real large company, or a high but real price", () => {
  assert.equal(tradeValue({ shares: 1000, price: 234, isDerivative: false, refPrice: 184, refRows: 314, sharesOutstanding: 24.1e9 }), 234000);
  assert.equal(tradeValue({ shares: 10, price: 7922, isDerivative: false, refPrice: 7922, refRows: WEAK_REF_ROWS, sharesOutstanding: 3e6 }), 79220);
  // a weakly referenced small company at an ordinary price
  assert.equal(tradeValue({ shares: 1000, price: 5.37, isDerivative: false, refPrice: 5.37, refRows: 1, sharesOutstanding: 13e6 }), 5370);
});
test("the company-value test spares grants and low prices (ADS against ordinary shares)", () => {
  // Akari: a grant at $10.02, shares outstanding counted in ordinary shares
  assert.equal(priceUnusable({ shares: 1248, price: 10.02, isDerivative: false, refRows: 0, sharesOutstanding: 186e9, code: "A" }), false);
  assert.equal(priceUnusable({ shares: 1248, price: 10.02, isDerivative: false, refRows: 0, sharesOutstanding: 186e9, code: "S" }), false);
  // a Wells Fargo row at $1,000 with code J is left alone; Mizuho in yen on code D is not
  assert.equal(priceUnusable({ shares: 39, price: 1000, isDerivative: false, refRows: 3, sharesOutstanding: 3.0e9, code: "J" }), false);
  assert.equal(priceUnusable({ shares: 264, price: 11910.34, isDerivative: false, refRows: 0, sharesOutstanding: 2.49e9, code: "D" }), true);
});
test("derivative rows and callers that pass no count are left to the older rules", () => {
  assert.equal(priceUnusable({ shares: 10, price: 500000, isDerivative: true, refRows: 1 }), false);
  assert.equal(priceUnusable({ shares: 10, price: 500000, isDerivative: false }), false);
});

const raw = (o: Partial<RawTxn>): RawTxn => ({ id: 1, filing_id: 1, person_id: 1, security_id: 7, side: "sell", txn_code: "S", is_derivative: false, txn_date: "2026-11-04",
  disclosed_at: "2026-11-05", amount_low: null, amount_high: null, shares: 100, price: 10, disclosure_lag_days: 1, is_10b5_1: false, owner_type: "direct", asset_type: null, owned_after: null, ...o });
const facts = { source: "sec_form4", filedAt: "2026-11-05", sourceUrl: null, isPublished: true };

test("refStatsMap counts the open-market stock rows behind each median", () => {
  const rows = [raw({ id: 1, price: 10 }), raw({ id: 2, price: 12 }), raw({ id: 3, txn_code: "M", price: 1 }), raw({ id: 4, is_derivative: true, price: 3 }), raw({ id: 5, security_id: 8, price: 4 })];
  const m = refStatsMap(rows);
  assert.deepEqual(m.get(7), { price: 11, rows: 2 });
  assert.deepEqual(m.get(8), { price: 4, rows: 1 });
});
test("buildTxn: a stock with no open-market rows at all counts as weakly referenced", () => {
  assert.equal(buildTxn(raw({ shares: 1000, price: 402000 }), facts, null).value, null);
  assert.equal(buildTxn(raw({ shares: 1000, price: 402000 }), facts, 402000, { rows: 1 }).value, null);
  assert.equal(buildTxn(raw({ shares: 1000, price: 40 }), facts, null).value, 40000);
});
test("unusablePriceLog names the stocks", () => {
  const rows = [raw({ id: 1, price: 270711.87, shares: 189309 }), raw({ id: 2, price: 1, shares: 1 })];
  const line = unusablePriceLog(rows, refStatsMap(rows), () => null, () => "SPPL", "test");
  assert.match(line, /: 1 Form 4 stock row .*: SPPL 1$/);
});
