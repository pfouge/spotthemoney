// npx tsx --test scripts/lobbyissues.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIssues, issueCell, issueIndex, issueSlug, rowIssues, ISSUES_PATH, ISSUE_TOP_ROWS, ISSUE_FILING_ROWS } from "../web/src/lib/lobbyissues";
import type { LobbyingRow } from "../web/src/lib/flagship";

let id = 0;
const row = (issues: string[], amount: number | null, client: string, registrant: string, year = 2026, createdAt = "2026-07-20"): LobbyingRow =>
  ({ id: ++id, registrant, client, issueArea: issues[0] ?? null, issues, amount, year, quarter: 2, filingType: "Q2", sourceRef: null, createdAt });
const names = new Map([["TAX", "Taxation/Internal Revenue Code"], ["TRD", "Trade (domestic/foreign)"], ["DEF", "Defense"], ["CAW", "Clean Air and Water (quality)"]]);

test("issueSlug drops brackets and punctuation", () => {
  assert.equal(issueSlug("Taxation/Internal Revenue Code"), "taxation-internal-revenue-code");
  assert.equal(issueSlug("Clean Air and Water (quality)"), "clean-air-and-water");
  assert.equal(issueSlug("Food Industry (safety, labeling, etc.)"), "food-industry");
  assert.equal(issueSlug("Law Enforcement/Crime/Criminal Justice"), "law-enforcement-crime-criminal-justice");
  assert.ok(issueSlug("Communications/Broadcasting/Radio/TV and a very long tail that would never fit in an address").length <= 60);
});

test("issueIndex gives every code one address, and a clash gets the code", () => {
  const idx = issueIndex([row(["XXX"], 1, "c", "r")], new Map([...names, ["TR2", "Trade"]]));
  const paths = [...idx.values()].map((i) => i.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(idx.get("TAX")!.path, `${ISSUES_PATH}taxation-internal-revenue-code/`);
  assert.equal(idx.get("XXX")!.name, "XXX");            // a code with no name still gets a page
  assert.deepEqual([idx.get("TR2")!.slug, idx.get("TRD")!.slug].sort(), ["trade", "trade-trd"]);
});

test("rowIssues: each code once, in order; falls back to the first-issue column", () => {
  assert.deepEqual(rowIssues({ issues: ["TAX", "TRD", "TAX"], issueArea: "TAX" }), ["TAX", "TRD"]);
  assert.deepEqual(rowIssues({ issues: [], issueArea: "DEF" }), ["DEF"]);
  assert.deepEqual(rowIssues({ issueArea: null }), []);
});

test("a filing counts under every issue it lists, with its whole amount", () => {
  const rows = [
    row(["TAX", "TRD"], 100, "Acme", "Firm A"),
    row(["TAX"], 40, "Acme", "Firm B"),
    row(["TRD", "DEF", "TAX"], 10, "Bolt", "Firm A"),
    row([], null, "Bolt", "Firm A"),                     // a registration: no issue, no amount
    row(["TAX"], 999, "Old", "Firm C", 2025, "2025-07-20"), // another year: not in the figures
  ];
  const issues = buildIssues(rows, names, 2026);
  const tax = issues.find((i) => i.code === "TAX")!;
  assert.deepEqual([tax.filings, tax.only, tax.clients, tax.registrants, tax.amount], [3, 1, 2, 2, 150]);
  assert.deepEqual(tax.topClients.map((c) => [c.name, c.amount, c.filings]), [["Acme", 140, 2], ["Bolt", 10, 1]]);
  assert.equal(tax.allFilings, 4);                       // the 2025 filing is on record, and listed under newest
  assert.equal(tax.newest.at(-1)!.year, 2025);
  const trd = issues.find((i) => i.code === "TRD")!;
  assert.deepEqual([trd.filings, trd.only, trd.amount], [2, 0, 110]);
  // The amounts overlap: they add up to more than the year's reported total (150).
  assert.ok(issues.reduce((s, i) => s + i.amount, 0) > 150);
  assert.deepEqual(issues.map((i) => i.code), ["TAX", "TRD", "DEF"]); // largest amount first
  assert.ok(!issues.some((i) => i.code === "CAW"));      // named but never listed: no page
});

test("tables are capped", () => {
  const rows = Array.from({ length: 130 }, (_, n) => row(["DEF"], n + 1, `Client ${n}`, `Firm ${n}`, 2026, `2026-07-${String((n % 28) + 1).padStart(2, "0")}`));
  const def = buildIssues(rows, names, 2026)[0]!;
  assert.equal(def.topClients.length, ISSUE_TOP_ROWS);
  assert.equal(def.newest.length, ISSUE_FILING_ROWS);
  assert.equal(def.clients, 130);
  assert.ok(def.newest.every((l, n, a) => n === 0 || a[n - 1]!.createdAt >= l.createdAt));
  assert.equal(def.latest, "2026-07-28");
});

test("issueCell prints the first few names and counts the rest", () => {
  const idx = issueIndex([], names);
  const c = issueCell({ issues: ["TAX", "TRD", "DEF", "ZZZ"], issueArea: "TAX" }, idx, 2);
  assert.deepEqual(c.shown.map((s) => s.name), ["Taxation/Internal Revenue Code", "Trade (domestic/foreign)"]);
  assert.equal(c.more, 2);
  assert.deepEqual(issueCell({ issues: [], issueArea: null }, idx), { shown: [], more: 0 });
  assert.equal(issueCell({ issues: ["ZZZ"], issueArea: "ZZZ" }, idx).shown[0]!.path, null); // unknown code: plain text
});
