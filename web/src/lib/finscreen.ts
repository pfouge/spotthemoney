// Company financials screener (/company-financials/): one row per company this site tracks that
// has a fiscal year or a quarter on file, with the figures of its NEWEST fiscal year and its
// NEWEST quarter as the company filed them with the SEC (lib/financials.ts has the rules for the
// figures themselves; this file only arranges them in a table).
// Pure: the build packs the rows with `packFinScreen` (lib/finscreen-build.ts), the page renders
// its first rows with `finScreen`, and the browser script (scripts/finscreen.ts) and the unit
// tests use the same `finMatches`, `finScreen`, `parseFinHash` and `toFinHash`.
// Rules:
//   - Every amount is the filed one. Nothing is converted or annualised. No score, rating or
//     ranking of companies by quality: a column can be sorted by what it holds, and that is all.
//   - The table has two sets of columns. "Filed figures" (the view the page opens on) holds
//     filed amounts only. "Two worked-out ratios" adds net margin and liabilities to equity,
//     the two ratios of lib/financials.ts (RATIOS), each worked out from two amounts printed in
//     the same row and set beside them, with the same "n/a" and beyond-the-cap wording as on a
//     company's page. A ratio column can be sorted (a ratio needs no currency, so every
//     reporting currency takes part); there is no filter on a ratio. Total liabilities is
//     stored for that view only.
//   - A figure the company page holds back ("not shown", lib/financials.ts) is held back here
//     too: it is not in the data file, passes no filter on its column and sorts last.
//   - The revenue and total-assets filters are in U.S. dollars. A company that reports in
//     another currency passes neither, and its amounts sort after the dollar amounts: figures
//     in different currencies are never compared.
//   - The sign of net income needs no currency, so that filter covers every company.
//   - "Ended in the last 18 months" keeps a row whose period ended at most RECENT_DAYS days
//     before the day the data file was built. A company that stopped filing keeps its last
//     fiscal year or quarter in the table, however old; this filter leaves those rows out. The
//     table opens without it: every company with a period on file is listed, each with its date.
//   - Executive pay (lib/execpay.ts) belongs to the company, not to the period: the principal
//     executive officer's Summary Compensation Table total for the company's newest fiscal year
//     with one on file, in dollars as the company tagged it, shown beside either period. It is
//     never compared with any figure in the row (no ratio), and a company with none shows a dash
//     and sorts last.
import { toCsv, type Column } from "./csv";
import { filingUrl, finMoney, finPerShare, ratioText, ratioValue, RATIOS, RATIO_NA, type RatioCell, type RatioDef } from "./financials";

export const FIN_SCREENER_PATH = "/company-financials/";
export const FIN_SCREENER_DATA = "/data/financials-screener.json";

// ── data ─────────────────────────────────────────────────────────────────────────────────
export const FS_CONCEPTS = [
  { key: "revenue", label: "Revenue", perShare: false },
  { key: "net_income", label: "Net income", perShare: false },
  { key: "eps_diluted", label: "Diluted EPS", perShare: true },
  { key: "assets", label: "Total assets", perShare: false },
  { key: "equity", label: "Shareholders' equity", perShare: false },
] as const;
/** Stored for the ratios view only: total liabilities has no column in the opening view. */
export const FS_EXTRA = [{ key: "liabilities", label: "Total liabilities", perShare: false }] as const;
/** Every figure a period carries in the data file, in mask-bit order. */
export const FS_STORED = [...FS_CONCEPTS, ...FS_EXTRA] as const;
export type FsConcept = (typeof FS_STORED)[number]["key"];
/** Where figure i of FS_STORED sits in a packed period: 5 to 9, then 11 (10 is the mask). */
const slot = (i: number) => (i < FS_CONCEPTS.length ? 5 + i : 6 + i);

/** One period, packed: [last day, first day or "", filing date of the newest report used, its
 *  form, its accession number, revenue, net income, diluted EPS, total assets, equity, held mask].
 *  A figure is null when the report gives none under a heading this site reads, or when it is
 *  held back; the mask has bit i set when figure i (in FS_STORED order) is held back. Total
 *  liabilities follows the mask and may be missing in a file written before it was added. */
export type PackedPeriod = [string, string, string, string, string, number | null, number | null, number | null, number | null, number | null, number, (number | null)?];
/** One company, packed: [name, page path or "", ticker or "", CIK (10 digits), division index or
 *  -1, SIC code or "", currency, newest fiscal year or 0, newest quarter or 0, principal executive
 *  officer's total pay or null, the fiscal year end that pay covers or ""]. The last two may be
 *  missing in a file written before executive pay was added. */
export type PackedCompany = [string, string, string, string, number, string, string, PackedPeriod | 0, PackedPeriod | 0, number | null, string];
export interface FinScreenData {
  /** The day the file was built (YYYY-MM-DD). */
  built: string;
  /** SIC divisions with a company in the file: the manual's name and the slug of its page. */
  divisions: { name: string; slug: string }[];
  companies: PackedCompany[];
}

export type PeriodKey = "year" | "quarter";
export interface FsPeriod {
  end: string; start: string | null; filed: string; form: string; accession: string;
  v: Record<FsConcept, number | null>;
  held: Record<FsConcept, boolean>;
  /** True when the period ended at most RECENT_DAYS days before the build day. Set when the data
   *  file is unpacked (it is worked out from the file's build day, not stored in it). */
  recent?: boolean;
}
/** The principal executive officer's total pay for the newest fiscal year that has one, dollars. */
export interface FsPay { peo: number; fye: string }
export interface FsCompany {
  pay?: FsPay | null;
  name: string; path: string | null; ticker: string; cik: string;
  division: { name: string; slug: string } | null; sic: string; unit: string;
  year: FsPeriod | null; quarter: FsPeriod | null;
}
/** A company with the period a view looks at. */
export interface FsRow { c: FsCompany; p: FsPeriod }

/** A period counts as recent when it ended this many days, or fewer, before the build day (about 18 months). */
export const RECENT_DAYS = 548;
export const RECENT_OPTION = "Ended in the last 18 months";
/** The earliest last day a recent period can have: the build day less RECENT_DAYS, as YYYY-MM-DD. */
export function recentCutoff(built: string): string {
  const t = Date.parse(`${built.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10) : "";
}
/** Recent = ended on or after the cutoff and not after the build day. With no usable build day nothing is recent. */
export function isRecent(end: string, built: string): boolean {
  const cut = recentCutoff(built);
  return cut !== "" && end >= cut && end <= built.slice(0, 10);
}

function unpackPeriod(x: PackedPeriod | 0, built = ""): FsPeriod | null {
  if (!x) return null;
  const v = {} as Record<FsConcept, number | null>, held = {} as Record<FsConcept, boolean>;
  FS_STORED.forEach((c, i) => {
    const n = x[slot(i)] as number | null | undefined;
    held[c.key] = ((x[10] >> i) & 1) === 1;
    v[c.key] = held[c.key] || typeof n !== "number" || !Number.isFinite(n) ? null : n;
  });
  return { end: x[0], start: x[1] || null, filed: x[2], form: x[3], accession: x[4], v, held, recent: isRecent(x[0], built) };
}
export function unpackFinScreen(d: FinScreenData): FsCompany[] {
  return d.companies.map((c) => ({
    name: c[0], path: c[1] || null, ticker: c[2], cik: c[3], division: d.divisions[c[4]] ?? null, sic: c[5], unit: c[6],
    year: unpackPeriod(c[7], d.built), quarter: unpackPeriod(c[8], d.built),
    pay: typeof c[9] === "number" && Number.isFinite(c[9]) && c[10] ? { peo: c[9], fye: c[10] } : null,
  }));
}
export function packPeriod(p: FsPeriod): PackedPeriod {
  let mask = 0;
  FS_STORED.forEach((c, i) => { if (p.held[c.key]) mask |= 1 << i; });
  const val = (k: FsConcept) => (p.held[k] ? null : p.v[k]);
  return [p.end, p.start ?? "", p.filed, p.form, p.accession, val("revenue"), val("net_income"), val("eps_diluted"), val("assets"), val("equity"), mask, val("liabilities")];
}
export function packFinScreen(built: string, companies: readonly FsCompany[]): FinScreenData {
  const divisions: { name: string; slug: string }[] = [];
  const idx = new Map<string, number>();
  for (const c of [...companies].sort((a, b) => (a.division?.name ?? "").localeCompare(b.division?.name ?? ""))) {
    if (c.division && !idx.has(c.division.slug)) idx.set(c.division.slug, divisions.push({ name: c.division.name, slug: c.division.slug }) - 1);
  }
  return {
    built, divisions,
    companies: companies.map((c) => [c.name, c.path ?? "", c.ticker, c.cik, c.division ? idx.get(c.division.slug)! : -1, c.sic, c.unit, c.year ? packPeriod(c.year) : 0, c.quarter ? packPeriod(c.quarter) : 0, c.pay?.peo ?? null, c.pay?.fye ?? ""]),
  };
}

// ── filters ──────────────────────────────────────────────────────────────────────────────
export const PERIODS: readonly PeriodKey[] = ["year", "quarter"];
export const PERIOD_OPTION: Record<PeriodKey, string> = { year: "Newest fiscal year", quarter: "Newest quarter" };
export const PERIOD_NOUN: Record<PeriodKey, string> = { year: "fiscal year", quarter: "quarter" };
/** Revenue of at least the step, in U.S. dollars. */
export const REV_MIN_STEPS = [100_000_000, 1_000_000_000, 10_000_000_000, 100_000_000_000] as const;
/** Revenue of at most the step, in U.S. dollars. */
export const REV_MAX_STEPS = [100_000_000, 1_000_000_000, 10_000_000_000] as const;
/** Total assets of at least the step, in U.S. dollars. */
export const ASSET_MIN_STEPS = [1_000_000_000, 10_000_000_000, 100_000_000_000] as const;
export const NI_SIGNS = ["pos", "neg"] as const;
export const NI_OPTION: Record<string, string> = { pos: "Net income above zero", neg: "Net income below zero" };
export const PER_PAGE = [25, 50, 100] as const;
export const DEFAULT_PER = 50;
export const SORT_KEYS = ["company", "end", "revenue", "net_income", "eps_diluted", "assets", "equity", "pay", "liabilities", "net_margin", "liabilities_to_equity"] as const;
export type FsSortKey = (typeof SORT_KEYS)[number];

// ── the two sets of columns ──────────────────────────────────────────────────────────────
export type FsCols = "figures" | "ratios";
export const COLS: readonly FsCols[] = ["figures", "ratios"];
export const COLS_OPTION: Record<FsCols, string> = { figures: "Filed figures", ratios: "Two worked-out ratios" };
export type RatioKey = RatioDef["key"];
export type FsColumn =
  | { kind: "figure"; key: FsConcept; label: string; views: readonly FsCols[] }
  | { kind: "ratio"; key: RatioKey; label: string; views: readonly FsCols[] }
  | { kind: "pay"; key: "pay"; label: string; views: readonly FsCols[] }
  | { kind: "payyear"; key: "payyear"; label: string; views: readonly FsCols[] };
const BOTH: readonly FsCols[] = COLS, FIG: readonly FsCols[] = ["figures"], RAT: readonly FsCols[] = ["ratios"];
const ratioDef = (k: RatioKey): RatioDef => RATIOS.find((r) => r.key === k)!;
/** Every column between "ended" and "Report", in table order, with the views it belongs to.
 *  Each ratio stands right after the two amounts it is worked out from. */
export const FS_COLUMNS: readonly FsColumn[] = [
  { kind: "figure", key: "revenue", label: "Revenue", views: BOTH },
  { kind: "figure", key: "net_income", label: "Net income", views: BOTH },
  { kind: "ratio", key: "net_margin", label: ratioDef("net_margin").label, views: RAT },
  { kind: "figure", key: "eps_diluted", label: "Diluted EPS", views: FIG },
  { kind: "figure", key: "assets", label: "Total assets", views: FIG },
  { kind: "figure", key: "liabilities", label: "Total liabilities", views: RAT },
  { kind: "figure", key: "equity", label: "Shareholders' equity", views: BOTH },
  { kind: "ratio", key: "liabilities_to_equity", label: ratioDef("liabilities_to_equity").label, views: RAT },
  { kind: "pay", key: "pay", label: "CEO pay, as reported", views: FIG },
  { kind: "payyear", key: "payyear", label: "Pay year", views: FIG },
];
export const columnsOf = (cols: FsCols): FsColumn[] => FS_COLUMNS.filter((c) => c.views.includes(cols));
/** The columns a view can be sorted by: the two fixed ones and every column it shows but "Pay year". */
export function sortKeysOf(cols: FsCols): FsSortKey[] {
  return ["company", "end", ...columnsOf(cols).filter((c) => c.kind !== "payyear").map((c) => c.key as FsSortKey)];
}
/** A ratio of the two amounts of a row, as the company pages work it out (lib/financials.ts). */
export function fsRatio(r: FsRow, k: RatioKey): RatioCell {
  const d = ratioDef(k);
  return ratioValue(r.p.v[d.num as FsConcept], r.p.v[d.den as FsConcept], d);
}
/** What a ratio cell prints: "55.6%", "over 1,000%", "0.40", "n/a", or "" when an amount is missing or not shown. */
export function fsRatioText(r: FsRow, k: RatioKey): string {
  const x = fsRatio(r, k);
  return x.status === "ok" ? ratioText(ratioDef(k), x.value!) : x.status === "base" ? RATIO_NA : "";
}
/** The two amounts a ratio is worked out from, in words ("net income ÷ revenue"). */
export const ratioInputs = (k: RatioKey): string => ratioDef(k).inputs;
/** The sentence over the table while the ratio columns show. */
export const RATIO_VIEW_NOTE = `Net margin and liabilities to equity are this site's arithmetic on two amounts of the same row, not figures the company filed. "${RATIO_NA}" means the amount divided by is zero or negative; an empty cell means an amount is missing or not shown. Sorting by a ratio orders the companies by that one number and is no verdict on any of them.`;

export interface FsFilter {
  q: string;
  /** Which period the table shows and the filters read. */
  period: PeriodKey;
  /** Slug of a SIC division's page ("manufacturing"); "" = any. */
  division: string;
  /** Reporting currency ("USD", "JPY"); "" = any. */
  unit: string;
  /** Revenue at least / at most, U.S. dollars; 0 = no limit. */
  rmin: number; rmax: number;
  ni: "" | "pos" | "neg";
  /** Total assets at least, U.S. dollars; 0 = no limit. */
  amin: number;
  /** 1 = only companies with executive pay on file; 0 = any. */
  pay: 0 | 1;
  /** 1 = only periods that ended in the last RECENT_DAYS days before the build; 0 or absent = any. */
  recent?: 0 | 1;
}
export const NO_FS_FILTER: FsFilter = { q: "", period: "year", division: "", unit: "", rmin: 0, rmax: 0, ni: "", amin: 0, pay: 0, recent: 0 };
export interface FsView { f: FsFilter; sort: FsSortKey; dir: "asc" | "desc"; page: number; per: number; /** Which set of columns shows; absent = "figures". */ cols?: FsCols }
export const DEFAULT_FS_VIEW: FsView = { f: NO_FS_FILTER, sort: "revenue", dir: "desc", page: 1, per: DEFAULT_PER, cols: "figures" };
export const colsOf = (v: FsView): FsCols => (v.cols === "ratios" ? "ratios" : "figures");
/** A view with the set of columns changed; a sort the new set cannot show goes back to the opening order. */
export function withCols(v: FsView, cols: FsCols): FsView {
  const keep = sortKeysOf(cols).includes(v.sort);
  return { ...v, cols, sort: keep ? v.sort : DEFAULT_FS_VIEW.sort, dir: keep ? v.dir : DEFAULT_FS_VIEW.dir, page: 1 };
}

/** The companies that have the period a view looks at, each with that period. */
export function rowsFor(all: readonly FsCompany[], period: PeriodKey): FsRow[] {
  const out: FsRow[] = [];
  for (const c of all) { const p = period === "quarter" ? c.quarter : c.year; if (p) out.push({ c, p }); }
  return out;
}
/** A figure a dollar filter or a sort by amount may read: filed, not held back, in U.S. dollars. */
export function usd(r: FsRow, k: FsConcept): number | null { return r.c.unit === "USD" ? r.p.v[k] : null; }

export function finMatches(r: FsRow, f: FsFilter): boolean {
  if (f.division && r.c.division?.slug !== f.division) return false;
  if (f.unit && r.c.unit !== f.unit) return false;
  if (f.rmin > 0) { const v = usd(r, "revenue"); if (v == null || v < f.rmin) return false; }
  if (f.rmax > 0) { const v = usd(r, "revenue"); if (v == null || v > f.rmax) return false; }
  if (f.amin > 0) { const v = usd(r, "assets"); if (v == null || v < f.amin) return false; }
  if (f.pay && r.c.pay == null) return false;
  if (f.recent && !r.p.recent) return false;
  if (f.ni) { const v = r.p.v.net_income; if (v == null || (f.ni === "pos" ? !(v > 0) : !(v < 0))) return false; }
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${r.c.name} ${r.c.ticker}`.toLowerCase();
    for (const word of q.split(/\s+/)) if (!hay.includes(word)) return false;
  }
  return true;
}

/** The direction a column starts in: names A to Z, dates newest first, amounts largest first. */
export function firstFsDir(k: FsSortKey): "asc" | "desc" { return k === "company" ? "asc" : "desc"; }

function sortValue(r: FsRow, k: FsSortKey): number | string | null {
  if (k === "company") return r.c.name.toLowerCase();
  if (k === "end") return r.p.end;
  if (k === "pay") return r.c.pay?.peo ?? null;
  // A ratio has no currency: every company with both amounts takes part. "n/a" and empty go last.
  if (k === "net_margin" || k === "liabilities_to_equity") return fsRatio(r, k).value;
  return usd(r, k);
}
/** Sorted copy. Empty values, held-back figures, amounts in another currency and ratios that
 *  could not be worked out go last in either direction; ties fall back to the company's name, then its SEC number. */
export function sortFsRows(rows: readonly FsRow[], k: FsSortKey, dir: "asc" | "desc"): FsRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows.map((r) => ({ r, v: sortValue(r, k) })).sort((a, b) => {
    const x = a.v, y = b.v;
    if (x == null || y == null) { if (x != null) return -1; if (y != null) return 1; }
    else if (x < y) return -sign; else if (x > y) return sign;
    const an = a.r.c.name.toLowerCase(), bn = b.r.c.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : a.r.c.cik < b.r.c.cik ? -1 : a.r.c.cik > b.r.c.cik ? 1 : 0;
  }).map((x) => x.r);
}

export interface FsResult {
  /** The rows of the page asked for. */
  rows: FsRow[];
  /** Companies that match, and companies that have the period at all. */
  total: number; all: number;
  page: number; pages: number; from: number; to: number;
}
export function finScreen(all: readonly FsCompany[], v: FsView): FsResult {
  const base = rowsFor(all, v.f.period);
  const sorted = sortFsRows(base.filter((r) => finMatches(r, v.f)), v.sort, v.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / v.per));
  const page = Math.min(Math.max(1, v.page), pages);
  const from = (page - 1) * v.per;
  const rows = sorted.slice(from, from + v.per);
  return { rows, total: sorted.length, all: base.length, page, pages, from: rows.length ? from + 1 : 0, to: from + rows.length };
}

const n = (x: number) => x.toLocaleString("en-US");
const pl = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;
/** The count line over the table. Plain counts only. */
export function fsSummaryLine(r: FsResult, period: PeriodKey): string {
  const noun = PERIOD_NOUN[period];
  if (r.total === 0) return r.all === 0 ? `No company has a ${noun} on file yet.` : "No company matches these filters.";
  const head = r.total === r.all ? `All ${pl(r.total, "company", "companies")} with a ${noun} on file` : `${pl(r.total, "company", "companies")} of ${n(r.all)} with a ${noun} on file`;
  return `${head}. Showing ${n(r.from)} to ${n(r.to)}.`;
}

// ── labels shared by the page and the script ─────────────────────────────────────────────
/** "$1 billion", "$100 million". */
export function stepLabel(step: number): string { return step >= 1e9 ? `$${n(step / 1e9)} billion` : `$${n(step / 1e6)} million`; }
export const revMinLabel = (s: number) => `Revenue ${stepLabel(s)} or more`;
export const revMaxLabel = (s: number) => `Revenue ${stepLabel(s)} or less`;
export const assetMinLabel = (s: number) => `Total assets ${stepLabel(s)} or more`;
/** What a cell prints: the amount in the company's currency, "not shown" for a held figure, "" for none. */
export function fsCellText(r: FsRow, k: FsConcept): string {
  if (r.p.held[k]) return "not shown";
  const v = r.p.v[k];
  if (v == null) return "";
  return k === "eps_diluted" ? finPerShare(v, `${r.c.unit}/shares`) : finMoney(v, r.c.unit);
}
/** The pay cell: the principal executive officer's total in dollars, "" when none is on file. */
export const fsPayText = (c: FsCompany): string => (c.pay ? finMoney(c.pay.peo, "USD") : "");
export function fsShortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export const reportUrl = (r: FsRow) => filingUrl(r.c.cik, r.p.accession);
export const divisionPagePath = (slug: string) => `/industries/${slug}/`;
export const tickerPagePath = (ticker: string) => `/stocks/${ticker.toLowerCase()}/`;

// ── the address ──────────────────────────────────────────────────────────────────────────
export function isDefaultFsFilter(f: FsFilter): boolean {
  return !f.q.trim() && f.period === "year" && !f.division && !f.unit && !f.rmin && !f.rmax && !f.ni && !f.amin && !f.pay && !f.recent;
}
export const FS_KEYS = ["q", "period", "division", "unit", "rmin", "rmax", "ni", "amin", "pay", "recent", "cols", "sort", "dir", "page", "per"];
/** True when a hash is a view (carries one of the screener's keys), not a jump link. */
export function isFsViewHash(hash: string): boolean {
  if (!hash.includes("=")) return false;
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return FS_KEYS.some((k) => p.has(k));
}
/** "#division=manufacturing&rmin=1000000000" → a view. Unknown keys and values are ignored. */
export function parseFinHash(hash: string): FsView {
  const f: FsFilter = { ...NO_FS_FILTER };
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (p.get("period") === "quarter") f.period = "quarter";
  const dv = (p.get("division") ?? "").toLowerCase(); if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dv) && dv.length <= 80) f.division = dv;
  const un = (p.get("unit") ?? "").toUpperCase(); if (/^[A-Z]{3}$/.test(un)) f.unit = un;
  const rmin = Number(p.get("rmin")); if ((REV_MIN_STEPS as readonly number[]).includes(rmin)) f.rmin = rmin;
  const rmax = Number(p.get("rmax")); if ((REV_MAX_STEPS as readonly number[]).includes(rmax)) f.rmax = rmax;
  const amin = Number(p.get("amin")); if ((ASSET_MIN_STEPS as readonly number[]).includes(amin)) f.amin = amin;
  const ni = p.get("ni"); if (ni === "pos" || ni === "neg") f.ni = ni;
  if (p.get("pay") === "1") f.pay = 1;
  if (p.get("recent") === "1") f.recent = 1;
  f.q = (p.get("q") ?? "").slice(0, 60);
  const cols: FsCols = p.get("cols") === "ratios" ? "ratios" : "figures";
  // A sort by a column the set of columns does not show is ignored.
  const so = p.get("sort") ?? ""; const sort = (sortKeysOf(cols) as readonly string[]).includes(so) ? (so as FsSortKey) : DEFAULT_FS_VIEW.sort;
  const di = p.get("dir"); const dir = di === "asc" || di === "desc" ? di : firstFsDir(sort);
  const pg = Number(p.get("page")); const page = Number.isInteger(pg) && pg >= 1 && pg <= 100000 ? pg : 1;
  const pe = Number(p.get("per")); const per = (PER_PAGE as readonly number[]).includes(pe) ? pe : DEFAULT_PER;
  return { f, sort, dir, page, per, cols };
}
/** The hash for a view; "" for the view the page opens on. */
export function toFinHash(v: FsView): string {
  const p = new URLSearchParams(), f = v.f;
  if (f.period !== "year") p.set("period", f.period);
  if (f.division) p.set("division", f.division);
  if (f.unit) p.set("unit", f.unit);
  if (f.rmin) p.set("rmin", String(f.rmin));
  if (f.rmax) p.set("rmax", String(f.rmax));
  if (f.ni) p.set("ni", f.ni);
  if (f.amin) p.set("amin", String(f.amin));
  if (f.pay) p.set("pay", "1");
  if (f.recent) p.set("recent", "1");
  if (f.q.trim()) p.set("q", f.q.trim());
  if (colsOf(v) !== "figures") p.set("cols", colsOf(v));
  if (v.sort !== DEFAULT_FS_VIEW.sort || v.dir !== firstFsDir(v.sort)) { p.set("sort", v.sort); p.set("dir", v.dir); }
  if (v.page > 1) p.set("page", String(v.page));
  if (v.per !== DEFAULT_PER) p.set("per", String(v.per));
  const s = p.toString();
  return s ? `#${s}` : "";
}

// ── links into the screener from the industry pages ──────────────────────────────────────
export function finScreenerHref(f: Partial<Pick<FsFilter, "division">>): string {
  return `${FIN_SCREENER_PATH}${toFinHash({ ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, ...f } })}`;
}
/** Companies with a fiscal year on file, in all and per division slug: what a link opens on. */
export function finScreenCounts(all: readonly FsCompany[]): { total: number; division: Map<string, number> } {
  const division = new Map<string, number>();
  const rows = rowsFor(all, "year");
  for (const r of rows) if (r.c.division) division.set(r.c.division.slug, (division.get(r.c.division.slug) ?? 0) + 1);
  return { total: rows.length, division };
}

// ── the rows on screen as a CSV file ─────────────────────────────────────────────────────
// Column names follow /downloads/company-financials.csv where the meaning is the same.
const figure = (k: FsConcept) => (r: FsRow) => r.p.v[k];
const CSV_COLUMNS: Column<FsRow>[] = [
  { key: "company", about: "The company, as this site names it", get: (r) => r.c.name },
  { key: "ticker", about: "The company's main ticker on this site", get: (r) => r.c.ticker },
  { key: "cik", about: "The company's SEC number, ten digits", get: (r) => r.c.cik },
  { key: "sic_code", about: "The industry code the SEC assigns", get: (r) => r.c.sic },
  { key: "sic_division", about: "The division of the SIC manual the code falls in", get: (r) => r.c.division?.name ?? null },
  { key: "period", about: "fiscal_year or quarter", get: (r) => (r.c.year === r.p ? "fiscal_year" : "quarter") },
  { key: "period_start", about: "First day of the period", get: (r) => r.p.start },
  { key: "period_end", about: "Last day of the period", get: (r) => r.p.end },
  { key: "currency", about: "The currency the company reports in; nothing is converted", get: (r) => r.c.unit },
  { key: "revenue", about: "Revenue for the period, as filed", get: figure("revenue") },
  { key: "net_income", about: "Net income for the period, as filed", get: figure("net_income") },
  { key: "eps_diluted", about: "Diluted earnings per share, as filed", get: figure("eps_diluted") },
  { key: "assets", about: "Total assets on the last day of the period, as filed", get: figure("assets") },
  { key: "liabilities", about: "Total liabilities on the last day of the period, as filed; blank when the report gives no such total", get: figure("liabilities") },
  { key: "equity", about: "Shareholders' equity on the last day of the period, as filed", get: figure("equity") },
  ...RATIOS.map((d): Column<FsRow> => ({ key: d.column, about: `${d.label}: ${d.inputs}${d.percent ? ", as a percentage rounded to one decimal" : ", rounded to two decimals"}. Worked out by this site from two columns of this row, not a filed figure. Blank when either is missing or not shown, or when the one divided by is zero or negative`, get: (r) => fsRatio(r, d.key).value })),
  { key: "not_shown", about: "Figures held back by a check, blank in their column", get: (r) => FS_STORED.filter((c) => r.p.held[c.key]).map((c) => c.key).join("; ") || null },
  { key: "report_form", about: "Form of the newest report used for the period", get: (r) => r.p.form },
  { key: "report_filed", about: "Day that report was filed", get: (r) => r.p.filed },
  { key: "report_url", about: "The report at the SEC", get: (r) => reportUrl(r) },
  { key: "ceo_pay_total", about: "Principal executive officer, total in the Summary Compensation Table for the company's newest fiscal year with one on file, dollars; blank when none", get: (r) => r.c.pay?.peo ?? null },
  { key: "ceo_pay_fiscal_year_end", about: "Last day of the fiscal year that pay covers", get: (r) => r.c.pay?.fye ?? null },
];
/** Every company a view matches, in the view's order (all pages), as CSV text. Made in the browser. */
export function fsViewCsv(all: readonly FsCompany[], v: FsView): string {
  return toCsv(CSV_COLUMNS, sortFsRows(rowsFor(all, v.f.period).filter((r) => finMatches(r, v.f)), v.sort, v.dir));
}
export function fsViewCsvName(v: FsView, built: string): string {
  const f = v.f;
  const bits = [f.period === "quarter" ? "quarter" : "fiscal-year", f.division, f.unit, f.rmin ? `revmin${f.rmin}` : "", f.rmax ? `revmax${f.rmax}` : "", f.ni ? `ni-${f.ni}` : "", f.amin ? `assetsmin${f.amin}` : "", f.pay ? "pay-on-file" : "", f.recent ? "ended-last-18-months" : "", f.q.trim() ? "filtered" : ""]
    .filter(Boolean).map((b) => String(b).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return `company-financials-${bits.join("-")}-${built}.csv`;
}

/** One line for the build log, for comparison with SQL. */
export function finScreenLog(all: readonly FsCompany[]): string {
  const y = rowsFor(all, "year"), q = rowsFor(all, "quarter");
  const hit = (rows: FsRow[], f: Partial<FsFilter>) => rows.filter((r) => finMatches(r, { ...NO_FS_FILTER, ...f })).length;
  const held = (rows: FsRow[]) => rows.reduce((s, r) => s + FS_STORED.filter((c) => r.p.held[c.key]).length, 0);
  const ratios = (rows: FsRow[]) => RATIOS.map((d) => {
    const cells = rows.map((r) => fsRatio(r, d.key)), okc = cells.filter((x) => x.status === "ok");
    return `${d.label.toLowerCase()} worked out for ${okc.length} (${okc.filter((x) => Math.abs(x.value!) > d.cap).length} beyond ${d.cap}${d.percent ? "%" : ""}), ${RATIO_NA} for ${cells.filter((x) => x.status === "base").length}`;
  }).join("; ");
  const liab = (rows: FsRow[]) => rows.filter((r) => r.p.v.liabilities != null).length;
  const div = new Map<string, number>();
  for (const r of y) { const k = r.c.division?.name ?? "no division"; div.set(k, (div.get(k) ?? 0) + 1); }
  const divs = [...div].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(", ");
  return `financials screener: ${all.length} companies, ${y.length} with a fiscal year, ${q.length} with a quarter; ${all.filter((c) => c.unit !== "USD").length} not in dollars; fiscal year: revenue in dollars ${y.filter((r) => usd(r, "revenue") != null).length}, ${REV_MIN_STEPS.map((s) => `at least ${s} ${hit(y, { rmin: s })}`).join(", ")}, at most ${REV_MAX_STEPS[0]} ${hit(y, { rmax: REV_MAX_STEPS[0] })}; net income above zero ${hit(y, { ni: "pos" })}, below zero ${hit(y, { ni: "neg" })}; total assets at least ${ASSET_MIN_STEPS[2]} ${hit(y, { amin: ASSET_MIN_STEPS[2] })}; executive pay on file ${hit(y, { pay: 1 })} of ${y.length}, newest pay year ends ${all.map((c) => c.pay?.fye ?? "").filter(Boolean).sort().at(-1) ?? "-"}; figures not shown ${held(y)} (fiscal year), ${held(q)} (quarter); newest fiscal year ends ${y.map((r) => r.p.end).sort()[0] ?? "-"} to ${y.map((r) => r.p.end).sort().at(-1) ?? "-"}; ended in the last ${RECENT_DAYS} days: ${hit(y, { recent: 1 })} of ${y.length} fiscal years, ${hit(q, { recent: 1 })} of ${q.length} quarters; ratio columns, fiscal year: total liabilities on file ${liab(y)}; ${ratios(y)}; quarter: total liabilities on file ${liab(q)}; ${ratios(q)}; by division: ${divs}`;
}
