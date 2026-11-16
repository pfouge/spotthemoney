// Committee pages (/congress-committees/ and /congress-committees/<slug>/): for each full
// committee, who sits on it today and the trades those members have disclosed.
// Pure: the pages, the sitemap, the search index and the unit tests all read `buildCommittees`.
// Everything here is a count, a date or a fact from the roster. A committee seat is context:
// nothing here matches a trade to a committee's business, and the roster holds CURRENT seats
// only, so a member's trades are listed whether they were made before or after the member
// joined the committee.
import type { Flagship, Person, Seat, Txn } from "./flagship";
import { daysBetween, partyKey, seatCode, sortName, topCommittee, type PartyKey } from "./directory";

export const COMMITTEES_PATH = "/congress-committees/";
/** Rows in a committee's trade table; the rest are on the members' own pages. */
export const COMMITTEE_TRADE_ROWS = 200;
/** Tickers in a committee's most-traded table. */
export const COMMITTEE_STOCK_ROWS = 15;
/** Window for "12 months" figures, in days, by disclosure date. */
export const COMMITTEE_WINDOW_DAYS = 365;

export interface CommitteeMember {
  id: number; name: string; sortName: string; path: string | null;
  party: PartyKey; state: string; seat: string;
  /** "Chair", "Ranking Member" … on the full committee; null for a plain seat or a subcommittee-only seat. */
  title: string | null;
  /** Subcommittees of this committee the member sits on, by name. */
  subs: string[];
  trades: number; trades12m: number; latest: string | null;
}
export interface CommitteeStock { ticker: string; securityId: number; members: number; trades: number; buys: number; sells: number; latest: string | null }
export interface Committee {
  code: string; slug: string; path: string; name: string;
  chamber: "house" | "senate" | "joint";
  url: string | null; jurisdiction: string | null;
  /** Subcommittees with at least one member on record. */
  subcommittees: string[];
  members: CommitteeMember[];
  withTrades: number;
  /** Trade rows of every member, all time and disclosed in the last 12 months. */
  trades: number; trades12m: number; buys12m: number; sells12m: number;
  latest: string | null;
  /** Every member's rows, newest disclosure first. */
  txns: Txn[];
  /** Tickers by number of rows disclosed in the last 12 months. */
  stocks: CommitteeStock[];
}

const LEAD = /chair|ranking/i;

/** "House Committee on Financial Services" → "house-financial-services". */
export function committeeSlug(name: string): string {
  const s = name.toLowerCase()
    .replace(/&/g, " and ").replace(/['’.]/g, "")
    .replace(/^united states\b/, " ")
    .replace(/\b(committee|select subcommittee|subcommittee|of congress)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((w, i) => !(i > 0 && (w === "on" || w === "the" || w === "of" || w === "to")));
  let out = "";
  for (const w of s) { if ((out + "-" + w).length > 60) break; out = out ? `${out}-${w}` : w; }
  return out || "committee";
}

// The directory's rule: a row counts by the date it was disclosed.
const disclosed = (t: Txn) => t.disclosedAt?.slice(0, 10) ?? null;
const sortDay = (t: Txn) => (t.disclosedAt ?? t.filedAt ?? "").slice(0, 10);

export function buildCommittees(m: Flagship, today: string, path: (p: Person) => string | null): Committee[] {
  // full committee code → its own facts, and → person id → that person's seats under it
  const facts = new Map<string, Seat>();
  const subNames = new Map<string, Set<string>>();
  const bySeat = new Map<string, Map<number, Seat[]>>();
  for (const [pid, seats] of m.seats) {
    for (const s of seats) {
      const top = topCommittee(s);
      if (!s.parent && !facts.has(s.code)) facts.set(s.code, s);
      if (s.parent) { const set = subNames.get(top) ?? new Set<string>(); set.add(s.name); subNames.set(top, set); }
      const people = bySeat.get(top) ?? new Map<number, Seat[]>();
      const mine = people.get(pid) ?? []; mine.push(s); people.set(pid, mine); bySeat.set(top, people);
    }
  }
  const out: Committee[] = [];
  const slugs = new Set<string>();
  for (const [code, people] of [...bySeat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const f = facts.get(code);
    if (!f) continue; // a subcommittee whose parent has no seat of its own on record: no page
    const members: CommitteeMember[] = [];
    const txns: Txn[] = [];
    for (const [pid, seats] of people) {
      const p = m.people.get(pid);
      if (!p || !p.isCongress) continue;
      const role = p.roles.find((r) => r.kind === "congress");
      if (!role) continue;
      let latest: string | null = null, trades12m = 0;
      for (const t of p.txns) {
        const d = disclosed(t); if (!d) continue;
        if (!latest || d > latest) latest = d;
        const age = daysBetween(d, today);
        if (age >= 0 && age <= COMMITTEE_WINDOW_DAYS) trades12m++;
      }
      const own = seats.find((s) => !s.parent);
      members.push({
        id: p.id, name: p.name, sortName: sortName(p.name), path: path(p),
        party: partyKey(role.party), state: (role.state ?? "").toUpperCase(),
        seat: seatCode(role.chamber, role.state ? role.state.toUpperCase() : null, role.district),
        title: own?.title ?? null,
        subs: seats.filter((s) => s.parent).map((s) => s.name).sort((a, b) => a.localeCompare(b)),
        trades: p.txns.length, trades12m, latest,
      });
      for (const t of p.txns) txns.push(t);
    }
    if (members.length === 0) continue;
    members.sort((a, b) => Number(LEAD.test(b.title ?? "")) - Number(LEAD.test(a.title ?? "")) || a.sortName.localeCompare(b.sortName) || a.id - b.id);
    txns.sort((a, b) => sortDay(b).localeCompare(sortDay(a)) || b.id - a.id);

    const stocks = new Map<number, CommitteeStock & { who: Set<number> }>();
    let buys12m = 0, sells12m = 0;
    for (const t of txns) {
      const d = disclosed(t); if (!d) continue;
      const age = daysBetween(d, today);
      if (age < 0 || age > COMMITTEE_WINDOW_DAYS) continue;
      if (t.side === "buy") buys12m++; else if (t.side === "sell") sells12m++;
      if (t.securityId == null) continue;
      const sec = m.securities.get(t.securityId); if (!sec) continue;
      const row = stocks.get(sec.id) ?? { ticker: sec.ticker, securityId: sec.id, members: 0, trades: 0, buys: 0, sells: 0, latest: null, who: new Set<number>() };
      row.trades++; if (t.side === "buy") row.buys++; else if (t.side === "sell") row.sells++;
      if (t.personId != null) row.who.add(t.personId);
      if (!row.latest || d > row.latest) row.latest = d;
      stocks.set(sec.id, row);
    }
    let slug = committeeSlug(f.name);
    if (slugs.has(slug)) slug = `${slug}-${code.toLowerCase()}`;
    slugs.add(slug);
    out.push({
      code, slug, path: `${COMMITTEES_PATH}${slug}/`, name: f.name, chamber: f.chamber, url: f.url, jurisdiction: f.jurisdiction,
      subcommittees: [...(subNames.get(code) ?? [])].sort((a, b) => a.localeCompare(b)),
      members, withTrades: members.filter((x) => x.trades > 0).length,
      trades: txns.length, trades12m: members.reduce((n, x) => n + x.trades12m, 0), buys12m, sells12m,
      latest: members.map((x) => x.latest).filter((x): x is string => !!x).sort().at(-1) ?? null,
      txns,
      stocks: [...stocks.values()].map(({ who, ...s }) => ({ ...s, members: who.size }))
        .sort((a, b) => b.trades - a.trades || b.members - a.members || a.ticker.localeCompare(b.ticker)),
    });
  }
  const order = { house: 0, senate: 1, joint: 2 } as const;
  return out.sort((a, b) => order[a.chamber] - order[b.chamber] || a.name.localeCompare(b.name));
}

export const CHAMBER_LABEL = { house: "House", senate: "Senate", joint: "Joint" } as const;

/** One line for the build log, to compare with a direct count on the database. */
export function committeeLogLine(cs: Committee[]): string {
  const seated = new Set<number>(), trading = new Set<number>();
  for (const c of cs) for (const x of c.members) { seated.add(x.id); if (x.trades > 0) trading.add(x.id); }
  const pick = (code: string) => { const c = cs.find((x) => x.code === code); return c ? `${code} ${c.members.length}/${c.withTrades}/${c.trades}/${c.trades12m}` : `${code} none`; };
  return `committees: ${cs.length} pages, ${cs.reduce((n, c) => n + c.members.length, 0)} seats, ${seated.size} members seated, ${trading.size} of them with trades, ${cs.filter((c) => c.withTrades === 0).length} committees with no trades; members/with trades/trades/12 months: ${["HSBA", "SSBK", "HSAS", "SLIN"].map(pick).join(", ")}`;
}
