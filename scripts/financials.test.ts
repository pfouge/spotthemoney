// Offline tests for the "Financials, as filed" rules. Run: npx tsx --test scripts/financials.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodKind, companyUnit, companyFinancials, shownYears, shownQuarters, filingUrl, sourceFilings, finMoney, finPerShare,
  heldList, heldCount, tagChangeCount, csvRows, summarySentence, financialsLog, emptyFinancials, FIN_CAVEAT, HELD_TEXT,
  SHOWN_CONCEPTS, LOADED_CONCEPTS, MAX_EPS_WITHOUT_INCOME, type FinRow,
} from "../web/src/lib/financials";

let n = 0;
const row = (o: Partial<FinRow>): FinRow => ({ concept: "revenue", tag: "us-gaap:Revenues", unit: "USD", start: "2025-01-01", end: "2025-12-31", value: 100, form: "10-K", filed: "2026-02-01", accession: `0000000001-26-${String(++n).padStart(6, "0")}`, ...o });
const yr = (y: number, o: Partial<FinRow> = {}) => row({ start: `${y}-01-01`, end: `${y}-12-31`, filed: `${y + 1}-02-01`, accession: `0000000001-${String(y + 1).slice(2)}-000001`, ...o });
const pt = (end: string, concept: string, value: number, o: Partial<FinRow> = {}) => row({ concept, tag: `us-gaap:${concept}`, start: null, end, value, ...o });

test("a period is told by its length", () => {
  assert.equal(periodKind("2025-01-01", "2025-03-31"), "quarter");
  assert.equal(periodKind("2025-01-01", "2025-12-31"), "year");
  assert.equal(periodKind("2024-09-29", "2025-09-27"), "year");   // a 52-week year
  assert.equal(periodKind("2025-01-01", "2025-06-30"), null);     // half-year, year to date
  assert.equal(periodKind("2025-01-01", "2025-09-30"), null);     // nine months
  assert.equal(periodKind(null, "2025-12-31"), null);
  assert.equal(periodKind("bad", "2025-12-31"), null);
});

test("currency: the newest filed figure that is not per share decides", () => {
  assert.equal(companyUnit([row({ unit: "USD", filed: "2024-01-01" }), row({ unit: "CNY", filed: "2026-01-01" }), row({ unit: "USD/shares", filed: "2027-01-01" })]), "CNY");
  assert.equal(companyUnit([row({ unit: "USD/shares" })]), null);
  assert.equal(companyUnit([]), null);
});

test("years and quarters, newest first, with balance-sheet figures on the period's last day", () => {
  const rows: FinRow[] = [
    yr(2023), yr(2024, { value: 200 }), yr(2025, { value: 300 }), yr(2022, { value: 50 }),
    yr(2025, { concept: "net_income", tag: "us-gaap:NetIncomeLoss", value: 30_000_000 }),
    yr(2025, { concept: "eps_diluted", tag: "us-gaap:EarningsPerShareDiluted", unit: "USD/shares", value: 1.5 }),
    yr(2025, { concept: "operating_cash_flow", tag: "us-gaap:NetCashProvidedByUsedInOperatingActivities", value: 40 }),
    pt("2025-12-31", "assets", 1000), pt("2025-12-31", "liabilities_and_equity", 1000), pt("2025-12-31", "cash", 10),
    pt("2025-11-15", "assets", 999), // a date that ends no period: in no column
    row({ start: "2026-01-01", end: "2026-03-31", value: 80, form: "10-Q", filed: "2026-05-01" }),
    row({ start: "2026-01-01", end: "2026-03-31", concept: "operating_cash_flow", value: 9, form: "10-Q", filed: "2026-05-01" }),
    row({ start: "2026-01-01", end: "2026-06-30", value: 170, form: "10-Q", filed: "2026-08-01" }), // year to date: ignored
    row({ start: "2026-04-01", end: "2026-06-30", value: 90, form: "10-Q", filed: "2026-08-01" }),
    row({ concept: "long_term_debt", tag: "us-gaap:LongTermDebt", start: null, value: 5 }), // stored, never shown
  ];
  const f = companyFinancials(rows)!;
  assert.equal(f.unit, "USD");
  assert.deepEqual(f.years.map((p) => p.end), ["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31"]);
  assert.deepEqual(shownYears(f).map((p) => p.end), ["2025-12-31", "2024-12-31", "2023-12-31"]);
  assert.deepEqual(shownQuarters(f).map((p) => p.end), ["2026-06-30", "2026-03-31"]);
  const y = f.years[0]!;
  assert.equal(y.start, "2025-01-01");
  assert.equal(y.cells["revenue"]!.value, 300);
  assert.equal(y.cells["assets"]!.value, 1000);
  assert.equal(y.cells["cash"]!.value, 10);
  assert.equal(y.cells["liabilities"], undefined);
  assert.equal(y.cells["long_term_debt"], undefined);
  assert.equal(y.cells["eps_diluted"]!.held, null);
  // cash flow is in the fiscal-year table only
  assert.equal(y.cells["operating_cash_flow"]!.value, 40);
  assert.equal(f.quarters[1]!.cells["operating_cash_flow"], undefined);
  assert.equal(f.quarters[0]!.cells["revenue"]!.value, 90);
  assert.ok(!SHOWN_CONCEPTS.some((c) => c.key === "long_term_debt") && !LOADED_CONCEPTS.includes("long_term_debt"));
});

test("the newest filing states a period; a restated figure replaces the original", () => {
  const f = companyFinancials([yr(2024, { value: 200 }), yr(2024, { value: 210, filed: "2026-02-01", accession: "0000000001-26-000009" })])!;
  assert.equal(f.years[0]!.cells["revenue"]!.value, 210);
  assert.equal(sourceFilings(f.years[0]!)[0]!.accession, "0000000001-26-000009");
});

test("two years ending close together: the later one is kept", () => {
  const f = companyFinancials([row({ start: "2024-10-01", end: "2025-09-30" }), row({ start: "2024-07-01", end: "2025-06-30", value: 7 }), row({ start: "2023-07-01", end: "2024-06-30", value: 6 })])!;
  assert.deepEqual(f.years.map((p) => p.end), ["2025-09-30", "2024-06-30"]);
});

test("rows in a second currency are left out and counted", () => {
  const f = companyFinancials([yr(2025, { unit: "CNY", filed: "2026-04-01" }), yr(2024, { unit: "USD" }), yr(2025, { concept: "eps_diluted", unit: "USD/shares", value: 2 }), yr(2025, { concept: "eps_diluted", unit: "CNY/shares", value: 3 })])!;
  assert.equal(f.unit, "CNY");
  assert.equal(f.years.length, 1);
  assert.equal(f.years[0]!.cells["eps_diluted"]!.value, 3);
  assert.equal(f.otherUnitRows, 2);
});

test("a per-share figure in a money unit is ignored", () => {
  const f = companyFinancials([yr(2025), yr(2025, { concept: "eps_diluted", unit: "USD", value: 5 })])!;
  assert.equal(f.years[0]!.cells["eps_diluted"], undefined);
});

test("no period on file means no tables", () => {
  assert.equal(companyFinancials([pt("2025-12-31", "assets", 5)]), null);
  assert.equal(companyFinancials([]), null);
  assert.equal(companyFinancials([row({ start: "2025-01-01", end: "2025-06-30" })]), null);
});

test("held back: earnings per share that imply too few shares", () => {
  const mk = (ni: number | null, eps: number) => companyFinancials([yr(2025), ...(ni == null ? [] : [yr(2025, { concept: "net_income", value: ni })]), yr(2025, { concept: "eps_diluted", unit: "USD/shares", value: eps })])!.years[0]!;
  assert.equal(mk(716_000_000, 790_000).cells["eps_diluted"]!.held, "implied_shares");   // a scale mistake
  assert.equal(mk(716_000_000, 0.79).cells["eps_diluted"]!.held, null);
  assert.equal(mk(-5_000_000, -66_245.01).cells["eps_diluted"]!.held, "implied_shares");
  assert.equal(mk(90_000_000_000, 62_000).cells["eps_diluted"]!.held, null);             // a very high share price, 1.45M shares
  assert.equal(mk(null, MAX_EPS_WITHOUT_INCOME + 1).cells["eps_diluted"]!.held, "implied_shares");
  assert.equal(mk(null, -30_560).cells["eps_diluted"]!.held, "implied_shares");
  assert.equal(mk(null, 500).cells["eps_diluted"]!.held, null);
  assert.equal(mk(0, 0.01).cells["eps_diluted"]!.held, null);                            // nothing to divide
  assert.equal(mk(1000, 0).cells["eps_diluted"]!.held, null);
  const p = mk(716_000_000, 790_000);
  assert.equal(heldList(p), "eps_diluted:implied_shares");
  assert.equal(heldCount([p]), 1);
});

test("held back: assets that do not equal liabilities and equity; cash above assets", () => {
  const mk = (assets: number, le: number | null, cash: number | null) => companyFinancials([yr(2025), pt("2025-12-31", "assets", assets), ...(le == null ? [] : [pt("2025-12-31", "liabilities_and_equity", le)]), ...(cash == null ? [] : [pt("2025-12-31", "cash", cash)])])!.years[0]!;
  assert.equal(mk(57_249, 57_599, null).cells["assets"]!.held, "balance");
  assert.equal(mk(1000, 1004, null).cells["assets"]!.held, null);      // inside the tolerance
  assert.equal(mk(1000, null, null).cells["assets"]!.held, null);      // nothing to compare with
  const p = mk(1000, 1000, 9_895_000);
  assert.equal(p.cells["cash"]!.held, "cash_over_assets");
  assert.equal(p.cells["assets"]!.held, "cash_over_assets");
  assert.equal(mk(1000, 1000, 1000).cells["cash"]!.held, null);
  assert.equal(heldList(p), "cash:cash_over_assets; assets:cash_over_assets");
  assert.equal(mk(57_249, 57_599, null).cells["liabilities_and_equity"]!.value, 57_599); // kept for the CSV
});

test("a figure filed under another tag than the newest column is marked", () => {
  const f = companyFinancials([yr(2025, { tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" }), yr(2024, { tag: "us-gaap:Revenues" }), yr(2023, { tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" })])!;
  assert.deepEqual(f.years.map((p) => p.cells["revenue"]!.tagChanged), [false, true, false]);
  assert.equal(tagChangeCount(shownYears(f)), 1);
});

test("filing address; bad input gives none", () => {
  assert.equal(filingUrl("0000320193", "0000320193-26-000026"), "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.htm");
  assert.equal(filingUrl("0000320193", "seed-1"), null);
  assert.equal(filingUrl("x", "0000320193-26-000026"), null);
});

test("amounts are printed in the unit as filed", () => {
  assert.equal(finMoney(478_834_000_000, "USD"), "$478.83B");
  assert.equal(finMoney(-1_234_000, "USD"), "−$1.2M");
  assert.equal(finMoney(247_000, "USD"), "$247K");
  assert.equal(finMoney(0, "USD"), "$0");
  assert.equal(finMoney(999, "USD"), "$999");
  assert.equal(finMoney(4.2e12, "JPY"), "JPY 4.20T");
  assert.equal(finMoney(12_300_000_000, "CNY"), "CNY 12.30B");
  assert.equal(finPerShare(6.43, "USD/shares"), "$6.43");
  assert.equal(finPerShare(-0.126, "USD/shares"), "−$0.13");
  assert.equal(finPerShare(123.4, "JPY/shares"), "JPY 123.40");
});

test("CSV rows: every year and quarter on file; wording carries no advice", () => {
  const f = companyFinancials([yr(2025), yr(2024), yr(2023), yr(2022), row({ start: "2026-01-01", end: "2026-03-31", form: "10-Q", filed: "2026-05-01" })])!;
  assert.equal(csvRows("0000000001", f).length, 5);
  const s = summarySentence("Example Corp", f);
  assert.match(s, /^Example Corp reports in U\.S\. dollars\. The tables show 3 fiscal years and one quarter/);
  for (const text of [s, FIN_CAVEAT, ...Object.values(HELD_TEXT)]) {
    assert.doesNotMatch(text, /\b(undervalued|overvalued|cheap|expensive|strong|weak|healthy|score|rating|should|recommend)\b/i);
    assert.ok(!text.includes("—"));
  }
});

test("build log line counts what the pages show", () => {
  const d = emptyFinancials();
  d.byCik.set("0000000001", [yr(2025), yr(2025, { concept: "net_income", value: 716_000_000 }), yr(2025, { concept: "eps_diluted", unit: "USD/shares", value: 790_000 })]);
  d.byCik.set("0000000002", [yr(2025, { unit: "CNY" })]);
  d.byCik.set("0000000003", [yr(2025)]); // not a company on the site
  d.newestFiled = "2026-02-01";
  const line = financialsLog(d, new Set(["0000000001", "0000000002"]));
  assert.match(line, /4 rows read for 3 companies/);
  assert.match(line, /2 companies with a table \(1 not in dollars\)/);
  assert.match(line, /1 figures not shown \(implied_shares 1\)/);
});
