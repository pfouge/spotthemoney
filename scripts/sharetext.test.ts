import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeSentence, chartId } from "../web/src/lib/sharetext.ts";

const base = { name: "Jane Doe", side: "sell", amount: "$1M–$5M", what: "NVDA", txnDate: "2026-09-03", disclosedAt: "2026-09-20", lagDays: 17 };

test("a sale with a range, both dates and a lag", () => {
  assert.equal(tradeSentence(base), "Jane Doe sold $1M–$5M of NVDA on Sep 3, 2026; disclosed Sep 20, 2026, 17 days later.");
});
test("a buy disclosed the next day says 1 day", () => {
  assert.equal(tradeSentence({ ...base, side: "buy", amount: "$41.2M", what: "AAPL", lagDays: 1 }), "Jane Doe bought $41.2M of AAPL on Sep 3, 2026; disclosed Sep 20, 2026, 1 day later.");
});
test("no amount, no trade date: nothing is invented", () => {
  assert.equal(tradeSentence({ ...base, amount: "—", txnDate: null }), "Jane Doe sold NVDA; disclosed Sep 20, 2026.");
});
test("a timestamp disclosure date is read in UTC", () => {
  assert.equal(tradeSentence({ ...base, disclosedAt: "2026-09-20T23:30:00Z", lagDays: null }), "Jane Doe sold $1M–$5M of NVDA on Sep 3, 2026; disclosed Sep 20, 2026.");
});
test("option and other rows are not called buys or sells", () => {
  assert.equal(tradeSentence({ ...base, side: "option" }), "Jane Doe reported an option or conversion in NVDA worth $1M–$5M on Sep 3, 2026; disclosed Sep 20, 2026, 17 days later.");
  assert.equal(tradeSentence({ ...base, side: "other", amount: null }), "Jane Doe reported a transaction in NVDA on Sep 3, 2026; disclosed Sep 20, 2026, 17 days later.");
  assert.equal(tradeSentence({ ...base, side: "exchange" }), "Jane Doe exchanged $1M–$5M of NVDA on Sep 3, 2026; disclosed Sep 20, 2026, 17 days later.");
});
test("missing filer and asset fall back to neutral words", () => {
  assert.equal(tradeSentence({ ...base, name: null, what: null, disclosedAt: null }), "A filer sold $1M–$5M of an asset on Sep 3, 2026.");
});
test("chart ids are stable slugs", () => {
  assert.equal(chartId("Weekly flow"), "chart-weekly-flow");
  assert.equal(chartId("Buy / sell pressure"), "chart-buy-sell-pressure");
  assert.equal(chartId("Congress & insiders: who leads?"), "chart-congress-and-insiders-who-leads");
});
