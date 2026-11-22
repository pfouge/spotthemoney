// Offline tests for the financials source helpers (no network, no database). Run:
//   npx tsx --test ingest/src/sources/sec_company_financials.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { companyFactsUrl, summarizeRows } from "./sec_company_financials.js";
import type { FinRow } from "../lib/companyfacts.js";

const row = (o: Partial<FinRow>): FinRow => ({
  concept: "revenue", tag: "us-gaap:Revenues", unit: "USD", periodStart: "2024-01-01", periodEnd: "2024-12-31",
  value: 1, form: "10-K", fy: 2024, fp: "FY", filed: "2025-02-01", accession: "0001-25-000001", ...o,
});

test("address uses the ten-digit CIK", () => {
  assert.equal(companyFactsUrl("https://data.sec.gov", "0001045810"), "https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json");
});

test("summary: concepts, non-USD, IFRS and newest filing date", () => {
  const s = summarizeRows([
    row({}),
    row({ concept: "eps_diluted", unit: "USD/shares", filed: "2025-05-01" }),
    row({ concept: "assets", tag: "ifrs-full:Assets", unit: "CNY", periodStart: null, filed: "2025-03-01" }),
  ]);
  assert.deepEqual(s.concepts.sort(), ["assets", "eps_diluted", "revenue"]);
  assert.equal(s.nonUsd, true);
  assert.equal(s.ifrs, true);
  assert.equal(s.newestFiled, "2025-05-01");
});

test("summary: US company in dollars only; no rows", () => {
  const s = summarizeRows([row({}), row({ concept: "eps_diluted", unit: "USD/shares" })]);
  assert.equal(s.nonUsd, false);
  assert.equal(s.ifrs, false);
  assert.deepEqual(summarizeRows([]), { concepts: [], nonUsd: false, ifrs: false, newestFiled: null });
});
