// Executive pay, as filed: the Pay Versus Performance table of a company's proxy statement, on stock and
// company pages and on /executive-pay/.
//
// Four figures per fiscal year, in dollars, as the company tagged them for the SEC (shared/src/execpay.ts):
// the principal executive officer's total in the Summary Compensation Table and "compensation actually
// paid", and the same two as an average over the other named executive officers. Rules that follow:
//   - Nothing is computed, converted or held back. A missing figure is a dash.
//   - Two sources, one figure each (mergePay): the SEC's XBRL frames data (table exec_pay) first, and
//     where it has no figure for a measure and year, the company's own proxy statement (table
//     exec_pay_proxy), which also carries figures a company tagged with the person they belong to.
//   - A year in which the company reports a principal executive figure for each of several people
//     (the post changed hands) keeps every figure, largest first, in `each`. They are never added
//     together, never ranked, and `values` has no entry for that measure, so no total, filter, sort
//     or tile reads one of them as "the" figure. A zero among several per-person lines is an empty
//     line of the table (a person who did not hold the post that year) and is left out.
//   - A figure that is unusually large or small is marked, not changed (payMarked).
//   - No person's name is shown with these figures (the data names none) and they never appear on
//     insider pages: a principal executive officer's own page would otherwise look like a statement
//     about that person.
//   - Counts and dollars only. No ratio, ranking by quality, score or comparison with a trade.
//
// Pure: lib/execpay-build.ts runs the query and wires the model. Tests: scripts/execpay.test.ts.
import { EXEC_PAY_MEASURES } from "@stm/shared";
import { toCsv, type Column } from "./csv";
import { finMoney } from "./financials";

export const PAY_PATH = "/executive-pay/";
export const PAY_DATA = "/data/executive-pay.json";
/** Fiscal years a company's table shows, newest first. */
export const PAY_YEARS = 4;
export const PAY_CAVEAT =
  "These figures come from the Pay Versus Performance table of the company's proxy statement, as the company tagged them for the SEC. Compensation actually paid is a measure defined by SEC rules that revalues share awards each year. It can be negative and is not the cash a person received. The data names no person. A year in which the post changed hands has a figure for each person, shown apart and never added together, and a company whose proxy statement carries no tagged table is missing.";
export const PAY_MARK_NOTE = "Marked figures are unusually large or small. They are shown as the company tagged them; check the filing.";
/** A figure at or above this size in either direction is marked. */
export const PAY_LARGE = 1_000_000_000;
/** A TOTAL (not "actually paid") between zero and this is marked. */
export const PAY_SMALL = 1_000;

export type PayMeasure = "peo_total" | "peo_actually_paid" | "neo_avg_total" | "neo_avg_actually_paid";
export const PAY_KEYS: readonly PayMeasure[] = ["peo_total", "peo_actually_paid", "neo_avg_total", "neo_avg_actually_paid"];
export const PAY_ROW_LABEL: Record<PayMeasure, string> = {
  peo_total: "Principal executive officer: total, Summary Compensation Table",
  peo_actually_paid: "Principal executive officer: compensation actually paid",
  neo_avg_total: "Other named executive officers, average: total",
  neo_avg_actually_paid: "Other named executive officers, average: compensation actually paid",
};
export const PAY_COLUMN_LABEL: Record<PayMeasure, string> = {
  peo_total: "Principal executive officer, total",
  peo_actually_paid: "Principal executive officer, actually paid",
  neo_avg_total: "Other officers, average total",
  neo_avg_actually_paid: "Other officers, average actually paid",
};
const KNOWN = new Set<string>(EXEC_PAY_MEASURES.map((m) => m.key));

export interface PayYear {
  fiscalYearEnd: string;                        // YYYY-MM-DD
  values: Partial<Record<PayMeasure, number>>;
  accession: string | null;                     // the filing the figures came from (peo_total's, else any)
  /** Principal executive figures when the company reports one for each of several people that year,
   *  largest first (two or more). `values` then has no entry for that measure. */
  each?: Partial<Record<PeoMeasure, number[]>>;
  /** Where the year's figures were read from. Absent means the frames data. */
  from?: PaySource;
}
export type PeoMeasure = "peo_total" | "peo_actually_paid";
export const PEO_KEYS: readonly PeoMeasure[] = ["peo_total", "peo_actually_paid"];
export type PaySource = "frames" | "proxy" | "both";
/** Counts over every company, for the build log. */
export interface PaySources {
  framesFigures: number;      // figures taken from the frames data
  proxyFigures: number;       // single figures taken from a proxy statement (frames had none)
  proxyRows: number;          // proxy-statement rows read
  eachCells: number;          // measure and year cells that hold several figures
  eachYears: number;          // company years with such a cell
  eachCompanies: number;      // companies with such a year
  eachNewest: number;         // companies whose newest year is such a year
  emptyLines: number;         // zero lines left out of per-person figures
  proxyOnlyCompanies: number; // companies with figures only from proxy statements
}
export const emptySources = (): PaySources => ({ framesFigures: 0, proxyFigures: 0, proxyRows: 0, eachCells: 0, eachYears: 0, eachCompanies: 0, eachNewest: 0, emptyLines: 0, proxyOnlyCompanies: 0 });
export interface PayData {
  /** CIK (10 digits) to the company's fiscal years, newest first. */
  byCik: Map<string, PayYear[]>;
  /** Frames rows read, over every company. */
  rows: number;
  newestYearEnd: string | null;
  sources: PaySources;
}
export const emptyPay = (): PayData => ({ byCik: new Map(), rows: 0, newestYearEnd: null, sources: emptySources() });

export const PAY_EACH_NOTE =
  "In a year marked b the company reports a figure for each of several people who held the principal executive officer post that year. Every figure is shown, largest first, and they are never added together. Each line is ordered by size on its own, so figures in the same position on two lines may belong to different people. The filing says who held the post and when.";
/** The figures of a cell that holds several, or [] when the cell holds one figure or none. */
export const eachOf = (y: PayYear, k: PayMeasure): number[] => (k === "peo_total" || k === "peo_actually_paid" ? y.each?.[k] ?? [] : []);
/** Does the year hold any figure at all, single or several? */
export const yearHasFigure = (y: PayYear): boolean => PAY_KEYS.some((k) => y.values[k] != null || eachOf(y, k).length > 0);
/** How many principal executive figures the company reports for the year: 0, 1, or more. */
export const peoFigures = (y: PayYear): number => Math.max(...PEO_KEYS.map((k) => (eachOf(y, k).length || (y.values[k] != null ? 1 : 0))));

// ── two sources into one table ──────────────────────────────────────────────────────────
export interface PayFact { measure: string; fiscalYearEnd: string; value: number; accession: string | null }
export interface ProxyPayFact extends PayFact { seq: number; dimensioned: boolean }

/** What a proxy statement's rows for ONE measure and year say: a single figure, or several.
 *  - a row filed without a person is the figure;
 *  - otherwise the rows are one per person: zero lines are empty lines of the table and are left out;
 *    one figure left is the figure, two or more are kept apart (largest first); all zero is a zero. */
export function proxyFigure(rows: readonly ProxyPayFact[]): { value?: number; each?: number[]; dropped: number } | null {
  const ok = rows.filter((r) => Number.isFinite(r.value));
  if (!ok.length) return null;
  const plain = ok.filter((r) => !r.dimensioned).sort((a, b) => a.seq - b.seq)[0];
  if (plain) return { value: plain.value, dropped: 0 };
  const nz = ok.map((r) => r.value).filter((v) => v !== 0).sort((a, b) => b - a);
  if (nz.length === 0) return { value: 0, dropped: ok.length - 1 };
  if (nz.length === 1) return { value: nz[0]!, dropped: ok.length - 1 };
  return { each: nz, dropped: ok.length - nz.length };
}

/** One company's fiscal years from its frames rows and its proxy-statement rows, newest first. */
export function mergePay(frames: readonly PayFact[], proxy: readonly ProxyPayFact[], stats: PaySources = emptySources()): PayYear[] {
  interface E { y: PayYear; peoAcc: string | null; f: boolean; p: boolean }
  const years = new Map<string, E>();
  const at = (fye: string): E => {
    let e = years.get(fye);
    if (!e) years.set(fye, (e = { y: { fiscalYearEnd: fye, values: {}, accession: null }, peoAcc: null, f: false, p: false }));
    return e;
  };
  const other = (e: E, acc: string | null) => { if (acc && (!e.y.accession || acc > e.y.accession)) e.y.accession = acc; };
  for (const r of frames) {
    if (!isPayMeasure(r.measure) || !isDate(r.fiscalYearEnd) || r.value == null || !Number.isFinite(Number(r.value))) continue;
    const e = at(r.fiscalYearEnd);
    e.y.values[r.measure] = Number(r.value);
    e.f = true;
    stats.framesFigures++;
    if (r.measure === "peo_total") e.peoAcc = r.accession; else other(e, r.accession);
  }
  const groups = new Map<string, ProxyPayFact[]>();
  for (const r of proxy) {
    if (!isPayMeasure(r.measure) || !isDate(r.fiscalYearEnd)) continue;
    const k = `${r.fiscalYearEnd}|${r.measure}`;
    const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]);
  }
  for (const [k, rows] of groups) {
    const [fye, measure] = k.split("|") as [string, PayMeasure];
    if (years.get(fye)?.y.values[measure] != null) continue;      // the frames data has this figure
    const fig = proxyFigure(rows);
    if (!fig) continue;
    const e = at(fye);
    const acc = [...rows].sort((a, b) => a.seq - b.seq)[0]!.accession;
    if (fig.each && (measure === "peo_total" || measure === "peo_actually_paid")) { (e.y.each ??= {})[measure] = fig.each; stats.eachCells++; }
    else if (fig.value != null) { e.y.values[measure] = fig.value; stats.proxyFigures++; }
    else continue;                                                // several figures for an average: not a thing the table has
    stats.emptyLines += fig.dropped;
    e.p = true;
    if (measure === "peo_total") e.peoAcc = acc; else other(e, acc);
  }
  const out = sortYears([...years.values()].map((e) => ({ ...e.y, accession: e.peoAcc ?? e.y.accession, from: (e.f && e.p ? "both" : e.p ? "proxy" : "frames") as PaySource })));
  const several = out.filter((y) => y.each && PEO_KEYS.some((m) => (y.each![m]?.length ?? 0) > 0));
  stats.eachYears += several.length;
  if (several.length) stats.eachCompanies++;
  if (out[0] && several.includes(out[0])) stats.eachNewest++;
  if (out.length && out.every((y) => y.from === "proxy")) stats.proxyOnlyCompanies++;
  return out;
}

const n = (x: number) => x.toLocaleString("en-US");
const pl = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const isPayMeasure = (m: string): m is PayMeasure => KNOWN.has(m);
export const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const shortDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

/** Dollars as the table prints them: "$21.40M", "−$3.1M". */
export const payMoney = (v: number): string => finMoney(v, "USD");

/** Is a figure marked? A figure of $1 billion or more in either direction; or a TOTAL between 0 and $1,000. */
export function payMarked(measure: PayMeasure, value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  if (Math.abs(value) >= PAY_LARGE) return true;
  const total = measure === "peo_total" || measure === "neo_avg_total";
  return total && value >= 0 && value < PAY_SMALL;
}
export const yearMarked = (y: PayYear): boolean => PAY_KEYS.some((k) => payMarked(k, y.values[k]) || eachOf(y, k).some((v) => payMarked(k, v)));

/** Fiscal years newest first; a year end that is not a date is dropped. */
export const sortYears = (ys: readonly PayYear[]): PayYear[] => ys.filter((y) => isDate(y.fiscalYearEnd)).sort((a, b) => b.fiscalYearEnd.localeCompare(a.fiscalYearEnd));
export const shownYears = (ys: readonly PayYear[]): PayYear[] => sortYears(ys).slice(0, PAY_YEARS);

/** The folder of a filing on EDGAR: https://www.sec.gov/Archives/edgar/data/<cik>/<accession without dashes>/ */
export function payFilingUrl(cik: string, accession: string | null): string | null {
  if (!accession || !/^\d{10}$/.test(cik) || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/`;
}

/** The sentence over a company's table: counts and a date. */
export function paySummary(name: string, ys: readonly PayYear[]): string {
  const all = sortYears(ys);
  if (!all.length) return "";
  const shown = Math.min(all.length, PAY_YEARS);
  return `${name} has executive pay figures on file for ${pl(all.length, "fiscal year")}, the newest ending ${longDate(all[0]!.fiscalYearEnd)}. The table shows ${shown === 1 ? "that year" : `the newest ${n(shown)}`}.`;
}
/** The glance tile: the principal executive officer's newest total, when there is one. */
export function payGlance(ys: readonly PayYear[]): { value: string; note: string } | null {
  const y = sortYears(ys)[0];
  const v = y?.values.peo_total;
  if (!y || v == null) return null;
  return { value: payMoney(v), note: `year ending ${shortDate(y.fiscalYearEnd)}` };
}

// ── the hub: /executive-pay/ ─────────────────────────────────────────────────────────────
export const PER_PAGE = [25, 50, 100] as const;
export const DEFAULT_PER = 50;
export const MIN_STEPS = [1_000_000, 10_000_000, 50_000_000, 100_000_000] as const;
export const MIN_LABEL: Record<number, string> = { 1_000_000: "$1M or more", 10_000_000: "$10M or more", 50_000_000: "$50M or more", 100_000_000: "$100M or more" };
export const SORT_KEYS = ["company", "year", "peo_total", "peo_actually_paid", "neo_avg_total", "neo_avg_actually_paid"] as const;
export type PaySortKey = (typeof SORT_KEYS)[number];

export interface PayHubCompany { name: string; path: string; ticker: string; cik: string; division: { name: string; slug: string } | null }
/** A row: [company index, fiscal year end, four figures (null when missing), accession or "", and, only
 *  when the year holds several principal executive figures, how many for the total and for actually paid]. */
export type PackedPay = [number, string, number | null, number | null, number | null, number | null, string, number?, number?];
export interface PayHubData {
  built: string;
  divisions: { name: string; slug: string }[];
  companies: [string, string, string, string, number][];
  rows: PackedPay[];
  /** Companies with a page, for the coverage sentence. */
  pages: number;
}
export interface PayHubRow { c: PayHubCompany; fye: string; v: Record<PayMeasure, number | null>; accession: string | null; marked: boolean; each: Record<PeoMeasure, number> }
/** What a list cell says when the year holds several figures: a count, never one of the figures. */
export const eachCellText = (count: number): string => `${n(count)} figures`;
export const PAY_HUB_EACH_NOTE = "A count such as \"2 figures\" in a principal executive officer column means the company reports a figure for each of several people who held the post in that year. The company's page lists every figure; none is added to another, and such a row has no figure in that column for sorting or the size filter.";
/** The sentence over the list about such rows, or "" when there are none. */
export function payEachSentence(rows: readonly PayHubRow[]): string {
  const k = rows.filter((r) => r.each.peo_total > 0 || r.each.peo_actually_paid > 0).length;
  if (!k) return "";
  return `${k === 1 ? "1 of these companies reports" : `${n(k)} of these companies report`} principal executive figures for more than one person in the newest year; the row then shows how many figures there are, and the company's page lists each.`;
}

export function packPayHub(built: string, companies: readonly PayHubCompany[], pay: ReadonlyMap<string, readonly PayYear[]>): PayHubData {
  const divisions: { name: string; slug: string }[] = [];
  const dix = new Map<string, number>();
  for (const c of [...companies].sort((a, b) => (a.division?.name ?? "").localeCompare(b.division?.name ?? ""))) {
    if (c.division && !dix.has(c.division.slug)) dix.set(c.division.slug, divisions.push(c.division) - 1);
  }
  const rows: PackedPay[] = [];
  const cs: PayHubData["companies"] = [];
  for (const c of companies) {
    const y = sortYears(pay.get(c.cik) ?? [])[0];
    if (!y || !yearHasFigure(y)) continue;
    const ci = cs.push([c.name, c.path, c.ticker, c.cik, c.division ? dix.get(c.division.slug)! : -1]) - 1;
    const row: PackedPay = [ci, y.fiscalYearEnd, y.values.peo_total ?? null, y.values.peo_actually_paid ?? null, y.values.neo_avg_total ?? null, y.values.neo_avg_actually_paid ?? null, y.accession ?? ""];
    const et = eachOf(y, "peo_total").length, ea = eachOf(y, "peo_actually_paid").length;
    if (et || ea) row.push(et, ea);
    rows.push(row);
  }
  rows.sort((a, b) => (b[2] ?? -Infinity) - (a[2] ?? -Infinity) || cs[a[0]]![0].localeCompare(cs[b[0]]![0]));
  return { built, divisions, companies: cs, rows, pages: companies.length };
}
export function unpackPayHub(d: PayHubData): PayHubRow[] {
  const cos: PayHubCompany[] = d.companies.map((c) => ({ name: c[0], path: c[1], ticker: c[2], cik: c[3], division: d.divisions[c[4]] ?? null }));
  return d.rows.map((r) => {
    const v: Record<PayMeasure, number | null> = { peo_total: r[2], peo_actually_paid: r[3], neo_avg_total: r[4], neo_avg_actually_paid: r[5] };
    return { c: cos[r[0]]!, fye: r[1], v, accession: r[6] || null, marked: PAY_KEYS.some((k) => payMarked(k, v[k])), each: { peo_total: r[7] ?? 0, peo_actually_paid: r[8] ?? 0 } };
  });
}

export interface PayFilter { q: string; division: string; fy: string; min: number }
export const NO_PAY_FILTER: PayFilter = { q: "", division: "", fy: "", min: 0 };
export interface PayView { f: PayFilter; sort: PaySortKey; dir: "asc" | "desc"; page: number; per: number }
export const DEFAULT_PAY_VIEW: PayView = { f: NO_PAY_FILTER, sort: "peo_total", dir: "desc", page: 1, per: DEFAULT_PER };
export const firstPayDir = (k: PaySortKey): "asc" | "desc" => (k === "company" ? "asc" : "desc");
export const fyOf = (fye: string): string => fye.slice(0, 4);

export function payMatches(r: PayHubRow, f: PayFilter): boolean {
  if (f.division && r.c.division?.slug !== f.division) return false;
  if (f.fy && fyOf(r.fye) !== f.fy) return false;
  if (f.min > 0 && !(r.v.peo_total != null && r.v.peo_total >= f.min)) return false;
  const q = f.q.trim().toLowerCase();
  if (q) { const hay = `${r.c.name} ${r.c.ticker}`.toLowerCase(); for (const word of q.split(/\s+/)) if (!hay.includes(word)) return false; }
  return true;
}
/** A missing figure sorts last in both directions; ties by company name, then CIK. */
export function sortPay(rows: readonly PayHubRow[], k: PaySortKey, dir: "asc" | "desc"): PayHubRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const tie = (a: PayHubRow, b: PayHubRow) => a.c.name.toLowerCase().localeCompare(b.c.name.toLowerCase()) || a.c.cik.localeCompare(b.c.cik);
  return [...rows].sort((a, b) => {
    if (k === "company") return sign * a.c.name.toLowerCase().localeCompare(b.c.name.toLowerCase()) || a.c.cik.localeCompare(b.c.cik);
    if (k === "year") return a.fye !== b.fye ? (a.fye < b.fye ? -sign : sign) : tie(a, b);
    const x = a.v[k], y = b.v[k];
    if (x == null && y == null) return tie(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return x !== y ? (x < y ? -sign : sign) : tie(a, b);
  });
}
export interface PayResult { rows: PayHubRow[]; total: number; all: number; page: number; pages: number; from: number; to: number }
export function payScreen(all: readonly PayHubRow[], v: PayView): PayResult {
  const sorted = sortPay(all.filter((r) => payMatches(r, v.f)), v.sort, v.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / v.per));
  const page = Math.min(Math.max(1, v.page), pages);
  const from = (page - 1) * v.per;
  const rows = sorted.slice(from, from + v.per);
  return { rows, total: sorted.length, all: all.length, page, pages, from: rows.length ? from + 1 : 0, to: from + rows.length };
}
export function paySummaryLine(r: PayResult): string {
  if (r.total === 0) return r.all === 0 ? "No figures are on file yet." : "No company matches these filters.";
  return `${pl(r.total, "company", "companies")}. Showing ${n(r.from)} to ${n(r.to)}.`;
}
/** "about 8 in 10", "nearly all"; "" when there is nothing to say. */
export function payShareWords(withFigures: number, withPage: number): string {
  if (withPage <= 0 || withFigures <= 0) return "";
  const share = withFigures / withPage;
  return share >= 0.95 ? "nearly all" : `about ${Math.max(1, Math.round(share * 10))} in 10`;
}
export function payCoverageSentence(withFigures: number, withPage: number): string {
  if (withPage <= 0) return "";
  const frac = payShareWords(withFigures, withPage);
  return `${n(withFigures)} of the ${n(withPage)} companies with a page on this site have figures on file, ${frac}. The rest have no proxy statement with a tagged Pay Versus Performance table in the SEC's data: funds, foreign companies and others that file no proxy statement, and companies whose proxy statement carries no such table.`;
}
export function fiscalYearOptions(all: readonly PayHubRow[]): { fy: string; companies: number }[] {
  const by = new Map<string, number>();
  for (const r of all) by.set(fyOf(r.fye), (by.get(fyOf(r.fye)) ?? 0) + 1);
  return [...by].map(([fy, companies]) => ({ fy, companies })).sort((a, b) => b.fy.localeCompare(a.fy));
}

export const PAY_HUB_KEYS = ["q", "division", "fy", "min", "sort", "dir", "page", "n"];
export function isPayViewHash(hash: string): boolean {
  if (!hash.includes("=")) return false;
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return PAY_HUB_KEYS.some((k) => p.has(k));
}
export function parsePayHash(hash: string): PayView {
  const f: PayFilter = { ...NO_PAY_FILTER };
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const dv = (p.get("division") ?? "").toLowerCase(); if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dv) && dv.length <= 80) f.division = dv;
  const fy = p.get("fy") ?? ""; if (/^\d{4}$/.test(fy)) f.fy = fy;
  const mn = Number(p.get("min")); if ((MIN_STEPS as readonly number[]).includes(mn)) f.min = mn;
  f.q = (p.get("q") ?? "").slice(0, 60);
  const so = p.get("sort") ?? ""; const sort = (SORT_KEYS as readonly string[]).includes(so) ? (so as PaySortKey) : DEFAULT_PAY_VIEW.sort;
  const di = p.get("dir"); const dir = di === "asc" || di === "desc" ? di : firstPayDir(sort);
  const pg = Number(p.get("page")); const page = Number.isInteger(pg) && pg >= 1 && pg <= 100000 ? pg : 1;
  const pe = Number(p.get("n")); const per = (PER_PAGE as readonly number[]).includes(pe) ? pe : DEFAULT_PER;
  return { f, sort, dir, page, per };
}
export function toPayHash(v: PayView): string {
  const p = new URLSearchParams(), f = v.f;
  if (f.division) p.set("division", f.division);
  if (f.fy) p.set("fy", f.fy);
  if (f.min) p.set("min", String(f.min));
  if (f.q.trim()) p.set("q", f.q.trim());
  if (v.sort !== DEFAULT_PAY_VIEW.sort || v.dir !== firstPayDir(v.sort)) { p.set("sort", v.sort); p.set("dir", v.dir); }
  if (v.page > 1) p.set("page", String(v.page));
  if (v.per !== DEFAULT_PER) p.set("n", String(v.per));
  const s = p.toString();
  return s ? `#${s}` : "";
}

// ── files ────────────────────────────────────────────────────────────────────────────────
export interface PayCsvRow { company: string; cik: string; ticker: string; pagePath: string | null; y: PayYear }
export const PAY_CSV_COLUMNS: Column<PayCsvRow>[] = [
  { key: "company", about: "The company, as this site names it", get: (r) => r.company },
  { key: "cik", about: "The company's SEC number, ten digits", get: (r) => r.cik },
  { key: "ticker", about: "The company's main ticker on this site", get: (r) => r.ticker },
  { key: "fiscal_year_end", about: "Last day of the fiscal year the figures cover", get: (r) => r.y.fiscalYearEnd },
  { key: "peo_total", about: "Principal executive officer, total in the Summary Compensation Table, dollars", get: (r) => r.y.values.peo_total ?? null },
  { key: "peo_actually_paid", about: "Principal executive officer, compensation actually paid, dollars (can be negative)", get: (r) => r.y.values.peo_actually_paid ?? null },
  { key: "neo_avg_total", about: "Other named executive officers, average total, dollars", get: (r) => r.y.values.neo_avg_total ?? null },
  { key: "neo_avg_actually_paid", about: "Other named executive officers, average compensation actually paid, dollars", get: (r) => r.y.values.neo_avg_actually_paid ?? null },
  { key: "marked", about: "true when a figure is unusually large or small and the pages mark it", get: (r) => yearMarked(r.y) },
  { key: "accession", about: "Accession number of the filing the figures came from", get: (r) => r.y.accession },
  { key: "source_url", about: "The filing's folder at the SEC", get: (r) => payFilingUrl(r.cik, r.y.accession) },
  { key: "page_url", about: "The company's page on this site", get: (r) => r.pagePath },
  { key: "peo_figures", about: "How many principal executive officer figures the company reports for the year: 1 as a rule, more when the post changed hands, 0 when none is on file", get: (r) => peoFigures(r.y) },
  { key: "peo_total_each", about: "Only when peo_figures is above 1: each person's total, dollars, largest first, separated by semicolons (no person is named; never added together; peo_total is then empty)", get: (r) => eachOf(r.y, "peo_total").map((v) => String(v)).join(";") || null },
  { key: "peo_actually_paid_each", about: "Only when peo_figures is above 1: each person's compensation actually paid, dollars, largest first, separated by semicolons (ordered on its own, so positions do not match peo_total_each)", get: (r) => eachOf(r.y, "peo_actually_paid").map((v) => String(v)).join(";") || null },
  { key: "read_from", about: "Where the year's figures were read: frames (the SEC's XBRL frames data), proxy (the company's proxy statement) or both", get: (r) => r.y.from ?? "frames" },
];
// The list's own download has the count of figures, not each figure and not the source: the data file it is made from carries neither.
const HUB_CSV_SKIP = new Set(["peo_figures", "peo_total_each", "peo_actually_paid_each", "read_from"]);
const HUB_CSV: Column<PayHubRow>[] = PAY_CSV_COLUMNS.map((c) => ({
  ...c,
  get: (r: PayHubRow) => c.get({
    company: r.c.name, cik: r.c.cik, ticker: r.c.ticker, pagePath: r.c.path ? `https://spotthemoney.com${r.c.path}` : null,
    y: { fiscalYearEnd: r.fye, accession: r.accession, values: Object.fromEntries(PAY_KEYS.filter((k) => r.v[k] != null).map((k) => [k, r.v[k] as number])) },
  }),
})).filter((c) => !HUB_CSV_SKIP.has(c.key)).concat([
  { key: "peo_figures", about: "How many principal executive officer figures the company reports for the year", get: (r: PayHubRow) => Math.max(r.each.peo_total, r.each.peo_actually_paid) || (r.v.peo_total != null || r.v.peo_actually_paid != null ? 1 : 0) },
]);
export function payViewCsv(all: readonly PayHubRow[], v: PayView): string {
  return toCsv(HUB_CSV, sortPay(all.filter((r) => payMatches(r, v.f)), v.sort, v.dir));
}
export function payViewCsvName(v: PayView, built: string): string {
  const f = v.f;
  const bits = [f.division, f.fy ? `fy${f.fy}` : "", f.min ? `min${f.min}` : "", f.q.trim() ? "filtered" : ""].filter(Boolean).map((b) => String(b).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return `executive-pay-${bits.length ? bits.join("-") + "-" : ""}${built}.csv`;
}

/** One line for the build log, for comparison with SQL. */
export function payLog(d: PayData, companyCiks: ReadonlySet<string>): string {
  let rows = 0, cos = 0, marked = 0, over = 0, neoOnly = 0, newest = "";
  for (const [cik, ys] of d.byCik) {
    if (!companyCiks.has(cik)) continue;
    cos++;
    rows += ys.reduce((s, y) => s + PAY_KEYS.filter((k) => y.values[k] != null || eachOf(y, k).length > 0).length, 0);
    if (ys.length > PAY_YEARS) over++;
    if (!ys.some((y) => y.values.peo_total != null)) neoOnly++;
    for (const y of shownYears(ys)) for (const k of PAY_KEYS) { if (payMarked(k, y.values[k])) marked++; marked += eachOf(y, k).filter((v) => payMarked(k, v)).length; }
    for (const y of ys) if (y.fiscalYearEnd > newest) newest = y.fiscalYearEnd;
  }
  const s = d.sources;
  return `executive pay (Pay Versus Performance): ${d.rows} frames rows and ${s.proxyRows} proxy-statement rows read; ${rows} measure and year cells for ${cos} companies on the site, newest year end ${newest || "none"}; ${over} companies with more than ${PAY_YEARS} years; ${neoOnly} with no single principal executive total; ${marked} marked figures in the tables; sources: ${s.framesFigures} figures from frames, ${s.proxyFigures} from proxy statements, ${s.proxyOnlyCompanies} companies only from proxy statements; several principal executive figures: ${s.eachCells} cells in ${s.eachYears} company years of ${s.eachCompanies} companies, ${s.eachNewest} of them in the newest year; ${s.emptyLines} zero lines left out`;
}
