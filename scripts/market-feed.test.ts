import test from "node:test";
import assert from "node:assert/strict";
import { allFormFourTxns, entityPath, emptyMarket, type Flagship, type Txn, type Person, type Security, type Company } from "../web/src/lib/flagship-core";
import { notableRows } from "../web/src/lib/notable-build";
import { buildFeed, capFeed, capLine, findClusters, DEFAULT_STATE, FEED_CAPS, type FeedItem } from "../web/src/lib/notable";

let id = 100;
const txn = (o: Partial<Txn> = {}): Txn => ({ id: ++id, filingId: 1, personId: 1, securityId: 1, side: "buy", code: "P", isDerivative: false, txnDate: "2026-11-10", disclosedAt: "2026-11-12",
  amountLow: null, amountHigh: null, shares: 1000, price: 50, lagDays: 2, is10b51: false, ownerType: null, assetType: null, source: "sec_form4", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/0001-26-000001-index.htm",
  filedAt: "2026-11-12", isPublished: true, value: 50_000, holdingsChange: 5, ...o });
const person = (i: number, o: Partial<Person> = {}): Person => ({ id: i, name: `Person ${i}`, slug: `person-${i}`, bioguideId: null, cik: null, roles: [{ kind: "insider", chamber: null, state: null, district: null, party: null, companyId: 1, officerTitle: "CEO", isDirector: false, validFrom: null, validTo: null }],
  txns: [], filings: [], isCongress: false, isInsider: true, lastFiledAt: null, firstFiledAt: null, underReview: false, ...o });
const sec = (i: number, ticker: string, companyId: number, o: Partial<Security> = {}): Security => ({ id: i, ticker, type: "equity", name: ticker, companyId, txns: [], insiderTxns: [], congressTxns: [], underReview: false, ...o });
const co = (i: number, name: string, slug: string, o: Partial<Company> = {}): Company => ({ id: i, name, cik: null, slug, primaryTicker: null, sector: null, securityIds: [], insiders: [], txns: [], contracts: [], lobbying: [], underReview: false, ...o });

function model(): Flagship {
  const m = { builtAt: "2026-11-15T00:00:00Z", market: emptyMarket(), people: new Map(), companies: new Map(), securities: new Map(), filings: new Map(), txns: [] } as unknown as Flagship;
  // tracked: person 1 at company 1 (TRK)
  m.people.set(1, person(1)); m.companies.set(1, co(1, "Tracked Co", "tracked-co")); m.securities.set(1, sec(1, "TRK", 1));
  // market: company 9 (MKT) with three insiders 11, 12, 13
  m.market.companies.set(9, co(9, "Market Co", "market-co", { od: true })); m.market.securities.set(9, sec(9, "MKT", 9, { od: true }));
  for (const p of [11, 12, 13]) m.market.people.set(p, person(p, { od: true, roles: [{ kind: "insider", chamber: null, state: null, district: null, party: null, companyId: 9, officerTitle: "Director", isDirector: true, validFrom: null, validTo: null }] }));
  return m;
}

test("entityPath builds one address pattern for every kind", () => {
  assert.equal(entityPath("insider", { slug: "a-b" }), "/insiders/a-b/");
  assert.equal(entityPath("congress", { slug: "x" }), "/congress/x/");
  assert.equal(entityPath("company", { slug: "c" }), "/companies/c/");
  assert.equal(entityPath("stock", { ticker: "BRK.B" }), "/stocks/brk.b/");
  assert.equal(entityPath("insider", { slug: null }), null);
});

test("allFormFourTxns: tracked Form 4 rows first, then market rows; PTR rows excluded", () => {
  const m = model();
  const a = txn(), b = txn({ source: "house_ptr" }), c = txn({ personId: 11, securityId: 9 });
  m.txns = [a, b]; m.market.txns = [c];
  assert.deepEqual(allFormFourTxns(m).map((t) => t.id), [a.id, c.id]);
});

test("feed over mixed rows: market cluster buy and market large sale appear, with market links", () => {
  const m = model();
  m.txns = [txn({ personId: 1, securityId: 1 })];
  m.market.txns = [
    ...[11, 12, 13].map((p) => txn({ personId: p, securityId: 9, value: 40_000 })),
    txn({ personId: 11, securityId: 9, side: "sell", code: "S", value: 2_500_000, holdingsChange: -2 }),
  ];
  const rows = notableRows(m);
  assert.equal(rows.length, 5);
  const mk = rows.filter((r) => r.ticker === "MKT");
  assert.ok(mk.every((r) => r.stockPath === "/stocks/mkt/" && r.path?.startsWith("/insiders/person-")));
  const data = buildFeed(rows, "2026-11-15", { companies: 2, senateThrough: null });
  assert.equal(data.clusters.filter((c) => c.b === 1 && c.tk === "MKT").length, 1, "market cluster buy");
  const cl = data.clusters[0]!;
  assert.deepEqual(cl.who.map((w) => w.p).sort(), ["/insiders/person-11/", "/insiders/person-12/", "/insiders/person-13/"]);
  assert.ok(data.items.some((i) => i.tg.includes("large-sale") && i.tk === "MKT" && i.np === "/insiders/person-11/"), "market large sale");
  assert.equal(findClusters(rows).length, 1);
});

test("cap keeps the largest per window, never cuts clusters or stake changes, and records true totals", () => {
  const items: FeedItem[] = [];
  for (let i = 0; i < 1000; i++) items.push({ k: "r", id: i, d: "2026-11-12", t: "2026-11-10", n: "n", np: null, r: "", tk: "T", tp: null, co: "c", b: 1, v: i + 1, vl: "", vs: "", ch: "", cs: null, tg: ["insider-buy"], u: null, ul: "", cl: -1 });
  items.push({ ...items[0]!, id: 5000, v: 1, tg: ["insider-buy", "stake-change"] });
  const data = { built: "2026-11-15", newest: "2026-11-12", companies: 1, senateThrough: null, items, clusters: [] };
  const c = capFeed(data);
  assert.equal(c.cap!.buys[30].total, 1001);
  const kept = c.items.filter((i) => i.tg.includes("insider-buy"));
  assert.equal(kept.length, FEED_CAPS.buys[30] + 1, "30-day cap plus the stake change kept for its own reason");
  assert.ok(c.items.some((i) => i.id === 5000), "stake change is never cut");
  assert.ok(c.items.some((i) => i.id === 999) && !c.items.some((i) => i.id === 0), "largest kept, smallest cut");
  assert.equal(c.cap!.buys[30].kept, kept.length);
  assert.equal(capLine(c, { ...DEFAULT_STATE, preset: "buys", win: 30 }), `Showing the ${kept.length} largest of 1,001 insider buys in 30 days.`);
  assert.equal(capLine(c, { ...DEFAULT_STATE, preset: "csell", win: 30 }), "");
  assert.equal(capFeed({ ...data, items: items.slice(0, 10) }).cap, undefined, "nothing cut: unchanged");
});
