// Figures and cross-links for the stock, company and insider pages. Pure functions over the
// build model (tests: scripts/entity.test.ts), in the same spirit as lib/profile.ts for
// members: every number is a count, a date or a sum of reported values; nothing is inferred
// about why anyone traded.
import type { Flagship, Person, Security, Company, Txn } from "./flagship";
import { personPath, securityPath, companyPath, roleLabel, daysAgo } from "./flagship-core";
import { sizeByTicker, CAP_BANDS, type SizeEstimate } from "./capband";
import { sicDivision } from "@stm/shared";

const isForm4 = (t: Txn) => t.source === "sec_form4";
const val = (ts: Txn[]) => ts.reduce((a, t) => a + (t.value ?? 0), 0);
const dates = (ts: Txn[]) => ts.map((t) => t.txnDate ?? t.disclosedAt).filter((d): d is string => !!d).sort();
/** Open-market purchase (Form 4 code P) — the only Form 4 rows this site calls buying. */
export const isOpenBuy = (t: Txn) => isForm4(t) && t.code === "P" && t.side === "buy";
export const isSale = (t: Txn) => t.side === "sell";

// ── Form 4 codes in words (kept in step with the codes guide) ────────────────────────────
export const CODE_LABEL: Record<string, string> = {
  P: "Open-market purchase", S: "Open-market sale", A: "Grant or award", M: "Option exercise or conversion", F: "Shares withheld for tax",
  G: "Gift", D: "Sale back to the company", C: "Conversion of a derivative", X: "Exercise of an in-the-money option", J: "Other acquisition or disposal",
  I: "Discretionary transaction", W: "Inheritance", U: "Shares tendered in a takeover", L: "Small acquisition", Z: "Voting trust deposit or withdrawal",
  O: "Exercise of an out-of-the-money option", E: "Expiry of a short derivative", H: "Expiry of a long derivative", K: "Equity swap",
};
export function codeLabel(code: string | null | undefined): string { return code ? CODE_LABEL[code.toUpperCase()] ?? `Code ${code}` : "No code given"; }

export interface CodeRow { code: string; label: string; rows: number; shares: number; value: number }
/** Form 4 rows by transaction code, most rows first. */
export function codeRows(txns: Txn[]): CodeRow[] {
  const m = new Map<string, Txn[]>();
  for (const t of txns) { if (!isForm4(t)) continue; const k = (t.code ?? "").toUpperCase() || "—"; const a = m.get(k); if (a) a.push(t); else m.set(k, [t]); }
  return [...m].map(([code, ts]) => ({ code, label: code === "—" ? "No code given" : codeLabel(code), rows: ts.length, shares: ts.reduce((a, t) => a + (t.shares ?? 0), 0), value: val(ts) }))
    .sort((a, b) => b.rows - a.rows || a.code.localeCompare(b.code));
}

export interface YearRow { year: string; rows: number; buys: number; sells: number; other: number; bought: number; sold: number }
/** Rows by year of the trade: open-market buys and sales apart from everything else. */
export function yearRows(txns: Txn[]): YearRow[] {
  const m = new Map<string, Txn[]>();
  for (const t of txns) { const y = (t.txnDate ?? t.disclosedAt ?? "").slice(0, 4); if (!/^\d{4}$/.test(y)) continue; const a = m.get(y); if (a) a.push(t); else m.set(y, [t]); }
  return [...m].sort((a, b) => b[0].localeCompare(a[0])).map(([year, ts]) => {
    const b = ts.filter((t) => (isForm4(t) ? isOpenBuy(t) : t.side === "buy")), s = ts.filter(isSale);
    return { year, rows: ts.length, buys: b.length, sells: s.length, other: ts.length - b.length - s.length, bought: val(b), sold: val(s) };
  });
}

// ── open-market buying and selling over a period (stock pages) ─────────────────────────────
/** Open-market sale (Form 4 code S). Shares withheld for tax (F) and sales back to the company (D) are not counted here. */
export const isOpenSale = (t: Txn) => isForm4(t) && t.code === "S" && t.side === "sell";
/** Open-market purchase (up) and sale (down) dollars by month of disclosure, the 12 months ending `end` (the stock pages' month bars). */
export function monthlyOpenMarket(txns: Txn[], end: Date): { key: string; label: string; up: number; down: number }[] {
  const out: { key: string; label: string; up: number; down: number }[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)); out.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }), up: 0, down: 0 }); }
  for (const t of txns) { const m = out.find((x) => x.key === (t.disclosedAt ?? "").slice(0, 7)); if (!m) continue; if (isOpenBuy(t)) m.up += t.value ?? 0; else if (isOpenSale(t)) m.down += t.value ?? 0; }
  return out;
}
/** The periods on a stock's page: days counted back from the build date, by the date a filing was disclosed. */
export const INSIDER_PERIODS: { days: number; label: string }[] = [{ days: 90, label: "Last 3 months" }, { days: 365, label: "Last 12 months" }];
export interface PeriodSummary {
  days: number; label: string;
  /** Open-market purchases: rows, distinct insiders, shares, dollars at reported prices. */
  buys: number; buyers: number; sharesBought: number; bought: number;
  /** Open-market sales, the same four figures, and how many of the rows were made under a Rule 10b5-1 plan. */
  sells: number; sellers: number; sharesSold: number; sold: number; planSells: number;
  /** Bought minus sold. */
  netShares: number; net: number;
  /** Rows counted above that report no usable price, so they add shares but no dollars. */
  unpriced: number;
}
/**
 * Insider buying and selling in a set of rows over each period. Only open-market purchases
 * (code P) and open-market sales (code S) count; derivative rows and a trade already reported
 * in another filing carry a different side in the build model and so stay out. A row belongs
 * to a period by its disclosure date, the same rule the trade map uses. Counts and sums only.
 */
export function insiderPeriods(txns: Txn[], since: (days: number) => string = daysAgo, periods = INSIDER_PERIODS): PeriodSummary[] {
  const sumOf = (ts: Txn[], f: (t: Txn) => number | null | undefined) => ts.reduce((a, t) => a + (f(t) ?? 0), 0);
  const people = (ts: Txn[]) => new Set(ts.map((t) => t.personId).filter((x) => x != null)).size;
  return periods.map(({ days, label }) => {
    const from = since(days);
    const inP = txns.filter((t) => !!t.disclosedAt && t.disclosedAt.slice(0, 10) >= from);
    const b = inP.filter(isOpenBuy), s = inP.filter(isOpenSale);
    const sharesBought = sumOf(b, (t) => t.shares), sharesSold = sumOf(s, (t) => t.shares), bought = val(b), sold = val(s);
    return { days, label, buys: b.length, buyers: people(b), sharesBought, bought, sells: s.length, sellers: people(s), sharesSold, sold,
      planSells: s.filter((t) => t.is10b51 === true).length, netShares: sharesBought - sharesSold, net: bought - sold,
      unpriced: [...b, ...s].filter((t) => t.value == null).length };
  });
}

// ── who is behind a set of trades ────────────────────────────────────────────────────────
export interface InsiderRow { person: Person; path: string | null; role: string; rows: number; buys: number; sells: number; bought: number; sold: number; last: string | null }
/** Corporate insiders in a set of Form 4 rows, most rows first. */
export function insiderRows(m: Flagship, txns: Txn[]): InsiderRow[] {
  const by = new Map<number, Txn[]>();
  for (const t of txns) { if (!isForm4(t) || t.personId == null) continue; const a = by.get(t.personId); if (a) a.push(t); else by.set(t.personId, [t]); }
  const out: InsiderRow[] = [];
  for (const [pid, ts] of by) {
    const person = m.people.get(pid); if (!person) continue;
    const b = ts.filter(isOpenBuy), s = ts.filter(isSale);
    out.push({ person, path: personPath(person), role: roleLabel(person, m.companies).replace(/ at .*$/, ""), rows: ts.length, buys: b.length, sells: s.length, bought: val(b), sold: val(s), last: dates(ts).at(-1) ?? null });
  }
  return out.sort((a, b) => b.rows - a.rows || (b.last ?? "").localeCompare(a.last ?? "") || a.person.name.localeCompare(b.person.name));
}

export interface MemberRow { person: Person; path: string | null; seat: string; trades: number; buys: number; sells: number; low: number; high: number; last: string | null }
/** Members of Congress in a set of congressional rows, most trades first. */
export function memberRows(m: Flagship, txns: Txn[]): MemberRow[] {
  const by = new Map<number, Txn[]>();
  for (const t of txns) { if (isForm4(t) || t.personId == null) continue; const a = by.get(t.personId); if (a) a.push(t); else by.set(t.personId, [t]); }
  const out: MemberRow[] = [];
  for (const [pid, ts] of by) {
    const person = m.people.get(pid); if (!person) continue;
    out.push({ person, path: personPath(person), seat: roleLabel(person, m.companies), trades: ts.length, buys: ts.filter((t) => t.side === "buy").length, sells: ts.filter(isSale).length,
      low: ts.reduce((a, t) => a + (t.amountLow ?? 0), 0), high: ts.reduce((a, t) => a + (t.amountHigh ?? t.amountLow ?? 0), 0), last: dates(ts).at(-1) ?? null });
  }
  return out.sort((a, b) => b.trades - a.trades || (b.last ?? "").localeCompare(a.last ?? "") || a.person.name.localeCompare(b.person.name));
}

// ── related pages ────────────────────────────────────────────────────────────────────────
export interface RelatedTicker { ticker: string; name: string | null; path: string; shared: number; who: string[] }
let _byPerson: { model: Flagship; map: Map<number, Set<string>> } | null = null;
/** person id → the tickers (lower case) that person has traded. Built once per build. */
function tickersByPerson(m: Flagship): Map<number, Set<string>> {
  if (_byPerson?.model === m) return _byPerson.map;
  const map = new Map<number, Set<string>>();
  for (const t of m.txns) {
    if (t.personId == null || t.securityId == null) continue;
    const s = m.securities.get(t.securityId); if (!s) continue;
    const set = map.get(t.personId); if (set) set.add(s.ticker.toLowerCase()); else map.set(t.personId, new Set([s.ticker.toLowerCase()]));
  }
  _byPerson = { model: m, map };
  return map;
}
let _tickerPage: { model: Flagship; map: Map<string, Security> } | null = null;
/** lower-case ticker → the security whose page it is (the equity row when several share a ticker). */
export function tickerPages(m: Flagship): Map<string, Security> {
  if (_tickerPage?.model === m) return _tickerPage.map;
  const map = new Map<string, Security>();
  for (const s of [...m.securities.values()].sort((a, b) => (a.type === "equity" ? -1 : 1) - (b.type === "equity" ? -1 : 1))) { const k = s.ticker.toLowerCase(); if (!map.has(k)) map.set(k, s); }
  _tickerPage = { model: m, map };
  return map;
}
/**
 * Tickers most often traded by the same people who traded this one. "Shared" is the number of
 * distinct filers in common; up to three are named. A statement about overlap in public
 * filings, nothing more.
 */
export function relatedTickers(m: Flagship, ticker: string, txns: Txn[], limit = 8): RelatedTicker[] {
  const self = ticker.toLowerCase();
  const people = [...new Set(txns.map((t) => t.personId).filter((x): x is number => x != null))];
  const byPerson = tickersByPerson(m), pages = tickerPages(m);
  const selfPage = pages.get(self);
  const selfPath = selfPage ? securityPath(selfPage) : null;
  const shared = new Map<string, number[]>();
  for (const pid of people) for (const tk of byPerson.get(pid) ?? []) { if (tk === self) continue; const a = shared.get(tk); if (a) a.push(pid); else shared.set(tk, [pid]); }
  return [...shared].map(([tk, pids]) => ({ tk, pids, s: pages.get(tk) }))
    .filter((x): x is { tk: string; pids: number[]; s: Security } => !!x.s && x.s.txns.length > 0)
    .sort((a, b) => b.pids.length - a.pids.length || b.s.txns.length - a.s.txns.length || a.tk.localeCompare(b.tk))
    // Share classes of one company are one page (lib/onepage.ts): list a page once, never the page itself.
    .filter((x, i, all) => securityPath(x.s) !== selfPath && all.findIndex((y) => securityPath(y.s) === securityPath(x.s)) === i)
    .slice(0, limit)
    .map(({ pids, s }) => ({ ticker: s.ticker, name: s.name ?? (s.companyId != null ? m.companies.get(s.companyId)?.name ?? null : null), path: securityPath(s), shared: pids.length,
      who: pids.map((id) => m.people.get(id)?.name).filter((n): n is string => !!n).sort().slice(0, 3) }));
}

export interface Colleague { person: Person; path: string; role: string; rows: number; last: string | null }
/** Other insiders at the same company (or companies), most rows first. */
export function colleagues(m: Flagship, p: Person, limit = 10): Colleague[] {
  const companyIds = new Set(p.roles.filter((r) => r.kind === "insider" && r.companyId != null).map((r) => r.companyId!));
  const seen = new Set<number>([p.id]); const out: Colleague[] = [];
  for (const cid of companyIds) for (const o of m.companies.get(cid)?.insiders ?? []) {
    if (seen.has(o.id)) continue; seen.add(o.id);
    const path = personPath(o); if (!path || o.txns.length === 0) continue;
    out.push({ person: o, path, role: roleLabel(o, m.companies).replace(/ at .*$/, ""), rows: o.txns.length, last: dates(o.txns).at(-1) ?? null });
  }
  return out.sort((a, b) => b.rows - a.rows || a.person.name.localeCompare(b.person.name)).slice(0, limit);
}

/** Companies whose stock was traded by the same filers as this company's (through its primary ticker). */
export function relatedCompanies(m: Flagship, c: Company, limit = 8): { company: Company; path: string; ticker: string; shared: number }[] {
  if (!c.primaryTicker) return [];
  const out: { company: Company; path: string; ticker: string; shared: number }[] = [];
  for (const r of relatedTickers(m, c.primaryTicker, c.txns, limit * 3)) {
    const s = tickerPages(m).get(r.ticker.toLowerCase());
    const co = s?.companyId != null ? m.companies.get(s.companyId) : undefined;
    const path = co ? companyPath(co) : null;
    if (!co || !path || co.id === c.id || out.some((x) => x.company.id === co.id)) continue;
    out.push({ company: co, path, ticker: r.ticker, shared: r.shared });
    if (out.length >= limit) break;
  }
  return out;
}

// ── industry, as the SEC classifies the company ──────────────────────────────────────────
export interface Industry {
  /** Four-digit SIC code as the SEC states it. */
  code: string;
  /** The SEC's wording for the code; null when the SEC gives none. */
  description: string | null;
  /** Division of the SIC manual the code falls in (first two digits); null when it is in none. */
  division: string | null;
  /** What the page prints: "Semiconductors & Related Devices (SIC 3674, Manufacturing)". */
  label: string;
}
/**
 * The company's industry from its SEC SIC code, or null when no code is on file. Nothing is
 * inferred: the code and wording are the SEC's, the division is a lookup on the code.
 */
export function industryOf(m: Flagship, company: Pick<Company, "cik"> | null | undefined): Industry | null {
  if (!company?.cik) return null;
  const e = m.companySic.get(company.cik.padStart(10, "0"));
  if (!e) return null;
  const division = sicDivision(e.sic)?.name ?? null;
  const inside = `SIC ${e.sic}${division ? `, ${division}` : ""}`;
  return { code: e.sic, description: e.description, division, label: e.description ? `${e.description} (${inside})` : inside };
}

// ── size band, cached (sizeByTicker walks every company) ─────────────────────────────────
let _size: { model: Flagship; map: Map<string, SizeEstimate> } | null = null;
export function sizeOf(m: Flagship, ticker: string | null | undefined): { label: string; range: string } | null {
  if (!ticker) return null;
  if (_size?.model !== m) _size = { model: m, map: sizeByTicker(m) };
  const e = _size.map.get(ticker.toUpperCase()) ?? _size.map.get(ticker);
  const band = e ? CAP_BANDS.find((b) => b.code === e.band) : null;
  return band ? { label: band.label, range: band.range } : null;
}
