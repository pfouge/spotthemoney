import { test } from "node:test";
import assert from "node:assert/strict";
import { splitItems, eventSourceUrl, pickEvents } from "./events8k.js";

const CIK = "0001045810";
function answer(rows: Record<string, string>[]) {
  const col = (k: string) => rows.map((r) => r[k] ?? "");
  return {
    filings: { recent: {
      accessionNumber: col("a"), filingDate: col("f"), reportDate: col("r"), acceptanceDateTime: col("t"),
      form: col("form"), items: col("items"), primaryDocument: col("doc"),
    } },
  };
}

test("splitItems splits, trims, dedupes, drops empties", () => {
  assert.deepEqual(splitItems("2.02, 9.01"), ["2.02", "9.01"]);
  assert.deepEqual(splitItems("5.02,5.02,,"), ["5.02"]);
  assert.deepEqual(splitItems(""), []);
  assert.deepEqual(splitItems(null as unknown as string), []);
});

test("eventSourceUrl builds the archive address", () => {
  assert.equal(eventSourceUrl(CIK, "0001045810-26-000010", "a.htm"), "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/a.htm");
  assert.equal(eventSourceUrl(CIK, "0001045810-26-000010", null), "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/");
});

test("pickEvents keeps 8-K and 8-K/A on or after the floor", () => {
  const p = pickEvents(answer([
    { a: "A-1", f: "2026-02-26", r: "2026-02-25", t: "2026-02-26T16:05:11.000Z", form: "8-K", items: "2.02,9.01", doc: "x.htm" },
    { a: "A-2", f: "2026-03-05", r: "", form: "8-K/A", items: "5.02", doc: "" },
    { a: "A-3", f: "2026-03-06", form: "10-Q", items: "" },
    { a: "A-4", f: "2025-09-30", form: "8-K", items: "1.01" },
    { a: "A-5", f: "2025-10-01", form: "8-K", items: "8.01" },
    { a: "A-1", f: "2026-02-26", form: "8-K", items: "2.02,9.01" },
  ]), CIK, "2025-10-01");
  assert.equal(p.hasShape, true);
  assert.deepEqual(p.events.map((e) => e.accession), ["A-1", "A-2", "A-5"]);
  assert.deepEqual(p.events[0]!.items, ["2.02", "9.01"]);
  assert.equal(p.events[1]!.reportDate, null);
  assert.equal(p.events[1]!.primaryDocument, null);
  assert.equal(p.events[0]!.acceptedAt != null, true);
});

test("pickEvents: shape failures", () => {
  assert.equal(pickEvents({}, CIK, "2025-10-01").hasShape, false);
  assert.equal(pickEvents(null, CIK, "2025-10-01").hasShape, false);
  assert.equal(pickEvents({ filings: { recent: { form: ["8-K"], accessionNumber: ["A"] } } }, CIK, "2025-10-01").hasShape, false);
  assert.equal(pickEvents({ filings: { recent: { form: ["8-K", "4"], accessionNumber: ["A"], items: [""] } } }, CIK, "2025-10-01").hasShape, false);
});

test("pickEvents: layout with no 8-K has the shape and no events", () => {
  const p = pickEvents(answer([{ a: "A-3", f: "2026-03-06", form: "10-Q", items: "" }]), CIK, "2025-10-01");
  assert.equal(p.hasShape, true);
  assert.equal(p.events.length, 0);
});
