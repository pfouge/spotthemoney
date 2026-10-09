// Figures for a member-of-Congress profile page (/congress/<slug>/). Pure functions over the
// build model, so the page stays markup and every number on it can be tested
// (scripts/profile.test.ts). Nothing here reads a price or infers a motive: every figure is a
// count, a date or a sum of the dollar ranges as filed.
import type { Flagship, Person, Txn, Security, Company, Seat } from "./flagship";
import { isLate, personPath, CONGRESS_DEADLINE_DAYS } from "./flagship";

export const isBuy = (t: Txn) => t.side === "buy";
export const isSell = (t: Txn) => t.side === "sell";

export function medianOf(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}
const lowOf = (ts: Txn[]) => ts.reduce((a, t) => a + (t.amountLow ?? 0), 0);
const highOf = (ts: Txn[]) => ts.reduce((a, t) => a + (t.amountHigh ?? t.amountLow ?? 0), 0);
/** Share as a whole percent; null when there is nothing to divide by. */
export const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);

export interface YearRow { year: string; trades: number; buys: number; sells: number; other: number; low: number; high: number; late: number }
export interface OwnerRow { key: string; label: string; n: number; share: number }
export interface StockRow {
  sec: Security; company: Company | null; trades: number; buys: number; sells: number; low: number; high: number;
  first: string | null; last: string | null; lobbying: number; contracts: number;
}
export interface MemberProfile {
  trades: number; buys: number; sells: number; other: number;
  low: number; high: number; buyLow: number; buyHigh: number; sellLow: number; sellHigh: number;
  firstTrade: string | null; lastTrade: string | null;
  medianLag: number | null; late: number; lateShare: number | null; dated: number;
  years: YearRow[]; owners: OwnerRow[]; stocks: StockRow[]; noTicker: number;
}

const OWNER_LABEL: Record<string, string> = { self: "Member", spouse: "Spouse", joint: "Joint", child: "Dependent child", dependent: "Dependent child" };
export function ownerLabel(key: string | null | undefined): string {
  if (!key) return "Not stated";
  return OWNER_LABEL[key.toLowerCase()] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export function memberProfile(m: Flagship, p: Person): MemberProfile {
  const txns = p.txns;
  const buys = txns.filter(isBuy), sells = txns.filter(isSell);
  const dates = txns.map((t) => t.txnDate).filter((d): d is string => !!d).sort();
  const withLag = txns.filter((t) => t.lagDays != null);
  const late = txns.filter(isLate).length;

  const yearMap = new Map<string, Txn[]>();
  for (const t of txns) {
    // A row with no trade date is counted in the year it was disclosed.
    const y = (t.txnDate ?? t.disclosedAt ?? "").slice(0, 4);
    if (!/^\d{4}$/.test(y)) continue;
    const xs = yearMap.get(y); if (xs) xs.push(t); else yearMap.set(y, [t]);
  }
  const years: YearRow[] = [...yearMap].sort((a, b) => b[0].localeCompare(a[0])).map(([year, ts]) => {
    const b = ts.filter(isBuy).length, s = ts.filter(isSell).length;
    return { year, trades: ts.length, buys: b, sells: s, other: ts.length - b - s, low: lowOf(ts), high: highOf(ts), late: ts.filter(isLate).length };
  });

  const ownerMap = new Map<string, number>();
  for (const t of txns) { const k = (t.ownerType ?? "").toLowerCase() || "unstated"; ownerMap.set(k, (ownerMap.get(k) ?? 0) + 1); }
  const owners: OwnerRow[] = [...ownerMap].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => ({ key, label: key === "unstated" ? "Not stated" : ownerLabel(key), n, share: pct(n, txns.length) ?? 0 }));

  const bySec = new Map<number, Txn[]>();
  let noTicker = 0;
  for (const t of txns) {
    if (t.securityId == null || !m.securities.has(t.securityId)) { noTicker++; continue; }
    const xs = bySec.get(t.securityId); if (xs) xs.push(t); else bySec.set(t.securityId, [t]);
  }
  const stocks: StockRow[] = [...bySec].map(([sid, ts]) => {
    const sec = m.securities.get(sid)!;
    const company = sec.companyId != null ? m.companies.get(sec.companyId) ?? null : null;
    const ds = ts.map((t) => t.txnDate).filter((d): d is string => !!d).sort();
    return { sec, company, trades: ts.length, buys: ts.filter(isBuy).length, sells: ts.filter(isSell).length, low: lowOf(ts), high: highOf(ts),
      first: ds[0] ?? null, last: ds[ds.length - 1] ?? null, lobbying: company?.lobbying.length ?? 0, contracts: company?.contracts.length ?? 0 };
  }).sort((a, b) => b.trades - a.trades || b.high - a.high || a.sec.ticker.localeCompare(b.sec.ticker));

  return {
    trades: txns.length, buys: buys.length, sells: sells.length, other: txns.length - buys.length - sells.length,
    low: lowOf(txns), high: highOf(txns), buyLow: lowOf(buys), buyHigh: highOf(buys), sellLow: lowOf(sells), sellHigh: highOf(sells),
    firstTrade: dates[0] ?? null, lastTrade: dates[dates.length - 1] ?? null,
    medianLag: medianOf(withLag.map((t) => t.lagDays)), late, lateShare: pct(late, withLag.length), dated: withLag.length,
    years, owners, stocks, noTicker,
  };
}

// ── comparison with every other member who has trades on record ──────────────────────────
export interface Peers {
  members: number;              // members of Congress with at least one trade on record here
  medianTrades: number | null;  // the middle member's number of trades
  medianLag: number | null;     // median days to report across all their trades
  lateShare: number | null;     // share of all their dated trades reported after the deadline
  rankByTrades: Map<number, number>; // person id → 1-based rank, ties share the better rank
}
let _peers: { model: Flagship; peers: Peers } | null = null;
export function peerStats(m: Flagship): Peers {
  if (_peers?.model === m) return _peers.peers;
  const people = [...m.people.values()].filter((p) => p.isCongress && p.txns.length > 0);
  const all = people.flatMap((p) => p.txns);
  const dated = all.filter((t) => t.lagDays != null);
  const sorted = [...people].sort((a, b) => b.txns.length - a.txns.length);
  const rankByTrades = new Map<number, number>();
  sorted.forEach((p, i) => rankByTrades.set(p.id, i > 0 && sorted[i - 1]!.txns.length === p.txns.length ? rankByTrades.get(sorted[i - 1]!.id)! : i + 1));
  const peers: Peers = { members: people.length, medianTrades: medianOf(people.map((p) => p.txns.length)),
    medianLag: medianOf(dated.map((t) => t.lagDays)), lateShare: pct(dated.filter(isLate).length, dated.length), rankByTrades };
  _peers = { model: m, peers };
  return peers;
}

// ── related members ──────────────────────────────────────────────────────────────────────
export interface RelatedMember { person: Person; path: string; trades: number; shared?: string[] }
function congressRole(p: Person) { return p.roles.find((r) => r.kind === "congress") ?? null; }

/** Other members from the same state with trades on record, busiest first. */
export function sameState(m: Flagship, p: Person, limit = 8): RelatedMember[] {
  const state = congressRole(p)?.state;
  if (!state) return [];
  return [...m.people.values()]
    .filter((o) => o.id !== p.id && o.isCongress && o.txns.length > 0 && congressRole(o)?.state === state && personPath(o))
    .sort((a, b) => b.txns.length - a.txns.length || a.name.localeCompare(b.name))
    .slice(0, limit).map((o) => ({ person: o, path: personPath(o)!, trades: o.txns.length }));
}

/** Members who traded the most of the same stocks (by ticker), with up to three shared tickers named. */
export function sameStocks(m: Flagship, p: Person, limit = 6): RelatedMember[] {
  const mine = new Set(p.txns.map((t) => t.securityId).filter((x): x is number => x != null && m.securities.has(x)));
  if (!mine.size) return [];
  const shared = new Map<number, Set<number>>();
  for (const sid of mine) {
    for (const t of m.securities.get(sid)!.congressTxns) {
      if (t.personId == null || t.personId === p.id) continue;
      const s = shared.get(t.personId); if (s) s.add(sid); else shared.set(t.personId, new Set([sid]));
    }
  }
  return [...shared].map(([pid, sids]) => ({ o: m.people.get(pid), sids }))
    .filter((x): x is { o: Person; sids: Set<number> } => !!x.o && x.o.isCongress && !!personPath(x.o))
    .sort((a, b) => b.sids.size - a.sids.size || b.o.txns.length - a.o.txns.length || a.o.name.localeCompare(b.o.name))
    .slice(0, limit)
    .map(({ o, sids }) => ({ person: o, path: personPath(o)!, trades: o.txns.length,
      shared: [...sids].map((sid) => m.securities.get(sid)!.ticker).sort().slice(0, 3).concat(sids.size > 3 ? [`+${sids.size - 3} more`] : []) }));
}

// ── committee seats, grouped ─────────────────────────────────────────────────────────────
export interface SeatGroup { seat: Seat; subs: Seat[] }
const LEAD = /chair|ranking/i;
/** Full committees (leadership posts first, then by name), each with the member's subcommittees. */
export function seatGroups(seats: Seat[]): SeatGroup[] {
  const full = seats.filter((s) => !s.parent);
  const groups = full.map((seat) => ({ seat, subs: seats.filter((s) => s.parent === seat.code).sort((a, b) => a.name.localeCompare(b.name)) }));
  return groups.sort((a, b) => Number(LEAD.test(b.seat.title ?? "")) - Number(LEAD.test(a.seat.title ?? "")) || a.seat.name.localeCompare(b.seat.name));
}
/** "Ranking Member" / "Chair" as stated, else "Member". */
export function seatTitle(s: Seat): string { return s.title ?? "Member"; }

// ── the page's own questions and answers ─────────────────────────────────────────────────
export interface Qa { q: string; a: string }
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : xs.length === 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString("en-US")} ${x === 1 ? one : many}`;

export function memberQa(p: Person, prof: MemberProfile, seats: Seat[], opts: { chamber: "house" | "senate" | null; range: string; longDate: (iso: string) => string }): Qa[] {
  if (!prof.trades) return [];
  const out: Qa[] = [];
  const office = opts.chamber === "senate" ? "Senate eFD" : "House Clerk";
  out.push({
    q: `How many stock trades has ${p.name} disclosed?`,
    a: `${n(prof.trades, "trade")} on record here: ${n(prof.buys, "purchase")}, ${n(prof.sells, "sale")}${prof.other ? ` and ${n(prof.other, "other transaction")} such as exchanges` : ""}. The dollar ranges as filed add up to ${opts.range}.${prof.firstTrade && prof.lastTrade ? ` The trades are dated ${opts.longDate(prof.firstTrade)} to ${opts.longDate(prof.lastTrade)}.` : ""}`,
  });
  if (prof.stocks.length) {
    const top = prof.stocks.slice(0, 5).map((s) => `${s.sec.ticker} (${n(s.trades, "trade")})`);
    out.push({
      q: `Which stocks has ${p.name} traded most often?`,
      a: `By number of disclosed trades: ${list(top)}. ${n(prof.stocks.length, "stock or fund with a ticker", "stocks and funds with a ticker")} appear in the reports on record${prof.noTicker ? `, plus ${n(prof.noTicker, "trade")} in assets without a ticker` : ""}.`,
    });
  }
  if (prof.dated > 0) {
    out.push({
      q: `Does ${p.name} report trades on time?`,
      a: `${prof.late === 0 ? "Every dated trade on record was" : `${n(prof.late, "trade")} of ${prof.dated.toLocaleString("en-US")} dated trades (${prof.lateShare}%) ${prof.late === 1 ? "was" : "were"} reported more than ${CONGRESS_DEADLINE_DAYS} days after the trade, the outer STOCK Act limit; the rest were`} reported within ${CONGRESS_DEADLINE_DAYS} days.${prof.medianLag != null ? ` The median gap between trade and report is ${Math.round(prof.medianLag)} days.` : ""} A late report is a filing matter and says nothing about why a trade was made.`,
    });
  }
  const full = seatGroups(seats);
  if (full.length) {
    out.push({
      q: `Which committees does ${p.name} sit on?`,
      a: `${list(full.map((g) => `${g.seat.name}${g.seat.title ? ` (${g.seat.title})` : ""}`))}. Committee membership is listed for context; this site does not connect any trade to committee business.`,
    });
  }
  out.push({
    q: `Where do these figures come from?`,
    a: `From the periodic transaction reports ${p.name} filed with the ${office}. Each row in the trade table links to the original report. Members report dollar ranges, not exact amounts, and a spouse's or dependent child's trades are reported on the same form.`,
  });
  return out;
}

// ── plain names for the header facts ─────────────────────────────────────────────────────
const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands",
  AS: "American Samoa", MP: "Northern Mariana Islands",
};
export function stateName(code: string | null | undefined): string | null { return code ? STATES[code.toUpperCase()] ?? code : null; }
/** "District 21", "At-large" for a single-seat state or a delegate; null for senators. */
export function seatName(chamber: string | null, district: string | null): string | null {
  if (chamber !== "house" || district == null || district === "") return null;
  return district === "0" ? "At-large" : `District ${district}`;
}
/** Party as a word, whichever way the roster stores it ("D" or "Democrat"). */
export function partyName(party: string | null | undefined): string | null {
  if (!party) return null;
  const p = party.toLowerCase();
  return p === "d" || p.startsWith("dem") ? "Democrat" : p === "r" || p.startsWith("rep") ? "Republican" : p === "i" || p.startsWith("ind") ? "Independent" : party;
}
