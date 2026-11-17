// Offline tests for the industry-code source (no network, no database). Run:
//   npx tsx --test ingest/src/sources/sec_company_sic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSubmissionSic, tenDigitCik, submissionsUrl } from "./sec_company_sic.js";
import { cleanSicCode, sicDivision, SIC_DIVISIONS } from "@stm/shared";

test("submissions file: code and description as stated", () => {
  const f = parseSubmissionSic({ cik: "1045810", sic: "3674", sicDescription: "Semiconductors &  Related Devices ", name: "NVIDIA CORP" });
  assert.deepEqual(f, { sic: "3674", description: "Semiconductors & Related Devices", hasKey: true });
});

test("submissions file: a three-digit or numeric code is padded to four digits", () => {
  assert.equal(parseSubmissionSic({ sic: "100", sicDescription: "Agricultural Production-Crops" }).sic, "0100");
  assert.equal(parseSubmissionSic({ sic: 7372, sicDescription: "Services-Prepackaged Software" }).sic, "7372");
});

test("submissions file: an empty or zero code is no code, and its description is dropped", () => {
  for (const sic of ["", "0000", null, "N/A", "12345"]) {
    const f = parseSubmissionSic({ sic, sicDescription: "Something" });
    assert.equal(f.sic, null, String(sic));
    assert.equal(f.description, null);
    assert.equal(f.hasKey, true);
  }
});

test("submissions file: a code with no wording keeps the code", () => {
  assert.deepEqual(parseSubmissionSic({ sic: "6770" }), { sic: "6770", description: null, hasKey: true });
});

test("submissions file: an answer with no sic key is flagged, never thrown on", () => {
  for (const bad of [null, undefined, "text", 5, [], {}, { error: "x" }]) {
    assert.deepEqual(parseSubmissionSic(bad), { sic: null, description: null, hasKey: false });
  }
});

test("CIK is ten digits in the address", () => {
  assert.equal(tenDigitCik("320193"), "0000320193");
  assert.equal(tenDigitCik("0000320193"), "0000320193");
  assert.equal(tenDigitCik(1045810), "0001045810");
  assert.equal(tenDigitCik("abc"), null);
  assert.equal(tenDigitCik(""), null);
  assert.equal(submissionsUrl("https://data.sec.gov", "0000320193"), "https://data.sec.gov/submissions/CIK0000320193.json");
});

test("division: read from the first two digits", () => {
  const name = (c: unknown) => sicDivision(c)?.name ?? null;
  assert.equal(name("0100"), "Agriculture, forestry and fishing");
  assert.equal(name("1311"), "Mining");
  assert.equal(name("1531"), "Construction");
  assert.equal(name("2834"), "Manufacturing");
  assert.equal(name("3674"), "Manufacturing");
  assert.equal(name("4911"), "Transportation, communications and utilities");
  assert.equal(name("5122"), "Wholesale trade");
  assert.equal(name("5961"), "Retail trade");
  assert.equal(name("6022"), "Finance, insurance and real estate");
  assert.equal(name("6798"), "Finance, insurance and real estate");
  assert.equal(name("7372"), "Services");
  assert.equal(name("8731"), "Services");
  assert.equal(name("9721"), "Public administration");
  assert.equal(name("9995"), "Nonclassifiable");
});

test("division: none for a missing code or a code outside every division", () => {
  for (const c of [null, "", "0000", "1800", "6800", "9000", "9800", "abcd"]) assert.equal(sicDivision(c), null, String(c));
});

test("division ranges do not overlap and are in order", () => {
  for (let i = 1; i < SIC_DIVISIONS.length; i++) assert.ok(SIC_DIVISIONS[i]!.from > SIC_DIVISIONS[i - 1]!.to);
  assert.equal(cleanSicCode(" 3674 "), "3674");
});
