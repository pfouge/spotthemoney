// Schedules 13D and 13G: a holder that reports on two classes of a company's shares
// (lib/schedule13.ts classKey, rowsByClass). The shapes are the ones met on production on
// 2026-11-24: an index manager filing on Class A and Class C on one day, a holder going back
// and forth between two classes, a CUSIP number that changed after a reverse split, a mistyped
// number, several series of one company, and a statement with no number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classKey, rowsByClass, sortStatements, holdersOf, holderSummary, holderCount, holdingCompanies, summarySentence, holdingsOf, holdingsSentence, type Statement } from "../web/src/lib/schedule13";

const base: Statement = { accession: "0000000000-26-000001", formType: "SCHEDULE 13G", schedule: "13G", isAmendment: false, filedAt: "2026-11-10", eventDate: "2026-09-30",
  issuerCik: "0000000001", issuerCusip: "000000AA1", securityClass: "Common Stock", filerCik: "0000000101", reporterName: "Fund One LP", reporterCount: 1,
  shares: 1_000_000, percent: 6.5, rules: ["Rule 13d-1(b)"], purpose: null, sourceUrl: null };
const st = (over: Partial<Statement>): Statement => ({ ...base, ...over });
const built = "2026-11-20T08:00:00.000Z";
const A = "02079K305", C = "02079K107";
const acc = (rows: { latest: Statement; statements: number }[]) => rows.map((r) => [r.latest.accession, r.statements]);

test("schedule 13: a CUSIP number as a key for a class of shares", () => {
  assert.equal(classKey(" 02079k107 "), "02079K107");
  assert.equal(classKey("US50101L1061"), "50101L106", "the nine characters inside a U.S. ISIN");
  assert.equal(classKey("0000000000"), "", "all zeros is no number");
  assert.equal(classKey(null), "");
  assert.equal(classKey(""), "");
  assert.equal(classKey("31946M1036"), "31946M1036", "a mistyped number is kept as typed");
  assert.equal(classKey("1431062*2"), "1431062*2", "private placement numbers keep their signs");
});

test("schedule 13: two numbers are two classes only when their statements overlap in time", () => {
  // Both on one day: two rows.
  const sameDay = sortStatements([st({ accession: "v-1", issuerCusip: A, filedAt: "2026-04-29", percent: 7.48 }), st({ accession: "v-2", issuerCusip: C, filedAt: "2026-04-29", percent: 6.41 })]);
  assert.deepEqual(acc(rowsByClass(sameDay)), [["v-2", 1], ["v-1", 1]]);
  // Back to the first number after the second: two rows, each its class's newest.
  const back = sortStatements([
    st({ accession: "s-1", issuerCusip: A, filedAt: "2025-11-10", percent: 8.9 }), st({ accession: "s-2", issuerCusip: C, filedAt: "2026-05-12", percent: 5.9 }),
    st({ accession: "s-3", issuerCusip: A, filedAt: "2026-11-10", percent: 9.8 }), st({ accession: "s-4", issuerCusip: C, filedAt: "2026-08-07", percent: 6.3 })]);
  assert.deepEqual(acc(rowsByClass(back)), [["s-3", 2], ["s-4", 2]]);
  // Every statement under the old number before every statement under the new one: the number changed.
  const changed = sortStatements([
    st({ accession: "r-1", issuerCusip: "862945102", filedAt: "2025-11-14", percent: 9.99 }), st({ accession: "r-2", issuerCusip: "862945102", filedAt: "2026-02-17", percent: 9.99 }),
    st({ accession: "r-3", issuerCusip: "862945300", filedAt: "2026-05-15", percent: 5.2 }), st({ accession: "r-4", issuerCusip: "862945300", filedAt: "2026-08-14", percent: 7.6 })]);
  assert.deepEqual(acc(rowsByClass(changed)), [["r-4", 4]], "the older, larger figure under the old number is not left standing beside the new one");
  // A mistyped number used once, before the right one.
  assert.deepEqual(acc(rowsByClass(sortStatements([st({ accession: "t-1", issuerCusip: "051774907", filedAt: "2025-11-13" }), st({ accession: "t-2", issuerCusip: "051774107", filedAt: "2026-05-07" })]))), [["t-2", 2]]);
  // Four numbers: two were last used before a third began; the fourth overlaps the third.
  const four = sortStatements([
    st({ accession: "m-1", issuerCusip: "531229763", filedAt: "2025-12-10" }), st({ accession: "m-2", issuerCusip: "531229748", filedAt: "2025-12-17" }),
    st({ accession: "m-3", issuerCusip: "531229730", filedAt: "2025-12-17" }), st({ accession: "m-4", issuerCusip: "531229771", filedAt: "2026-03-31" }),
    st({ accession: "m-5", issuerCusip: "531229763", filedAt: "2026-11-05" }), st({ accession: "m-6", issuerCusip: "531229771", filedAt: "2026-11-05" })]);
  assert.deepEqual(acc(rowsByClass(four)), [["m-6", 4], ["m-5", 2]], "statements under replaced numbers are counted with the newest row");
  assert.equal(rowsByClass(four).reduce((a, r) => a + r.statements, 0), four.length);
  // A statement with no number: the holder is never split.
  const blank = sortStatements([st({ accession: "n-1", issuerCusip: A, filedAt: "2026-04-29" }), st({ accession: "n-2", issuerCusip: null, filedAt: "2026-04-29" }), st({ accession: "n-3", issuerCusip: C, filedAt: "2026-04-29" })]);
  assert.deepEqual(acc(rowsByClass(blank)), [["n-3", 3]]);
  // One number typed three ways is one class.
  assert.deepEqual(acc(rowsByClass(sortStatements([st({ accession: "i-1", issuerCusip: "US02079K3059", filedAt: "2026-01-01" }), st({ accession: "i-2", issuerCusip: "02079k305 ", filedAt: "2026-06-01" }), st({ accession: "i-3", issuerCusip: A, filedAt: "2026-03-01" })]))), [["i-2", 3]]);
  assert.deepEqual(rowsByClass([]), []);
});

test("schedule 13: a holder with two classes is one holder in two rows, on the company's page and on its own", () => {
  const xs = [
    st({ accession: "v-1", issuerCusip: A, filedAt: "2026-04-29", percent: 7.48, securityClass: "Class A" }), st({ accession: "v-2", issuerCusip: C, filedAt: "2026-04-29", percent: 3.2, securityClass: "Class C" }),
    st({ accession: "w-1", filerCik: "0000000202", reporterName: "Other Fund", issuerCusip: A, filedAt: "2026-02-01", percent: 6 }),
    st({ accession: "w-2", filerCik: "0000000202", reporterName: "Other Fund", issuerCusip: "02079K999", filedAt: "2026-09-01", percent: 5.5 }),
    st({ accession: "y-1", filerCik: "0000000303", reporterName: "Later LLC", issuerCusip: C, filedAt: "2026-12-01", percent: 50 }), // after the build day
  ];
  const hs = holdersOf(xs, built);
  assert.deepEqual(hs.map((h) => h.latest.accession), ["v-1", "w-2", "v-2"]);
  assert.equal(hs[0]!.holder, hs[2]!.holder);
  assert.deepEqual(holdersOf([...xs].reverse(), built).map((h) => h.latest.accession), ["v-1", "w-2", "v-2"], "the same rows whatever the order of the input");
  const s = holderSummary(hs);
  assert.deepEqual({ holders: s.holders, rows: s.rows, multiClass: s.multiClass, atOrAbove: s.atOrAbove, below: s.below, noPercent: s.noPercent, statements: s.statements },
    { holders: 2, rows: 3, multiClass: 1, atOrAbove: 2, below: 1, noPercent: 0, statements: 4 });
  assert.equal(s.atOrAbove + s.below + s.noPercent, s.rows);
  assert.equal(holderCount(xs, built), 2, "the tile counts holders, not the three rows");
  assert.equal(holderCount([], built), 0);
  assert.equal(holderCount([xs[4]!], built), 0, "a statement dated after the build day is no holder yet");
  assert.equal(summarySentence("Acme", s), "2 holders have filed an ownership statement (Schedule 13D or 13G) about Acme with the SEC since October 2025, 1 of them about more than one class of shares, so the table has 3 rows, one for each holder and class. In the newest statement of each row, 2 report 5% or more of a class of shares, 1 reports less than 5%.");
  // The filer's side uses the same test, company by company.
  const mine = [xs[0]!, xs[1]!, st({ accession: "z-1", issuerCik: "0000000002", issuerCusip: "111111AA1", filedAt: "2026-01-05", percent: 9 }), st({ accession: "z-2", issuerCik: "0000000002", issuerCusip: "111111AB9", filedAt: "2026-07-05", percent: 8 })];
  const hd = holdingsOf(mine, built);
  assert.deepEqual(hd.map((h) => [h.latest.issuerCik, h.latest.accession, h.statements]), [["0000000002", "z-2", 2], ["0000000001", "v-1", 1], ["0000000001", "v-2", 1]]);
  assert.equal(holdingCompanies(hd), 2, "the filer's tile counts companies, not the three rows");
  assert.equal(holdingCompanies([]), 0);
  assert.equal(holdingsSentence("Fund One LP", hd), "Fund One LP is the filer of an ownership statement (Schedule 13D or 13G) about 2 companies this site tracks, filed with the SEC since October 2025, about more than one class of shares in 1 of them, so the table has 3 rows. Of the newest statement in each row, 2 report 5% or more of a class of shares, 1 reports less than 5%.");
  for (const t of [summarySentence("Acme", s), holdingsSentence("Fund One LP", hd)]) assert.ok(!t.includes(String.fromCharCode(0x2014)) && !/\b(bought|sold|activist)\b/i.test(t));
});
