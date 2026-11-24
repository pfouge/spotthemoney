// Schedules 13D and 13G: a CUSIP number that cannot be one (it fails its check digit, or is not
// nine characters) is read as the holder's other number mistyped when it is near exactly one
// (lib/schedule13.ts cusipValid, keyDistance, classRows). Shapes from production on 2026-11-24:
// 8 of 1,021 numbers fail the check; one of them (Aurora, one character off) sits beside the
// number it was meant to be; a wrong number that passes the check by chance is not caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cusipValid, keyDistance, classRows, rowsByClass, classNotes, sortStatements, holdersOf, holderSummary, schedule13Log, TYPO_MAX_DISTANCE, type Statement } from "../web/src/lib/schedule13";

const base: Statement = { accession: "0000000000-26-000001", formType: "SCHEDULE 13G", schedule: "13G", isAmendment: false, filedAt: "2026-11-10", eventDate: "2026-09-30",
  issuerCik: "0000000001", issuerCusip: "02079K305", securityClass: "Common Stock", filerCik: "0000000101", reporterName: "Fund One LP", reporterCount: 1,
  shares: 1_000_000, percent: 6.5, rules: ["Rule 13d-1(b)"], purpose: null, sourceUrl: null };
const st = (over: Partial<Statement>): Statement => ({ ...base, ...over });
const built = "2026-11-20T08:00:00.000Z";
const A = "02079K305", C = "02079K107";
const acc = (rows: { latest: Statement; statements: number }[]) => rows.map((r) => [r.latest.accession, r.statements]);

test("schedule 13: the CUSIP check digit", () => {
  for (const k of ["02079K305", "02079K107", "539830109", "051774107", "862945102", "862945300", "67066G104", "594918104", "69608A108", "1431062*2"]) assert.equal(cusipValid(k), true, k);
  for (const k of ["051774907", "28422T209", "360904920", "MULTIPLES", "539830019", "02079K999"]) assert.equal(cusipValid(k), false, k);
  for (const k of ["31946M1036", "587733R102", "0002080921", "02079K30", "", "02079k305", "02079K3O5 ", "02079K-05"]) assert.equal(cusipValid(k), false, `${k}: not nine characters of the CUSIP alphabet`);
  assert.equal(cusipValid("SBW2K5V75"), true, "a wrong number can pass the check by chance (met on production)");
});

test("schedule 13: how far apart two numbers are as typed", () => {
  assert.equal(keyDistance("051774907", "051774107"), 1);
  assert.equal(keyDistance("539830019", "539830109"), 2, "two characters swapped");
  assert.equal(keyDistance(A, C), 2);
  assert.equal(keyDistance(A, A), 0);
  assert.equal(keyDistance("31946M1036", "31946M103"), 1, "one character too many at the end");
  assert.equal(keyDistance("587733R102", "58733R102"), 1, "one character too many inside");
  assert.equal(keyDistance("58733R102", "587733R102"), 1, "the same either way round");
  assert.equal(keyDistance("5398301", "539830109"), Infinity);
  assert.equal(keyDistance("MULTIPLES", "14309L102"), 9);
  assert.equal(TYPO_MAX_DISTANCE, 2);
});

test("schedule 13: a number that fails the check joins the one number it is nearest to", () => {
  // The slip between two statements under the right number: one row, three statements (two rows before this rule).
  const slip = sortStatements([st({ accession: "k-1", issuerCusip: "539830109", filedAt: "2026-01-08" }), st({ accession: "k-2", issuerCusip: "539830019", filedAt: "2026-04-29" }), st({ accession: "k-3", issuerCusip: "539830109", filedAt: "2026-07-30" })]);
  assert.deepEqual(classRows(slip), { rows: [{ latest: slip[0]!, statements: 3 }], changed: 0, mistyped: 1 });
  assert.equal(slip[0]!.accession, "k-3");
  // The slip in the newest statement: that statement is still the row.
  const newest = sortStatements([st({ accession: "k-1", issuerCusip: "539830109", filedAt: "2026-01-08" }), st({ accession: "k-2", issuerCusip: "539830019", filedAt: "2026-04-29", percent: 7.7 })]);
  assert.deepEqual(acc(rowsByClass(newest)), [["k-2", 2]]);
  assert.deepEqual([classRows(newest).changed, classRows(newest).mistyped], [0, 1], "counted as a slip, not as a number that changed");
  // One character too many.
  const long = sortStatements([st({ accession: "h-1", issuerCusip: "31946M103", filedAt: "2025-11-14" }), st({ accession: "h-2", issuerCusip: "31946M1036", filedAt: "2026-02-17" }), st({ accession: "h-3", issuerCusip: "31946M103", filedAt: "2026-08-14" })]);
  assert.deepEqual(acc(rowsByClass(long)), [["h-3", 3]]);
  // Two real classes and a slip in one of them: the slip joins the nearer class and can be its newest statement.
  const two = sortStatements([
    st({ accession: "v-1", issuerCusip: A, filedAt: "2026-04-29", percent: 7.48 }), st({ accession: "v-2", issuerCusip: C, filedAt: "2026-04-29", percent: 6.41 }),
    st({ accession: "v-3", issuerCusip: "02079K306", filedAt: "2026-10-30", percent: 7.9 })]);
  assert.equal(cusipValid("02079K306"), false);
  assert.deepEqual(acc(rowsByClass(two)), [["v-3", 2], ["v-2", 1]]);
  assert.deepEqual([classRows(two).changed, classRows(two).mistyped], [0, 1]);
  assert.equal(rowsByClass(two).reduce((a, r) => a + r.statements, 0), two.length);
});

test("schedule 13: what the check digit rule leaves alone", () => {
  // As near to one class as to the other: not folded; the overlap test decides as before.
  const tie = sortStatements([
    st({ accession: "t-1", issuerCusip: A, filedAt: "2026-04-29" }), st({ accession: "t-2", issuerCusip: C, filedAt: "2026-04-29" }),
    st({ accession: "t-3", issuerCusip: "02079K205", filedAt: "2026-06-30" }), st({ accession: "t-4", issuerCusip: A, filedAt: "2026-09-30" }), st({ accession: "t-5", issuerCusip: C, filedAt: "2026-09-30" })]);
  assert.equal(cusipValid("02079K205"), false);
  assert.equal(keyDistance("02079K205", A), 1);
  assert.equal(keyDistance("02079K205", C), 2);
  assert.deepEqual(classRows(tie).mistyped, 1, "nearer to A by one character: joins A");
  const even = sortStatements([
    st({ accession: "e-1", issuerCusip: "02079K305", filedAt: "2026-04-29" }), st({ accession: "e-2", issuerCusip: "02079K404", filedAt: "2026-04-29" }),
    st({ accession: "e-3", issuerCusip: "02079K405", filedAt: "2026-06-30" }), st({ accession: "e-4", issuerCusip: "02079K305", filedAt: "2026-09-30" }), st({ accession: "e-5", issuerCusip: "02079K404", filedAt: "2026-09-30" })]);
  assert.equal(cusipValid("02079K404"), true);
  assert.equal(cusipValid("02079K405"), false);
  assert.equal(keyDistance("02079K405", "02079K305"), 1);
  assert.equal(keyDistance("02079K405", "02079K404"), 1);
  assert.equal(classRows(even).mistyped, 0, "one character from each of two valid numbers: not folded");
  assert.equal(rowsByClass(even).length, 3, "it stays a number of its own, as before the rule");
  // Far from every valid number: left alone (a made-up word in the number's place).
  const word = sortStatements([st({ accession: "w-1", issuerCusip: "14309L102", filedAt: "2026-01-10" }), st({ accession: "w-2", issuerCusip: "MULTIPLES", filedAt: "2026-06-10" })]);
  assert.deepEqual(classRows(word), { rows: [{ latest: word[0]!, statements: 2 }], changed: 1, mistyped: 0 });
  // Two numbers that both fail the check are never joined to each other.
  const both = sortStatements([st({ accession: "b-1", issuerCusip: "111111AA1", filedAt: "2026-01-05" }), st({ accession: "b-2", issuerCusip: "111111AB1", filedAt: "2026-01-05" })]);
  assert.equal(cusipValid("111111AA1") || cusipValid("111111AB1"), false);
  assert.equal(rowsByClass(both).length, 2);
  // A wrong number that passes the check is not caught: two rows, as the methodology says.
  const lucky = sortStatements([st({ accession: "l-1", issuerCusip: "83443Q103", filedAt: "2026-01-08" }), st({ accession: "l-2", issuerCusip: "SBW2K5V75", filedAt: "2026-04-29" }), st({ accession: "l-3", issuerCusip: "83443Q103", filedAt: "2026-07-30" })]);
  assert.equal(rowsByClass(lucky).length, 2);
  // Valid numbers are never folded, however near (Class A and Class C are two characters apart).
  assert.equal(rowsByClass(sortStatements([st({ accession: "a-1", issuerCusip: A, filedAt: "2026-04-29" }), st({ accession: "a-2", issuerCusip: C, filedAt: "2026-04-29" })])).length, 2);
  // A statement with no number still means the holder is never split, and nothing is counted as mistyped.
  const blank = sortStatements([st({ accession: "n-1", issuerCusip: "539830109", filedAt: "2026-01-08" }), st({ accession: "n-2", issuerCusip: "539830019", filedAt: "2026-04-29" }), st({ accession: "n-3", issuerCusip: null, filedAt: "2026-07-30" })]);
  assert.deepEqual(classRows(blank), { rows: [{ latest: blank[0]!, statements: 3 }], changed: 0, mistyped: 0 });
});

test("schedule 13: the build log counts holders with a changed and with a mistyped number", () => {
  const xs = [
    st({ accession: "k-1", issuerCusip: "539830109", filedAt: "2026-01-08" }), st({ accession: "k-2", issuerCusip: "539830019", filedAt: "2026-04-29" }), st({ accession: "k-3", issuerCusip: "539830109", filedAt: "2026-07-30" }),
    st({ accession: "r-1", filerCik: "0000000202", reporterName: "Other Fund", issuerCusip: "862945102", filedAt: "2025-11-14" }), st({ accession: "r-2", filerCik: "0000000202", reporterName: "Other Fund", issuerCusip: "862945300", filedAt: "2026-05-15" }),
    st({ accession: "y-1", filerCik: "0000000303", reporterName: "Later LLC", issuerCusip: "539830019", filedAt: "2026-12-01" }), // after the build day
  ];
  assert.deepEqual(classNotes(xs, built), { changed: 1, mistyped: 1 });
  const hs = holdersOf(xs, built);
  assert.deepEqual(hs.map((h) => [h.latest.accession, h.statements]).sort(), [["k-3", 3], ["r-2", 2]]);
  assert.equal(holderSummary(hs).rows, 2);
  const line = schedule13Log({ shown: true, lastFiled: "2026-11-19", byCik: new Map([["0000000001", sortStatements(xs)]]) }, built, new Set(["0000000001"]));
  assert.match(line, /2 holders, 2 rows by newest statement and class \(0 holders with more than one class, on 0 companies\)/);
  assert.match(line, /; 1 holders with a number that changed, 1 with a mistyped number read as the right one$/);
});
