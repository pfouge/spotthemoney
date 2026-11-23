import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText, dateOnly, fecToBioguide, personForCandidate, hasIeShape, ieUrl, minusDays, nextCursor, parseIeRow, DESCRIPTION_MAX, type ParseNotes,
} from "./fecie.js";

const notes = (): ParseNotes => ({ futureDate: 0, badDate: 0 });
const base = {
  sub_id: "4100", committee_id: "C1", committee: { name: " A  B " }, candidate_id: "H1", candidate_name: "X Y",
  candidate_office: "h", candidate_office_state: "pa", candidate_office_district: "04", candidate_party: "DEM",
  support_oppose_indicator: "o", expenditure_amount: "12.5", expenditure_date: "2026-03-01T00:00:00",
  dissemination_date: "2026-03-02", expenditure_description: "a\n b", payee_name: "P", is_notice: false, pdf_url: "https://x.gov/a.pdf",
};

test("cleanText collapses white space, drops control characters and cuts", () => {
  assert.equal(cleanText("  a \u0000 b\n c "), "a b c");
  assert.equal(cleanText("   "), null);
  assert.equal(cleanText(5), null);
  assert.equal(cleanText("x".repeat(500), DESCRIPTION_MAX)?.length, DESCRIPTION_MAX);
});

test("dateOnly accepts real dates only", () => {
  assert.equal(dateOnly("2026-03-01T00:00:00"), "2026-03-01");
  assert.equal(dateOnly("2026-02-30"), null);
  assert.equal(dateOnly("03/01/2026"), null);
  assert.equal(dateOnly(null), null);
});

test("parseIeRow cleans one row", () => {
  const n = notes();
  const r = parseIeRow(base, "2026-11-22", n);
  assert.ok(typeof r !== "string");
  assert.equal(r.sub_id, "4100");
  assert.equal(r.candidate_office, "H");
  assert.equal(r.candidate_state, "PA");
  assert.equal(r.support_oppose, "O");
  assert.equal(r.amount, 12.5);
  assert.equal(r.spent_at, "2026-03-01");
  assert.equal(r.committee_name, "A B");
  assert.equal(r.description, "a b");
  assert.equal(r.is_notice, false);
  assert.equal(n.futureDate + n.badDate, 0);
});

test("future and impossible dates become null and are counted", () => {
  const n = notes();
  const a = parseIeRow({ ...base, expenditure_date: "2099-01-01T00:00:00" }, "2026-11-22", n);
  const b = parseIeRow({ ...base, dissemination_date: "2026-13-01" }, "2026-11-22", n);
  assert.ok(typeof a !== "string" && typeof b !== "string");
  assert.equal(a.spent_at, null);
  assert.equal(b.disseminated_at, null);
  assert.deepEqual(n, { futureDate: 1, badDate: 1 });
});

test("rows without the key fields give a reason", () => {
  const n = notes();
  assert.equal(typeof parseIeRow({ ...base, sub_id: undefined }, "2026-11-22", n), "string");
  assert.equal(typeof parseIeRow({ ...base, committee_id: null, committee: null }, "2026-11-22", n), "string");
  assert.equal(typeof parseIeRow({ ...base, expenditure_amount: "abc" }, "2026-11-22", n), "string");
  assert.equal(typeof parseIeRow(null, "2026-11-22", n), "string");
});

test("odd support/oppose and office values are null, not guessed", () => {
  const r = parseIeRow({ ...base, support_oppose_indicator: "maybe", candidate_office: "Z" }, "2026-11-22", notes());
  assert.ok(typeof r !== "string");
  assert.equal(r.support_oppose, null);
  assert.equal(r.candidate_office, null);
});

test("hasIeShape needs sub_id, committee id and an amount", () => {
  assert.equal(hasIeShape(base), true);
  assert.equal(hasIeShape({ foo: 1 }), false);
  assert.equal(hasIeShape({ ...base, expenditure_amount: null }), false);
});

test("fecToBioguide maps every FEC id of a member and skips members without one", () => {
  const m = fecToBioguide([{ id: { bioguide: "A1", fec: ["h1", "S2"] } }, { id: { bioguide: "B1" } }, { id: { fec: ["H9"] } }]);
  assert.equal(m.get("H1"), "A1");
  assert.equal(m.get("S2"), "A1");
  assert.equal(m.size, 2);
});

test("nextCursor copies the non-null seek keys and needs last_index", () => {
  assert.deepEqual(nextCursor({ pagination: { last_indexes: { last_index: "9", last_expenditure_date: "2026-01-01", x: null } } }), { last_index: "9", last_expenditure_date: "2026-01-01" });
  assert.equal(nextCursor({ pagination: { last_indexes: null } }), null);
  assert.equal(nextCursor({ pagination: { last_indexes: { last_expenditure_date: "2026-01-01" } } }), null);
  assert.equal(nextCursor({}), null);
});

test("ieUrl carries the cycle, both notice values, min_date and the cursor", () => {
  const u = ieUrl({ base: "http://h/v1", key: "K", cycle: 2026, perPage: 100, minDate: "2026-01-01", cursor: { last_index: "5" } });
  assert.equal(u.pathname, "/v1/schedules/schedule_e/");
  assert.equal(u.searchParams.get("cycle"), "2026");
  assert.equal(u.searchParams.get("most_recent"), "true");
  assert.deepEqual(u.searchParams.getAll("is_notice"), ["true", "false"]);
  assert.equal(u.searchParams.get("min_date"), "2026-01-01");
  assert.equal(u.searchParams.get("last_index"), "5");
});

test("minusDays", () => {
  assert.equal(minusDays("2026-03-01", 30), "2026-01-30");
});

test("personForCandidate goes candidate id to Bioguide ID to person, by ids only", () => {
  const fecBio = fecToBioguide([{ id: { bioguide: "A000001", fec: ["H4PA00001", "s9xx00009"] } }, { id: { bioguide: "B000002", fec: ["S0TX00002"] } }]);
  const bioId = new Map<string, number>([["A000001", 11]]);
  assert.equal(personForCandidate("H4PA00001", fecBio, bioId), 11);
  assert.equal(personForCandidate(" S9XX00009 ", fecBio, bioId), 11);
  assert.equal(personForCandidate("S0TX00002", fecBio, bioId), null); // bioguide not in people
  assert.equal(personForCandidate("H0ZZ00000", fecBio, bioId), null); // not on the roster
  assert.equal(personForCandidate(null, fecBio, bioId), null);
});
