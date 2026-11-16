// Committee pages (web/src/lib/committees.ts): members, counts by disclosure date, slugs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommittees, committeeSlug, committeeLogLine } from "../web/src/lib/committees";

const TODAY = "2026-11-16";
let nextId = 1;
const txn = (personId: number, d: string | null, side = "buy", securityId: number | null = 1) => ({ id: nextId++, personId, disclosedAt: d, filedAt: d, side, securityId });
const person = (id: number, name: string, role: any, txns: any[] = [], extra: any = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), isCongress: true, roles: [{ kind: "congress", ...role }], txns, ...extra });
const full = (code: string, name: string, chamber = "house", title: string | null = null) => ({ code, parent: null, chamber, name, url: `https://example.gov/${code}`, jurisdiction: null, side: null, rank: null, title });
const sub = (code: string, parent: string, name: string) => ({ code, parent, chamber: "house", name, url: null, jurisdiction: null, side: null, rank: null, title: "Chair" });
const model: any = {
  securities: new Map([[1, { id: 1, ticker: "AAA" }], [2, { id: 2, ticker: "BBB" }]]),
  people: new Map([
    [1, person(1, "Ann B. Zeta", { chamber: "house", state: "tx", district: "21", party: "Republican" }, [txn(1, "2026-11-01", "buy", 1), txn(1, "2026-01-10", "sell", 2), txn(1, "2025-06-01", "sell", 1), txn(1, "2026-10-01", "other", null)])],
    [2, person(2, "Carl Alpha", { chamber: "house", state: "OH", district: "3", party: "D" }, [txn(2, "2026-03-01", "buy", 1)])],
    [3, person(3, "Dee Mid", { chamber: "house", state: "AK", district: "0", party: "D" })],
    [4, person(4, "Sam Senator", { chamber: "senate", state: "TX", district: null, party: "I" })],
    [5, person(5, "Eve Insider", {}, [txn(5, "2026-11-02")], { isCongress: false, roles: [{ kind: "insider" }] })],
  ]),
  seats: new Map([
    [1, [full("HSAG", "House Committee on Agriculture"), sub("HSAG15", "HSAG", "Livestock")]],
    [2, [full("HSAG", "House Committee on Agriculture", "house", "Chair"), full("HSBA", "House Committee on Financial Services")]],
    [3, [sub("HSAG15", "HSAG", "Livestock"), sub("HSAP01", "HSAP", "Parent has no seat on record")]],
    [4, [full("SSAF", "Senate Committee on Agriculture, Nutrition, and Forestry", "senate")]],
    [5, [full("HSAG", "House Committee on Agriculture")]],
  ]),
};
const cs = buildCommittees(model, TODAY, (p: any) => `/congress/${p.slug}/`);
const get = (code: string) => cs.find((c) => c.code === code)!;

test("one committee per full committee with a member; House before Senate, by name", () => {
  assert.deepEqual(cs.map((c) => c.code), ["HSAG", "HSBA", "SSAF"]); // HSAP has only a subcommittee seat and no facts
  assert.equal(new Set(cs.map((c) => c.slug)).size, cs.length);
  assert.equal(get("HSAG").path, "/congress-committees/house-agriculture/");
});

test("members: leaders first, then by surname; a subcommittee-only seat counts; non-members of Congress are out", () => {
  const ag = get("HSAG");
  assert.deepEqual(ag.members.map((m) => m.id), [2, 3, 1]); // Alpha is Chair; then Mid, Zeta
  assert.equal(ag.members[0].title, "Chair");
  assert.equal(ag.members.find((m) => m.id === 3)!.title, null); // a subcommittee chair is not the committee's chair
  assert.deepEqual(ag.members.find((m) => m.id === 1)!.subs, ["Livestock"]);
  assert.deepEqual(ag.subcommittees, ["Livestock"]);
  assert.equal(ag.members.find((m) => m.id === 1)!.seat, "TX-21");
});

test("trade counts: every row of every member, 12 months by disclosure date", () => {
  const ag = get("HSAG");
  assert.equal(ag.withTrades, 2);
  assert.equal(ag.trades, 5);
  assert.equal(ag.trades12m, 4);     // the 2025-06-01 row is older than 365 days
  assert.equal(ag.buys12m, 2); assert.equal(ag.sells12m, 1); // one "other" row is neither
  assert.equal(ag.latest, "2026-11-01");
  assert.equal(ag.trades, ag.members.reduce((n, m) => n + m.trades, 0));
  assert.equal(ag.trades12m, ag.members.reduce((n, m) => n + m.trades12m, 0));
  assert.deepEqual(ag.txns.map((t) => t.disclosedAt), ["2026-11-01", "2026-10-01", "2026-03-01", "2026-01-10", "2025-06-01"]);
  const none = get("SSAF");
  assert.equal(none.trades, 0); assert.equal(none.latest, null); assert.deepEqual(none.stocks, []);
});

test("most-traded tickers: 12 months only, members counted once", () => {
  const ag = get("HSAG");
  assert.deepEqual(ag.stocks.map((s) => [s.ticker, s.trades, s.members, s.buys, s.sells]), [["AAA", 2, 2, 2, 0], ["BBB", 1, 1, 0, 1]]);
});

test("slugs", () => {
  assert.equal(committeeSlug("House Committee on Financial Services"), "house-financial-services");
  assert.equal(committeeSlug("Senate Committee on the Judiciary"), "senate-judiciary");
  assert.equal(committeeSlug("House Committee on Veterans' Affairs"), "house-veterans-affairs");
  assert.equal(committeeSlug("Joint Committee of Congress on the Library"), "joint-library");
  assert.equal(committeeSlug("United States Senate Caucus on International Narcotics Control"), "senate-caucus-international-narcotics-control");
  const long = committeeSlug("House Select Committee on the Strategic Competition Between the United States and the Chinese Communist Party");
  assert.ok(long.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(long), long);
});

test("build-log line names the totals", () => {
  assert.match(committeeLogLine(cs), /^committees: 3 pages, 5 seats, 4 members seated, 2 of them with trades, 1 committees with no trades/);
});
