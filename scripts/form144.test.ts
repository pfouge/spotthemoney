import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, stated, relationshipLabel, sortNotices, noticesInWindow, noticeSummary, summarySentence, sellerKey, form144Log, emptyForm144, NOTICE_CAVEAT, NOTICE_ROWS, type Notice } from "../web/src/lib/form144";
import { caughtUp, catchingUp, emptyStored, CAUGHT_UP_DAYS } from "../web/src/lib/coverage-stored";

const base: Notice = { accession: "0000000000-26-000001", formType: "144", filedAt: "2026-11-10", issuerCik: "0000000001", filerCik: "0000000101", sellerName: "JANE ROE",
  relationships: ["Officer"], securityClass: "Common", shares: 1000, marketValue: 150000, sharesOutstanding: 1e9, approxSaleDate: "2026-11-10", broker: "Broker LLC",
  planAdoptionDate: null, noticeDate: "2026-11-10", sold3mShares: null, sold3mProceeds: null, nothingSold3m: true, sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/x-index.htm" };
const n = (over: Partial<Notice>): Notice => ({ ...base, ...over });
const built = "2026-11-20T08:00:00.000Z";

test("form 144: shown only once the newest filing on file is within the allowance of the build day", () => {
  assert.equal(caughtUp("2026-11-10", built), true, `${CAUGHT_UP_DAYS} days back is current`);
  assert.equal(caughtUp("2026-11-09", built), false);
  assert.equal(caughtUp(null, built), false);
  assert.equal(caughtUp("soon", built), false);
  assert.equal(caughtUp("2026-11-18", "not a date"), false);
  // The page switch and the methodology's "not shown" sentence are one condition.
  for (const last of ["2026-11-10", "2026-11-09", "2026-08-12"]) {
    assert.equal(caughtUp(last, built), !catchingUp({ ...emptyStored(), rows: 5, lastFiled: last }, built));
  }
});

test("form 144: text is cleaned and figures of zero or less are blanks", () => {
  assert.equal(cleanText("  FLUOR \n CORP\u0007 "), "FLUOR CORP");
  assert.equal(cleanText("a\u202eb"), "a b");
  assert.equal(cleanText(""), null);
  assert.equal(cleanText(7), null);
  assert.equal(cleanText("x".repeat(200), 50)!.length, 50);
  assert.equal(stated(0), null);
  assert.equal(stated(-5), null);
  assert.equal(stated(NaN), null);
  assert.equal(stated(null), null);
  assert.equal(stated(12.5), 12.5);
});

test("form 144: relationships are shown as filed, repeats dropped", () => {
  assert.equal(relationshipLabel(["Officer", "Director"]), "Officer, Director");
  assert.equal(relationshipLabel(["Officer", "OFFICER", " officer "]), "Officer");
  assert.equal(relationshipLabel(["See Remarks"]), "See Remarks");
  assert.equal(relationshipLabel([]), null);
  assert.equal(relationshipLabel(null), null);
});

test("form 144: order, window and summary", () => {
  const xs = [
    n({ accession: "a-1", filedAt: "2026-11-01" }),
    n({ accession: "a-3", filedAt: "2026-11-10", formType: "144/A" }),
    n({ accession: "a-2", filedAt: "2026-11-10", planAdoptionDate: "2026-02-01" }),
    n({ accession: "a-0", filedAt: "2025-11-19", filerCik: "0000000102" }),           // 366 days back: out
    n({ accession: "a-4", filedAt: "2025-11-20", filerCik: null, sellerName: "Trust A" }),   // 365 days back: in
    n({ accession: "a-5", filedAt: "2026-11-21", filerCik: null, sellerName: "TRUST a" }),   // after the build day: out
  ];
  assert.deepEqual(sortNotices(xs).map((x) => x.accession), ["a-5", "a-3", "a-2", "a-1", "a-4", "a-0"]);
  const w = noticesInWindow(xs, built);
  assert.deepEqual(w.map((x) => x.accession), ["a-3", "a-2", "a-1", "a-4"]);
  assert.deepEqual(noticesInWindow(xs, "junk"), []);
  const s = noticeSummary(w);
  assert.deepEqual(s, { notices: 4, amendments: 1, sellers: 2, withPlan: 1, newest: "2026-11-10", oldest: "2025-11-20" });
  assert.equal(sellerKey(n({ filerCik: null, sellerName: " Trust  A " })), sellerKey(n({ filerCik: null, sellerName: "TRUST a" })));
  assert.equal(summarySentence("Acme Corp", s), "4 Form 144 notices about Acme Corp were filed with the SEC in the last 12 months by 2 sellers, 1 of them an amendment. 1 notice states the date a Rule 10b5-1 trading plan was adopted.");
  assert.equal(summarySentence("Acme Corp", noticeSummary([xs[0]])), "1 Form 144 notice about Acme Corp was filed with the SEC in the last 12 months by 1 seller.");
  assert.equal(summarySentence("Acme Corp", noticeSummary([])), "");
});

test("form 144: wording states a plan, never a sale, a reason or advice", () => {
  const texts = [NOTICE_CAVEAT, summarySentence("Acme Corp", noticeSummary([n({}), n({ accession: "b", formType: "144/A", planAdoptionDate: "2026-01-01" })]))];
  assert.match(NOTICE_CAVEAT, /not a report of a sale/);
  assert.match(NOTICE_CAVEAT, /none of them is in any buy or sell total/);
  for (const t of texts) {
    assert.doesNotMatch(t, /\u2014/);
    assert.doesNotMatch(t, /\b(dumping|bearish|bullish|signal|warning|insiders are selling|expects?|because)\b/i);
    assert.doesNotMatch(t, /\b(has sold|have sold|was sold|were sold)\b/i);
  }
});

test("form 144: the build-log line", () => {
  assert.match(form144Log({ ...emptyForm144(), lastFiled: "2026-08-12" }, built, new Set()), /^planned sales \(Form 144\): not shown \(newest filing on file 2026-08-12;/);
  const many = Array.from({ length: NOTICE_ROWS + 1 }, (_, i) => n({ accession: `m-${String(i).padStart(2, "0")}`, issuerCik: "0000000002", marketValue: 10 + i }));
  const d = { shown: true, lastFiled: "2026-11-18", byCik: new Map([["0000000001", [n({}), n({ accession: "z", formType: "144/A", filedAt: "2025-10-05", marketValue: 2e6 })]], ["0000000002", many], ["0000000003", [n({ accession: "off" })]]]) };
  assert.equal(form144Log(d, built, new Set(["0000000001", "0000000002"])),
    `planned sales (Form 144): shown; ${NOTICE_ROWS + 3} notices for 2 companies on the site (1 amendments), newest 2026-11-10; ${NOTICE_ROWS + 2} filed in the last 365 days for 2 companies; 1 companies with more than ${NOTICE_ROWS}; largest stated value 2000000`);
});
