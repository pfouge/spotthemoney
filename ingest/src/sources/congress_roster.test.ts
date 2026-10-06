// Offline tests for the pure congress_roster helpers (no DB, no network). Run:
//   npx tsx --test ingest/src/sources/congress_roster.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chamberForTermType,
  districtForTerm,
  currentTerm,
  nameCandidates,
  slugify,
  fullNameFor,
  isSameMember,
  findMember,
  type Legislator,
  type UnlinkedFiler,
} from "./congress_roster.js";

test("chamberForTermType maps rep/sen and rejects unknowns", () => {
  assert.equal(chamberForTermType("rep"), "house");
  assert.equal(chamberForTermType("sen"), "senate");
  assert.equal(chamberForTermType("prez"), null);
});

test("districtForTerm: reps get a district string, senators never do", () => {
  assert.equal(districtForTerm({ type: "rep", district: 12 }), "12");
  assert.equal(districtForTerm({ type: "rep", district: 0 }), "0"); // at-large
  assert.equal(districtForTerm({ type: "rep", district: undefined }), null);
  assert.equal(districtForTerm({ type: "sen", district: undefined }), null);
});

test("currentTerm picks the last entry in terms[]", () => {
  const terms = [
    { type: "rep", start: "2015-01-03" },
    { type: "rep", start: "2023-01-03" },
  ];
  assert.equal(currentTerm(terms), terms[1]);
  assert.equal(currentTerm([]), undefined);
});

test("nameCandidates: official_full, first+last, nickname, and middle-stripped", () => {
  const cands = nameCandidates({
    first: "Raúl",
    last: "Grijalva",
    middle_name: "M.",
    official_full: "Raúl M. Grijalva",
  });
  assert.ok(cands.includes("Raúl M. Grijalva"));
  assert.ok(cands.includes("Raúl Grijalva")); // official_full with the middle initial dropped
  assert.ok(cands.includes("Raúl Grijalva")); // also equals first+last here

  const withNickname = nameCandidates({
    first: "William",
    last: "Smith",
    nickname: "Bill",
    official_full: "William Smith",
  });
  assert.ok(withNickname.includes("William Smith"));
  assert.ok(withNickname.includes("Bill Smith"));
});

test("nameCandidates handles a bare name with no official_full", () => {
  const cands = nameCandidates({ first: "Mark", last: "Green" });
  assert.deepEqual(cands, ["Mark Green"]);
});

test("slugify matches the Python job byte-for-byte for known members", () => {
  assert.equal(slugify("Mark Green"), "mark-green");
  assert.equal(slugify("Sheri Biggs"), "sheri-biggs");
  assert.equal(slugify("Raúl M. Grijalva"), "raul-m-grijalva");
});

test("slugify: empty/punctuation-only names fall back to 'member'", () => {
  assert.equal(slugify(""), "member");
  assert.equal(slugify("...---..."), "member");
});

test("slugify: collapses runs of punctuation and trims hyphens", () => {
  assert.equal(slugify("  O'Brien -- Jr.  "), "o-brien-jr");
});

test("fullNameFor prefers official_full, falls back to first+last", () => {
  assert.equal(fullNameFor({ first: "Mark", last: "Green", official_full: "Mark E. Green" }), "Mark E. Green");
  assert.equal(fullNameFor({ first: "Mark", last: "Green" }), "Mark Green");
});

// ── former members ────────────────────────────────────────────────────────
const leg = (first: string, last: string, type: "rep" | "sen", state: string, party: string, start: string, end: string, extra: Partial<Legislator["name"]> = {}, district?: number): Legislator =>
  ({ id: { bioguide: `${last[0]}${first.length}${state}` }, name: { first, last, official_full: `${first} ${last}`, ...extra }, terms: [{ type, state, party, start, end, district }] });
const ROSTER: Legislator[] = [
  leg("Marjorie", "Greene", "rep", "GA", "Republican", "2025-01-03", "2026-01-05", { official_full: "Marjorie Taylor Greene" }, 14),
  leg("Markwayne", "Mullin", "sen", "OK", "Republican", "2023-01-03", "2026-03-23"),
  leg("Lindsey", "Graham", "sen", "SC", "Republican", "2021-01-03", "2026-07-11"),
  leg("Darline", "Graham", "sen", "SC", "Republican", "2026-07-14", "2027-01-03"),
  leg("Kevin", "Mullin", "rep", "CA", "Democrat", "2025-01-03", "2027-01-03", {}, 15),
  leg("Rich", "McCormick", "rep", "GA", "Republican", "2025-01-03", "2027-01-03", { official_full: "Richard McCormick" }, 7),
  leg("Dave", "McCormick", "sen", "PA", "Republican", "2025-01-03", "2031-01-03", { official_full: "David McCormick" }),
  leg("Sheila", "Cherfilus-McCormick", "rep", "FL", "Democrat", "2025-01-03", "2026-04-21", {}, 20),
  leg("Bob", "Graham", "sen", "FL", "Democrat", "1999-01-06", "2005-01-03"),
];
const filer = (fullName: string, chamber: "house" | "senate", state: string | null = null, district: string | null = null): UnlinkedFiler => ({ id: 1, fullName, chamber, state, district });
const TODAY = "2026-10-06";

test("former members are found by name and chamber", () => {
  assert.equal(findMember(filer("Marjorie Taylor Greene", "house", "GA", "14"), ROSTER, TODAY)?.name.last, "Greene");
  assert.equal(findMember(filer("Markwayne Mullin", "senate"), ROSTER, TODAY)?.terms[0]!.state, "OK");
  assert.equal(findMember(filer("Lindsey Graham", "senate"), ROSTER, TODAY)?.name.first, "Lindsey");
});

test("a successor in the same seat is a different person", () => {
  assert.equal(isSameMember(filer("Lindsey Graham", "senate", "SC"), ROSTER[3]!), false);
  assert.equal(findMember(filer("Darline Graham", "senate"), ROSTER, TODAY)?.name.first, "Darline");
});

test("the name as filed reaches the roster's shorter name", () => {
  assert.equal(findMember(filer("Richard Dean Dr McCormick", "house", "GA", "7"), ROSTER, TODAY)?.name.first, "Rich");
  assert.equal(findMember(filer("David H McCormick", "senate"), ROSTER, TODAY)?.name.first, "Dave");
});

test("chamber, state and age of the last term all have to fit", () => {
  assert.equal(findMember(filer("Markwayne Mullin", "house"), ROSTER, TODAY), null);            // wrong chamber
  assert.equal(findMember(filer("Marjorie Taylor Greene", "house", "FL"), ROSTER, TODAY), null); // wrong state
  assert.equal(findMember(filer("Bob Graham", "senate"), ROSTER, TODAY), null);                  // left in 2005
  assert.equal(findMember(filer("Pat Nobody", "senate"), ROSTER, TODAY), null);
});

test("an ambiguous name matches nobody", () => {
  const two = [...ROSTER, leg("Lindsey", "Graham", "sen", "NC", "Democrat", "2025-01-03", "2027-01-03")];
  assert.equal(findMember(filer("Lindsey Graham", "senate"), two, TODAY), null);
  assert.equal(findMember(filer("Lindsey Graham", "senate", "SC"), two, TODAY)?.terms[0]!.state, "SC");
});
