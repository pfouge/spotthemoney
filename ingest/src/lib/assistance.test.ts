// Offline tests for the assistance parser. Run: npx tsx --test ingest/src/lib/assistance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMaskedRecipient, listingText, looksLikeSearchAnswer, parseAssistanceRow, KIND_SPECS } from "./assistance.js";
import { isShapeRejection, parseAmount } from "../sources/usaspending.js";

test("masked recipients are recognised", () => {
  assert.equal(isMaskedRecipient("MULTIPLE RECIPIENTS"), true);
  assert.equal(isMaskedRecipient("redacted due to PII"), true);
  assert.equal(isMaskedRecipient("NVIDIA CORP"), false);
});

test("listingText handles string, object, array, null", () => {
  assert.equal(listingText(null), null);
  assert.equal(listingText("10.001"), "10.001");
  assert.ok(listingText({ cfda_number: "10.001", cfda_program_title: "X" })!.includes("10.001"));
  assert.ok(listingText([{ cfda_number: "1" }, { cfda_number: "2" }])!.includes(";"));
});

test("looksLikeSearchAnswer", () => {
  assert.equal(looksLikeSearchAnswer({ results: [] }), true);
  assert.equal(looksLikeSearchAnswer({ results: [{ generated_internal_id: "A" }] }), true);
  assert.equal(looksLikeSearchAnswer({ results: [{ x: 1 }] }), false);
  assert.equal(looksLikeSearchAnswer({ data: [] }), false);
  assert.equal(looksLikeSearchAnswer(null), false);
});

test("grant row parses; bad date becomes null; missing id or recipient rejected", () => {
  const ok = parseAssistanceRow({ generated_internal_id: "G1", "Award ID": "A", "Recipient Name": "ACME", "Award Amount": 5, "Start Date": "2026-02-30", "Awarding Agency": "X" }, "grant");
  assert.equal(ok.ok, true);
  if (ok.ok) { assert.equal(ok.rec.startDate, null); assert.equal(ok.rec.amount, 5); assert.equal(ok.rec.kind, "grant"); }
  assert.equal(parseAssistanceRow({ "Recipient Name": "A" }, "grant").ok, false);
  assert.equal(parseAssistanceRow({ generated_internal_id: "G", "Recipient Name": "" }, "grant").ok, false);
});

test("loan row uses Loan Value, Issued Date and Subsidy Cost", () => {
  const r = parseAssistanceRow({ generated_internal_id: "L1", "Recipient Name": "BANK", "Loan Value": 900, "Subsidy Cost": 12, "Issued Date": "2026-03-01" }, "loan");
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.rec.amount, 900); assert.equal(r.rec.subsidyCost, 12); assert.equal(r.rec.startDate, "2026-03-01"); }
});

test("masked row is flagged", () => {
  const r = parseAssistanceRow({ generated_internal_id: "M1", "Recipient Name": "MULTIPLE RECIPIENTS", "Award Amount": 1 }, "grant");
  assert.equal(r.ok && r.rec.masked, true);
});

test("kind specs keep groups apart", () => {
  const all = Object.values(KIND_SPECS).flatMap((s) => s.codes);
  assert.equal(new Set(all).size, all.length);
  assert.equal(KIND_SPECS.loan.amountField, "Loan Value");
});

test("shared helpers", () => {
  assert.equal(isShapeRejection(new Error("HTTP 422 x")), true);
  assert.equal(isShapeRejection(new Error("HTTP 500 x")), false);
  assert.equal(parseAmount("12.5"), 12.5);
});
