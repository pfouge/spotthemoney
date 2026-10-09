// Offline tests for the member-profile figures (web/src/lib/profile.ts). Run:
//   npx tsx --test scripts/profile.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ordinal, memberProfile, peerStats, sameState, sameStocks, seatGroups, memberQa, medianOf, pct, ownerLabel, stateName, seatName, partyName } from "../web/src/lib/profile";
import type { Flagship, Person, Txn, Security, Seat } from "../web/src/lib/flagship";

let nextId = 1;
function txn(personId: number, securityId: number | null, side: string, date: string | null, lag: number | null, low: number, high: number, owner = "self"): Txn {
  return { id: nextId++, filingId: 1, personId, securityId, side, code: null, isDerivative: null, txnDate: date, disclosedAt: "2026-03-01",
    amountLow: low, amountHigh: high, shares: null, price: null, lagDays: lag, is10b51: null, ownerType: owner, assetType: "stock",
    source: "house_ptr", sourceUrl: null, filedAt: "2026-03-01", isPublished: true, value: high };
}
function person(id: number, name: string, state: string, txns: Txn[]): Person {
  return { id, name, slug: name.toLowerCase().replace(/ /g, "-"), bioguideId: null, cik: null,
    roles: [{ kind: "congress", chamber: "house", state, district: "1", party: "Democrat", companyId: null, officerTitle: null, isDirector: null }],
    txns, filings: [], isCongress: true, isInsider: false, lastFiledAt: null, firstFiledAt: null, underReview: false };
}
function build(): { m: Flagship; a: Person; b: Person; c: Person } {
  const sec = (id: number, ticker: string): Security => ({ id, ticker, type: "stock", name: ticker, companyId: null, txns: [], insiderTxns: [], congressTxns: [], underReview: false });
  const securities = new Map([[1, sec(1, "AAA")], [2, sec(2, "BBB")], [3, sec(3, "CCC")]]);
  const a = person(1, "Ann Able", "TX", [
    txn(1, 1, "buy", "2026-01-10", 20, 1001, 15000),
    txn(1, 1, "sell", "2026-02-10", 50, 15001, 50000, "spouse"),
    txn(1, 2, "buy", "2025-06-01", 30, 1001, 15000),
    txn(1, null, "exchange", "2025-07-01", null, 1001, 15000, "joint"),
  ]);
  const b = person(2, "Bob Baker", "TX", [txn(2, 1, "buy", "2026-01-11", 60, 1001, 15000), txn(2, 2, "buy", "2026-01-12", 10, 1001, 15000)]);
  const c = person(3, "Cy Cole", "OH", [txn(3, 3, "sell", "2026-01-13", 5, 1001, 15000)]);
  const people = new Map([[1, a], [2, b], [3, c]]);
  for (const p of people.values()) for (const t of p.txns) if (t.securityId != null) { securities.get(t.securityId)!.txns.push(t); securities.get(t.securityId)!.congressTxns.push(t); }
  const m = { people, securities, companies: new Map(), seats: new Map() } as unknown as Flagship;
  return { m, a, b, c };
}

test("medianOf, pct and the label helpers", () => {
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([4, 1, null, 3, 2]), 2.5);
  assert.equal(medianOf([]), null);
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(1, 0), null);
  assert.equal(ownerLabel("self"), "Member");
  assert.equal(ownerLabel("Spouse"), "Spouse");
  assert.equal(ownerLabel(null), "Not stated");
  assert.equal(stateName("TX"), "Texas");
  assert.equal(stateName("ZZ"), "ZZ");
  assert.equal(seatName("house", "0"), "At-large");
  assert.equal(seatName("house", "21"), "District 21");
  assert.equal(seatName("senate", null), null);
  assert.equal(partyName("D"), "Democrat");
  assert.equal(partyName("Republican"), "Republican");
  assert.equal(partyName("Libertarian"), "Libertarian");
});

test("memberProfile: counts, ranges, years, owners and stocks", () => {
  const { m, a } = build();
  const p = memberProfile(m, a);
  assert.deepEqual([p.trades, p.buys, p.sells, p.other], [4, 2, 1, 1]);
  assert.equal(p.low, 1001 * 3 + 15001);
  assert.equal(p.high, 15000 * 3 + 50000);
  assert.deepEqual([p.firstTrade, p.lastTrade], ["2025-06-01", "2026-02-10"]);
  assert.equal(p.medianLag, 30);
  assert.deepEqual([p.late, p.dated, p.lateShare], [1, 3, 33]); // the row with no lag is not counted either way
  assert.deepEqual(p.years.map((y) => [y.year, y.trades, y.buys, y.sells, y.other, y.late]), [["2026", 2, 1, 1, 0, 1], ["2025", 2, 1, 0, 1, 0]]);
  assert.deepEqual(p.owners.map((o) => [o.label, o.n, o.share]), [["Member", 2, 50], ["Joint", 1, 25], ["Spouse", 1, 25]]);
  assert.deepEqual(p.stocks.map((s) => [s.sec.ticker, s.trades, s.buys, s.sells, s.last]), [["AAA", 2, 1, 1, "2026-02-10"], ["BBB", 1, 1, 0, "2025-06-01"]]);
  assert.equal(p.noTicker, 1);
  assert.equal(p.years.reduce((n, y) => n + y.trades, 0), p.trades);
  assert.equal(p.owners.reduce((n, o) => n + o.n, 0), p.trades);
});

test("peerStats: rank with ties, medians across all members with trades", () => {
  const { m, a, b, c } = build();
  const peers = peerStats(m);
  assert.equal(peers.members, 3);
  assert.equal(peers.medianTrades, 2);
  assert.deepEqual([peers.rankByTrades.get(a.id), peers.rankByTrades.get(b.id), peers.rankByTrades.get(c.id)], [1, 2, 3]);
  assert.equal(peers.medianLag, 25); // lags 5, 10, 20, 30, 50, 60
  assert.equal(peers.lateShare, 33);
});

test("related members: same state, and shared tickers", () => {
  const { m, a, b } = build();
  assert.deepEqual(sameState(m, a).map((r) => r.person.name), ["Bob Baker"]);
  const mates = sameStocks(m, a);
  assert.deepEqual(mates.map((r) => [r.person.name, r.shared]), [["Bob Baker", ["AAA", "BBB"]]]);
  assert.deepEqual(sameStocks(m, b).map((r) => r.person.name), ["Ann Able"]);
});

test("seatGroups and memberQa", () => {
  const { m, a } = build();
  const seat = (code: string, parent: string | null, name: string, title: string | null): Seat => ({ code, parent, chamber: "house", name, url: null, jurisdiction: null, side: "minority", rank: 1, title });
  const seats = [seat("HSAG", null, "House Committee on Agriculture", null), seat("HSWM", null, "House Committee on Ways and Means", "Ranking Member"), seat("HSWM04", "HSWM", "Health", null)];
  const groups = seatGroups(seats);
  assert.deepEqual(groups.map((g) => [g.seat.code, g.subs.length]), [["HSWM", 1], ["HSAG", 0]]);
  const prof = memberProfile(m, a);
  const qa = memberQa(a, prof, seats, { chamber: "house", range: "between $18K and $95K", longDate: (d) => d });
  assert.equal(qa.length, 5);
  assert.match(qa[0]!.a, /^4 trades on record here: 2 purchases, 1 sale and 1 other transaction/);
  assert.match(qa[1]!.a, /AAA \(2 trades\) and BBB \(1 trade\)/);
  assert.match(qa[2]!.a, /1 trade of 3 dated trades \(33%\) was reported more than 45 days/);
  assert.match(qa[3]!.a, /House Committee on Ways and Means \(Ranking Member\) and House Committee on Agriculture/);
  for (const f of qa) assert.doesNotMatch(f.a, /because|in order to|ahead of|suspicious/i);
  assert.deepEqual(memberQa(a, memberProfile(m, { ...a, txns: [] }), seats, { chamber: "house", range: "", longDate: (d) => d }), []);
});

test("ordinal: 1st, 2nd, 3rd, 11th-13th, 21st, 41st, 112th", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 41, 103, 112, 1001].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "41st", "103rd", "112th", "1,001st"]);
});
