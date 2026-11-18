// Ticker history flags for congressional rows (web/src/lib/tickerhistory.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tickerHistory, firstEligibleFrom, histFlags, histTitle, isHistFlag, runFlag, FIRST_FLAG, RECORD_START, FIRST_MIN_DAYS, RUN_MIN, NO_HIST } from "../web/src/lib/tickerhistory";
import { flagHref } from "../web/src/lib/links";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let id = 0;
const row = (who: number, ticker: string | null, side: string, txn: string | null) => ({ id: ++id, who, ticker, side, txn });

test("the first day that can be a first trade is 90 days after the record starts", () => {
  assert.equal(RECORD_START, "2025-10-01"); assert.equal(FIRST_MIN_DAYS, 90); assert.equal(RUN_MIN, 3);
  assert.equal(firstEligibleFrom(), "2025-12-30");
  assert.equal(firstEligibleFrom("2026-01-01", 30), "2026-01-31");
});

test("first: the earliest trade date per member and ticker, every row of that day, only when late enough", () => {
  id = 0;
  const rows = [
    row(1, "NVDA", "buy", "2026-03-02"),   // 1 first (two lots on the day)
    row(1, "nvda", "buy", "2026-03-02"),   // 2 first too: the ticker's case does not matter
    row(1, "NVDA", "sell", "2026-05-01"),  // 3 not first
    row(1, "AAPL", "sell", "2025-12-29"),  // 4 earliest AAPL, one day too early for the flag
    row(1, "AAPL", "sell", "2026-02-01"),  // 5 not first: 4 is earlier
    row(2, "NVDA", "sell", "2025-12-30"),  // 6 another member: first, on the first eligible day
    row(2, "MSFT", "exchange", "2026-04-01"), // 7 an exchange can be the first day
    row(2, "MSFT", "buy", "2026-04-09"),   // 8 not first
    row(3, null, "buy", "2026-04-01"),     // 9 no ticker: no part
    row(3, "", "buy", "2026-04-01"),       // 10 no ticker: no part
    row(3, "TSLA", "buy", null),           // 11 no trade date: no part
    row(3, "TSLA", "buy", "2026-06-01"),   // 12 first: the undated row is ignored
  ];
  const h = tickerHistory(rows);
  assert.deepEqual(rows.filter((r) => h.get(r.id)?.first).map((r) => r.id), [1, 2, 6, 7, 12]);
  assert.deepEqual([9, 10, 11].map((i) => h.has(i)), [false, false, false]);
  assert.equal(h.size, 9);
});

test("runs: one-sided trade dates running; a mixed day ends a run, an exchange does not, lots on a day are one day", () => {
  id = 0;
  const rows = [
    row(1, "NVDA", "buy", "2026-01-05"),      // 1 run 1
    row(1, "NVDA", "buy", "2026-01-12"),      // 2 run 2
    row(1, "NVDA", "buy", "2026-01-12"),      // 3 run 2 (second lot, same day)
    row(1, "NVDA", "exchange", "2026-01-15"), // 4 no run, does not end it
    row(1, "NVDA", "buy", "2026-01-20"),      // 5 run 3
    row(1, "NVDA", "exchange", "2026-01-20"), // 6 an exchange on a purchase day carries no run
    row(1, "NVDA", "buy", "2026-02-01"),      // 7 run 4
    row(1, "NVDA", "sell", "2026-02-10"),     // 8 sale: run 1
    row(1, "NVDA", "buy", "2026-02-11"),      // 9 purchase again: run 1
    row(1, "NVDA", "buy", "2026-02-12"),      // 10 mixed day: none
    row(1, "NVDA", "sell", "2026-02-12"),     // 11 mixed day: none
    row(1, "NVDA", "buy", "2026-02-13"),      // 12 after a mixed day the count starts again: 1
    row(2, "NVDA", "sell", "2026-01-06"),     // 13 another member is another count: 1
    row(1, "AAPL", "buy", "2026-01-21"),      // 14 another ticker is another count: 1
  ];
  const h = tickerHistory(rows);
  assert.deepEqual(rows.map((r) => h.get(r.id)!.run), [1, 2, 2, 0, 3, 0, 4, 1, 1, 0, 0, 1, 1, 1]);
  // The order of the input does not matter: rows are ordered by trade date.
  const again = tickerHistory([...rows].reverse());
  assert.deepEqual(rows.map((r) => again.get(r.id)), rows.map((r) => h.get(r.id)));
});

test("flags: wording, the threshold, and the hover text states the fact and the start of the record", () => {
  assert.deepEqual(histFlags(undefined, "buy"), []);
  assert.deepEqual(histFlags(NO_HIST, "buy"), []);
  assert.deepEqual(histFlags({ first: true, run: 1 }, "buy"), [FIRST_FLAG]);
  assert.deepEqual(histFlags({ first: false, run: 2 }, "buy"), []);
  assert.deepEqual(histFlags({ first: false, run: 3 }, "buy"), ["3rd buy in a row"]);
  assert.deepEqual(histFlags({ first: false, run: 4 }, "sell"), ["4th sale in a row"]);
  assert.equal(runFlag({ first: false, run: 11 }, "buy"), "11th buy in a row");
  assert.equal(runFlag({ first: false, run: 22 }, "sell"), "22nd sale in a row");
  assert.equal(runFlag({ first: false, run: 21 }, "buy"), "21st buy in a row");
  assert.equal(runFlag({ first: false, run: 5 }, "exchange"), "");
  for (const f of [FIRST_FLAG, "3rd buy in a row", "12th sale in a row"]) assert.ok(isHistFlag(f), f);
  for (const f of ["late", "spouse", "first", "3rd exchange in a row"]) assert.ok(!isHistFlag(f), f);
  assert.equal(histTitle(FIRST_FLAG, "NVDA"), "No earlier trade in NVDA in this member's reports on record here, which were filed from October 2025 on");
  assert.equal(histTitle("3rd buy in a row", "NVDA"), "NVDA bought on 3 trade dates running with no sale between, in the reports on record here");
  assert.equal(histTitle("4th sale in a row", ""), "this ticker sold on 4 trade dates running with no purchase between, in the reports on record here");
  // No flag text gives a reason for a trade or a verdict on it.
  for (const t of [histTitle(FIRST_FLAG, "X"), histTitle("3rd buy in a row", "X"), FIRST_FLAG]) assert.ok(!/because|signal|bullish|bearish|confiden|unusual|suspicious/i.test(t), t);
});

test("the flags link to a real guide section, for congressional rows only", () => {
  const to = flagHref(FIRST_FLAG, "house_ptr");
  assert.equal(to, "/guides/how-to-read-a-congressional-trade-report/#ticker-history");
  assert.equal(flagHref("5th sale in a row", "senate_ptr"), to);
  assert.equal(flagHref(FIRST_FLAG, "sec_form4"), null);
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/src/lib/guides/congress.ts"), "utf8");
  assert.ok(src.includes('slug: "how-to-read-a-congressional-trade-report"') && src.includes('{ id: "ticker-history",'), "the guide has the section the flags link to");
});
