// Offline tests for the award-details job's pure helpers. Run:
//   npx tsx --test ingest/src/sources/usaspending_details.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAwardDetails, awardUrl } from "./usaspending_details.js";

test("parseAwardDetails: reads the three details, cleaned like the search job's", () => {
  const d = parseAwardDetails({
    description: "  PATRIOT PAC-3\n MISSILE\tPRODUCTION ",
    awarding_agency: { toptier_agency: { name: "Department of Defense" }, subtier_agency: { name: " Department of the  Army " } },
    period_of_performance: { start_date: "2026-08-01", end_date: "2030-08-31T00:00:00", potential_end_date: "2032-08-31" },
  });
  assert.deepEqual(d, { description: "PATRIOT PAC-3 MISSILE PRODUCTION", subAgency: "Department of the Army", endDate: "2030-08-31", hasShape: true });
});

test("parseAwardDetails: the keys present with nothing in them is the right shape with nothing to add", () => {
  assert.deepEqual(parseAwardDetails({ description: null, awarding_agency: null, period_of_performance: {} }),
    { description: null, subAgency: null, endDate: null, hasShape: true });
  assert.deepEqual(parseAwardDetails({ description: "", awarding_agency: { subtier_agency: null }, period_of_performance: { end_date: "not a date" } }),
    { description: null, subAgency: null, endDate: null, hasShape: true });
});

test("parseAwardDetails: one expected key is enough for the shape; values of the wrong type are ignored", () => {
  const d = parseAwardDetails({ description: 42, awarding_agency: "Navy", period_of_performance: ["2030-01-01"] });
  assert.deepEqual(d, { description: null, subAgency: null, endDate: null, hasShape: true });
  assert.equal(parseAwardDetails({ description: "X" }).hasShape, true);
});

test("parseAwardDetails: an answer with none of the keys is not the expected shape", () => {
  for (const v of [{}, { unexpected: true }, { results: [] }, null, undefined, "text", 7, []]) {
    assert.deepEqual(parseAwardDetails(v), { description: null, subAgency: null, endDate: null, hasShape: false });
  }
});

test("parseAwardDetails: a long description is cut at the stored length, a long sub-agency at 200", () => {
  const d = parseAwardDetails({ description: "A".repeat(1500), awarding_agency: { subtier_agency: { name: "B".repeat(300) } } });
  assert.equal(d.description!.length, 1000);
  assert.equal(d.subAgency!.length, 200);
});

test("awardUrl: the award id is one path segment, escaped", () => {
  assert.equal(awardUrl("https://api.usaspending.gov", "CONT_AWD_W31P4Q26C0001_9700_-NONE-_-NONE-"),
    "https://api.usaspending.gov/api/v2/awards/CONT_AWD_W31P4Q26C0001_9700_-NONE-_-NONE-/");
  assert.equal(awardUrl("http://127.0.0.1:8791", "A/B C"), "http://127.0.0.1:8791/api/v2/awards/A%2FB%20C/");
});
