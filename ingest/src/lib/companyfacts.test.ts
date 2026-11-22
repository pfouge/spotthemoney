// Offline tests for the companyfacts reader. Run:
//   npx tsx --test ingest/src/lib/companyfacts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFacts, calendarDate } from "./companyfacts.js";

type F = Record<string, unknown>;
const fact = (o: F): F => ({ accn: "0000000001-26-000001", fy: 2026, fp: "FY", form: "10-K", filed: "2026-02-01", ...o });
const tag = (units: Record<string, F[]>) => ({ label: "x", description: "y", units });
const doc = (facts: Record<string, Record<string, unknown>>) => ({ cik: 1, entityName: "T", facts });

test("tag priority is per period: old periods on one tag, new on another", () => {
  const r = pickFacts(doc({ "us-gaap": {
    Revenues: tag({ USD: [fact({ start: "2023-01-01", end: "2023-12-31", val: 100 })] }),
    RevenueFromContractWithCustomerExcludingAssessedTax: tag({ USD: [
      fact({ start: "2023-01-01", end: "2023-12-31", val: 999 }),
      fact({ start: "2024-01-01", end: "2024-12-31", val: 120, accn: "0000000001-25-000002", filed: "2025-02-01" }),
    ] }),
  } }));
  const rev = r.rows.filter((x) => x.concept === "revenue").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  assert.equal(rev.length, 2);
  assert.equal(rev[0]!.tag, "us-gaap:Revenues");
  assert.equal(rev[0]!.value, 100);
  assert.equal(rev[1]!.tag, "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
  assert.equal(rev[1]!.value, 120);
});

test("comparative repeated in a later filing: newest filed wins and carries its value and accession", () => {
  const r = pickFacts(doc({ "us-gaap": { Assets: tag({ USD: [
    fact({ end: "2023-12-31", val: 500, accn: "A-24", filed: "2024-02-01" }),
    fact({ end: "2023-12-31", val: 510, accn: "A-25", filed: "2025-02-01", fy: 2024 }),
    fact({ end: "2023-12-31", val: 505, accn: "A-25b", filed: "2024-08-01", form: "10-Q" }),
  ] }) } }));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.value, 510);
  assert.equal(r.rows[0]!.accession, "A-25");
  assert.equal(r.rows[0]!.fy, 2024);
});

test("same filed date: greater accession wins", () => {
  const r = pickFacts(doc({ "us-gaap": { Assets: tag({ USD: [
    fact({ end: "2024-12-31", val: 1, accn: "0001-26-000009" }),
    fact({ end: "2024-12-31", val: 2, accn: "0001-26-000010" }),
  ] }) } }));
  assert.equal(r.rows[0]!.value, 2);
});

test("instant and duration facts: start is null only for an instant", () => {
  const r = pickFacts(doc({ "us-gaap": {
    Assets: tag({ USD: [fact({ end: "2024-12-31", val: 5 })] }),
    NetIncomeLoss: tag({ USD: [fact({ start: "2024-01-01", end: "2024-12-31", val: 7 })] }),
  } }));
  assert.equal(r.rows.find((x) => x.concept === "assets")!.periodStart, null);
  assert.equal(r.rows.find((x) => x.concept === "net_income")!.periodStart, "2024-01-01");
});

test("quarter and year-to-date with the same end are separate rows", () => {
  const r = pickFacts(doc({ "us-gaap": { NetIncomeLoss: tag({ USD: [
    fact({ start: "2024-07-01", end: "2024-09-30", val: 10, form: "10-Q", fp: "Q3" }),
    fact({ start: "2024-01-01", end: "2024-09-30", val: 30, form: "10-Q", fp: "Q3" }),
  ] }) } }));
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.map((x) => x.value).sort(), [10, 30]);
});

test("form filter: an 8-K fact is dropped; amendments are kept", () => {
  const r = pickFacts(doc({ "us-gaap": { Assets: tag({ USD: [
    fact({ end: "2024-12-31", val: 1, form: "8-K" }),
    fact({ end: "2024-06-30", val: 2, form: "10-Q/A" }),
  ] }) } }));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.form, "10-Q/A");
  assert.equal(r.hasShape, true);
});

test("floor: a period ending before 2023-01-01 is dropped, the floor day is kept", () => {
  const r = pickFacts(doc({ "us-gaap": { Assets: tag({ USD: [
    fact({ end: "2022-12-31", val: 1 }),
    fact({ end: "2023-01-01", val: 2 }),
  ] }) } }));
  assert.deepEqual(r.rows.map((x) => x.value), [2]);
});

test("bad dates, missing accession and non-finite values are dropped", () => {
  const r = pickFacts(doc({ "us-gaap": { Assets: tag({ USD: [
    fact({ end: "2024-02-30", val: 1 }),
    fact({ end: "2024-12-31", val: 2, filed: "2025-13-01" }),
    fact({ end: "2024-12-31", val: 3, filed: "yesterday" }),
    fact({ start: "2024-1-1", end: "2024-12-31", val: 4 }),
    fact({ end: "2024-12-31", val: "5" }),
    fact({ end: "2024-12-31", val: null }),
    fact({ end: "2024-12-31", val: Number.POSITIVE_INFINITY }),
    fact({ end: "2024-12-31", val: Number.NaN }),
    fact({ end: "2024-12-31", val: 6, accn: "" }),
    fact({ end: "2024-12-31", val: 7, accn: undefined }),
    fact({ end: "2024-12-31", val: 8 }),
  ] }) } }));
  assert.deepEqual(r.rows.map((x) => x.value), [8]);
  assert.equal(calendarDate("2024-02-29"), "2024-02-29");
  assert.equal(calendarDate("2023-02-29"), null);
});

test("ifrs-full tag and a non-USD unit", () => {
  const r = pickFacts(doc({ "ifrs-full": { Revenue: tag({ CNY: [fact({ start: "2024-01-01", end: "2024-12-31", val: 1000, form: "20-F" })] }) } }));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.tag, "ifrs-full:Revenue");
  assert.equal(r.rows[0]!.unit, "CNY");
  assert.equal(r.rows[0]!.form, "20-F");
});

test("units are separate: the same period in USD and EUR gives two rows", () => {
  const r = pickFacts(doc({ "us-gaap": { Assets: tag({
    USD: [fact({ end: "2024-12-31", val: 1 })],
    EUR: [fact({ end: "2024-12-31", val: 2 })],
  }) } }));
  assert.equal(r.rows.length, 2);
});

test("empty facts and an object with no shape", () => {
  assert.deepEqual(pickFacts({ cik: 1, facts: {} }), { rows: [], hasShape: false, hasFacts: false });
  assert.deepEqual(pickFacts({ cik: 1, facts: { dei: { EntityCommonStockSharesOutstanding: { units: { shares: [] } } } } }), { rows: [], hasShape: false, hasFacts: true });
  assert.equal(pickFacts({ message: "other" }).hasShape, false);
  for (const bad of [null, undefined, "x", 5, [], { facts: [] }]) {
    assert.deepEqual(pickFacts(bad), { rows: [], hasShape: false, hasFacts: false });
  }
  for (const noTaxonomy of [{ facts: { "us-gaap": { A: { units: {} } } } }, { facts: { dei: { X: tag({ shares: [fact({ end: "2024-01-01", val: 1 })] }) } } }]) {
    assert.deepEqual(pickFacts(noTaxonomy), { rows: [], hasShape: false, hasFacts: true });
  }
});

test("shape is true even when no row survives the filters", () => {
  const r = pickFacts(doc({ "us-gaap": { Assets: tag({ USD: [fact({ end: "2020-12-31", val: 1 })] }) } }));
  assert.deepEqual(r, { rows: [], hasShape: true, hasFacts: true });
});
