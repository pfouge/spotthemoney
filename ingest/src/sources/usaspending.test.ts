// Offline tests for the contracts job's pure helpers. Run:
//   npx tsx --test ingest/src/sources/usaspending.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { windowSlices, naicsCode, recipientSearchText } from "./usaspending.js";

test("windowSlices: six 30-day slices cover 180 days with no gap or overlap", () => {
  const s = windowSlices(new Date("2026-10-05T15:00:00Z"), 180);
  assert.equal(s.length, 6);
  assert.deepEqual(s[0], { start: "2026-09-06", end: "2026-10-05" });
  assert.equal(s[5]!.start, "2026-04-09");
  let days = 0;
  for (let i = 0; i < s.length; i++) {
    days += (Date.parse(s[i]!.end) - Date.parse(s[i]!.start)) / 86_400_000 + 1;
    if (i > 0) assert.equal(Date.parse(s[i - 1]!.start) - Date.parse(s[i]!.end), 86_400_000);
  }
  assert.equal(days, 180);
});

test("windowSlices: a window that is not a multiple of the slice ends with a short slice", () => {
  const s = windowSlices(new Date("2026-10-05T00:00:00Z"), 45);
  assert.deepEqual(s, [{ start: "2026-09-06", end: "2026-10-05" }, { start: "2026-08-22", end: "2026-09-05" }]);
});

test("naicsCode: plain code, object form, empties", () => {
  assert.equal(naicsCode("541512"), "541512");
  assert.equal(naicsCode(541512), "541512");
  assert.equal(naicsCode({ code: "336411", description: "Aircraft Manufacturing" }), "336411");
  assert.equal(naicsCode({ code: null }), null);
  assert.equal(naicsCode(null), null);
  assert.equal(naicsCode(""), null);
});

test("recipientSearchText: drops suffixes and share-class tails", () => {
  assert.equal(recipientSearchText("NVIDIA CORP"), "NVIDIA");
  assert.equal(recipientSearchText("Lockheed Martin Corporation"), "LOCKHEED MARTIN");
  assert.equal(recipientSearchText("Microsoft Corporation - Common Stock"), "MICROSOFT");
});
