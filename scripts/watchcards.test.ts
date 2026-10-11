// Offline tests for the watchlist cards (web/src/lib/watchcards.ts, watchcards-build.ts).
// Run:  npx tsx --test scripts/watchcards.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shardOf, shardFor, SHARDS, WATCH_WINDOW_DAYS, isStockCard, type StockCard, type PersonCard } from "../web/src/lib/watchcards";
import { buildCards, watchShard, monthKeys, shortSeat } from "../web/src/lib/watchcards-build";
import type { Flagship, Person, Txn, Security, Company } from "../web/src/lib/flagship";
import type { Kind } from "../web/src/lib/account";

let nid = 1;
const f4 = (personId: number, securityId: number, code: string, side: string, date: string, shares: number, value: number): Txn => ({ id: nid++, filingId: 1, personId, securityId, side, code, isDerivative: false, txnDate: date, disclosedAt: date, amountLow: null, amountHigh: null, shares, price: value / shares, lagDays: 1, is10b51: false, ownerType: null, assetType: "stock", source: "sec_form4", sourceUrl: null, filedAt: date, isPublished: true, value });
const ptr = (personId: number, securityId: number, side: string, date: string, low: number, high: number): Txn => ({ id: nid++, filingId: 2, personId, securityId, side, code: null, isDerivative: null, txnDate: date, disclosedAt: date, amountLow: low, amountHigh: high, shares: null, price: null, lagDays: 20, is10b51: null, ownerType: "self", assetType: "stock", source: "house_ptr", sourceUrl: null, filedAt: date, isPublished: true, value: high });

function build() {
  const companies = new Map<number, Company>([[1, { id: 1, name: "Alpha Corp", cik: "1", slug: "alpha-corp", primaryTicker: "AAA", sector: null, securityIds: [1], insiders: [], txns: [], contracts: [], lobbying: [], underReview: false }],
    [2, { id: 2, name: "Beta Inc.", cik: "2", slug: "beta-inc", primaryTicker: "BBB", sector: null, securityIds: [2], insiders: [], txns: [], contracts: [], lobbying: [], underReview: false }]]);
  const sec = (id: number, ticker: string, companyId: number, type = "equity"): Security => ({ id, ticker, type, name: null, companyId, txns: [], insiderTxns: [], congressTxns: [], underReview: false });
  const securities = new Map([[1, sec(1, "AAA", 1)], [2, sec(2, "BBB", 2, "bond")]]);
  const ins = (id: number, name: string, companyId: number, title: string): Person => ({ id, name, slug: name.toLowerCase().replace(/ /g, "-"), bioguideId: null, cik: null, roles: [{ kind: "insider", chamber: null, state: null, district: null, party: null, companyId, officerTitle: title, isDirector: false }], txns: [], filings: [], isCongress: false, isInsider: true, lastFiledAt: null, firstFiledAt: null, underReview: false });
  const mem = (id: number, name: string, chamber: "house" | "senate"): Person => ({ id, name, slug: name.toLowerCase().replace(/ /g, "-"), bioguideId: null, cik: null, roles: [{ kind: "congress", chamber, state: "TX", district: chamber === "house" ? "1" : null, party: "Democrat", companyId: null, officerTitle: null, isDirector: null }], txns: [], filings: [], isCongress: true, isInsider: false, lastFiledAt: null, firstFiledAt: null, underReview: false });
  const people = new Map<number, Person>([[1, ins(1, "Ann Able", 1, "CEO")], [2, ins(2, "Bo Baker", 1, "CFO")], [3, mem(3, "Cy Cole", "house")], [4, mem(4, "Di Dunn", "senate")]]);
  const txns: Txn[] = [
    f4(1, 1, "P", "buy", "2026-02-01", 100, 1000), f4(1, 1, "S", "sell", "2026-03-01", 50, 600), f4(1, 1, "A", "buy", "2025-06-01", 500, 0), f4(1, 1, "F", "other", "2025-06-02", 20, 250),
    f4(2, 1, "S", "sell", "2025-12-15", 10, 120),   // outside the 90 days to 2026-03-31
    ptr(3, 1, "buy", "2026-01-10", 1001, 15000), ptr(3, 2, "sell", "2026-01-11", 15001, 50000), ptr(4, 1, "sell", "2026-02-10", 1001, 15000), ptr(4, 2, "buy", "2026-02-11", 1001, 15000), ptr(3, 1, "sell", "2026-03-10", 1001, 15000),
  ];
  for (const t of txns) { const p = people.get(t.personId!)!; p.txns.unshift(t); const s = securities.get(t.securityId!)!; s.txns.push(t); companies.get(s.companyId!)!.txns.push(t); }
  return { people, securities, companies, txns, builtAt: "2026-03-31T12:00:00.000Z" } as unknown as Flagship;
}

test("shards: stable, in range, and every card lands in exactly one shard of its kind", () => {
  assert.equal(shardOf("nvda", 16), shardOf("nvda", 16));
  for (const k of ["nvda", "jpm", "a", "brk.b", "jen-hsun-huang-i12"]) for (const n of [4, 8, 16, 32]) { const s = shardOf(k, n); assert.ok(s >= 0 && s < n && Number.isInteger(s)); }
  assert.match(shardFor("stock", "nvda"), /^\/data\/watch\/stock-\d+\.json$/);
  const m = build(), all = buildCards(m);
  for (const kind of Object.keys(SHARDS) as Kind[]) {
    const seen: string[] = [];
    for (let n = 0; n < SHARDS[kind]; n++) { const sh = watchShard(m, kind, n); assert.equal(sh.window, WATCH_WINDOW_DAYS); for (const k of Object.keys(sh.cards)) { assert.equal(shardOf(k, SHARDS[kind]), n); seen.push(k); } }
    assert.deepEqual(seen.sort(), [...all[kind].keys()].sort(), kind);
  }
});

test("stock and company cards list who traded in the window, with the stock page's figures", () => {
  const all = buildCards(build());
  const aaa = all.stock.get("aaa") as StockCard;
  assert.ok(isStockCard(aaa));
  assert.deepEqual([aaa.ticker, aaa.name, aaa.path, aaa.chart], ["AAA", "Alpha Corp", "/stocks/aaa/", true]);
  assert.deepEqual(aaa.insiders.map((r) => [r.name, r.role, r.rows, r.buys, r.sells, r.bought, r.sold, r.last]), [["Ann Able", "CEO", 2, 1, 1, 1000, 600, "2026-03-01"]]);
  assert.equal(aaa.insiderCount, 1, "Bo Baker's sale is older than 90 days");
  assert.deepEqual(aaa.members.map((r) => [r.name, r.seat, r.trades, r.buys, r.sells, r.low, r.high]), [["Cy Cole", "Rep. D-TX-1", 2, 1, 1, 2002, 30000], ["Di Dunn", "Sen. D-TX", 1, 0, 1, 1001, 15000]]);
  assert.equal((all.stock.get("bbb") as StockCard).chart, false, "a bond gets no price chart");
  const co = all.company.get("alpha-corp") as StockCard;
  assert.deepEqual([co.ticker, co.path, co.chart, co.insiderCount, co.memberCount], ["AAA", "/companies/alpha-corp/", true, 1, 2]);
});

test("person cards: twelve months of bars, the latest trade, the window's totals and tickers", () => {
  const all = buildCards(build());
  assert.deepEqual(monthKeys("2026-03-31T00:00:00Z", 3), ["2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(monthKeys("2026-01-15", 2), ["2025-12", "2026-01"]);
  const ann = all.insider.get("ann-able") as PersonCard;
  assert.equal(ann.months.length, 12);
  assert.deepEqual([ann.months[0][0], ann.months.at(-1)![0]], ["2025-04", "2026-03"]);
  assert.deepEqual(ann.months.filter(([, b, s]) => b || s), [["2026-02", 1, 0], ["2026-03", 0, 1]], "a grant (code A) is not a buy");
  assert.deepEqual([ann.rows, ann.buys, ann.sells, ann.bought, ann.sold], [2, 1, 1, 1000, 600]);
  assert.deepEqual([ann.last?.date, ann.last?.verb, ann.last?.ticker], ["2026-03-01", "Open-market sale", "AAA"]);
  assert.equal(ann.role, "CEO at Alpha Corp");
  assert.equal(ann.low, undefined);
  const cy = all.member.get("cy-cole") as PersonCard;
  assert.deepEqual([cy.rows, cy.buys, cy.sells, cy.low, cy.high], [3, 1, 2, 17003, 80000]);
  assert.deepEqual(cy.tickers, [["AAA", 2], ["BBB", 1]]);
  assert.deepEqual(cy.months.filter(([, b, s]) => b || s), [["2026-01", 1, 1], ["2026-03", 0, 1]]);
  assert.ok(all.member.has("di-dunn") && !all.insider.has("cy-cole"));
});

test("shortSeat", () => {
  const p = (chamber: "house" | "senate", party: string | null, district: string | null) => ({ roles: [{ kind: "congress", chamber, state: "CA", district, party }] }) as unknown as Person;
  assert.equal(shortSeat(p("house", "Republican", "12")), "Rep. R-CA-12");
  assert.equal(shortSeat(p("senate", "Independent", null)), "Sen. I-CA");
  assert.equal(shortSeat(p("house", null, null)), "Rep. CA");
  assert.equal(shortSeat({ roles: [] } as unknown as Person), "");
});
