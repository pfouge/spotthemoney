// Independent expenditures: the rules in web/src/lib/outsidespending.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countedFlags, sideTotals, addCents, mostCommon, amountOutOfRange, inTotals, OUTSIDE_AMOUNT_MAX, bySpender, byCandidate, largestSpenders, newestCounted, cycleOf, memberOutside, memberOutsideSentence, cleanOutsideText, fecCommitteeUrl, CSV_COLUMNS, OUTSIDE_CAVEAT, COUNT_RULE,
  type Expenditure,
} from "../web/src/lib/outsidespending";

let n = 0;
const ex = (committee: string | null, spentAt: string | null, isNotice: boolean, x: Partial<Expenditure> = {}): Expenditure => ({
  subId: `S${++n}`, committeeId: committee, committeeName: committee ? `Committee ${committee}` : "Unnamed", candidateId: "H0AA", candidateName: "Jane Doe", office: "H", state: "TX", district: "01", party: "DEM",
  personId: 1, side: "S", amount: 1000, spentAt, disseminatedAt: spentAt, description: "TV ad", isNotice, url: "https://docquery.fec.gov/x", counted: false, ...x,
});
const flagged = (rows: Expenditure[]) => { const f = countedFlags(rows); return rows.map((r, i) => ({ ...r, counted: f[i] })); };

test("counted rule: regular reports always count; a notice counts only when later than the committee's newest regular row", () => {
  const rows = flagged([
    ex("C1", "2026-06-01", false), ex("C1", "2026-06-10", false),
    ex("C1", "2026-06-10", true),     // same day as the newest regular row: repeat
    ex("C1", "2026-06-05", true),     // earlier: repeat
    ex("C1", "2026-06-11", true),     // later: counts
    ex("C2", "2026-05-01", true),     // committee with notices only: counts
    ex("C2", "2026-05-02", true),
    ex("C3", "2026-07-01", false), ex("C3", "2026-06-30", true),   // every notice older than its regular rows
    ex("C4", null, true),             // notice with no date, committee has no regular rows: counts
    ex("C5", "2026-04-01", false), ex("C5", null, true),           // undated notice beside regular rows: does not count
  ]);
  assert.deepEqual(rows.map((r) => r.counted), [true, true, false, false, true, true, true, true, false, true, true, false]);
});
test("committees without an id are grouped by name, and the flag count equals the row count", () => {
  const rows = flagged([ex(null, "2026-01-01", false), ex(null, "2026-01-01", true), ex(null, "2026-01-02", true)]);
  assert.deepEqual(rows.map((r) => r.counted), [true, false, true]);
});
test("totals: support and oppose separate, null amount or side listed but in no total", () => {
  const rows = flagged([
    ex("C1", "2026-06-01", false, { amount: 500 }), ex("C1", "2026-06-02", false, { side: "O", amount: 300 }),
    ex("C2", "2026-06-02", false, { side: "O", amount: 200 }), ex("C2", "2026-06-03", false, { amount: null }), ex("C3", "2026-06-03", false, { side: null, amount: 900 }),
    ex("C4", "2026-06-05", true, { amount: 70 }), ex("C1", "2026-06-02", true, { amount: 999 }),
  ]);
  const t = sideTotals(rows);
  assert.deepEqual([t.support, t.oppose, t.supportRows, t.opposeRows, t.supportSpenders, t.opposeSpenders], [570, 500, 2, 2, 2, 2]);
  assert.equal(t.spenders, 4);
  assert.deepEqual(bySpender(rows, "O").map((r) => [r.name, r.amount]), [["Committee C1", 300], ["Committee C2", 200]]);
  assert.equal(memberOutside(rows).countedRows, 6);
  const s = memberOutsideSentence("Jane Doe", 2026, t);
  assert.match(s, /\$570 reported in support by 2 committees, and \$500 reported in opposition by 2 committees/);
  assert.doesNotMatch(s, /\bnet\b|received|donat|gave/i);
});
test("hub tables", () => {
  const rows = flagged([
    ...Array.from({ length: 5 }, (_, i) => ex("C1", `2026-06-0${i + 1}`, false, { amount: 100 })),
    ...Array.from({ length: 4 }, (_, i) => ex("C2", `2026-06-0${i + 1}`, false, { candidateId: "H0BB", candidateName: "Other", personId: null, amount: 10 })),
    ex("C2", "2026-07-01", false, { side: "O", amount: 50, candidateId: "H0AA" }),
  ]);
  const c = byCandidate(rows);
  assert.deepEqual(c.map((x) => [x.name, x.rows, x.spenders]), [["Jane Doe", 6, 2]]);   // the other candidate has 4 rows
  assert.deepEqual([c[0].support, c[0].oppose], [500, 50]);
  assert.equal(largestSpenders(rows)[0].name, "Committee C1");
  assert.equal(newestCounted(rows, 3)[0].spentAt, "2026-07-01");
  assert.equal(cycleOf(rows), 2026);
  assert.equal(cycleOf(flagged([ex("C1", "2025-03-01", false)])), 2026);
  assert.equal(cycleOf([]), null);
});
test("text, links, CSV columns, wording", () => {
  assert.equal(cleanOutsideText("<b>\"x\"</b>\u0007  y", 80), "<b>\"x\"</b> y");
  assert.ok(cleanOutsideText("a ".repeat(100), 80)!.endsWith("…"));
  assert.equal(fecCommitteeUrl("C00123456"), "https://www.fec.gov/data/committee/C00123456/");
  assert.equal(fecCommitteeUrl("x"), null);
  const keys = CSV_COLUMNS(() => null).map((c) => c.key);
  assert.deepEqual(keys, ["sub_id", "spender", "spender_fec_id", "candidate", "candidate_fec_id", "office", "state", "district", "party", "support_oppose", "amount", "date", "disseminated", "purpose", "is_notice", "counted", "member_page_url", "source_url", "amount_out_of_range"]);
  assert.ok(!keys.includes("payee_name") && !keys.includes("payee"));
  assert.match(OUTSIDE_CAVEAT, /The member did not receive this money/);
  assert.match(COUNT_RULE, /counted once/);
});

test("an amount over the limit is listed but in no total; totals add in cents; labels are the most common value", () => {
  const rows = [ex("C1", "2026-06-01", false, { amount: 9_000_000_000, counted: true }), ex("C1", "2026-06-02", false, { amount: 500, counted: true })];
  assert.equal(amountOutOfRange(OUTSIDE_AMOUNT_MAX), false);
  assert.equal(amountOutOfRange(OUTSIDE_AMOUNT_MAX + 1), true);
  assert.equal(inTotals(rows[0]!), false);
  assert.equal(sideTotals(rows).support, 500);
  assert.equal(sideTotals(rows).supportRows, 1);
  // 0.1 + 0.2 in cents is exactly 0.3, whatever the order
  assert.equal(addCents(0.1, 0.2), 0.3);
  const a = [0.105, 1000.005, 2.675, 0.335].reduce(addCents, 0), b = [0.335, 2.675, 1000.005, 0.105].reduce(addCents, 0);
  assert.equal(Math.round(a * 100), Math.round(b * 100));
  assert.equal(mostCommon(["OSSOFF, JON", "OSSOFF, T. JONATHAN", "OSSOFF, JON", null]), "OSSOFF, JON");
  assert.equal(mostCommon(["B", "A"]), "A");
  assert.equal(mostCommon([null, ""]), null);
  const cands = byCandidate([0, 1, 2, 3, 4, 5].map((i) => ex("C1", "2026-06-01", false, { counted: true, candidateName: i < 2 ? "DOE, JANE" : "DOE, JANE M", state: i === 0 ? null : "TX" })), 5, 10);
  assert.equal(cands[0]!.name, "DOE, JANE M");
  assert.equal(cands[0]!.state, "TX");
});
