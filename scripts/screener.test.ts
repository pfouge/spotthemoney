// Congress trade screener rules (web/src/lib/screener.ts): packing, filters, sorting, paging, the address.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  screenerData, screenerTxns, unpack, matches, screen, sortRows, summaryLine, parseHash, toHash, isViewHash, isDefaultFilter, isLateRow,
  rangeLabel, minLabel, assetLabel, shortDate, seatTag, firstDir, NO_FILTER, DEFAULT_VIEW, DEFAULT_PER, type ScreenFilter, type ScreenView,
} from "../web/src/lib/screener";

const TODAY = "2026-11-17";
let id = 0;
const txn = (personId: number | null, o: any = {}) => ({
  id: ++id, filingId: o.filingId ?? 100 + (personId ?? 0), personId, securityId: o.sec ?? null, side: o.side ?? "buy", source: o.source ?? "house_ptr",
  isPublished: o.pub ?? true, txnDate: "txn" in o ? o.txn : "2026-10-01", disclosedAt: "disc" in o ? o.disc : "2026-10-20", lagDays: "lag" in o ? o.lag : 19,
  amountLow: "low" in o ? o.low : 1001, amountHigh: "high" in o ? o.high : 15000, ownerType: o.owner ?? "self", assetType: o.asset ?? "stock",
  sourceUrl: o.url ?? `https://example.test/${o.filingId ?? 100 + (personId ?? 0)}.pdf`,
});
const person = (pid: number, name: string, role: any) => ({ id: pid, name, slug: name.toLowerCase().replace(/\W+/g, "-"), isCongress: true, roles: [{ kind: "congress", ...role }] });
const txns = [
  txn(1, { sec: 1, side: "buy", low: 15001, high: 50000, disc: "2026-11-10", txn: "2026-10-30", lag: 11 }),                 // 1 Zeta NVDA
  txn(1, { sec: 2, side: "sell", low: 1001, high: 15000, disc: "2026-11-10", txn: "2026-09-01", lag: 70, owner: "spouse" }), // 2 Zeta AAPL late
  txn(2, { sec: 1, side: "buy", low: 1000001, high: 5000000, disc: "2026-08-01", txn: "2026-07-20", lag: 12, source: "senate_ptr" }), // 3 Alpha NVDA
  txn(2, { side: "sell", low: 5000001, high: null, disc: "2026-03-01", txn: "2026-02-20", lag: 9, asset: "bond", source: "senate_ptr", owner: "joint" }), // 4 Alpha bond, open top
  txn(3, { sec: 2, side: "exchange", low: 1001, high: 15000, disc: "2025-10-05", txn: null, lag: null, owner: "dependent" }), // 5 Mid AAPL, no trade date
  txn(1, { sec: 1, pub: false }),                         // under review: out
  txn(1, { sec: 1, disc: null }),                         // no disclosure date: out
  txn(9, { sec: 1, source: "sec_form4" }),                // an insider row: out
  txn(null, { sec: 1 }),                                  // no filer: out
];
const model: any = {
  txns,
  people: new Map([
    [1, person(1, "Ann B. Zeta", { chamber: "house", state: "tx", district: "21", party: "Republican" })],
    [2, person(2, "Carl Alpha Jr.", { chamber: "senate", state: "TX", district: null, party: "D" })],
    [3, person(3, "Dee Mid", { chamber: "house", state: "AK", district: "0", party: "Independent", validTo: "2026-01-05" })],
  ]),
  securities: new Map([[1, { ticker: "NVDA" }], [2, { ticker: "AAPL" }]]),
  seats: new Map([
    [1, [{ code: "HSAG", parent: null }, { code: "HSAG15", parent: "HSAG" }, { code: "HSAP01", parent: "HSAP" }]],
    [2, [{ code: "SSAF", parent: null }]],
  ]),
};
const data = screenerData(model, TODAY, (p: any) => `/congress/${p.slug}/`);
const all = unpack(JSON.parse(JSON.stringify(data)));   // through JSON, as the browser gets it
const f = (o: Partial<ScreenFilter>): ScreenFilter => ({ ...NO_FILTER, ...o });
const ids = (flt: ScreenFilter) => all.filter((r) => matches(r, flt, data.built)).map((r) => r.id).sort((a, b) => a - b);
const view = (o: Partial<ScreenView> = {}, flt: Partial<ScreenFilter> = {}): ScreenView => ({ ...DEFAULT_VIEW, ...o, f: f(flt) });

test("data: published congressional rows with a disclosure date and a filer, each member and report written once", () => {
  assert.deepEqual(screenerTxns(model).map((t: any) => t.id), [1, 2, 3, 4, 5]);
  assert.equal(data.rows.length, 5); assert.equal(data.members.length, 3); assert.equal(data.filings.length, 3);
  const z = all.find((r) => r.id === 1)!;
  assert.deepEqual([z.m.n, z.m.p, z.m.ch, z.m.pa, z.m.st, z.m.se], ["Ann B. Zeta", "/congress/ann-b-zeta/", "house", "R", "TX", "TX-21"]);
  assert.deepEqual(z.m.c, ["HSAG", "HSAP"]);            // a subcommittee seat counts for its parent, once
  assert.equal(z.ticker, "NVDA"); assert.equal(z.url, "https://example.test/101.pdf");
  const b = all.find((r) => r.id === 4)!;
  assert.deepEqual([b.ticker, b.asset, b.low, b.high, b.m.se, b.m.f], ["", "bond", 5000001, null, "TX", undefined]);
  const m = all.find((r) => r.id === 5)!;
  assert.deepEqual([m.txn, m.lag, m.m.f, m.m.se, m.m.pa], [null, null, 1, "AK-AL", "I"]);
});

test("filters: each one alone", () => {
  assert.deepEqual(ids(f({})), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(f({ chamber: "senate" })), [3, 4]);
  assert.deepEqual(ids(f({ party: "R" })), [1, 2]);
  assert.deepEqual(ids(f({ state: "TX" })), [1, 2, 3, 4]);
  assert.deepEqual(ids(f({ committee: "HSAP" })), [1, 2]);
  assert.deepEqual(ids(f({ committee: "HSAG15" })), []);  // only full committees are filter values
  assert.deepEqual(ids(f({ side: "sell" })), [2, 4]);
  assert.deepEqual(ids(f({ side: "exchange" })), [5]);
  assert.deepEqual(ids(f({ owner: "spouse" })), [2]);
  assert.deepEqual(ids(f({ asset: "ticker" })), [1, 2, 3, 5]);
  assert.deepEqual(ids(f({ asset: "other" })), [4]);
});

test("filters: amount goes by the low end of the range; late and on time; windows by disclosure date", () => {
  assert.deepEqual(ids(f({ min: 15001 })), [1, 3, 4]);
  assert.deepEqual(ids(f({ min: 50001 })), [3, 4]);
  assert.deepEqual(ids(f({ min: 1000000 })), [3, 4]);
  assert.deepEqual(ids(f({ late: "late" })), [2]);
  assert.deepEqual(ids(f({ late: "ontime" })), [1, 3, 4]);   // a row with no lag is neither
  assert.equal(isLateRow({ lag: 45 }), false); assert.equal(isLateRow({ lag: 46 }), true); assert.equal(isLateRow({ lag: null }), false);
  assert.deepEqual(ids(f({ w: 30 })), [1, 2]);
  assert.deepEqual(ids(f({ w: 365 })), [1, 2, 3, 4]);
  // The window's edge is inclusive and never reaches into the future.
  const edge = unpack({ built: "2026-11-17", members: data.members, filings: [""], rows: [[90, 0, "X", "stock", "buy", "self", "", "2026-08-19", -1, -1, -1, 0], [91, 0, "X", "stock", "buy", "self", "", "2026-08-18", -1, -1, -1, 0], [92, 0, "X", "stock", "buy", "self", "", "2026-11-18", -1, -1, -1, 0]] });
  assert.deepEqual(edge.filter((r) => matches(r, f({ w: 90 }), "2026-11-17")).map((r) => r.id), [90]);
});

test("search: every word must be in the member's name or the ticker; filters combine", () => {
  assert.deepEqual(ids(f({ q: "zeta" })), [1, 2]);
  assert.deepEqual(ids(f({ q: "NVDA" })), [1, 3]);
  assert.deepEqual(ids(f({ q: "alpha nvda" })), [3]);
  assert.deepEqual(ids(f({ q: "  " })), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(f({ q: "nobody" })), []);
  assert.deepEqual(ids(f({ state: "TX", side: "buy", min: 15001 })), [1, 3]);
  assert.deepEqual(ids(f({ chamber: "house", party: "R", late: "late", owner: "spouse" })), [2]);
});

test("sorting: default newest disclosure; empty values last both ways; ties by newest disclosure, then id", () => {
  const order = (k: any, dir: any) => sortRows(all, k, dir).map((r) => r.id);
  assert.deepEqual(order("disclosed", "desc"), [2, 1, 3, 4, 5]);
  assert.deepEqual(order("disclosed", "asc"), [5, 4, 3, 2, 1]);
  assert.deepEqual(order("trade", "desc"), [1, 2, 3, 4, 5]);     // row 5 has no trade date
  assert.deepEqual(order("trade", "asc"), [4, 3, 2, 1, 5]);
  assert.deepEqual(order("member", "asc"), [3, 4, 5, 2, 1]);     // Alpha, Mid, Zeta (by surname)
  assert.deepEqual(order("ticker", "asc"), [2, 5, 1, 3, 4]);     // AAPL, AAPL, NVDA, NVDA, none
  assert.deepEqual(order("ticker", "desc"), [1, 3, 2, 5, 4]);
  assert.deepEqual(order("lag", "desc"), [2, 3, 1, 4, 5]);
  assert.deepEqual(order("amount", "desc"), [4, 3, 1, 2, 5]);    // open-topped range above the rest; equal ranges by newest
  assert.deepEqual(order("amount", "asc"), [2, 5, 1, 3, 4]);
  assert.equal(firstDir("member"), "asc"); assert.equal(firstDir("amount"), "desc");
});

test("screen: counts, pages, and a page past the end falls back to the last one", () => {
  const r = screen(all, view({ per: 2 } as any), data.built);
  assert.deepEqual([r.total, r.members, r.tickers, r.buys, r.sells, r.pages, r.page, r.from, r.to], [5, 3, 2, 2, 2, 3, 1, 1, 2]);
  assert.deepEqual(r.rows.map((x) => x.id), [2, 1]);
  const last = screen(all, view({ per: 2, page: 99 } as any), data.built);
  assert.deepEqual([last.page, last.from, last.to, last.rows.map((x) => x.id)], [3, 5, 5, [5]]);
  const none = screen(all, view({}, { q: "nobody" }), data.built);
  assert.deepEqual([none.total, none.pages, none.page, none.from, none.to], [0, 1, 1, 0, 0]);
  assert.equal(summaryLine(none, 5), "No trade matches these filters");
  assert.equal(summaryLine(screen(all, view(), data.built), 5), "All 5 trades by 3 members: 2 purchases, 2 sales, 2 tickers. Showing 1 to 5.");
  assert.equal(summaryLine(screen(all, view({}, { late: "late" }), data.built), 5), "1 trade of 5 by 1 member: 0 purchases, 1 sale, 1 ticker. Showing 1 to 1.");
});

test("labels", () => {
  assert.equal(rangeLabel(1001, 15000), "$1,001–$15K");
  assert.equal(rangeLabel(1000001, 5000000), "$1.0M–$5.0M");
  assert.equal(rangeLabel(5000001, null), "over $5.0M");
  assert.equal(rangeLabel(null, 15000), "up to $15K");
  assert.equal(rangeLabel(null, null), "");
  assert.equal(minLabel(15001), "$15,001 or more"); assert.equal(minLabel(1000000), "$1,000,000 or more");
  assert.equal(assetLabel("bond"), "bond"); assert.equal(assetLabel("hedge_fund"), "hedge fund"); assert.equal(assetLabel(""), "no ticker");
  assert.equal(shortDate("2026-11-03"), "Nov 3, 2026"); assert.equal(shortDate(null), "");
  assert.equal(seatTag(all.find((r) => r.id === 1)!.m), "R-TX-21");
});

test("the address: round trip, defaults leave it empty, junk is ignored, a jump link is not a view", () => {
  assert.equal(toHash(DEFAULT_VIEW), "");
  const v: ScreenView = { f: f({ chamber: "senate", party: "D", state: "TX", committee: "SSAF", side: "buy", min: 100001, owner: "joint", asset: "ticker", w: 90, late: "late", q: "nvda" }), sort: "amount", dir: "asc", page: 3, per: 25 };
  assert.deepEqual(parseHash(toHash(v)), v);
  assert.equal(toHash(view({ sort: "amount", dir: "desc" } as any)), "#sort=amount&dir=desc");
  assert.equal(toHash(view({ sort: "disclosed", dir: "asc" } as any)), "#sort=disclosed&dir=asc");
  const junk = parseHash("#chamber=lords&party=X&state=TEXAS&min=7&owner=dog&asset=x&w=45&late=maybe&sort=price&dir=up&page=-2&per=1000&side=short");
  assert.deepEqual(junk, { ...DEFAULT_VIEW, f: { ...NO_FILTER } });
  assert.equal(parseHash("#sort=member").dir, "asc");
  assert.equal(isViewHash("#about"), false); assert.equal(isViewHash("#heatmap=1"), false); assert.equal(isViewHash("#side=buy"), true); assert.equal(isViewHash(""), false);
  assert.equal(isDefaultFilter(f({})), true); assert.equal(isDefaultFilter(f({ min: 15001 })), false);
  assert.equal(DEFAULT_PER, 50);
});
