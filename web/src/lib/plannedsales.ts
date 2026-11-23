// Planned sales hub (/planned-sales/): every Form 144 notice filed in the last 12 months about a
// company with a page on this site, in one table. Built after the company financials screener:
// the page prints the first rows, a packed data file and a browser script do the rest.
// Rules (lib/form144.ts holds the notice rules; this file only arranges them):
//   - A notice is a plan, never a sale. No shares or dollars are added up anywhere on the hub: an
//     amendment (144/A) repeats the notice it corrects, so the count line counts notices,
//     companies and sellers only.
//   - A stated value over VALUE_MAX_PER_SHARE a share is "not shown"; it passes no value filter.
//   - A seller links to an insider page only when the filer number belongs to exactly one person
//     with a page (sellerPath). The name shown is the notice's own.
//   - Windows count back from the build day by filing date; the filing date is never in the future.
import { toCsv, type Column } from "./csv";
import { DEFAULT_PER, PER_PAGE, inWindow, isDay, nf, paginate, plural, shortDate, slugLike, sortRows, type Page } from "./hubscreen";

export const PLANNED_PATH = "/planned-sales/";
export const PLANNED_DATA = "/data/planned-sales.json";

/** [filed, amendment 0|1, company index, seller index, relationship or "", shares or null, shown value or null,
 *  held back 0|1, approximate sale date or "", plan adoption date or "", accession, notice URL or ""] */
export type PackedNotice = [string, 0 | 1, number, number, string, number | null, number | null, 0 | 1, string, string, string, string];
export interface PlannedData {
  built: string;
  divisions: { name: string; slug: string }[];
  /** [name, page path, ticker, SEC number, division index or -1] */
  companies: [string, string, string, string, number][];
  /** [name as filed, insider page path or "", key] */
  sellers: [string, string, string][];
  rows: PackedNotice[];
}
export interface PsCompany { name: string; path: string; ticker: string; cik: string; division: { name: string; slug: string } | null }
export interface PsSeller { name: string; path: string | null; key: string }
export interface PsRow {
  filed: string; amend: boolean; c: PsCompany; s: PsSeller; relationship: string | null;
  shares: number | null; value: number | null; held: boolean; sale: string | null; plan: string | null; accession: string; url: string | null;
}
export interface PsIn { filed: string; amend: boolean; company: PsCompany; seller: PsSeller; relationship: string | null; shares: number | null; value: number | null; held: boolean; sale: string | null; plan: string | null; accession: string; url: string | null }

/** Pack rows with a dictionary of companies and sellers so each is written once. */
export function packPlanned(built: string, rows: readonly PsIn[]): PlannedData {
  const divs: { name: string; slug: string }[] = [], dIdx = new Map<string, number>();
  const cos: PlannedData["companies"] = [], cIdx = new Map<string, number>();
  const sel: PlannedData["sellers"] = [], sIdx = new Map<string, number>();
  const out: PackedNotice[] = [];
  for (const r of rows) {
    let ci = cIdx.get(r.company.cik);
    if (ci == null) {
      let di = -1;
      if (r.company.division) { di = dIdx.get(r.company.division.slug) ?? -1; if (di < 0) { di = divs.length; divs.push(r.company.division); dIdx.set(r.company.division.slug, di); } }
      ci = cos.length; cos.push([r.company.name, r.company.path, r.company.ticker, r.company.cik, di]); cIdx.set(r.company.cik, ci);
    }
    let si = sIdx.get(r.seller.key);
    if (si == null) { si = sel.length; sel.push([r.seller.name, r.seller.path ?? "", r.seller.key]); sIdx.set(r.seller.key, si); }
    out.push([r.filed, r.amend ? 1 : 0, ci, si, r.relationship ?? "", r.shares, r.value, r.held ? 1 : 0, r.sale ?? "", r.plan ?? "", r.accession, r.url ?? ""]);
  }
  divs.sort((a, b) => a.name.localeCompare(b.name));
  // division indexes were assigned before sorting: remap
  const old = [...dIdx.entries()];
  const order = new Map(divs.map((d, i) => [d.slug, i]));
  const remap = new Map(old.map(([slug, i]) => [i, order.get(slug) ?? -1]));
  for (const c of cos) c[4] = c[4] < 0 ? -1 : remap.get(c[4]) ?? -1;
  return { built, divisions: divs, companies: cos, sellers: sel, rows: out };
}

export function unpackPlanned(d: PlannedData): PsRow[] {
  const cos: PsCompany[] = d.companies.map((c) => ({ name: c[0], path: c[1], ticker: c[2], cik: c[3], division: c[4] >= 0 ? d.divisions[c[4]] ?? null : null }));
  const sel: PsSeller[] = d.sellers.map((s) => ({ name: s[0], path: s[1] || null, key: s[2] }));
  return d.rows.map((r) => ({
    filed: r[0], amend: r[1] === 1, c: cos[r[2]], s: sel[r[3]], relationship: r[4] || null, shares: r[5], value: r[6], held: r[7] === 1,
    sale: r[8] || null, plan: r[9] || null, accession: r[10], url: r[11] || null,
  }));
}

// ── filters, sort, view ──────────────────────────────────────────────────────────────────
export const WINDOWS = [7, 30, 90, 365] as const;
export const WINDOW_LABEL: Record<number, string> = { 7: "Filed in the last 7 days", 30: "Filed in the last 30 days", 90: "Filed in the last 90 days", 365: "Filed in the last 12 months" };
export const VALUE_STEPS = [100_000, 1_000_000, 10_000_000, 100_000_000] as const;
export const valueStepLabel = (s: number): string => (s >= 1e6 ? `$${nf(s / 1e6)} million or more` : `$${nf(s)} or more`);
export const FORMS = ["notice", "amendment"] as const;
export const FORM_LABEL: Record<string, string> = { notice: "Notices (Form 144)", amendment: "Amendments (144/A)" };
export const PLANS = ["yes", "no"] as const;
export const PLAN_LABEL: Record<string, string> = { yes: "States a 10b5-1 plan date", no: "States no plan date" };
export const SORT_KEYS = ["filed", "company", "seller", "shares", "value", "sale", "plan"] as const;
export type PsSortKey = (typeof SORT_KEYS)[number];

export interface PsFilter { q: string; division: string; form: "" | "notice" | "amendment"; plan: "" | "yes" | "no"; min: number; w: number }
export const DEFAULT_WINDOW = 30;
export const NO_PS_FILTER: PsFilter = { q: "", division: "", form: "", plan: "", min: 0, w: DEFAULT_WINDOW };
export interface PsView { f: PsFilter; sort: PsSortKey; dir: "asc" | "desc"; page: number; per: number }
export const DEFAULT_PS_VIEW: PsView = { f: NO_PS_FILTER, sort: "filed", dir: "desc", page: 1, per: DEFAULT_PER };

export function psMatches(r: PsRow, f: PsFilter, built: string): boolean {
  if (!inWindow(r.filed, built, f.w)) return false;
  if (f.division && r.c.division?.slug !== f.division) return false;
  if (f.form === "notice" && r.amend) return false;
  if (f.form === "amendment" && !r.amend) return false;
  if (f.plan === "yes" && !r.plan) return false;
  if (f.plan === "no" && r.plan) return false;
  if (f.min > 0 && (r.value == null || r.value < f.min)) return false; // a held-back or blank value passes no value filter
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${r.c.name} ${r.c.ticker} ${r.s.name}`.toLowerCase();
    for (const word of q.split(/\s+/)) if (!hay.includes(word)) return false;
  }
  return true;
}
export const firstPsDir = (k: PsSortKey): "asc" | "desc" => (k === "company" || k === "seller" ? "asc" : "desc");
const sortValue = (r: PsRow, k: PsSortKey): number | string | null =>
  k === "filed" ? r.filed : k === "company" ? r.c.name.toLowerCase() : k === "seller" ? r.s.name.toLowerCase()
    : k === "shares" ? r.shares : k === "value" ? r.value : k === "sale" ? r.sale : r.plan;
const tie = (a: PsRow, b: PsRow): number => b.filed.localeCompare(a.filed) || (a.accession < b.accession ? 1 : a.accession > b.accession ? -1 : 0);
export function sortPs(rows: readonly PsRow[], k: PsSortKey, dir: "asc" | "desc"): PsRow[] { return sortRows(rows, (r) => sortValue(r, k), dir, tie); }

export interface PsResult extends Page<PsRow> { companies: number; sellers: number; all: number }
export function plannedScreen(all: readonly PsRow[], v: PsView, built: string): PsResult {
  const hits = sortPs(all.filter((r) => psMatches(r, v.f, built)), v.sort, v.dir);
  const pg = paginate(hits, v.page, v.per);
  return { ...pg, companies: new Set(hits.map((r) => r.c.cik)).size, sellers: new Set(hits.map((r) => r.s.key)).size, all: all.length };
}
/** The count line. Counts only: no shares or dollars are added up. */
export function psSummaryLine(r: PsResult): string {
  if (r.total === 0) return r.all === 0 ? "No Form 144 notices are on file yet." : "No notice matches these filters.";
  return `${plural(r.total, "notice", "notices")} about ${plural(r.companies, "company", "companies")} from ${plural(r.sellers, "seller", "sellers")}. Showing ${nf(r.from)} to ${nf(r.to)}.`;
}

// ── the address ─────────────────────────────────────────────────────────────────────────
export const PS_KEYS = ["q", "division", "form", "plan", "min", "w", "sort", "dir", "page", "n"];
export const isPsViewHash = (hash: string): boolean => hash.includes("=") && PS_KEYS.some((k) => new URLSearchParams(hash.replace(/^#/, "")).has(k));
export function isDefaultPsFilter(f: PsFilter): boolean { return !f.q.trim() && !f.division && !f.form && !f.plan && !f.min && f.w === DEFAULT_WINDOW; }
export function parsePsHash(hash: string): PsView {
  const p = new URLSearchParams(hash.replace(/^#/, "")), f: PsFilter = { ...NO_PS_FILTER };
  const dv = (p.get("division") ?? "").toLowerCase(); if (slugLike(dv)) f.division = dv;
  const fm = p.get("form"); if (fm === "notice" || fm === "amendment") f.form = fm;
  const pl = p.get("plan"); if (pl === "yes" || pl === "no") f.plan = pl;
  const mn = Number(p.get("min")); if ((VALUE_STEPS as readonly number[]).includes(mn)) f.min = mn;
  const w = Number(p.get("w")); if ((WINDOWS as readonly number[]).includes(w)) f.w = w;
  f.q = (p.get("q") ?? "").slice(0, 60);
  const so = p.get("sort") ?? ""; const sort = (SORT_KEYS as readonly string[]).includes(so) ? (so as PsSortKey) : DEFAULT_PS_VIEW.sort;
  const di = p.get("dir"); const dir = di === "asc" || di === "desc" ? di : firstPsDir(sort);
  const pg = Number(p.get("page")); const page = Number.isInteger(pg) && pg >= 1 && pg <= 100000 ? pg : 1;
  const n = Number(p.get("n")); const per = (PER_PAGE as readonly number[]).includes(n) ? n : DEFAULT_PER;
  return { f, sort, dir, page, per };
}
export function toPsHash(v: PsView): string {
  const p = new URLSearchParams(), f = v.f;
  if (f.division) p.set("division", f.division);
  if (f.form) p.set("form", f.form);
  if (f.plan) p.set("plan", f.plan);
  if (f.min) p.set("min", String(f.min));
  if (f.w !== DEFAULT_WINDOW) p.set("w", String(f.w));
  if (f.q.trim()) p.set("q", f.q.trim());
  if (v.sort !== DEFAULT_PS_VIEW.sort || v.dir !== firstPsDir(v.sort)) { p.set("sort", v.sort); p.set("dir", v.dir); }
  if (v.page > 1) p.set("page", String(v.page));
  if (v.per !== DEFAULT_PER) p.set("n", String(v.per));
  const s = p.toString();
  return s ? `#${s}` : "";
}

// ── the rows on screen as a CSV file (made in the browser) ──────────────────────────────
const CSV_COLUMNS: Column<PsRow>[] = [
  { key: "filed_date", about: "Day the notice was filed with the SEC", get: (r) => r.filed },
  { key: "form_type", about: "144 or 144/A (an amendment)", get: (r) => (r.amend ? "144/A" : "144") },
  { key: "company", about: "The company the shares are in, as this site names it", get: (r) => r.c.name },
  { key: "ticker", about: "The company's main ticker on this site", get: (r) => r.c.ticker },
  { key: "issuer_cik", about: "The company's SEC number, ten digits", get: (r) => r.c.cik },
  { key: "seller", about: "The person for whose account the shares are to be sold, as filed", get: (r) => r.s.name },
  { key: "relationship", about: "The seller's relationship to the company, in the filer's words", get: (r) => r.relationship },
  { key: "shares_to_be_sold", about: "Shares the notice says are to be sold", get: (r) => r.shares },
  { key: "stated_market_value", about: "Aggregate market value the filer states; blank when held back", get: (r) => r.value },
  { key: "value_not_shown", about: "true when the stated value works out to an impossible price a share", get: (r) => r.held },
  { key: "approximate_sale_date", about: "Approximate date of sale, as filed", get: (r) => r.sale },
  { key: "plan_adoption_date", about: "Date a Rule 10b5-1 plan was adopted, when the notice states one", get: (r) => r.plan },
  { key: "accession", about: "The SEC accession number", get: (r) => r.accession },
  { key: "sec_url", about: "The notice at the SEC", get: (r) => r.url },
  { key: "page_url", about: "The company's page on this site", get: (r) => (r.c.path ? `https://spotthemoney.com${r.c.path}` : null) },
];
export function psViewCsv(all: readonly PsRow[], v: PsView, built: string): string {
  return toCsv(CSV_COLUMNS, sortPs(all.filter((r) => psMatches(r, v.f, built)), v.sort, v.dir));
}
export function psViewCsvName(v: PsView, built: string): string {
  const f = v.f;
  const bits = [`last${f.w}d`, f.division, f.form, f.plan ? `plan-${f.plan}` : "", f.min ? `min${f.min}` : "", f.q.trim()].filter(Boolean).map((b) => String(b).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return `planned-sales-${bits.join("-")}-${built}.csv`;
}
export { shortDate, isDay };

/** One build-log line to compare with SQL. */
export function plannedLog(d: PlannedData): string {
  const rows = unpackPlanned(d);
  const win = (days: number) => rows.filter((r) => inWindow(r.filed, d.built, days)).length;
  return `planned sales hub: ${rows.length} notices (${rows.filter((r) => r.amend).length} amendments) about ${new Set(rows.map((r) => r.c.cik)).size} companies from ${new Set(rows.map((r) => r.s.key)).size} sellers; filed in the last 7 days ${win(7)}, 30 days ${win(30)}, 90 days ${win(90)}, 365 days ${win(365)}; with a plan date ${rows.filter((r) => r.plan).length}; value held back ${rows.filter((r) => r.held).length}; value at least 100000 ${rows.filter((r) => (r.value ?? 0) >= 100000).length}, 1000000 ${rows.filter((r) => (r.value ?? 0) >= 1e6).length}; newest ${rows.map((r) => r.filed).sort().at(-1) ?? "none"}`;
}
