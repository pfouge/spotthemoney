// Builds the watchlist cards (lib/watchcards.ts) from the build model. Every figure comes from the
// same functions the pages use (entity.ts insiderRows / memberRows, flagship.ts labels), so a card
// can never disagree with the page it links to — only cover a shorter window. Tests:
// scripts/watchcards.test.ts.
import type { Flagship, Person, Txn } from "./flagship";
import { personPath, securityPath, companyPath, roleLabel, sideLabel, amountLabel } from "./flagship";
import { insiderRows, memberRows, tickerPages, isOpenBuy, isSale, codeLabel } from "./entity";
import type { Kind } from "./account";
import { WATCH_WINDOW_DAYS, WATCH_TOP, WATCH_MONTHS, SHARDS, shardOf, type Card, type StockCard, type PersonCard, type MonthBar, type WatchShard } from "./watchcards";

const CHARTABLE = new Set(["equity", "etf", "adr"]);
const isForm4 = (t: Txn) => t.source === "sec_form4";
const isBuy = (t: Txn) => (isForm4(t) ? isOpenBuy(t) : t.side === "buy");

function cutoff(builtAt: string, days: number): string {
  return new Date(Date.parse(builtAt.slice(0, 10) + "T00:00:00Z") - days * 86400_000).toISOString().slice(0, 10);
}
const inWindow = (since: string) => (t: Txn) => !!t.disclosedAt && t.disclosedAt.slice(0, 10) >= since;

/** The last `n` calendar months ending with the build's month, oldest first: ["2025-11", …, "2026-10"]. */
export function monthKeys(builtAt: string, n = WATCH_MONTHS): string[] {
  const y = Number(builtAt.slice(0, 4)), mo = Number(builtAt.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, mo - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}

/** "Rep. D-AZ-4", "Sen. R-SC": the compact seat used on cards. */
export function shortSeat(p: Person): string {
  const r = p.roles.find((x) => x.kind === "congress");
  if (!r) return "";
  const party = r.party ? r.party.trim().charAt(0).toUpperCase() : "";
  const seat = [party, r.state, r.chamber === "senate" ? null : r.district].filter(Boolean).join("-");
  return `${r.chamber === "senate" ? "Sen." : "Rep."}${seat ? ` ${seat}` : ""}`;
}

function stockCard(m: Flagship, txns: Txn[], since: string, base: Omit<StockCard, "insiders" | "insiderCount" | "members" | "memberCount">): StockCard {
  const w = txns.filter(inWindow(since));
  const ins = insiderRows(m, w.filter(isForm4)), mem = memberRows(m, w.filter((t) => !isForm4(t)));
  return {
    ...base,
    insiders: ins.slice(0, WATCH_TOP).map((r) => ({ name: r.person.name, path: r.path, role: r.role, rows: r.rows, buys: r.buys, sells: r.sells, bought: r.bought, sold: r.sold, last: r.last })),
    insiderCount: ins.length,
    members: mem.slice(0, WATCH_TOP).map((r) => ({ name: r.person.name, path: r.path, seat: shortSeat(r.person) || r.seat, trades: r.trades, buys: r.buys, sells: r.sells, low: r.low, high: r.high, last: r.last })),
    memberCount: mem.length,
  };
}

export function personCard(m: Flagship, p: Person, since: string, months: string[]): PersonCard | null {
  const path = personPath(p);
  if (!path) return null;
  const bars = new Map<string, MonthBar>(months.map((k) => [k, [k, 0, 0]]));
  for (const t of p.txns) {
    const b = bars.get((t.disclosedAt ?? "").slice(0, 7));
    if (!b) continue;
    if (isBuy(t)) b[1]++; else if (isSale(t)) b[2]++;
  }
  const w = p.txns.filter(inWindow(since));
  const buys = w.filter(isBuy), sells = w.filter(isSale);
  const tick = new Map<string, number>();
  for (const t of w) { const s = t.securityId != null ? m.securities.get(t.securityId) : undefined; if (s) tick.set(s.ticker, (tick.get(s.ticker) ?? 0) + 1); }
  const newest = [...p.txns].sort((a, b) => (b.disclosedAt ?? "").localeCompare(a.disclosedAt ?? "") || b.id - a.id)[0];
  const sec = newest?.securityId != null ? m.securities.get(newest.securityId) : undefined;
  const congress = p.isCongress && !p.isInsider;
  const card: PersonCard = {
    name: p.name, path, role: roleLabel(p, m.companies),
    months: months.map((k) => bars.get(k)!),
    last: newest?.disclosedAt ? { date: newest.disclosedAt.slice(0, 10), verb: isForm4(newest) ? codeLabel(newest.code) : sideLabel(newest), ticker: sec?.ticker ?? null, amount: amountLabel(newest) } : null,
    rows: w.length, buys: buys.length, sells: sells.length,
    bought: buys.reduce((a, t) => a + (t.value ?? 0), 0), sold: sells.reduce((a, t) => a + (t.value ?? 0), 0),
    tickers: [...tick].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6),
  };
  if (congress) { card.low = w.reduce((a, t) => a + (t.amountLow ?? 0), 0); card.high = w.reduce((a, t) => a + (t.amountHigh ?? t.amountLow ?? 0), 0); }
  return card;
}

/** Every card, by kind and page key (the same keys watchlist items use). */
export function buildCards(m: Flagship): Record<Kind, Map<string, Card>> {
  const since = cutoff(m.builtAt, WATCH_WINDOW_DAYS);
  const months = monthKeys(m.builtAt);
  const out: Record<Kind, Map<string, Card>> = { stock: new Map(), company: new Map(), member: new Map(), insider: new Map() };

  const pages = tickerPages(m);
  for (const [key, s] of pages) {
    const siblings = [...m.securities.values()].filter((x) => x.ticker.toLowerCase() === key);
    const co = s.companyId != null ? m.companies.get(s.companyId) : undefined;
    out.stock.set(key, stockCard(m, siblings.flatMap((x) => x.txns), since,
      { ticker: s.ticker, name: co?.name ?? s.name ?? s.ticker, path: securityPath(s), chart: siblings.some((x) => CHARTABLE.has(x.type)) }));
  }
  for (const c of m.companies.values()) {
    const path = companyPath(c);
    if (!c.slug || !path) continue;
    const t = c.primaryTicker?.toLowerCase() ?? null;
    const page = t ? pages.get(t) : undefined;
    out.company.set(c.slug, stockCard(m, c.txns, since,
      { ticker: page?.ticker ?? c.primaryTicker ?? null, name: c.name, path, chart: !!page && [...m.securities.values()].some((x) => x.ticker.toLowerCase() === t && CHARTABLE.has(x.type)) }));
  }
  for (const p of m.people.values()) {
    if (!p.slug) continue;
    const card = personCard(m, p, since, months);
    if (!card) continue;
    (card.path.startsWith("/congress/") ? out.member : out.insider).set(p.slug, card);
  }
  return out;
}

let cache: { m: Flagship; cards: Record<Kind, Map<string, Card>> } | null = null;
/** The contents of /data/watch/<kind>-<n>.json. */
export function watchShard(m: Flagship, kind: Kind, n: number): WatchShard {
  if (cache?.m !== m) cache = { m, cards: buildCards(m) };
  const cards: Record<string, Card> = {};
  for (const [key, c] of cache.cards[kind]) if (shardOf(key, SHARDS[kind]) === n) cards[key] = c;
  return { built: m.builtAt, window: WATCH_WINDOW_DAYS, cards };
}
