// Offline tests for the LD-203 contribution reader. Run:
//   npx tsx --test ingest/src/lib/lobbycontrib.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { beforeCursor, cleanText, hasPageShape, parseAmount, parseContribFiling, parseDate } from "./lobbycontrib.js";

const TODAY = "2026-11-22";
const base = {
  filing_uuid: "abc-1", filing_type: "MM", filing_year: 2026, filing_period: "mid_year", filer_type: "lobbyist",
  dt_posted: "2026-11-11T18:50:45-05:00", filing_document_url: "https://lda.gov/filings/public/contribution/abc-1/print/",
  url: "https://lda.gov/api/v1/contributions/abc-1/", registrant: { id: 7, name: "  Acme   Lobbying\n" },
  lobbyist: { prefix: null, first_name: "Jane", middle_name: "Q", last_name: "Doe", suffix: "Jr." },
  no_contributions: false, pacs: ["PAC One", "  ", 5],
  contribution_items: [{ contribution_type: "feca", contributor_name: "Jane Doe", payee_name: "Friends of X", honoree_name: "X", amount: "1000.00", date: "2026-03-24" }],
};

test("amounts: plain decimals only", () => {
  assert.equal(parseAmount("1000.00"), 1000);
  assert.equal(parseAmount("$1,250.50"), 1250.5);
  assert.equal(parseAmount("-5"), -5);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("1e9"), null);
  assert.equal(parseAmount("99999999999999"), null);
  assert.equal(parseAmount(null), null);
});

test("dates: real, not future", () => {
  assert.equal(parseDate("2026-03-24", TODAY), "2026-03-24");
  assert.equal(parseDate("2026-11-22", TODAY), "2026-11-22");
  assert.equal(parseDate("2026-11-23", TODAY), null);
  assert.equal(parseDate("2026-02-30", TODAY), null);
  assert.equal(parseDate("03/24/2026", TODAY), null);
  assert.equal(parseDate(undefined, TODAY), null);
});

test("text: control characters out, white space collapsed, cut", () => {
  assert.equal(cleanText("a\u0000b\tc \n d"), "a b c d");
  assert.equal(cleanText("   "), null);
  assert.equal(cleanText("x".repeat(500), 10), "xxxxxxxxxx");
});

test("a filing and its items", () => {
  const p = parseContribFiling(base, TODAY)!;
  assert.equal(p.filing.filing_uuid, "abc-1");
  assert.equal(p.filing.registrant_name, "Acme Lobbying");
  assert.equal(p.filing.registrant_id, 7);
  assert.equal(p.filing.lobbyist_name, "Jane Q Doe Jr.");
  assert.deepEqual(p.filing.pacs, ["PAC One"]);
  assert.equal(p.filing.source_url, base.filing_document_url);
  assert.equal(p.filing.item_count, 1);
  assert.equal(p.items[0]!.seq, 1);
  assert.equal(p.items[0]!.amount, 1000);
  assert.equal(p.items[0]!.contributed_at, "2026-03-24");
});

test("no document url: the API detail url; organization has no lobbyist name", () => {
  const p = parseContribFiling({ ...base, filing_document_url: null, lobbyist: null, filer_type: "organization", contribution_items: [], no_contributions: true }, TODAY)!;
  assert.equal(p.filing.source_url, base.url);
  assert.equal(p.filing.lobbyist_name, null);
  assert.equal(p.filing.no_contributions, true);
  assert.equal(p.items.length, 0);
});

test("bad amounts and dates are NULL and counted", () => {
  const p = parseContribFiling({ ...base, contribution_items: [
    { amount: "abc", date: "2099-01-01", honoree_name: "H" },
    { amount: "5.00", date: "2026-02-30" },
    { amount: null, date: null },
  ] }, TODAY)!;
  assert.equal(p.badAmounts, 1);
  assert.equal(p.badDates, 2);
  assert.equal(p.items[0]!.amount, null);
  assert.equal(p.items[0]!.contributed_at, null);
  assert.equal(p.items.length, 3);
});

test("not a filing", () => {
  assert.equal(parseContribFiling({ a: 1 }, TODAY), null);
  assert.equal(parseContribFiling(null, TODAY), null);
});

test("page layout and cursor", () => {
  assert.equal(hasPageShape({ count: 1, results: [] }), true);
  assert.equal(hasPageShape({ results: [] }), false);
  assert.equal(hasPageShape({ count: 1 }), false);
  assert.equal(beforeCursor("2026-11-11T18:50:45-05:00"), "2026-11-11T18:50:46");
  assert.equal(beforeCursor("garbage-date-time-x"), "garbage-da");
});
