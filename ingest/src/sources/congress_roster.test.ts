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
