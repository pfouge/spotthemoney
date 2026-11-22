import test from "node:test";
import assert from "node:assert/strict";
import {
  amendKind, buildCusipMap, decide, keepCutoff, lookupCusip, normPutCall, planFilings, valueToDollars, type Sub,
} from "./inst13f.js";

const sub = (o: Partial<Sub>): Sub => ({
  accession: "0000000001-26-000001", filed: "2026-02-10", type: "13F-HR", managerCik: "0000111111",
  period: "2025-12-31", isAmendment: false, amendType: "", managerName: "M", ...o,
});

test("value is thousands before 2023-01-03 and dollars from then on", () => {
  assert.equal(valueToDollars(5, "2022-12-30"), 5000);
  assert.equal(valueToDollars(5, "2023-01-02"), 5000);
  assert.equal(valueToDollars(5, "2023-01-03"), 5);
  assert.equal(valueToDollars(5, "2026-02-10"), 5);
});

test("put/call normalisation", () => {
  assert.equal(normPutCall(" put "), "PUT");
  assert.equal(normPutCall("Call"), "CALL");
  assert.equal(normPutCall(""), "");
  assert.equal(normPutCall(undefined), "");
  assert.equal(normPutCall("other"), "");
});

test("cusip map: unique claims, ambiguous dropped, 8-character fallback", () => {
  const m = buildCusipMap([
    { cusip: "037833100", cik: "0000320193" },
    { cusip: "037833100", cik: "0000320193" },
    { cusip: "AAAAAAAA1", cik: "0000000001" },
    { cusip: "AAAAAAAA1", cik: "0000000002" }, // ambiguous
    { cusip: "BBBBBBBB1", cik: "0000000003" },
    { cusip: "bad", cik: "0000000004" },
    { cusip: null, cik: "0000000005" },
  ]);
  assert.equal(m.ambiguous, 1);
  assert.deepEqual(lookupCusip(m, "037833100"), { cik: "0000320193", fallback: false });
  assert.equal(lookupCusip(m, "AAAAAAAA1"), null);
  // a different check digit on the same 8-character issue is matched by fallback
  assert.deepEqual(lookupCusip(m, "BBBBBBBB7"), { cik: "0000000003", fallback: true });
  assert.equal(lookupCusip(m, "ZZZZZZZZ0"), null);
});

test("amendment kind", () => {
  assert.deepEqual(amendKind({ isAmendment: false, amendType: "" }), { kind: "base", unknown: false });
  assert.deepEqual(amendKind({ isAmendment: true, amendType: "RESTATEMENT" }), { kind: "base", unknown: false });
  assert.deepEqual(amendKind({ isAmendment: true, amendType: "NEW HOLDINGS" }), { kind: "add", unknown: false });
  assert.deepEqual(amendKind({ isAmendment: true, amendType: "something else" }), { kind: "base", unknown: true });
});

test("plan: newest base wins, later additions are kept, other forms ignored", () => {
  const { plans, restated, added } = planFilings([
    sub({ accession: "A1", filed: "2026-02-10" }),
    sub({ accession: "A2", filed: "2026-03-10", type: "13F-HR/A", isAmendment: true, amendType: "RESTATEMENT" }),
    sub({ accession: "A3", filed: "2026-03-20", type: "13F-HR/A", isAmendment: true, amendType: "NEW HOLDINGS" }),
    sub({ accession: "X1", filed: "2026-03-20", type: "13F-NT" }),
    sub({ accession: "B1", managerCik: "0000222222" }),
  ]);
  assert.equal(plans.length, 2);
  const p = plans.find((x) => x.managerCik === "0000111111")!;
  assert.equal(p.base!.accession, "A2");
  assert.deepEqual(p.adds.map((a) => a.accession), ["A3"]);
  assert.equal(restated, 1);
  assert.equal(added, 1);
});

test("plan: an addition filed before the winning base is dropped", () => {
  const { plans } = planFilings([
    sub({ accession: "A1", filed: "2026-02-10" }),
    sub({ accession: "A3", filed: "2026-02-20", type: "13F-HR/A", isAmendment: true, amendType: "NEW HOLDINGS" }),
    sub({ accession: "A2", filed: "2026-03-10", type: "13F-HR/A", isAmendment: true, amendType: "RESTATEMENT" }),
  ]);
  assert.equal(plans[0]!.base!.accession, "A2");
  assert.equal(plans[0]!.adds.length, 0);
});

test("decide: replace, skip older, addition, no base", () => {
  const base = sub({ accession: "A1", filed: "2026-02-10" });
  const planNew = planFilings([base]).plans[0]!;
  assert.equal(decide(planNew, undefined, new Set()).decision, "replace");
  assert.equal(decide(planNew, { filed: "2026-02-10", accession: "A1" }, new Set()).decision, "replace");
  assert.equal(decide(planNew, { filed: "2026-05-01", accession: "Z9" }, new Set()).decision, "skip_older");

  const addOnly = planFilings([sub({ accession: "A3", filed: "2026-03-20", type: "13F-HR/A", isAmendment: true, amendType: "NEW HOLDINGS" })]).plans[0]!;
  assert.equal(decide(addOnly, undefined, new Set()).decision, "skip_no_base");
  assert.equal(decide(addOnly, { filed: "2026-02-10", accession: "A1" }, new Set()).decision, "add");
  // already applied: the stored accession is the addition itself
  assert.equal(decide(addOnly, { filed: "2026-03-20", accession: "A3" }, new Set(["A3"])).decision, "skip_loaded");
  // older than what is stored
  assert.equal(decide(addOnly, { filed: "2026-04-01", accession: "A9" }, new Set(["A9"])).decision, "skip_loaded");
});

test("retention cut-off keeps the newest N periods", () => {
  assert.equal(keepCutoff(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2025-12-31"], 4), null);
  assert.equal(keepCutoff(["2025-06-30", "2025-09-30", "2025-12-31"], 4), null);
  assert.equal(keepCutoff(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"], 4), "2025-06-30");
});

test("keepCutoff ignores mistyped and future report periods", () => {
  const ps = ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2027-06-30", "2026-05-15"];
  assert.equal(keepCutoff(ps, 2, "2026-11-22"), "2026-03-31");
  assert.equal(keepCutoff(["2026-06-30"], 2, "2026-11-22"), null);
});
