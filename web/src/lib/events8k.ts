// Company events: SEC Form 8-K reports on stock and company pages and on /company-events/.
//
// A Form 8-K is the company's own report that something happened. The SEC assigns each kind of event an
// item number and a fixed heading (shared/src/events8k.ts). This site lists the reports and their items
// and nothing more. Rules that follow:
//   - Nothing is derived from a report: the text is not read, no report is called good or bad news, and
//     no report is placed beside any trade on a page.
//   - An amendment (8-K/A) is its own row. The form does not say which report it amends, so nothing
//     links them.
//   - Item 9.01 (financial statements and exhibits) is on most reports. It is printed last in a
//     row and in soft ink, and it is left out of "the most frequent items".
//   - Counts and dates only. A company with a page here is a company whose CIK matches a report.
//
// Pure: lib/events8k-build.ts runs the query and wires the model. Tests: scripts/events8k.test.ts.
import { EVENT_ITEMS, EVENTS_FLOOR } from "@stm/shared";
import { csvCell, toCsv, type Column } from "./csv";

export { EVENT_ITEMS, EVENTS_FLOOR };

export const EVENTS_PATH = "/company-events/";
export const EVENTS_DATA = "/data/company-events.json";
/** Reports a company's table shows. */
export const EVENT_ROWS = 15;
/** The window of the summary, the item table and the hub, counted back from the build day. */
export const EVENT_WINDOW_DAYS = 365;
export const EVENT_CAVEAT =
  "A Form 8-K is the company's own report that something happened. The item names are the headings the SEC assigns to each kind of event. This site lists the reports and their items and does not read or summarise their text.";
/** The item that carries the financial statements and exhibits attached to another item. */
export const EXHIBITS_ITEM = "9.01";

export interface CompanyEvent {
  accession: string;
  cik: string;                     // 10 digits
  form: string;                    // "8-K" or "8-K/A"
  filed: string;                   // YYYY-MM-DD
  reportDate: string | null;       // the date of the event the report states
  items: string[];                 // item numbers as filed ("2.02")
  sourceUrl: string | null;
}
export interface EventsData {
  byCik: Map<string, CompanyEvent[]>;
  /** Newest filing date over everything read, or null. */
  newestFiled: string | null;
  /** Reports read, over every company (with or without a page). */
  rows: number;
}
export const emptyEvents = (): EventsData => ({ byCik: new Map(), newestFiled: null, rows: 0 });

const DAY = 86_400_000;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const t0 = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
const n = (x: number) => x.toLocaleString("en-US");
const pl = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

export const isAmendment = (e: Pick<CompanyEvent, "form">): boolean => e.form === "8-K/A";
/** Newest filed first; ties by accession, newest first, so the order is the same in every build. */
export function sortEvents(xs: readonly CompanyEvent[]): CompanyEvent[] {
  return [...xs].sort((a, b) => b.filed.localeCompare(a.filed) || b.accession.localeCompare(a.accession));
}
/** A company's reports filed in the window ending on the build day (never after it), newest first. */
export function eventsInWindow(xs: readonly CompanyEvent[], builtAt: string, days = EVENT_WINDOW_DAYS): CompanyEvent[] {
  const end = t0(builtAt);
  if (Number.isNaN(end)) return [];
  const start = end - days * DAY;
  return sortEvents(xs.filter((e) => isDate(e.filed) && t0(e.filed) <= end && t0(e.filed) >= start));
}

// ── items ────────────────────────────────────────────────────────────────────────────────
const itemKey = (i: string) => i.split(".").map((p) => p.padStart(2, "0")).join(".");
/** Item numbers in print order: ascending, with 9.01 last; repeats dropped; text that is not an item number dropped. */
export function orderItems(items: readonly string[]): string[] {
  const clean = [...new Set(items.map((i) => i.trim()).filter((i) => /^\d{1,2}\.\d{2}$/.test(i)))];
  return clean.sort((a, b) => (a === EXHIBITS_ITEM ? 1 : 0) - (b === EXHIBITS_ITEM ? 1 : 0) || itemKey(a).localeCompare(itemKey(b)));
}
/** The SEC's heading for an item, or null for a number it has no heading for. */
export const itemHeading = (item: string): string | null => EVENT_ITEMS[item] ?? null;
/** "2.02 Results of Operations and Financial Condition". */
export const itemLabel = (item: string): string => { const h = itemHeading(item); return h ? `${item} ${h}` : item; };

export interface ItemCount { item: string; heading: string | null; reports: number }
/** Reports per item over the reports given, most reports first, then item number. */
export function itemCounts(xs: readonly CompanyEvent[]): ItemCount[] {
  const by = new Map<string, number>();
  for (const e of xs) for (const i of orderItems(e.items)) by.set(i, (by.get(i) ?? 0) + 1);
  return [...by].map(([item, reports]) => ({ item, heading: itemHeading(item), reports }))
    .sort((a, b) => b.reports - a.reports || itemKey(a.item).localeCompare(itemKey(b.item)));
}
/** The most frequent items other than 9.01, with their counts. */
export function topItems(xs: readonly CompanyEvent[], count = 3): ItemCount[] {
  return itemCounts(xs).filter((c) => c.item !== EXHIBITS_ITEM).slice(0, count);
}

export interface EventSummary { reports: number; amendments: number; newest: string | null; top: ItemCount[] }
export function eventSummary(rows: readonly CompanyEvent[]): EventSummary {
  return { reports: rows.length, amendments: rows.filter(isAmendment).length, newest: rows[0]?.filed ?? null, top: topItems(rows) };
}
/** The sentence over a company's table: counts only. */
export function summarySentence(name: string, s: EventSummary): string {
  const head = `${name} filed ${pl(s.reports, "Form 8-K report")} in the last 12 months`;
  const amend = s.amendments > 0 ? `, ${s.amendments === 1 ? "one of them an amendment" : `${n(s.amendments)} of them amendments`}` : "";
  const top = s.top.length
    ? `. The items named most often, apart from 9.01, are ${s.top.map((t) => `${t.item} ${t.heading ?? ""} (${pl(t.reports, "report")})`.replace("  ", " ")).join("; ")}.`
    : ".";
  return `${head}${amend}${top}`;
}

/** Text from a filing, cleaned for printing: control and direction characters out, white space collapsed. */
export function cleanText(s: unknown, max = 200): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}
/** A report address that is safe to link: https on sec.gov. */
export function safeUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try { const x = new URL(u); return x.protocol === "https:" && (x.hostname === "www.sec.gov" || x.hostname === "sec.gov") ? x.href : null; } catch { return null; }
}

// ── the hub: /company-events/ ────────────────────────────────────────────────────────────
export const HUB_WINDOWS = [7, 30, 90, 365] as const;
export const HUB_WINDOW_LABEL: Record<number, string> = { 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days", 365: "Last 12 months" };
export const PER_PAGE = [25, 50, 100] as const;
export const DEFAULT_PER = 50;
export const FORMS = ["report", "amendment"] as const;
export const FORM_LABEL: Record<string, string> = { report: "Reports (8-K)", amendment: "Amendments (8-K/A)" };
export const SORT_KEYS = ["filed", "company"] as const;
export type HubSortKey = (typeof SORT_KEYS)[number];

/** One company in the hub file. */
export interface HubCompany { name: string; path: string; ticker: string; cik: string; division: { name: string; slug: string } | null }
/** One report in the hub file: [company index, filed, event date or "", 1 for an amendment, item numbers joined by a space, accession, document]
 *  where the document is the part of the address after https://www.sec.gov/Archives/edgar/data/<cik>/<accession without dashes>/ when the
 *  address has that shape, or the whole address, or "" when there is none. */
export type PackedEvent = [number, string, string, 0 | 1, string, string, string];
export interface HubData {
  built: string;
  divisions: { name: string; slug: string }[];
  /** Company: [name, page path, ticker, CIK, division index or -1]. */
  companies: [string, string, string, string, number][];
  rows: PackedEvent[];
}
export interface HubRow { c: HubCompany; e: CompanyEvent }

const EDGAR = "https://www.sec.gov/Archives/edgar/data/";
export function eventUrl(cik: string, accession: string, doc: string): string | null {
  if (!doc) return null;
  if (/^https?:\/\//i.test(doc)) return safeUrl(doc);
  if (!/^\d{10}$/.test(cik) || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || /[\/\\?#]/.test(doc)) return null;
  return `${EDGAR}${Number(cik)}/${accession.replaceAll("-", "")}/${doc}`;
}
function packDoc(e: CompanyEvent): string {
  const u = safeUrl(e.sourceUrl);
  if (!u) return "";
  const prefix = `${EDGAR}${Number(e.cik)}/${e.accession.replaceAll("-", "")}/`;
  return u.startsWith(prefix) && !/[?#]/.test(u.slice(prefix.length)) && u.length > prefix.length ? u.slice(prefix.length) : u;
}
/** Rows for the hub: every report filed in the window by a company with a page. */
export function packHub(built: string, companies: readonly HubCompany[], events: ReadonlyMap<string, readonly CompanyEvent[]>): HubData {
  const divisions: { name: string; slug: string }[] = [];
  const dix = new Map<string, number>();
  for (const c of [...companies].sort((a, b) => (a.division?.name ?? "").localeCompare(b.division?.name ?? ""))) {
    if (c.division && !dix.has(c.division.slug)) dix.set(c.division.slug, divisions.push(c.division) - 1);
  }
  const rows: PackedEvent[] = [];
  const cs: HubData["companies"] = [];
  for (const c of companies) {
    const xs = eventsInWindow(events.get(c.cik) ?? [], built);
    if (!xs.length) continue;
    const ci = cs.push([c.name, c.path, c.ticker, c.cik, c.division ? dix.get(c.division.slug)! : -1]) - 1;
    for (const e of xs) rows.push([ci, e.filed, e.reportDate ?? "", isAmendment(e) ? 1 : 0, orderItems(e.items).join(" "), e.accession, packDoc(e)]);
  }
  rows.sort((a, b) => b[1].localeCompare(a[1]) || b[5].localeCompare(a[5]));
  return { built, divisions, companies: cs, rows };
}
export function unpackHub(d: HubData): HubRow[] {
  const cos: HubCompany[] = d.companies.map((c) => ({ name: c[0], path: c[1], ticker: c[2], cik: c[3], division: d.divisions[c[4]] ?? null }));
  return d.rows.map((r) => {
    const c = cos[r[0]]!;
    return { c, e: { accession: r[5], cik: c.cik, form: r[3] ? "8-K/A" : "8-K", filed: r[1], reportDate: r[2] || null, items: r[4] ? r[4].split(" ") : [], sourceUrl: eventUrl(c.cik, r[5], r[6]) } };
  });
}

export interface HubFilter { q: string; item: string; division: string; form: "" | "report" | "amendment"; w: number }
export const NO_HUB_FILTER: HubFilter = { q: "", item: "", division: "", form: "", w: 30 };
export interface HubView { f: HubFilter; sort: HubSortKey; dir: "asc" | "desc"; page: number; per: number }
export const DEFAULT_HUB_VIEW: HubView = { f: NO_HUB_FILTER, sort: "filed", dir: "desc", page: 1, per: DEFAULT_PER };
export const firstHubDir = (k: HubSortKey): "asc" | "desc" => (k === "company" ? "asc" : "desc");

export function hubMatches(r: HubRow, f: HubFilter, built: string): boolean {
  const end = t0(built), t = t0(r.e.filed);
  if (Number.isNaN(end) || t > end || t < end - f.w * DAY) return false;
  if (f.item && !r.e.items.includes(f.item)) return false;
  if (f.division && r.c.division?.slug !== f.division) return false;
  if (f.form === "report" && isAmendment(r.e)) return false;
  if (f.form === "amendment" && !isAmendment(r.e)) return false;
  const q = f.q.trim().toLowerCase();
  if (q) { const hay = `${r.c.name} ${r.c.ticker}`.toLowerCase(); for (const word of q.split(/\s+/)) if (!hay.includes(word)) return false; }
  return true;
}
export function sortHub(rows: readonly HubRow[], k: HubSortKey, dir: "asc" | "desc"): HubRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (k === "company") {
      const x = a.c.name.toLowerCase(), y = b.c.name.toLowerCase();
      if (x !== y) return x < y ? -sign : sign;
      return b.e.filed.localeCompare(a.e.filed) || b.e.accession.localeCompare(a.e.accession);
    }
    if (a.e.filed !== b.e.filed) return a.e.filed < b.e.filed ? -sign : sign;
    return b.e.accession.localeCompare(a.e.accession);
  });
}
export interface HubResult { rows: HubRow[]; total: number; companies: number; all: number; page: number; pages: number; from: number; to: number }
export function hubScreen(all: readonly HubRow[], v: HubView, built: string): HubResult {
  const sorted = sortHub(all.filter((r) => hubMatches(r, v.f, built)), v.sort, v.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / v.per));
  const page = Math.min(Math.max(1, v.page), pages);
  const from = (page - 1) * v.per;
  const rows = sorted.slice(from, from + v.per);
  return { rows, total: sorted.length, companies: new Set(sorted.map((r) => r.c.cik)).size, all: all.length, page, pages, from: rows.length ? from + 1 : 0, to: from + rows.length };
}
export function hubSummaryLine(r: HubResult): string {
  if (r.total === 0) return r.all === 0 ? "No report is on file yet." : "No report matches these filters.";
  return `${pl(r.total, "report")} from ${pl(r.companies, "company", "companies")}. Showing ${n(r.from)} to ${n(r.to)}.`;
}
export function hubShortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
/** The item options the filter offers: every item on a report in the whole file, most reports first. */
export function hubItemOptions(all: readonly HubRow[]): ItemCount[] {
  return itemCounts(all.map((r) => r.e));
}

// ── the address ──────────────────────────────────────────────────────────────────────────
export const HUB_KEYS = ["q", "item", "division", "form", "w", "sort", "dir", "page", "n"];
export function isHubViewHash(hash: string): boolean {
  if (!hash.includes("=")) return false;
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return HUB_KEYS.some((k) => p.has(k));
}
export function isDefaultHubFilter(f: HubFilter): boolean { return !f.q.trim() && !f.item && !f.division && !f.form && f.w === NO_HUB_FILTER.w; }
export function parseHubHash(hash: string): HubView {
  const f: HubFilter = { ...NO_HUB_FILTER };
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const it = p.get("item") ?? ""; if (/^\d{1,2}\.\d{2}$/.test(it)) f.item = it;
  const dv = (p.get("division") ?? "").toLowerCase(); if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dv) && dv.length <= 80) f.division = dv;
  const fm = p.get("form"); if (fm === "report" || fm === "amendment") f.form = fm;
  const w = Number(p.get("w")); if ((HUB_WINDOWS as readonly number[]).includes(w)) f.w = w;
  f.q = (p.get("q") ?? "").slice(0, 60);
  const so = p.get("sort") ?? ""; const sort = (SORT_KEYS as readonly string[]).includes(so) ? (so as HubSortKey) : DEFAULT_HUB_VIEW.sort;
  const di = p.get("dir"); const dir = di === "asc" || di === "desc" ? di : firstHubDir(sort);
  const pg = Number(p.get("page")); const page = Number.isInteger(pg) && pg >= 1 && pg <= 100000 ? pg : 1;
  const pe = Number(p.get("n")); const per = (PER_PAGE as readonly number[]).includes(pe) ? pe : DEFAULT_PER;
  return { f, sort, dir, page, per };
}
export function toHubHash(v: HubView): string {
  const p = new URLSearchParams(), f = v.f;
  if (f.item) p.set("item", f.item);
  if (f.division) p.set("division", f.division);
  if (f.form) p.set("form", f.form);
  if (f.w !== NO_HUB_FILTER.w) p.set("w", String(f.w));
  if (f.q.trim()) p.set("q", f.q.trim());
  if (v.sort !== DEFAULT_HUB_VIEW.sort || v.dir !== firstHubDir(v.sort)) { p.set("sort", v.sort); p.set("dir", v.dir); }
  if (v.page > 1) p.set("page", String(v.page));
  if (v.per !== DEFAULT_PER) p.set("n", String(v.per));
  const s = p.toString();
  return s ? `#${s}` : "";
}

// ── files ────────────────────────────────────────────────────────────────────────────────
export interface EventCsvRow { company: string; cik: string; ticker: string; pagePath: string | null; e: CompanyEvent }
export const eventHeadings = (items: readonly string[]): string => orderItems(items).map((i) => itemHeading(i) ?? "").join(" | ");
export const EVENT_CSV_COLUMNS: Column<EventCsvRow>[] = [
  { key: "company", about: "The company, as this site names it", get: (r) => r.company },
  { key: "cik", about: "The company's SEC number, ten digits", get: (r) => r.cik },
  { key: "ticker", about: "The company's main ticker on this site", get: (r) => r.ticker },
  { key: "form", about: "8-K, or 8-K/A for an amendment", get: (r) => r.e.form },
  { key: "filed", about: "Day the report was filed", get: (r) => r.e.filed },
  { key: "event_date", about: "The date of the event, as the report states it", get: (r) => r.e.reportDate },
  { key: "items", about: "Item numbers the report names, separated by semicolons, 9.01 last", get: (r) => orderItems(r.e.items).join("; ") },
  { key: "item_headings", about: "The SEC's heading for each item, in the same order, separated by a vertical bar (a heading can itself contain semicolons)", get: (r) => eventHeadings(r.e.items) },
  { key: "accession", about: "The report's accession number at the SEC", get: (r) => r.e.accession },
  { key: "source_url", about: "The report at the SEC", get: (r) => safeUrl(r.e.sourceUrl) },
  { key: "page_url", about: "The company's page on this site", get: (r) => r.pagePath },
];
const HUB_CSV_COLUMNS: Column<HubRow>[] = EVENT_CSV_COLUMNS.map((c) => ({ ...c, get: (r: HubRow) => c.get({ company: r.c.name, cik: r.c.cik, ticker: r.c.ticker, pagePath: r.c.path ? `https://spotthemoney.com${r.c.path}` : null, e: r.e }) }));
/** Every report a view matches, in the view's order (all pages), as CSV text. Made in the browser. */
export function hubViewCsv(all: readonly HubRow[], v: HubView, built: string): string {
  return toCsv(HUB_CSV_COLUMNS, sortHub(all.filter((r) => hubMatches(r, v.f, built)), v.sort, v.dir));
}
export function hubViewCsvName(v: HubView, built: string): string {
  const f = v.f;
  const bits = [f.item ? `item${f.item}` : "", f.division, f.form, `${f.w}d`, f.q.trim() ? "filtered" : ""].filter(Boolean).map((b) => String(b).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return `company-events-${bits.join("-")}-${built}.csv`;
}

/** One line for the build log, for comparison with SQL. */
export function eventsLog(d: EventsData, builtAt: string, companyCiks: ReadonlySet<string>): string {
  let rows = 0, cos = 0, amend = 0, inWindow = 0, cosInWindow = 0, capped = 0, newest = "";
  const items = new Map<string, number>();
  for (const [cik, xs] of d.byCik) {
    if (!companyCiks.has(cik)) continue;
    rows += xs.length; cos++;
    amend += xs.filter(isAmendment).length;
    const w = eventsInWindow(xs, builtAt);
    inWindow += w.length;
    if (w.length) cosInWindow++;
    if (w.length > EVENT_ROWS) capped++;
    for (const e of w) for (const i of orderItems(e.items)) items.set(i, (items.get(i) ?? 0) + 1);
    for (const e of xs) if (e.filed > newest) newest = e.filed;
  }
  const top = [...items].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(", ");
  return `company events (Form 8-K): ${rows} reports for ${cos} companies on the site (${amend} amendments), newest ${newest || "none"}; ${inWindow} filed in the last ${EVENT_WINDOW_DAYS} days for ${cosInWindow} companies; ${capped} companies with more than ${EVENT_ROWS}; reports per item in the window: ${top || "none"}`;
}

// Re-export so a caller needs one import for the csv cell helper in tests.
export { csvCell };
