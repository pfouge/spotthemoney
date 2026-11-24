// The home page's first screen: route tiles (one per dataset, a live figure and a 12-week sparkline) and,
// for the "search first" direction, the most recently active tickers and members. Pure: hometop-build.ts
// turns the build model into HomeInputs. Counts only, each by the dataset's own date, never a future date.
import { inWindow } from "./hubscreen";

export const ROUTE_DAYS = 30;
export const SPARK_WEEKS = 12;

export interface RouteTile {
  key: string;
  label: string;
  /** The label with its window, for the compact tiles that carry no caption. */
  shortLabel: string;
  href: string;
  figure: string;
  /** What the figure counts and over which window ("disclosed, last 30 days"). */
  unit: string;
  caption: string;
  /** Count per week, oldest first, for the last SPARK_WEEKS weeks up to the build day. Empty when the tile has none. */
  spark: number[];
}

/** Dates of one dataset (its own date), or null when the dataset is not shown in this build. */
export interface Dated { dates: readonly (string | null | undefined)[] }
export interface HomeInputs {
  built: string;
  congress: (Dated & { members: number }) | null;
  insiders: (Dated & { companies: number }) | null;
  stocks: { pages: number } | null;
  planned: Dated | null;
  holders: Dated | null;
  events: Dated | null;
  votes: Dated | null;
  lobbying: Dated | null;
  contracts: Dated | null;
  donations: { receipts: number; committees: number; windowDays: number } | null;
  rates: { tenYear: string; ibond: string } | null;
}

const DAY = 86_400_000;
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
const t0 = (s: string): number => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const fmtN = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Rows in the window (both edges inclusive, the hubs' rule). */
export function countIn(dates: Dated["dates"], built: string, days = ROUTE_DAYS): number {
  let n = 0;
  for (const d of dates) { const s = d?.slice(0, 10); if (s && inWindow(s, built, days)) n++; }
  return n;
}

/** Counts per 7-day bucket, oldest first, the last bucket ending on the build day. A date after the build day or older than the buckets is not counted. */
export function weeklyCounts(dates: Dated["dates"], built: string, weeks = SPARK_WEEKS): number[] {
  const out = new Array<number>(weeks).fill(0);
  if (!isDay(built)) return out;
  const b = t0(built);
  for (const d of dates) {
    const s = d?.slice(0, 10);
    if (!s || !isDay(s)) continue;
    const age = Math.round((b - t0(s)) / DAY);
    if (age < 0 || age >= weeks * 7) continue;
    out[weeks - 1 - Math.floor(age / 7)]!++;
  }
  return out;
}

const plain = (n: number, one: string, many = one + "s") => `${fmtN(n)} ${n === 1 ? one : many}`;

export function buildRoutes(x: HomeInputs): RouteTile[] {
  const out: RouteTile[] = [];
  const dated = (key: string, label: string, href: string, d: Dated, unit: string, caption: string, win = `${ROUTE_DAYS} days`) => {
    out.push({ key, label, shortLabel: `${label}, ${win}`, href, figure: fmtN(countIn(d.dates, x.built)), unit, caption, spark: weeklyCounts(d.dates, x.built) });
  };
  if (x.congress) dated("congress", "Congress trades", "/congress/", x.congress, "disclosed, last 30 days", `${plain(x.congress.members, "member")} on record`);
  if (x.insiders) dated("insiders", "Insider trades", "/insiders/", x.insiders, "open-market, filed in 30 days", plain(x.insiders.companies, "company", "companies"));
  if (x.stocks) out.push({ key: "stocks", label: "Stocks and companies", shortLabel: "Stocks and companies", href: "/stocks/", figure: fmtN(x.stocks.pages), unit: "tickers with a page", caption: "trades, holders, records", spark: [] });
  if (x.planned) dated("planned", "Planned sales", "/planned-sales/", x.planned, "Form 144 notices, 30 days", "intended sales");
  if (x.holders) dated("holders", "Large holders", "/large-holders/", x.holders, "13D and 13G, 30 days", "owners of over 5%");
  if (x.events) dated("events", "Company events", "/company-events/", x.events, "8-K reports, 30 days", "what companies report");
  if (x.votes) dated("votes", "Votes", "/congress-votes/", x.votes, "roll calls, 30 days", "House and Senate");
  if (x.lobbying) dated("lobbying", "Lobbying", "/lobbying/", x.lobbying, "filings posted, 30 days", "Senate LDA reports");
  if (x.contracts) dated("contracts", "Federal contracts", "/contracts/", x.contracts, "awards started, 30 days", "USAspending");
  if (x.donations) out.push({ key: "donations", label: "Donations", shortLabel: `Donations, ${x.donations.windowDays} days`, href: "/donations/", figure: fmtN(x.donations.receipts), unit: `receipts held on this site, ${x.donations.windowDays} days`, caption: `${plain(x.donations.committees, "committee")}; a sample, not a total`, spark: [] });
  if (x.rates) out.push({ key: "rates", label: "Rates", shortLabel: "10-year Treasury", href: "/rates/", figure: x.rates.tenYear, unit: "10-year Treasury yield", caption: `I-bond composite ${x.rates.ibond}`, spark: [] });
  return out;
}

export const routesLog = (r: readonly RouteTile[]): string => `[web] home routes: ${r.length ? r.map((t) => `${t.key} ${t.figure}`).join(", ") : "none"}`;

// ── "Recently active" (direction B) ─────────────────────────────────────────────────────────
export interface ActiveItem { key: string; text: string; href: string; n: number }
/** The `n` entries with the most rows in the window; ties by name. Counts only. */
export function topActive(rows: readonly { key: string; text: string; href: string | null; date: string | null }[], built: string, n = 3, days = ROUTE_DAYS): ActiveItem[] {
  const by = new Map<string, ActiveItem>();
  for (const r of rows) {
    const d = r.date?.slice(0, 10);
    if (!r.href || !d || !inWindow(d, built, days)) continue;
    const cur = by.get(r.key);
    if (cur) cur.n++; else by.set(r.key, { key: r.key, text: r.text, href: r.href, n: 1 });
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text)).slice(0, n);
}
