// Contract award details (web/src/lib/contracts.ts). Run:
//   npx tsx --test scripts/contracts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDescription, shortDescription, subAgencyLabel, subAgencyRows, contractDetailStats, contractDetailLog, DESCRIPTION_SHOWN } from "../web/src/lib/contracts";
import type { ContractRow } from "../web/src/lib/flagship-core";

const row = (o: Partial<ContractRow>): ContractRow => ({ id: 1, recipient: "ACME", agency: "Department of Defense", amount: 100, actionDate: "2026-10-01", naics: null, sourceRef: "X", createdAt: "2026-10-02", subAgency: null, endDate: null, description: null, ...o });

test("cleanDescription: white space collapsed, empties are null", () => {
  assert.equal(cleanDescription("  F-35 \n LOT 18 "), "F-35 LOT 18");
  assert.equal(cleanDescription("   "), null);
  assert.equal(cleanDescription(null), null);
  assert.equal(cleanDescription(undefined), null);
});

test("shortDescription: short text unchanged, long text cut at a word with an ellipsis", () => {
  assert.equal(shortDescription("ENGINE SPARES"), "ENGINE SPARES");
  const long = "PROCUREMENT OF SPARE PARTS AND SUSTAINMENT ENGINEERING SERVICES FOR THE F-35 LIGHTNING II AIRFRAME, PROPULSION SYSTEM AND SUPPORT EQUIPMENT AT ALL OPERATING LOCATIONS WORLDWIDE";
  const s = shortDescription(long)!;
  assert.ok(s.endsWith("…"));
  assert.ok(s.length <= DESCRIPTION_SHOWN + 1);
  assert.ok(long.startsWith(s.slice(0, -1)));
  assert.ok(!/[\s,;:.\-]…$/.test(s), "no dangling punctuation before the ellipsis");
  // one long word: cut hard, still within the limit
  const word = "X".repeat(400);
  assert.equal(shortDescription(word)!.length, DESCRIPTION_SHOWN + 1);
  assert.equal(shortDescription(""), null);
  // exactly at the limit is not cut
  const exact = "A".repeat(DESCRIPTION_SHOWN);
  assert.equal(shortDescription(exact), exact);
});

test("subAgencyLabel: only when it says more than the agency", () => {
  assert.equal(subAgencyLabel("Department of Defense", "Department of the Navy"), "Department of the Navy");
  assert.equal(subAgencyLabel("General Services Administration", "GENERAL SERVICES  ADMINISTRATION"), null);
  assert.equal(subAgencyLabel("Department of Defense", null), null);
  assert.equal(subAgencyLabel(null, "Federal Acquisition Service"), "Federal Acquisition Service");
});

test("subAgencyRows: grouped by agency and sub-agency, awards without one left out, largest first", () => {
  const rows = [
    row({ id: 1, subAgency: "Department of the Navy", amount: 500 }),
    row({ id: 2, subAgency: "DEPARTMENT OF THE NAVY", amount: 250 }),
    row({ id: 3, subAgency: "Department of the Army", amount: 900 }),
    row({ id: 4, subAgency: null, amount: 10_000 }),
    row({ id: 5, agency: "Department of Homeland Security", subAgency: "U.S. Coast Guard", amount: null }),
    row({ id: 6, agency: "Department of Energy", subAgency: "Department of the Navy", amount: 5 }),
  ];
  const out = subAgencyRows(rows);
  assert.deepEqual(out.map((r) => [r.subAgency, r.agency, r.awards, r.total]), [
    ["Department of the Army", "Department of Defense", 1, 900],
    ["Department of the Navy", "Department of Defense", 2, 750],
    ["Department of the Navy", "Department of Energy", 1, 5],
    ["U.S. Coast Guard", "Department of Homeland Security", 1, 0],
  ]);
  assert.equal(out.reduce((a, r) => a + r.awards, 0), 5);
});

test("contractDetailStats and the build log line: plain counts", () => {
  const rows = [
    row({ id: 1, subAgency: "Department of the Navy", endDate: "2027-09-30", description: "ENGINE SPARES" }),
    row({ id: 2, description: "  " }),
    row({ id: 3, endDate: "2026-12-31" }),
  ];
  assert.deepEqual(contractDetailStats(rows), { awards: 3, withDescription: 1, withSubAgency: 1, withEndDate: 2, subAgencies: 1, longestDescription: 13 });
  const line = contractDetailLog(rows);
  assert.match(line, /^\[web\] contract details: 3 awards in the window; with a description 1, a sub-agency 1, an end date 2; 1 sub-agencies/);
  assert.match(line, /Department of the Navy 1\/100/);
  assert.match(contractDetailLog([]), /0 awards in the window/);
});
