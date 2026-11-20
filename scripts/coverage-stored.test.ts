import { test } from "node:test";
import assert from "node:assert/strict";
import { catchingUp, form144Sentence, schedule13Sentence, storedProblems, storedLog, emptyStored, emptyStoredNotShown, CAUGHT_UP_DAYS, type StoredSource } from "../web/src/lib/coverage-stored";

const f144: StoredSource = { rows: 22900, amendments: 204, issuers: 2617, trackedRows: 8249, firstFiled: "2025-10-01", lastFiled: "2026-05-18",
  months: [{ month: "2025-10", rows: 12000 }, { month: "2026-05", rows: 10900 }], kinds: { "144": 22696, "144/A": 204 } };
const s13: StoredSource = { rows: 5, amendments: 1, issuers: 1, trackedRows: 0, firstFiled: "2026-11-10", lastFiled: "2026-11-18",
  months: [{ month: "2026-11", rows: 5 }], kinds: { "13D": 2, "13G": 3 } };
const built = "2026-11-20T04:00:00.000Z";

test("stored sources: a load is catching up until its newest filing is within the allowance", () => {
  assert.equal(catchingUp(f144, built), true);
  assert.equal(catchingUp(s13, built), false);
  assert.equal(catchingUp({ ...s13, lastFiled: "2026-11-10" }, built), false, `${CAUGHT_UP_DAYS} days back is still current`);
  assert.equal(catchingUp({ ...s13, lastFiled: "2026-11-09" }, built), true);
  assert.equal(catchingUp(emptyStored(), built), true);
  assert.equal(catchingUp({ ...s13, lastFiled: "soon" }, built), true);
  assert.equal(catchingUp(s13, "not a date"), true);
});

test("stored sources: the sentences state the counts, the dates and that nothing is shown", () => {
  const a = form144Sentence(f144, built);
  assert.match(a, /^22,900 notices of a proposed sale on file, filed October 1, 2025 to May 18, 2026, about 2,617 companies; 204 are amendments\./);
  assert.match(a, /A notice states a plan to sell, not a sale\./);
  assert.match(a, /stored and not shown on any page yet\./);
  assert.match(a, /filings after May 18, 2026 are not on file yet\.$/);
  const b = schedule13Sentence(s13, built);
  assert.match(b, /^5 ownership statements on file \(2 on Schedule 13D, 3 on Schedule 13G\), filed November 10, 2026 to November 18, 2026, about 1 company; 1 is an amendment\./);
  assert.match(b, /not shown on any page yet\.$/, "a current load has no catching-up clause");
  assert.equal(form144Sentence(emptyStored(), built), "");
  assert.equal(schedule13Sentence(emptyStored(), built), "");
  // Once the Form 144 load is current the notices are on pages, and the sentence says so.
  const c = form144Sentence({ ...f144, lastFiled: "2026-11-18" }, built);
  assert.match(c, /Notices about companies this site tracks \(8,249 notices\) are shown on the stock and company pages, as filed, and are in no buy or sell total; the others are stored and not shown\.$/);
  assert.doesNotMatch(c, /not shown on any page yet|still working forward/);
  assert.match(form144Sentence({ ...f144, firstFiled: "2026-05-18" }, built), /, filed May 18, 2026,/);
});

test("stored sources: no advice, no verdict, no em-dash in the wording", () => {
  for (const s of [form144Sentence(f144, built), schedule13Sentence(s13, built), schedule13Sentence({ ...f144, kinds: { "13D": 1, "13G": 22899 } }, built)]) {
    assert.doesNotMatch(s, /—|should|signal|bullish|bearish|insider selling ahead|dump/i);
    assert.doesNotMatch(s, /undefined|NaN|null/);
  }
});

test("stored sources: counts that do not add up are reported", () => {
  assert.deepEqual(storedProblems("a", f144), []);
  assert.deepEqual(storedProblems("b", s13), []);
  assert.deepEqual(storedProblems("e", emptyStored()), []);
  assert.equal(storedProblems("m", { ...s13, months: [{ month: "2026-11", rows: 4 }] }).length, 1);
  assert.equal(storedProblems("k", { ...s13, kinds: { "13D": 2 } }).length, 1);
  assert.equal(storedProblems("p", { ...s13, amendments: 9 }).length, 1);
  assert.equal(storedProblems("d", { ...s13, firstFiled: "2026-12-01" }).length, 1);
});

test("stored sources: the build-log line carries every count", () => {
  const line = storedLog({ form144: f144, schedule13: s13 }, built);
  assert.match(line, /^stored, not shown: Form 144 22900 rows \(144 22696, 144\/A 204; 204 amendments, 2617 issuers, 8249 for tracked companies\), filed 2025-10-01 to 2026-05-18, 2 months, catching up; Schedule 13 5 rows \(13D 2, 13G 3; 1 amendments, 1 issuers, 0 for tracked companies\), filed 2026-11-10 to 2026-11-18, 1 months, current$/);
  assert.match(storedLog(emptyStoredNotShown(), built), /Form 144 0 rows .*filed none to none/);
});
