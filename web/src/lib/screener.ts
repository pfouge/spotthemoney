// Congress trade screener (/congress-trades/): every published row of the House and Senate
// periodic transaction reports on record in one filterable, sortable table.
// Pure: the build packs the rows with `screenerData` (pages/data/congress-screener.json.ts), the
// page renders its first rows with `screen`, and the browser script (scripts/screener.ts) and the
// unit tests use the same `matches`, `screen`, `parseHash` and `toHash`, so the page, the script
// and the tests cannot disagree about what a filter means.
// Everything here is a count, a date or a value from a filing or the roster. Amounts are the
// ranges the reports give; nothing is added up in dollars. A committee seat is context: nothing
// links a trade to a committee.
import type { Flagship, Person, Txn } from "./flagship";
import { CONGRESS_DEADLINE_DAYS, money } from "./flagship-core";
import { toCsv, type Column } from "./csv";
import { partyKey, seatCode, topCommittee, daysBetween, sortName, type PartyKey } from "./directory";

// ── data ─────────────────────────────────────────────────────────────────────────────────
export interface ScreenMember {
  /** Name as on the member's page, and the page's path (null when the member has no page). */
  n: string; p: string | null;
  ch: "house" | "senate" | ""; pa: PartyKey;
  /** State code and seat ("TX-21", "TX"). */
  st: string; se: string;
  /** Codes of the full committees the member sits on today. */
  c: string[];
  /** 1 when the member has left office. */
  f?: 1;
}
/** One row, packed: [id, member index, ticker or "", asset type, side, owner, trade date or "",
 *  disclosure date, lag in days or -1, low end or -1, high end or -1, filing index]. */
export type PackedRow = [number, number, string, string, string, string, string, string, number, number, number, number];
export interface ScreenData {
  /** The day the file was built (YYYY-MM-DD): date windows count back from it. */
  built: string;
  members: ScreenMember[];
  /** Link to each original report. */
  filings: string[];
  rows: PackedRow[];
}
export interface ScreenRow {
  id: number; m: ScreenMember; ticker: string; asset: string; side: string; owner: string;
  txn: string | null; disc: string; lag: number | null; low: number | null; high: number | null; url: string;
}

/** The rows the screener holds: published rows of congressional reports that carry a disclosure date. */
export function screenerTxns(m: Flagship): Txn[] {
  return m.txns.filter((t) => t.source !== "sec_form4" && t.isPublished && !!t.disclosedAt && t.personId != null);
}

export function screenerData(m: Flagship, today: string, path: (p: Person) => string | null): ScreenData {
  const members: ScreenMember[] = [], memberIdx = new Map<number, number>();
  const filings: string[] = [], filingIdx = new Map<number, number>();
  const rows: PackedRow[] = [];
  for (const t of screenerTxns(m)) {
    const p = m.people.get(t.personId!);
    if (!p) continue;
    let mi = memberIdx.get(p.id);
    if (mi == null) {
      const role = p.roles.find((r) => r.kind === "congress");
      const st = (role?.state ?? "").toUpperCase();
      const mem: ScreenMember = {
        n: p.name, p: path(p), ch: role?.chamber ?? "", pa: partyKey(role?.party), st,
        se: seatCode(role?.chamber ?? null, st || null, role?.district ?? null),
        c: [...new Set((m.seats.get(p.id) ?? []).map(topCommittee))].sort(),
      };
      if (role?.validTo && role.validTo.slice(0, 10) < today) mem.f = 1;
      mi = members.push(mem) - 1;
      memberIdx.set(p.id, mi);
    }
    let fi = filingIdx.get(t.filingId);
    if (fi == null) { fi = filings.push(t.sourceUrl ?? "") - 1; filingIdx.set(t.filingId, fi); }
    const s = t.securityId != null ? m.securities.get(t.securityId) : undefined;
    rows.push([
      t.id, mi, s?.ticker ?? "", t.assetType ?? "", t.side, t.ownerType ?? "",
      t.txnDate?.slice(0, 10) ?? "", t.disclosedAt!.slice(0, 10), t.lagDays ?? -1, t.amountLow ?? -1, t.amountHigh ?? -1, fi,
    ]);
  }
  return { built: today, members, filings, rows };
}

export function unpack(d: ScreenData): ScreenRow[] {
  return d.rows.map((r) => ({
    id: r[0], m: d.members[r[1]], ticker: r[2], asset: r[3], side: r[4], owner: r[5],
    txn: r[6] || null, disc: r[7], lag: r[8] < 0 ? null : r[8], low: r[9] < 0 ? null : r[9], high: r[10] < 0 ? null : r[10],
    url: d.filings[r[11]] ?? "",
  }));
}

// ── filters ──────────────────────────────────────────────────────────────────────────────
export const SIDES = ["buy", "sell", "exchange"] as const;
export const SIDE_LABEL: Record<string, string> = { buy: "Buy", sell: "Sell", exchange: "Exchange" };
export const SIDE_OPTION: Record<string, string> = { buy: "Purchases", sell: "Sales", exchange: "Exchanges" };
export const OWNERS = ["self", "spouse", "joint", "dependent"] as const;
export const OWNER_LABEL: Record<string, string> = { self: "Self", spouse: "Spouse", joint: "Joint", dependent: "Dependent child" };
/** Amount steps: a row passes when the LOW end of its reported range is at least the step. */
export const MIN_STEPS = [15001, 50001, 100001, 250001, 500001, 1000000] as const;
export const WINDOWS = [30, 90, 365] as const;
export const WINDOW_LABEL: Record<number, string> = { 30: "Disclosed in the last 30 days", 90: "Disclosed in the last 90 days", 365: "Disclosed in the last 12 months" };
export const PER_PAGE = [25, 50, 100] as const;
export const DEFAULT_PER = 50;
export const SORT_KEYS = ["disclosed", "trade", "member", "ticker", "lag", "amount"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface ScreenFilter {
  q: string; chamber: "" | "house" | "senate"; party: PartyKey; state: string; committee: string;
  side: "" | (typeof SIDES)[number]; min: number; owner: "" | (typeof OWNERS)[number];
  /** "ticker": rows with a ticker symbol; "other": rows without one (bonds, funds, other assets). */
  asset: "" | "ticker" | "other";
  /** Disclosure window in days back from the build day; 0 = any date. */
  w: 0 | 30 | 90 | 365;
  /** "late": reported after the deadline; "ontime": within it. */
  late: "" | "late" | "ontime";
  /** Exactly one member, by the slug of the member's page ("kevin-hern"); "" = any. Set by a link
   *  from a member page, shown on the screener as a removable line, not a control. */
  member: string;
  /** Exactly one ticker symbol, upper case ("NVDA"); "" = any. Set by a link from a stock page. */
  ticker: string;
}
export const NO_FILTER: ScreenFilter = { q: "", chamber: "", party: "", state: "", committee: "", side: "", min: 0, owner: "", asset: "", w: 0, late: "", member: "", ticker: "" };
export interface ScreenView { f: ScreenFilter; sort: SortKey; dir: "asc" | "desc"; page: number; per: number }
export const DEFAULT_VIEW: ScreenView = { f: NO_FILTER, sort: "disclosed", dir: "desc", page: 1, per: DEFAULT_PER };

/** Reported after the deadline this site applies to congressional reports. */
export function isLateRow(r: Pick<ScreenRow, "lag">): boolean { return r.lag != null && r.lag > CONGRESS_DEADLINE_DAYS; }

/** The slug of a member's page ("/congress/kevin-hern/" → "kevin-hern"); "" when the member has no page. */
export function memberSlug(m: Pick<ScreenMember, "p">): string { return m.p ? m.p.replace(/\/+$/, "").split("/").pop() ?? "" : ""; }

export function matches(r: ScreenRow, f: ScreenFilter, built: string): boolean {
  if (f.member && memberSlug(r.m) !== f.member) return false;
  if (f.ticker && r.ticker.toUpperCase() !== f.ticker) return false;
  if (f.chamber && r.m.ch !== f.chamber) return false;
  if (f.party && r.m.pa !== f.party) return false;
  if (f.state && r.m.st !== f.state) return false;
  if (f.committee && !r.m.c.includes(f.committee)) return false;
  if (f.side && r.side !== f.side) return false;
  if (f.owner && r.owner !== f.owner) return false;
  if (f.min > 0 && !(r.low != null && r.low >= f.min)) return false;
  if (f.asset === "ticker" && !r.ticker) return false;
  if (f.asset === "other" && r.ticker) return false;
  if (f.late === "late" && !isLateRow(r)) return false;
  if (f.late === "ontime" && (r.lag == null || isLateRow(r))) return false;
  if (f.w > 0) { const age = daysBetween(r.disc, built); if (age < 0 || age > f.w) return false; }
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${r.m.n} ${r.ticker}`.toLowerCase();
    for (const word of q.split(/\s+/)) if (!hay.includes(word)) return false;
  }
  return true;
}

/** The direction a column starts in: text A to Z, dates and numbers largest or newest first. */
export function firstDir(k: SortKey): "asc" | "desc" { return k === "member" || k === "ticker" ? "asc" : "desc"; }

function sortValue(r: ScreenRow, k: SortKey): [number | string | null, number] {
  switch (k) {
    case "disclosed": return [r.disc, 0];
    case "trade": return [r.txn, 0];
    case "member": return [sortName(r.m.n), 0];
    case "ticker": return [r.ticker || null, 0];
    case "lag": return [r.lag, 0];
    // By the low end of the range, then the high end; a range with no top sorts above one with a top.
    case "amount": return r.low == null && r.high == null ? [null, 0] : [r.low ?? 0, r.high ?? Number.MAX_VALUE];
  }
}
/** Sorted copy. Empty values go last in either direction; ties fall back to newest disclosure, then row id. */
export function sortRows(rows: ScreenRow[], k: SortKey, dir: "asc" | "desc"): ScreenRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows.map((r) => ({ r, v: sortValue(r, k) })).sort((a, b) => {
    const x = a.v[0], y = b.v[0];
    if (x == null || y == null) { if (x != null) return -1; if (y != null) return 1; }
    else if (x < y) return -sign; else if (x > y) return sign;
    else if (a.v[1] !== b.v[1]) return a.v[1] < b.v[1] ? -sign : sign;
    return a.r.disc < b.r.disc ? 1 : a.r.disc > b.r.disc ? -1 : b.r.id - a.r.id;
  }).map((x) => x.r);
}

export interface ScreenResult {
  /** The rows of the page asked for. */
  rows: ScreenRow[];
  total: number; members: number; tickers: number; buys: number; sells: number;
  page: number; pages: number; from: number; to: number;
}
export function screen(all: ScreenRow[], v: ScreenView, built: string): ScreenResult {
  const hit = all.filter((r) => matches(r, v.f, built));
  const sorted = sortRows(hit, v.sort, v.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / v.per));
  const page = Math.min(Math.max(1, v.page), pages);
  const from = (page - 1) * v.per;
  const rows = sorted.slice(from, from + v.per);
  return {
    rows, total: hit.length, members: new Set(hit.map((r) => r.m)).size, tickers: new Set(hit.filter((r) => r.ticker).map((r) => r.ticker)).size,
    buys: hit.filter((r) => r.side === "buy").length, sells: hit.filter((r) => r.side === "sell").length,
    page, pages, from: rows.length ? from + 1 : 0, to: from + rows.length,
  };
}

const n = (x: number) => x.toLocaleString("en-US");
const pl = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
/** The count line over the table. Plain counts only. */
export function summaryLine(r: ScreenResult, all: number): string {
  if (r.total === 0) return "No trade matches these filters";
  const head = r.total === all ? `All ${pl(r.total, "trade")}` : `${pl(r.total, "trade")} of ${n(all)}`;
  return `${head} by ${pl(r.members, "member")}: ${pl(r.buys, "purchase")}, ${pl(r.sells, "sale")}, ${pl(r.tickers, "ticker")}. Showing ${n(r.from)} to ${n(r.to)}.`;
}

// ── labels shared by the page and the script ─────────────────────────────────────────────
/** The dollar range as the report gives it, written as on the member pages. */
export function rangeLabel(low: number | null, high: number | null): string {
  if (low != null && high != null) return `${money(low)}–${money(high)}`;
  if (high != null) return `up to ${money(high)}`;
  if (low != null) return `over ${money(low)}`;
  return "";
}
export function minLabel(step: number): string { return `$${n(step)} or more`; }
const ASSET: Record<string, string> = { stock: "stock, no ticker", etf: "ETF", bond: "bond", fund: "fund", hedge_fund: "hedge fund", private_equity: "private equity", option: "option", crypto: "crypto", other: "other asset" };
/** What to print where a row has no ticker. */
export function assetLabel(asset: string): string { return ASSET[asset] ?? (asset ? asset.replace(/_/g, " ") : "no ticker"); }
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export function seatTag(m: ScreenMember): string { return [m.pa, m.se].filter(Boolean).join("-"); }
export function tickerPath(ticker: string): string { return `/stocks/${ticker.toLowerCase()}/`; }

// ── the address ──────────────────────────────────────────────────────────────────────────
export function isDefaultFilter(f: ScreenFilter): boolean {
  return !f.q.trim() && !f.chamber && !f.party && !f.state && !f.committee && !f.side && !f.min && !f.owner && !f.asset && !f.w && !f.late && !f.member && !f.ticker;
}
const KEYS = ["q", "chamber", "party", "state", "committee", "side", "min", "owner", "asset", "w", "late", "member", "ticker", "sort", "dir", "page", "per"];
/** True when a hash is a saved view (carries one of the screener's keys), not a jump link. */
export function isViewHash(hash: string): boolean {
  if (!hash.includes("=")) return false;
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return KEYS.some((k) => p.has(k));
}
/** "#chamber=senate&side=buy&min=100001" → a view. Unknown keys and values are ignored. */
export function parseHash(hash: string): ScreenView {
  const f: ScreenFilter = { ...NO_FILTER };
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const ch = p.get("chamber"); if (ch === "house" || ch === "senate") f.chamber = ch;
  const pa = (p.get("party") ?? "").toUpperCase(); if (pa === "D" || pa === "R" || pa === "I") f.party = pa;
  const st = (p.get("state") ?? "").toUpperCase(); if (/^[A-Z]{2}$/.test(st)) f.state = st;
  const co = (p.get("committee") ?? "").toUpperCase(); if (/^[A-Z0-9]{2,8}$/.test(co)) f.committee = co;
  const si = p.get("side") ?? ""; if ((SIDES as readonly string[]).includes(si)) f.side = si as ScreenFilter["side"];
  const mi = Number(p.get("min")); if ((MIN_STEPS as readonly number[]).includes(mi)) f.min = mi;
  const ow = p.get("owner") ?? ""; if ((OWNERS as readonly string[]).includes(ow)) f.owner = ow as ScreenFilter["owner"];
  const as = p.get("asset"); if (as === "ticker" || as === "other") f.asset = as;
  const w = Number(p.get("w")); if ((WINDOWS as readonly number[]).includes(w)) f.w = w as ScreenFilter["w"];
  const la = p.get("late"); if (la === "late" || la === "ontime") f.late = la;
  const me = (p.get("member") ?? "").toLowerCase(); if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(me) && me.length <= 80) f.member = me;
  const ti = (p.get("ticker") ?? "").toUpperCase(); if (/^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(ti)) f.ticker = ti;
  f.q = (p.get("q") ?? "").slice(0, 60);
  const so = p.get("sort") ?? ""; const sort = (SORT_KEYS as readonly string[]).includes(so) ? (so as SortKey) : DEFAULT_VIEW.sort;
  const di = p.get("dir"); const dir = di === "asc" || di === "desc" ? di : firstDir(sort);
  const pg = Number(p.get("page")); const page = Number.isInteger(pg) && pg >= 1 && pg <= 100000 ? pg : 1;
  const pe = Number(p.get("per")); const per = (PER_PAGE as readonly number[]).includes(pe) ? pe : DEFAULT_PER;
  return { f, sort, dir, page, per };
}
/** The hash for a view; "" for the view the page opens on. */
export function toHash(v: ScreenView): string {
  const p = new URLSearchParams(), f = v.f;
  if (f.chamber) p.set("chamber", f.chamber);
  if (f.party) p.set("party", f.party);
  if (f.state) p.set("state", f.state);
  if (f.committee) p.set("committee", f.committee);
  if (f.side) p.set("side", f.side);
  if (f.min) p.set("min", String(f.min));
  if (f.owner) p.set("owner", f.owner);
  if (f.asset) p.set("asset", f.asset);
  if (f.w) p.set("w", String(f.w));
  if (f.late) p.set("late", f.late);
  if (f.member) p.set("member", f.member);
  if (f.ticker) p.set("ticker", f.ticker);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (v.sort !== DEFAULT_VIEW.sort || v.dir !== firstDir(v.sort)) { p.set("sort", v.sort); p.set("dir", v.dir); }
  if (v.page > 1) p.set("page", String(v.page));
  if (v.per !== DEFAULT_PER) p.set("per", String(v.per));
  const s = p.toString();
  return s ? `#${s}` : "";
}

// ── links into the screener from other pages ─────────────────────────────────────────────
/** The address of the screener narrowed to one committee, one member or one ticker. */
export function screenerHref(f: Partial<Pick<ScreenFilter, "committee" | "member" | "ticker">>): string {
  return `/congress-trades/${toHash({ ...DEFAULT_VIEW, f: { ...NO_FILTER, ...f } })}`;
}
export interface ScreenerCounts {
  /** Rows in the screener, in all. */
  total: number;
  /** Rows by members who sit on each full committee today, by committee code. */
  committee: Map<string, number>;
  /** Rows by each member, by the slug of the member's page. */
  member: Map<string, number>;
  /** Rows in each ticker symbol (upper case). */
  ticker: Map<string, number>;
}
/** How many rows a link into the screener will show, counted with the screener's own `matches`
 *  so the number beside a link is the number the screener opens on. */
export function screenerCounts(d: ScreenData): ScreenerCounts {
  const out: ScreenerCounts = { total: 0, committee: new Map(), member: new Map(), ticker: new Map() };
  const add = (m: Map<string, number>, k: string) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };
  for (const r of unpack(d)) {
    out.total++;
    for (const c of r.m.c) add(out.committee, c);
    add(out.member, memberSlug(r.m));
    add(out.ticker, r.ticker.toUpperCase());
  }
  return out;
}
const countCache = new WeakMap<object, ScreenerCounts>();
/** `screenerCounts` for a build model, worked out once per build (hundreds of pages ask). */
export function screenerCountsFor(m: Flagship, path: (p: Person) => string | null): ScreenerCounts {
  let c = countCache.get(m);
  if (!c) {
    c = screenerCounts(screenerData(m, new Date().toISOString().slice(0, 10), path));
    countCache.set(m, c);
    // Build log: the figures to compare with a direct count on the database.
    const top = (x: Map<string, number>) => [...x].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(", ");
    console.log(`[web] screener links: ${c.total} rows; ${c.committee.size} committees (${top(c.committee)}); ${c.member.size} members (${top(c.member)}); ${c.ticker.size} tickers (${top(c.ticker)})`);
  }
  return c;
}

// ── the rows on screen as a CSV file ─────────────────────────────────────────────────────
// Column names follow /downloads/congress-trades.csv where the meaning is the same.
const CSV_COLUMNS: Column<ScreenRow>[] = [
  { key: "trade_id", about: "Row id on this site", get: (r) => r.id },
  { key: "filer", about: "Member who filed the report", get: (r) => r.m.n },
  { key: "chamber", about: "house or senate", get: (r) => r.m.ch },
  { key: "party", about: "D, R or I", get: (r) => r.m.pa },
  { key: "state", about: "State code", get: (r) => r.m.st },
  { key: "seat", about: "State, and district for a representative", get: (r) => r.m.se },
  { key: "ticker", about: "Ticker symbol, blank when the report gives none", get: (r) => r.ticker },
  { key: "asset_type", about: "Asset type as read from the report", get: (r) => r.asset },
  { key: "side", about: "buy, sell or exchange", get: (r) => r.side },
  { key: "owner", about: "Whose asset", get: (r) => r.owner },
  { key: "trade_date", about: "Trade date", get: (r) => r.txn },
  { key: "disclosed_date", about: "Day the report was filed", get: (r) => r.disc },
  { key: "lag_days", about: "Days from trade to report", get: (r) => r.lag },
  { key: "late", about: "Reported after the deadline", get: (r) => (r.lag == null ? null : isLateRow(r)) },
  { key: "amount_low", about: "Low end of the reported range", get: (r) => r.low },
  { key: "amount_high", about: "High end of the reported range", get: (r) => r.high },
  { key: "filing_url", about: "The original report", get: (r) => r.url },
];
/** Every row a view matches, in the view's order (all pages), as CSV text. Made in the browser. */
export function viewCsv(all: ScreenRow[], v: ScreenView, built: string): string {
  return toCsv(CSV_COLUMNS, sortRows(all.filter((r) => matches(r, v.f, built)), v.sort, v.dir));
}
/** A file name that says what was filtered: "congress-trades-senate-buy-2026-11-17.csv". */
export function viewCsvName(v: ScreenView, built: string): string {
  const f = v.f;
  const bits = [f.member, f.ticker, f.committee, f.chamber, f.party, f.state, f.side, f.owner, f.min ? `min${f.min}` : "", f.asset, f.w ? `${f.w}d` : "", f.late]
    .filter(Boolean).map((b) => String(b).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return `congress-trades-${bits.length || f.q.trim() ? [...bits, "filtered"].join("-") : "all"}-${built}.csv`;
}
