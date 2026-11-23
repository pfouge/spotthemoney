// "Financials, as filed" on stock and company pages (queue item A1, stage 2).
//
// The figures come from the SEC's XBRL "companyfacts" data (table company_financials, migration
// 0032, source sec_company_financials): what a company itself reported in its annual and
// quarterly reports. Rules:
//   - A figure is shown as filed, with its period, its currency and the report it came from.
//     Nothing is estimated, annualised or converted to dollars.
//   - A period is told by its length: 80 to 100 days is a quarter, 350 to 380 days a fiscal
//     year. Half-year and nine-month figures (the year-to-date columns of a quarterly report)
//     are not shown.
//   - Nothing is worked out from two filed figures. A fourth fiscal quarter is not filed on its
//     own, so it has no column; cash-flow figures are filed year-to-date in quarterly reports,
//     so they are in the fiscal-year table only.
//   - A missing figure is a dash, never a guess.
//   - Checks hold a figure back ("not shown") when the filed data looks wrong as stored:
//     earnings per share that imply fewer than MIN_IMPLIED_SHARES shares (usually a figure filed
//     in the wrong scale; now and then real, for a very small company after a reverse split:
//     seen on production, so the wording never says "mistake" outright); total assets
//     that differ from "liabilities and equity" on the same date by more than BALANCE_TOLERANCE;
//     cash larger than total assets. The CSV file keeps the figure as filed and names the check.
//   - No ratio that needs a market price, no score, rating or ranking, no forecast.
//   - Two ratios are worked out by this site (queue item A1-b), each from two lines printed in
//     the SAME column, and labelled as this site's arithmetic with its two inputs named: net
//     margin (net income ÷ revenue) and liabilities to equity (total liabilities ÷ shareholders'
//     equity). A ratio exists only when both figures are printed (on file and not held back) and
//     the figure divided by is above zero; otherwise the cell is a dash (a figure is missing) or
//     "n/a" (the divisor is zero or negative). The two figures can come from different reports
//     (equity is restated in three annual reports, total liabilities in two: on production 46%
//     of pairs), so the rule is "the two figures printed above", not "one report". A ratio feeds
//     no total, filter, sort order or ranking.
//   - Long-term debt is shown only for a company whose fiscal years and quarters on file all give
//     it under ONE heading (XBRL tag), and the line is named after that heading, because the
//     headings measure different things (all long-term debt; the part due after a year; debt
//     with lease obligations; borrowings). A company whose reports use more than one heading has
//     no line and a sentence saying so: on production (2026-11-23) 18 of 137 companies with both
//     "LongTermDebt" and "LongTermDebtNoncurrent" on file state a total smaller than the part
//     due after a year, so the two cannot be put in one row. A debt figure larger than total
//     liabilities on the same date is held back.
//
// Pure: lib/financials-build.ts runs the query and passes rows in. Tests: scripts/financials.test.ts.

export interface FinRow {
  concept: string;
  tag: string;            // taxonomy:Tag as filed
  unit: string;           // USD, USD/shares, CNY ...
  start: string | null;   // null for a balance-sheet date
  end: string;            // YYYY-MM-DD
  value: number;
  form: string;
  filed: string;          // YYYY-MM-DD
  accession: string;
}

export interface FinancialsData {
  /** 10-digit CIK → that company's stored rows (quarter, fiscal-year and balance-sheet rows of the shown concepts). */
  byCik: Map<string, FinRow[]>;
  /** Newest filing date among the rows read, or null. */
  newestFiled: string | null;
}
export const emptyFinancials = (): FinancialsData => ({ byCik: new Map(), newestFiled: null });

export type PeriodKind = "year" | "quarter";
export const YEARS_SHOWN = 3;
export const QUARTERS_SHOWN = 4;
export const QUARTER_DAYS: readonly [number, number] = [80, 100];
export const YEAR_DAYS: readonly [number, number] = [350, 380];
/** Earnings per share that imply fewer shares than this (net income ÷ EPS) are held back. */
export const MIN_IMPLIED_SHARES = 100_000;
/** With no net income filed for the period there is nothing to divide: earnings per share beyond this, either way, are held back. */
export const MAX_EPS_WITHOUT_INCOME = 10_000;
/** Total assets and "liabilities and equity" on one date may differ by this share before assets are held back. */
export const BALANCE_TOLERANCE = 0.005;

export interface ShownConcept { key: string; label: string; flow: boolean; perShare?: boolean; annualOnly?: boolean }
/** The figures a page prints, in order. `flow` = covers a period; otherwise a balance-sheet date. */
export const SHOWN_CONCEPTS: readonly ShownConcept[] = [
  { key: "revenue", label: "Revenue", flow: true },
  { key: "net_income", label: "Net income", flow: true },
  { key: "eps_diluted", label: "Diluted earnings per share", flow: true, perShare: true },
  { key: "operating_cash_flow", label: "Cash from operations", flow: true, annualOnly: true },
  { key: "capex", label: "Capital expenditure", flow: true, annualOnly: true },
  { key: "cash", label: "Cash and equivalents", flow: false },
  { key: "assets", label: "Total assets", flow: false },
  { key: "liabilities", label: "Total liabilities", flow: false },
  { key: "equity", label: "Shareholders' equity", flow: false },
  { key: "long_term_debt", label: "Long-term debt", flow: false },
];
/** The debt line: shown under one heading per company, named after it (DEBT_LABEL). */
export const DEBT_CONCEPT = "long_term_debt";
/** What the line is called, by the heading (XBRL tag) the company filed it under. */
export const DEBT_LABEL: Readonly<Record<string, string>> = {
  "us-gaap:LongTermDebt": "Long-term debt",
  "us-gaap:LongTermDebtNoncurrent": "Long-term debt, not counting the part due within a year",
  "us-gaap:LongTermDebtAndCapitalLeaseObligations": "Long-term debt and lease obligations",
  "ifrs-full:Borrowings": "Borrowings",
};
export const debtLabel = (tag: string | null | undefined) => (tag && DEBT_LABEL[tag]) || "Long-term debt";
/** Read with the shown concepts because a check needs it; in the CSV, not on pages. */
export const CHECK_CONCEPT = "liabilities_and_equity";
/** Every concept the loader reads. */
export const LOADED_CONCEPTS: readonly string[] = [...SHOWN_CONCEPTS.map((c) => c.key), CHECK_CONCEPT];

export type HeldReason = "implied_shares" | "balance" | "cash_over_assets" | "debt_over_liabilities" | "several_headings";
/** Not a doubt about one figure: the company has no debt line at all, and the page says so in a sentence of its own. */
export const NO_LINE_REASON: HeldReason = "several_headings";
export const HELD_TEXT: Record<HeldReason, string> = {
  implied_shares: `the earnings per share as stored would mean the company has fewer than ${MIN_IMPLIED_SHARES.toLocaleString("en-US")} shares`,
  balance: "total assets as stored do not equal liabilities plus equity on the same date",
  cash_over_assets: "cash as stored is larger than total assets on the same date",
  debt_over_liabilities: "long-term debt as stored is larger than total liabilities on the same date",
  several_headings: "the company's reports give long-term debt under more than one heading",
};
export const DEBT_NOTE = "Long-term debt is not shown for this company: its reports give it under more than one heading, and the headings do not measure the same thing. The CSV file has each figure with its heading.";

export interface Cell {
  value: number;
  unit: string;
  tag: string;
  form: string;
  filed: string;
  accession: string;
  held: HeldReason | null;
  /** True when this figure was filed under another tag than the same figure in the table's newest column. */
  tagChanged: boolean;
}
export interface Period {
  kind: PeriodKind;
  start: string | null;
  end: string;
  cells: Record<string, Cell | undefined>;
}
export interface CompanyFinancials {
  /** The currency the company reports in (USD, CNY ...), from its newest filed figure. */
  unit: string;
  years: Period[];     // every fiscal year on file, newest first
  quarters: Period[];  // every quarter filed on its own, newest first
  /** Rows on file in another currency than `unit`, left out. */
  otherUnitRows: number;
  /**
   * Long-term debt: the headings (XBRL tags) it is filed under across every fiscal year and
   * quarter on file. One heading: the line is shown, named after it. Several: no line.
   */
  debtTags: string[];
}

// ── ratios worked out from two printed lines ────────────────────────────────────────────────
export interface RatioDef {
  key: "net_margin" | "liabilities_to_equity";
  /** CSV column. */
  column: string;
  label: string;
  /** The two inputs, in words, printed under the label. */
  inputs: string;
  num: string; den: string;
  /** Printed as a percentage (one decimal) or as a plain number (two decimals). */
  percent: boolean;
  /** Beyond this (either way for a percentage) the cell says so in words; the CSV keeps the number. */
  cap: number;
}
export const RATIOS: readonly RatioDef[] = [
  { key: "net_margin", column: "net_margin_pct", label: "Net margin", inputs: "net income ÷ revenue", num: "net_income", den: "revenue", percent: true, cap: 1000 },
  { key: "liabilities_to_equity", column: "liabilities_to_equity", label: "Liabilities to equity", inputs: "total liabilities ÷ shareholders' equity", num: "liabilities", den: "equity", percent: false, cap: 100 },
];
/** ok: worked out. none: a figure it needs is missing or not shown. base: the figure divided by is zero or negative. */
export type RatioStatus = "ok" | "none" | "base";
export interface RatioCell { status: RatioStatus; value: number | null }
export const RATIO_HEAD = "Worked out by this site from the lines above";
export const RATIO_NA = "n/a";

/** A ratio of two figures of one period, as a page prints it: a percentage rounded to one decimal, or a number rounded to two. */
export function ratioOf(p: Period, r: RatioDef): RatioCell {
  const a = p.cells[r.num], b = p.cells[r.den];
  if (!a || !b || a.held || b.held) return { status: "none", value: null };
  return ratioValue(a.value, b.value, r);
}
/** The same arithmetic on two bare figures (null = missing or not shown): the financials screener
 *  (lib/finscreen.ts) reads its own two figures of a row through this. */
export function ratioValue(a: number | null | undefined, b: number | null | undefined, r: RatioDef): RatioCell {
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return { status: "none", value: null };
  if (!(b > 0)) return { status: "base", value: null };
  const raw = r.percent ? Math.round((a / b) * 1000) / 10 : Math.round((a / b) * 100) / 100;
  return { status: "ok", value: raw === 0 ? 0 : raw };
}
/** "55.6%", "−12.4%", "over 1,000%", "under −1,000%"; "0.40", "over 100". */
export function ratioText(r: RatioDef, v: number): string {
  const cap = r.cap.toLocaleString("en-US");
  if (r.percent) {
    if (v > r.cap) return `over ${cap}%`;
    if (v < -r.cap) return `under −${cap}%`;
    return `${v < 0 ? "−" : ""}${trim(Math.abs(v), 1)}%`;
  }
  if (v > r.cap) return `over ${cap}`;
  return `${v < 0 ? "−" : ""}${trim(Math.abs(v), 2)}`;
}
/** The ratios a table has a line for: at least one of its columns has a value or an "n/a". */
export function shownRatios(cols: readonly Period[]): RatioDef[] {
  return RATIOS.filter((r) => cols.some((p) => ratioOf(p, r).status !== "none"));
}
/** The sentence under the tables, naming the ratios shown. */
export function ratioNote(shown: readonly RatioDef[]): string {
  if (!shown.length) return "";
  const names = shown.map((r) => `${r.label.toLowerCase()} (${r.inputs})`);
  const caps = shown.map((r) => `${r.cap.toLocaleString("en-US")}${r.percent ? "% either way" : ""} for ${r.label.toLowerCase()}`);
  return `${names.join(" and ").replace(/^./, (c) => c.toUpperCase())} ${shown.length === 1 ? "is" : "are"} this site's arithmetic on two lines of the same column, not ${shown.length === 1 ? "a figure" : "figures"} the company filed. A dash means one of the two figures is missing or not shown; "${RATIO_NA}" means the figure divided by is zero or negative, so the result would say nothing. Beyond ${caps.join(" and ")} the cell says so in words, and the CSV file has the number. A ratio describes one period of one company; it is not a verdict on the company and is used in no total or filter on this site.`;
}

const DAY = 86_400_000;
const t0 = (iso: string) => Date.parse(iso + "T00:00:00Z");
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t0(s));
export const daysBetween = (a: string, b: string) => Math.round((t0(b) - t0(a)) / DAY);

/** quarter, year or null, by the length of the period. A balance-sheet date (no start) is null. */
export function periodKind(start: string | null, end: string): PeriodKind | null {
  if (!start || !isDate(start) || !isDate(end)) return null;
  const d = daysBetween(start, end);
  if (d >= QUARTER_DAYS[0] && d <= QUARTER_DAYS[1]) return "quarter";
  if (d >= YEAR_DAYS[0] && d <= YEAR_DAYS[1]) return "year";
  return null;
}

const baseUnit = (unit: string) => unit.replace(/\/shares$/, "");
const newer = (a: FinRow, b: FinRow) => a.filed > b.filed || (a.filed === b.filed && (a.accession > b.accession || (a.accession === b.accession && (a.start ?? "") > (b.start ?? ""))));

/** The currency of the newest filed figure that is not per share; ties go to the currency with more rows. */
export function companyUnit(rows: readonly FinRow[]): string | null {
  const n = new Map<string, { filed: string; rows: number }>();
  for (const r of rows) {
    if (r.unit.endsWith("/shares")) continue;
    const e = n.get(r.unit);
    if (!e) n.set(r.unit, { filed: r.filed, rows: 1 });
    else { e.rows++; if (r.filed > e.filed) e.filed = r.filed; }
  }
  let best: string | null = null;
  for (const [u, e] of n) {
    const b = best ? n.get(best)! : null;
    if (!b || e.filed > b.filed || (e.filed === b.filed && (e.rows > b.rows || (e.rows === b.rows && u < best!)))) best = u;
  }
  return best;
}

function applyChecks(p: Period, le: FinRow | undefined): void {
  const c = p.cells;
  const eps = c["eps_diluted"], ni = c["net_income"];
  if (eps && eps.value !== 0) {
    const implied = ni ? Math.abs(ni.value / eps.value) : null;
    if (implied != null ? implied < MIN_IMPLIED_SHARES && ni!.value !== 0 : Math.abs(eps.value) > MAX_EPS_WITHOUT_INCOME) eps.held = "implied_shares";
  }
  const assets = c["assets"], cash = c["cash"];
  if (assets && le && Math.abs(assets.value - le.value) > BALANCE_TOLERANCE * Math.max(Math.abs(assets.value), 1)) assets.held = "balance";
  if (assets && cash && cash.value > assets.value * 1.001) { cash.held = "cash_over_assets"; if (!assets.held) assets.held = "cash_over_assets"; }
  const debt = c[DEBT_CONCEPT], liab = c["liabilities"];
  if (debt && liab && debt.value > liab.value * 1.001) debt.held = "debt_over_liabilities";
}

/** The headings long-term debt is filed under in the periods given; with more than one, every debt figure is marked and no line is shown. */
function applyDebtRule(periods: Period[]): string[] {
  const tags = [...new Set(periods.map((p) => p.cells[DEBT_CONCEPT]?.tag).filter((t): t is string => !!t))].sort();
  if (tags.length > 1) for (const p of periods) { const c = p.cells[DEBT_CONCEPT]; if (c) c.held = NO_LINE_REASON; }
  return tags;
}
/** True when the company has a long-term debt line: figures on file, all under one heading. */
export const debtShown = (f: CompanyFinancials) => f.debtTags.length === 1;

/**
 * A company's fiscal years and quarters, newest first, from its stored rows. Rows in another
 * currency than the company's own are left out. Each period takes, for a figure covering a
 * period, the row of that length ending that day (newest filing first), and for a balance-sheet
 * figure the row dated that day.
 */
export function companyFinancials(rows: readonly FinRow[]): CompanyFinancials | null {
  const unit = companyUnit(rows);
  if (!unit) return null;
  const mine = rows.filter((r) => baseUnit(r.unit) === unit && isDate(r.end) && Number.isFinite(r.value));
  const flows = new Map<string, FinRow>();   // kind|end|concept
  const points = new Map<string, FinRow>();  // end|concept
  const ends: Record<PeriodKind, Set<string>> = { year: new Set(), quarter: new Set() };
  const shown = new Map(SHOWN_CONCEPTS.map((c) => [c.key, c]));
  for (const r of mine) {
    const sc = shown.get(r.concept);
    if (r.start == null) {
      if ((sc && !sc.flow) || r.concept === CHECK_CONCEPT) { const k = `${r.end}|${r.concept}`; const cur = points.get(k); if (!cur || newer(r, cur)) points.set(k, r); }
      continue;
    }
    if (!sc || !sc.flow) continue;
    if (!!sc.perShare !== r.unit.endsWith("/shares")) continue; // a per-share figure in a money unit, or the reverse
    const kind = periodKind(r.start, r.end);
    if (!kind) continue;
    const k = `${kind}|${r.end}|${r.concept}`;
    const cur = flows.get(k);
    if (!cur || newer(r, cur)) flows.set(k, r);
    ends[kind].add(r.end);
  }
  const cell = (r: FinRow): Cell => ({ value: r.value, unit: r.unit, tag: r.tag, form: r.form, filed: r.filed, accession: r.accession, held: null, tagChanged: false });
  const build = (kind: PeriodKind): Period[] => {
    const minGap = kind === "year" ? 300 : 60;
    const out: Period[] = [];
    for (const end of [...ends[kind]].sort().reverse()) {
      const prev = out.at(-1);
      if (prev && daysBetween(end, prev.end) < minGap) continue; // two periods of one kind ending close together: keep the later
      const p: Period = { kind, start: null, end, cells: {} };
      for (const sc of SHOWN_CONCEPTS) {
        if (sc.flow) {
          if (kind === "quarter" && sc.annualOnly) continue;
          const r = flows.get(`${kind}|${end}|${sc.key}`);
          if (r) { p.cells[sc.key] = cell(r); if (!p.start) p.start = r.start; }
        } else {
          const r = points.get(`${end}|${sc.key}`);
          if (r) p.cells[sc.key] = cell(r);
        }
      }
      applyChecks(p, points.get(`${end}|${CHECK_CONCEPT}`));
      const le = points.get(`${end}|${CHECK_CONCEPT}`);
      if (le) p.cells[CHECK_CONCEPT] = cell(le);
      out.push(p);
    }
    return out;
  };
  const years = build("year"), quarters = build("quarter");
  const debtTags = applyDebtRule([...years, ...quarters]);
  markTagChanges(years.slice(0, YEARS_SHOWN));
  markTagChanges(quarters.slice(0, QUARTERS_SHOWN));
  if (!years.length && !quarters.length) return null;
  return { unit, years, quarters, otherUnitRows: rows.length - rows.filter((r) => baseUnit(r.unit) === unit).length, debtTags };
}

/** Marks, within the columns of one table, a figure filed under another tag than the newest column's. */
export function markTagChanges(cols: Period[]): void {
  for (const sc of SHOWN_CONCEPTS) {
    const first = cols.find((p) => p.cells[sc.key])?.cells[sc.key];
    if (!first) continue;
    for (const p of cols) { const c = p.cells[sc.key]; if (c) c.tagChanged = c.tag !== first.tag; }
  }
}

export const shownYears = (f: CompanyFinancials) => f.years.slice(0, YEARS_SHOWN);
export const shownQuarters = (f: CompanyFinancials) => f.quarters.slice(0, QUARTERS_SHOWN);

/** The address of a filing's index page on EDGAR. */
export function filingUrl(cik: string, accession: string): string | null {
  if (!/^\d{1,10}$/.test(cik) || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/${accession}-index.htm`;
}

export interface SourceFiling { form: string; filed: string; accession: string }
/** The distinct reports a period's printed figures came from, newest first. */
export function sourceFilings(p: Period): SourceFiling[] {
  const seen = new Map<string, SourceFiling>();
  for (const sc of SHOWN_CONCEPTS) { const c = p.cells[sc.key]; if (c && c.held !== NO_LINE_REASON && !seen.has(c.accession)) seen.set(c.accession, { form: c.form, filed: c.filed, accession: c.accession }); }
  return [...seen.values()].sort((a, b) => b.filed.localeCompare(a.filed) || b.accession.localeCompare(a.accession));
}

const trim = (n: number, digits: number) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** "$478.83B", "−$1.2M", "CNY 12.30B". The amount is in the unit given; nothing is converted. */
export function finMoney(value: number, unit: string): string {
  const a = Math.abs(value);
  const body = a >= 1e12 ? `${trim(a / 1e12, 2)}T` : a >= 1e9 ? `${trim(a / 1e9, 2)}B` : a >= 1e6 ? `${trim(a / 1e6, 1)}M` : a >= 1e3 ? `${trim(a / 1e3, 0)}K` : trim(a, 0);
  const u = baseUnit(unit);
  return `${value < 0 ? "−" : ""}${u === "USD" ? "$" : `${u} `}${body}`;
}
/** "$6.43", "−$0.12", "JPY 123.45". */
export function finPerShare(value: number, unit: string): string {
  const u = baseUnit(unit);
  return `${value < 0 ? "−" : ""}${u === "USD" ? "$" : `${u} `}${trim(Math.abs(value), 2)}`;
}
export const cellText = (sc: ShownConcept, c: Cell) => (sc.perShare ? finPerShare(c.value, c.unit) : finMoney(c.value, c.unit));

const longDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export const FIN_CAVEAT = "These are the company's own figures, as it filed them with the SEC, in the currency it reports in. Nothing here is estimated, and a dash means the report did not give that figure under a heading this site reads. A fourth fiscal quarter is not filed on its own, so it has no column, and cash-flow figures are in the fiscal-year table only. This is a record of filings, not advice.";

export function summarySentence(name: string, f: CompanyFinancials): string {
  const y = shownYears(f), q = shownQuarters(f);
  const parts: string[] = [];
  if (y.length) parts.push(`${y.length === 1 ? "one fiscal year" : `${y.length} fiscal years`}`);
  if (q.length) parts.push(`${q.length === 1 ? "one quarter" : `${q.length} quarters`}`);
  const newest = [...y, ...q].flatMap((p) => sourceFilings(p).map((s) => s.filed)).sort().at(-1);
  return `${name} reports in ${f.unit === "USD" ? "U.S. dollars" : f.unit}. The tables show ${parts.join(" and ")} from its annual and quarterly reports${newest ? `; the newest report used was filed on ${longDate(newest)}` : ""}.`;
}

export function heldCount(cols: readonly Period[]): number {
  let n = 0;
  for (const p of cols) for (const sc of SHOWN_CONCEPTS) { const h = p.cells[sc.key]?.held; if (h && h !== NO_LINE_REASON) n++; }
  return n;
}
export function tagChangeCount(cols: readonly Period[]): number {
  let n = 0;
  for (const p of cols) for (const sc of SHOWN_CONCEPTS) if (p.cells[sc.key]?.tagChanged && !p.cells[sc.key]?.held) n++;
  return n;
}

// ── CSV rows ────────────────────────────────────────────────────────────────────────────────
export interface FinCsvRow { cik: string; unit: string; period: Period }
/** One row per company and period: every fiscal year and quarter on file, newest first. */
export function csvRows(cik: string, f: CompanyFinancials): FinCsvRow[] {
  return [...f.years, ...f.quarters].map((period) => ({ cik, unit: f.unit, period }));
}
/** "eps_diluted:implied_shares; assets:balance" for the figures of a period a page would hold back. */
export function heldList(p: Period): string | null {
  const xs = SHOWN_CONCEPTS.filter((sc) => p.cells[sc.key]?.held).map((sc) => `${sc.key}:${p.cells[sc.key]!.held}`);
  return xs.length ? xs.join("; ") : null;
}

/** One line for the build log, for comparison with SQL. */
export function financialsLog(d: FinancialsData, siteCiks: ReadonlySet<string>): string {
  let rows = 0, withTables = 0, years = 0, quarters = 0, held = 0, nonUsd = 0, tagChanged = 0, otherUnit = 0;
  let debtOne = 0, debtSeveral = 0, debtNone = 0, debtFigures = 0;
  const debtBy: Record<string, number> = {};
  const heldBy: Record<string, number> = {};
  const ratios: Record<string, { ok: number; base: number; capped: number; companies: number }> = {};
  for (const [cik, rs] of d.byCik) {
    if (!siteCiks.has(cik)) continue;
    rows += rs.length;
    const f = companyFinancials(rs);
    if (!f) continue;
    withTables++;
    if (f.unit !== "USD") nonUsd++;
    otherUnit += f.otherUnitRows;
    years += f.years.length; quarters += f.quarters.length;
    const cols = [...shownYears(f), ...shownQuarters(f)];
    tagChanged += tagChangeCount(cols);
    for (const p of cols) for (const sc of SHOWN_CONCEPTS) { const h = p.cells[sc.key]?.held; if (h && h !== NO_LINE_REASON) { held++; heldBy[h] = (heldBy[h] ?? 0) + 1; } }
    if (f.debtTags.length === 1) { debtOne++; debtBy[f.debtTags[0]!.replace(/^.*:/, "")] = (debtBy[f.debtTags[0]!.replace(/^.*:/, "")] ?? 0) + 1; }
    else if (f.debtTags.length > 1) debtSeveral++;
    else debtNone++;
    for (const p of [...f.years, ...f.quarters]) {
      if (p.cells[DEBT_CONCEPT]) debtFigures++;
      for (const r of RATIOS) { const x = ratioOf(p, r); const e = (ratios[r.key] ??= { ok: 0, base: 0, capped: 0, companies: 0 }); if (x.status === "ok") { e.ok++; if (Math.abs(x.value!) > r.cap) e.capped++; } else if (x.status === "base") e.base++; }
    }
    for (const r of RATIOS) if ([...f.years, ...f.quarters].some((p) => ratioOf(p, r).status === "ok")) ratios[r.key]!.companies++;
  }
  const rt = RATIOS.map((r) => { const e = ratios[r.key] ?? { ok: 0, base: 0, capped: 0, companies: 0 }; return `${r.label.toLowerCase()} worked out for ${e.ok} periods of ${e.companies} companies (${e.capped} beyond ${r.cap}${r.percent ? "%" : ""}), ${RATIO_NA} for ${e.base}`; }).join("; ");
  const db = Object.entries(debtBy).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(", ");
  const hb = Object.entries(heldBy).sort().map(([k, n]) => `${k} ${n}`).join(", ");
  return `financials (SEC XBRL): ${rows} rows read for ${d.byCik.size} companies, newest filing ${d.newestFiled ?? "none"}; ${withTables} companies with a table (${nonUsd} not in dollars); ${years} fiscal years and ${quarters} quarters on file; on pages: ${held} figures not shown${hb ? ` (${hb})` : ""}, ${tagChanged} filed under a changed tag; ${otherUnit} rows in a second currency left out; long-term debt: ${debtFigures} figures in the periods on file, ${debtOne} companies with a line${db ? ` (${db})` : ""}, ${debtSeveral} with several headings and no line, ${debtNone} with none on file; ratios in the periods on file: ${rt}`;
}
