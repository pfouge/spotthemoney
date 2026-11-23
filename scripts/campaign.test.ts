import test from "node:test";
import assert from "node:assert/strict";
import { topEmployers, topStates, usableEmployer, payeeMap, indexCampaign, shownFor, type CampaignCommittee } from "../web/src/lib/campaign";

const cc = (o: Partial<CampaignCommittee>): CampaignCommittee => ({ id: 1, fecId: "C1", name: "A for Congress", slug: "a", memberName: "A", personId: 1, held: 1, sum: 1, held90: 0, sum90: 0, first: null, newest: null, note: null, employers: [], states: [], employerOmitted: 0, ...o });

test("uninformative employers are left out and counted", () => {
  for (const v of [null, "", " ", "N/A", "none", "Retired", "NOT EMPLOYED", "self-employed", "SELF", "Self Employed"]) assert.equal(usableEmployer(v), null, String(v));
  assert.equal(usableEmployer("  Acme   Corp "), "Acme Corp");
  const r = topEmployers([{ key: "RETIRED", sum: 500, count: 5 }, { key: "Acme", sum: 100, count: 1 }, { key: "ACME", sum: 50, count: 2 }, { key: null, sum: 10, count: 1 }]);
  assert.equal(r.omitted, 6);
  assert.deepEqual(r.rows, [{ key: "ACME", sum: 150, count: 3 }].map((x) => ({ ...x, key: r.rows[0].key })));
  assert.equal(r.rows.length, 1);
});
test("top rows are capped and ordered by sum", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ key: `E${i}`, sum: i, count: 1 }));
  const r = topEmployers(rows);
  assert.equal(r.rows.length, 10); assert.equal(r.rows[0].key, "E14");
});
test("states keep two letters only", () => {
  const r = topStates([{ key: "pa", sum: 5, count: 1 }, { key: "PA", sum: 5, count: 1 }, { key: "XXX", sum: 99, count: 1 }, { key: null, sum: 9, count: 1 }]);
  assert.deepEqual(r, [{ key: "PA", sum: 10, count: 2 }]);
});
test("payee map: shared names map to nobody", () => {
  const m = payeeMap([{ name: "Marsh for California, Inc.", slug: "m" }, { name: "Same Name Committee", slug: "x" }, { name: "SAME NAME COMMITTEE", slug: "y" }, { name: "Same Name Committee", slug: "x" }]);
  assert.equal(m.get("MARSH FOR CALIFORNIA") ?? m.get([...m.keys()][0]), "m");
  assert.equal([...m.values()].includes("x"), false);
  assert.equal([...m.values()].includes("y"), false);
});
test("shownFor: only committees with receipts, at most three", () => {
  const d = indexCampaign([cc({ id: 1, fecId: "C1", held: 5 }), cc({ id: 2, fecId: "C2", held: 0 }), cc({ id: 3, fecId: "C3", held: 9 }), cc({ id: 4, fecId: "C4", held: 7 }), cc({ id: 5, fecId: "C5", held: 1 })]);
  assert.deepEqual(shownFor(d, "a").map((c) => c.fecId), ["C3", "C4", "C1"]);
  assert.deepEqual(shownFor(d, "none"), []);
});
