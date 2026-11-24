// Large holders hub (/large-holders/): for every company with a page on this site, each holder's
// newest Schedule 13D or 13G statement, in one table. Built after the company financials screener.
// Rules (lib/schedule13.ts holds the statement rules; this file only arranges them):
//   - A statement is what the filer says it owned on its event date, never a trade. Nothing is
//     added up: members of a group each report the combined holding, so the count line counts
//     holders and companies only, with no sum of shares or percentages.
//   - One row per holder and company: the holder's NEWEST statement (holdersOf), a statement under
//     5% stays listed and is marked "below 5%". A holder that reports on two classes of a company's
//     shares has a row for each (lib/schedule13.ts rowsByClass); the count line counts it once.
//   - A row with no percent passes no percent filter.
//   - A holder links to a page only when the filer number belongs to exactly one person or company
//     with a page (holderPath). The name shown is the statement's own.
import { toCsv, type Column } from "./csv";
import { DEFAULT_PER, PER_PAGE, inWindow, nf, paginate, plural, shortDate, slugLike, sortRows, type Page } from "./hubscreen";

export const LARGE_PATH = "/large-holders/";
export const LARGE_DATA = "/data/large-holders.json";
export const FILING_THRESHOLD = 5;

/** [company index, holder as filed, holder page path or "", "D" | "G", amendment 0|1, percent or null, shares or null,
 *  event date or "", filed, accession, reporting persons, statement URL or "", holder key (may be absent in an older file)] */
export type PackedHolder = [number, string, string, "D" | "G", 0 | 1, number | null, number | null, string, string, string, number, string, string?];
export interface LargeData {
  built: string;
  divisions: { name: string; slug: string }[];
  /** [name, page path, ticker, SEC number, division index or -1] */
  companies: [string, string, string, string, number][];
  rows: PackedHolder[];
}
export interface LhCompany { name: string; path: string; ticker: string; cik: string; division: { name: string; slug: string } | null }
export interface LhRow {
  c: LhCompany; holder: string; path: string | null; schedule: "13D" | "13G"; amend: boolean; percent: number | null; shares: number | null;
  event: string | null; filed: string; accession: string; persons: number; url: string | null;
  /** Which holder the row belongs to (the filer's SEC number, or its name when there is none): two rows of one company with the same key are one holder reporting on two classes of shares. */
  hk: string;
}
export interface LhIn { company: LhCompany; holder: string; path: string | null; schedule: "13D" | "13G"; amend: boolean; percent: number | null; shares: number | null; event: string | null; filed: string; accession: string; persons: number; url: string | null; hk?: string }

export function packLarge(built: string, rows: readonly LhIn[]): LargeData {
  const divs: { name: string; slug: string }[] = [], seen = new Map<string, { name: string; slug: string }>();
  for (const r of rows) if (r.company.division && !seen.has(r.company.division.slug)) { seen.set(r.company.division.slug, r.company.division); divs.push(r.company.division); }
  divs.sort((a, b) => a.name.localeCompare(b.name));
  const dIdx = new Map(divs.map((d, i) => [d.slug, i]));
  const cos: LargeData["companies"] = [], cIdx = new Map<string, number>();
  const out: PackedHolder[] = [];
  for (const r of rows) {
    let ci = cIdx.get(r.company.cik);
    if (ci == null) { ci = cos.length; cos.push([r.company.name, r.company.path, r.company.ticker, r.company.cik, r.company.division ? dIdx.get(r.company.division.slug) ?? -1 : -1]); cIdx.set(r.company.cik, ci); }
    out.push([ci, r.holder, r.path ?? "", r.schedule === "13D" ? "D" : "G", r.amend ? 1 : 0, r.percent, r.shares, r.event ?? "", r.filed, r.accession, r.persons, r.url ?? "", r.hk ?? `n:${r.holder.toLowerCase()}`]);
  }
  return { built, divisions: divs, companies: cos, rows: out };
}
export function unpackLarge(d: LargeData): LhRow[] {
  const cos: LhCompany[] = d.companies.map((c) => ({ name: c[0], path: c[1], ticker: c[2], cik: c[3], division: c[4] >= 0 ? d.divisions[c[4]] ?? null : null }));
  return d.rows.map((r) => ({
    c: cos[r[0]], holder: r[1], path: r[2] || null, schedule: r[3] === "D" ? "13D" : "13G", amend: r[4] === 1, percent: r[5], shares: r[6],
    event: r[7] || null, filed: r[8], accession: r[9], persons: r[10], url: r[11] || null, hk: r[12] ?? `n:${r[1].toLowerCase()}`,
  }));
}

// ── filters, sort, view ──────────────────────────────────────────────────────────────────
export const SCHEDULES = ["13D", "13G"] as const;
export const SCHEDULE_LABEL: Record<string, string> = { "13D": "Schedule 13D", "13G": "Schedule 13G" };
export const PCTS = ["5", "10", "below"] as const;
export const PCT_LABEL: Record<string, string> = { "5": "5% or more", "10": "10% or more", below: "Below 5% (exit notices)" };
export const WINDOWS = [30, 90, 365] as const;
export const WINDOW_LABEL: Record<number, string> = { 0: "Any filing date", 30: "Filed in the last 30 days", 90: "Filed in the last 90 days", 365: "Filed in the last 12 months" };
export const SORT_KEYS = ["filed", "company", "holder", "percent", "shares", "event"] as const;
export type LhSortKey = (typeof SORT_KEYS)[number];

export interface LhFilter { q: string; division: string; schedule: "" | "13D" | "13G"; pct: "" | "5" | "10" | "below"; w: number }
export const NO_LH_FILTER: LhFilter = { q: "", division: "", schedule: "", pct: "", w: 0 };
export interface LhView { f: LhFilter; sort: LhSortKey; dir: "asc" | "desc"; page: number; per: number }
export const DEFAULT_LH_VIEW: LhView = { f: NO_LH_FILTER, sort: "filed", dir: "desc", page: 1, per: DEFAULT_PER };

export function lhMatches(r: LhRow, f: LhFilter, built: string): boolean {
  if (f.w > 0 && !inWindow(r.filed, built, f.w)) return false;
  if (f.division && r.c.division?.slug !== f.division) return false;
  if (f.schedule && r.schedule !== f.schedule) return false;
  if (f.pct) {
    const p = r.percent;
    if (p == null) return false; // no stated percent: passes no percent filter
    if (f.pct === "5" && !(p >= FILING_THRESHOLD)) return false;
    if (f.pct === "10" && !(p >= 10)) return false;
    if (f.pct === "below" && !(p < FILING_THRESHOLD)) return false;
  }
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${r.c.name} ${r.c.ticker} ${r.holder}`.toLowerCase();
    for (const word of q.split(/\s+/)) if (!hay.includes(word)) return false;
  }
  return true;
}
export const firstLhDir = (k: LhSortKey): "asc" | "desc" => (k === "company" || k === "holder" ? "asc" : "desc");
const sortValue = (r: LhRow, k: LhSortKey): number | string | null =>
  k === "filed" ? r.filed : k === "company" ? r.c.name.toLowerCase() : k === "holder" ? r.holder.toLowerCase() : k === "percent" ? r.percent : k === "shares" ? r.shares : r.event;
const tie = (a: LhRow, b: LhRow): number => b.filed.localeCompare(a.filed) || a.c.name.localeCompare(b.c.name) || (a.accession < b.accession ? 1 : a.accession > b.accession ? -1 : 0);
export function sortLh(rows: readonly LhRow[], k: LhSortKey, dir: "asc" | "desc"): LhRow[] { return sortRows(rows, (r) => sortValue(r, k), dir, tie); }

export interface LhResult extends Page<LhRow> {
  companies: number; all: number;
  /** Holder and company pairs among the matching rows; lower than `total` when a holder reports on two classes of one company's shares. */
  holders: number;
}
export function largeScreen(all: readonly LhRow[], v: LhView, built: string): LhResult {
  const hits = sortLh(all.filter((r) => lhMatches(r, v.f, built)), v.sort, v.dir);
  const pg = paginate(hits, v.page, v.per);
  return { ...pg, companies: new Set(hits.map((r) => r.c.cik)).size, all: all.length, holders: new Set(hits.map((r) => `${r.c.cik}|${r.hk}`)).size };
}
/** The count line. Counts only. */
export function lhSummaryLine(r: LhResult): string {
  if (r.total === 0) return r.all === 0 ? "No Schedule 13D or 13G statements are on file yet." : "No holder matches these filters.";
  const rows = r.total > r.holders ? `, in ${plural(r.total, "row", "rows")} (a holder that reports on two classes of a company's shares has a row for each)` : "";
  return `${plural(r.holders, "holder", "holders")} of ${plural(r.companies, "company", "companies")}${rows}. Showing ${nf(r.from)} to ${nf(r.to)}.`;
}
export const percentText = (p: number | null): string => (p == null ? "" : `${Number(p.toFixed(2)).toString()}%`);

// ── the address ─────────────────────────────────────────────────────────────────────────
export const LH_KEYS = ["q", "division", "schedule", "pct", "w", "sort", "dir", "page", "n"];
export const isLhViewHash = (hash: string): boolean => hash.includes("=") && LH_KEYS.some((k) => new URLSearchParams(hash.replace(/^#/, "")).has(k));
export function isDefaultLhFilter(f: LhFilter): boolean { return !f.q.trim() && !f.division && !f.schedule && !f.pct && !f.w; }
export function parseLhHash(hash: string): LhView {
  const p = new URLSearchParams(hash.replace(/^#/, "")), f: LhFilter = { ...NO_LH_FILTER };
  const dv = (p.get("division") ?? "").toLowerCase(); if (slugLike(dv)) f.division = dv;
  const sc = (p.get("schedule") ?? "").toUpperCase(); if (sc === "13D" || sc === "13G") f.schedule = sc;
  const pc = p.get("pct"); if (pc === "5" || pc === "10" || pc === "below") f.pct = pc;
  const w = Number(p.get("w")); if ((WINDOWS as readonly number[]).includes(w)) f.w = w;
  f.q = (p.get("q") ?? "").slice(0, 60);
  const so = p.get("sort") ?? ""; const sort = (SORT_KEYS as readonly string[]).includes(so) ? (so as LhSortKey) : DEFAULT_LH_VIEW.sort;
  const di = p.get("dir"); const dir = di === "asc" || di === "desc" ? di : firstLhDir(sort);
  const pg = Number(p.get("page")); const page = Number.isInteger(pg) && pg >= 1 && pg <= 100000 ? pg : 1;
  const n = Number(p.get("n")); const per = (PER_PAGE as readonly number[]).includes(n) ? n : DEFAULT_PER;
  return { f, sort, dir, page, per };
}
export function toLhHash(v: LhView): string {
  const p = new URLSearchParams(), f = v.f;
  if (f.division) p.set("division", f.division);
  if (f.schedule) p.set("schedule", f.schedule);
  if (f.pct) p.set("pct", f.pct);
  if (f.w) p.set("w", String(f.w));
  if (f.q.trim()) p.set("q", f.q.trim());
  if (v.sort !== DEFAULT_LH_VIEW.sort || v.dir !== firstLhDir(v.sort)) { p.set("sort", v.sort); p.set("dir", v.dir); }
  if (v.page > 1) p.set("page", String(v.page));
  if (v.per !== DEFAULT_PER) p.set("n", String(v.per));
  const s = p.toString();
  return s ? `#${s}` : "";
}

// ── the rows on screen as a CSV file (made in the browser) ──────────────────────────────
const CSV_COLUMNS: Column<LhRow>[] = [
  { key: "company", about: "The company, as this site names it", get: (r) => r.c.name },
  { key: "ticker", about: "The company's main ticker on this site", get: (r) => r.c.ticker },
  { key: "issuer_cik", about: "The company's SEC number, ten digits", get: (r) => r.c.cik },
  { key: "holder", about: "The first reporting person on the statement, as filed", get: (r) => r.holder },
  { key: "other_reporting_persons", about: "Further reporting persons named on the statement", get: (r) => Math.max(0, r.persons - 1) },
  { key: "schedule", about: "13D or 13G", get: (r) => r.schedule },
  { key: "amendment", about: "true for an amendment", get: (r) => r.amend },
  { key: "percent_of_class", about: "Largest percent of class any one reporting person states", get: (r) => r.percent },
  { key: "shares_stated", about: "Largest share count any one reporting person states", get: (r) => r.shares },
  { key: "below_5_percent", about: "true when the statement states less than 5%", get: (r) => (r.percent == null ? null : r.percent < FILING_THRESHOLD) },
  { key: "event_date", about: "The date the statement is as of", get: (r) => r.event },
  { key: "filed_date", about: "Day the statement was filed", get: (r) => r.filed },
  { key: "accession", about: "The SEC accession number", get: (r) => r.accession },
  { key: "sec_url", about: "The statement at the SEC", get: (r) => r.url },
  { key: "page_url", about: "The company's page on this site", get: (r) => (r.c.path ? `https://spotthemoney.com${r.c.path}` : null) },
];
export function lhViewCsv(all: readonly LhRow[], v: LhView, built: string): string {
  return toCsv(CSV_COLUMNS, sortLh(all.filter((r) => lhMatches(r, v.f, built)), v.sort, v.dir));
}
export function lhViewCsvName(v: LhView, built: string): string {
  const f = v.f;
  const bits = [f.w ? `last${f.w}d` : "", f.division, f.schedule, f.pct ? `pct-${f.pct}` : "", f.q.trim()].filter(Boolean).map((b) => String(b).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return `large-holders${bits.length ? "-" + bits.join("-") : ""}-${built}.csv`;
}
export { shortDate };

/** One build-log line to compare with SQL. */
export function largeLog(d: LargeData): string {
  const rows = unpackLarge(d);
  const win = (days: number) => rows.filter((r) => inWindow(r.filed, d.built, days)).length;
  return `large holders hub: ${new Set(rows.map((r) => `${r.c.cik}|${r.hk}`)).size} holders in ${rows.length} rows on ${new Set(rows.map((r) => r.c.cik)).size} companies; 13D ${rows.filter((r) => r.schedule === "13D").length}, 13G ${rows.filter((r) => r.schedule === "13G").length}; 5% or more ${rows.filter((r) => (r.percent ?? -1) >= 5).length}, 10% or more ${rows.filter((r) => (r.percent ?? -1) >= 10).length}, below 5% ${rows.filter((r) => r.percent != null && r.percent < 5).length}, no percent ${rows.filter((r) => r.percent == null).length}; filed in the last 30 days ${win(30)}, 90 days ${win(90)}, 365 days ${win(365)}; newest ${rows.map((r) => r.filed).sort().at(-1) ?? "none"}`;
}
