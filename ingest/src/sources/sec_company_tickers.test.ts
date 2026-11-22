// Offline tests for the ticker-owner source (no network, no database). Run:
//   npx tsx --test ingest/src/sources/sec_company_tickers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCompanyTickers, readRepair, tickersUrl, MIN_ROWS } from "./sec_company_tickers.js";

test("ticker file: the SEC's object of numbered entries", () => {
  const p = parseCompanyTickers({
    "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    "1": { cik_str: "1404912", ticker: "kkr", title: " KKR &  Co. Inc. " },
    "2": { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" },
  });
  assert.equal(p.entries, 3);
  assert.equal(p.unusable, 0);
  assert.deepEqual(p.rows, [
    { ticker: "AAPL", cik: "0000320193", title: "Apple Inc.", rank: 0 },
    { ticker: "KKR", cik: "0001404912", title: "KKR & Co. Inc.", rank: 1 },
    { ticker: "BRK-B", cik: "0001067983", title: "BERKSHIRE HATHAWAY INC", rank: 2 },
  ]);
});

test("ticker file: a list works too, and the first listing of a ticker is kept", () => {
  const p = parseCompanyTickers([
    { cik_str: 1, ticker: "AAA", title: "First" },
    { cik_str: 2, ticker: "AAA", title: "Second" },
  ]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0]!.cik, "0000000001");
  assert.equal(p.repeats, 1);
});

test("ticker file: entries with no symbol or no SEC number are left out and counted", () => {
  const p = parseCompanyTickers({
    a: { cik_str: 5, ticker: "", title: "No ticker" },
    b: { cik_str: "abc", ticker: "GOOD", title: "Bad number" },
    c: { cik_str: 0, ticker: "ZERO", title: "Zero" },
    d: { cik_str: 7, ticker: "<script>", title: "Not a symbol" },
    e: "text",
    f: { cik_str: 9, ticker: "OK", title: 12 },
  });
  assert.equal(p.entries, 6);
  assert.equal(p.unusable, 5);
  assert.deepEqual(p.rows, [{ ticker: "OK", cik: "0000000009", title: null, rank: 0 }]);
});

test("ticker file: another shape gives no rows and does not throw", () => {
  for (const v of [null, undefined, "x", 7, { message: "something else" }, []]) {
    assert.equal(parseCompanyTickers(v).rows.length, 0);
  }
  assert.ok(MIN_ROWS >= 1000);
});

test("the address and the repair answer", () => {
  assert.equal(tickersUrl("https://www.sec.gov"), "https://www.sec.gov/files/company_tickers.json");
  assert.deepEqual(readRepair({ securities_moved: 2, moved: ["IVZ", "KKR"], tickers_cleared: 1, cleared: ["PRU"], skipped: [] }),
    { securities_moved: 2, moved: ["IVZ", "KKR"], tickers_cleared: 1, cleared: ["PRU"], skipped: [] });
  assert.deepEqual(readRepair(null), { securities_moved: 0, moved: [], tickers_cleared: 0, cleared: [], skipped: [] });
});
