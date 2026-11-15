import test from "node:test";
import assert from "node:assert/strict";
import {
  CLUSTER_DAYS, CLUSTER_MIN_INSIDERS, CONGRESS_MIN_LOW, LARGE_SALE_MIN, STAKE_MIN_PCT, STAKE_MIN_VALUE,
  buildFeed, eligible, findClusters, reasonsOf, selectFeed, sinceOf, topLists, DEFAULT_STATE, type NRow,
} from "../web/src/lib/notable";

let n = 0;
function row(o: Partial<NRow> = {}): NRow {
  n++;
  return {
    id: n, personId: n, name: `Person ${n}`, path: `/insiders/p${n}/`, role: "CEO", companyKey: "c1", company: "Acme", ticker: "ACME", stockPath: "/stocks/acme/",
    source: "sec_form4", code: "P", side: "buy", isDerivative: false, is10b51: false, jointOf: null, isPublished: true,
    txnDate: "2026-11-10", disclosedAt: "2026-11-12", value: 50_000, shares: 1000, price: 50, amountLow: null, change: 1,
    valueLabel: "$50K", subLabel: "1,000 × $50", changeLabel: "+1.0%", srcUrl: "https://example.test/f", srcLabel: "Form 4", ...o,
  };
}
const cong = (o: Partial<NRow> = {}) => row({ source: "house_ptr", code: null, shares: null, price: null, value: 50_000, amountLow: 15_001, change: null, role: "Rep. D-AZ-4", ...o });

test("constants match the published rules", () => {
  assert.deepEqual([CLUSTER_MIN_INSIDERS, CLUSTER_DAYS, STAKE_MIN_PCT, STAKE_MIN_VALUE, LARGE_SALE_MIN, CONGRESS_MIN_LOW], [3, 30, 20, 100_000, 1_000_000, 15_001]);
});

test("reasons: insider buy, stake change, large sale, congress", () => {
  assert.deepEqual(reasonsOf(row()), ["insider-buy"]);
  assert.deepEqual(reasonsOf(row({ change: 25, value: 100_000 })), ["insider-buy", "stake-change"]);
  assert.deepEqual(reasonsOf(row({ change: "new", value: 150_000 })), ["insider-buy", "stake-change"]);
  assert.deepEqual(reasonsOf(row({ change: 25, value: 99_999 })), ["insider-buy"], "stake change needs $100,000");
  assert.deepEqual(reasonsOf(row({ change: 19.9, value: 500_000 })), ["insider-buy"], "stake change needs 20%");
  assert.deepEqual(reasonsOf(row({ code: "S", side: "sell", change: -30, value: 200_000 })), ["stake-change"]);
  assert.deepEqual(reasonsOf(row({ code: "S", side: "sell", change: -1, value: 1_000_000 })), ["large-sale"]);
  assert.deepEqual(reasonsOf(row({ code: "S", side: "sell", change: -1, value: 999_999 })), []);
  assert.deepEqual(reasonsOf(cong()), ["congress"]);
  assert.deepEqual(reasonsOf(cong({ amountLow: 15_000 })), [], "range must start at $15,001");
  assert.deepEqual(reasonsOf(cong({ side: "sell", source: "senate_ptr" })), ["congress"]);
  assert.deepEqual(reasonsOf(row({ code: "A", side: "buy" })), [], "awards are not purchases");
});

test("exclusions: unpublished, joint, derivative, plan, no ticker, dates", () => {
  assert.equal(eligible(row()), true);
  assert.equal(eligible(row({ isPublished: false })), false);
  assert.equal(eligible(row({ jointOf: 5 })), false);
  assert.equal(eligible(row({ isDerivative: true })), false);
  assert.equal(eligible(row({ ticker: null })), false);
  assert.equal(eligible(row({ txnDate: null })), false);
  assert.equal(eligible(row({ txnDate: "2026-11-13", disclosedAt: "2026-11-12" })), false, "future-dated against its filing");
  assert.deepEqual(reasonsOf(row({ is10b51: true })), [], "plan rows are not notable");
  assert.deepEqual(reasonsOf(row({ code: "S", side: "sell", is10b51: true, value: 5_000_000 })), []);
  assert.deepEqual(reasonsOf(row({ side: "other" })), []);
  assert.deepEqual(reasonsOf(cong({ isPublished: false })), []);
});

const buyer = (i: number, txn: string, filed: string, co = "c1") => row({ personId: 1000 + i, name: `Buyer ${i}`, txnDate: txn, disclosedAt: filed, companyKey: co });

test("cluster: 3 insiders inside 30 days, not 2, not spread over 31 days", () => {
  assert.equal(findClusters([buyer(1, "2026-11-01", "2026-11-03"), buyer(2, "2026-11-05", "2026-11-06")]).length, 0);
  const three = [buyer(1, "2026-10-01", "2026-10-03"), buyer(2, "2026-10-15", "2026-10-16"), buyer(3, "2026-10-31", "2026-11-02")];
  const c = findClusters(three);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.n, 3);
  assert.equal(c[0]!.f, "2026-10-01"); assert.equal(c[0]!.l, "2026-10-31"); assert.equal(c[0]!.d, "2026-11-02");
  const spread = [buyer(1, "2026-10-01", "2026-10-03"), buyer(2, "2026-10-15", "2026-10-16"), buyer(3, "2026-11-01", "2026-11-02")];
  assert.equal(findClusters(spread).length, 0, "31 days apart");
  assert.equal(findClusters([buyer(1, "2026-11-01", "2026-11-02"), { ...buyer(1, "2026-11-02", "2026-11-03") }, buyer(2, "2026-11-03", "2026-11-04")]).length, 0, "same insider twice is one");
});

test("cluster: groups by company, ignores excluded rows", () => {
  const rows = [buyer(1, "2026-11-01", "2026-11-02"), buyer(2, "2026-11-02", "2026-11-03"), row({ personId: 3000, txnDate: "2026-11-03", disclosedAt: "2026-11-04", is10b51: true })];
  assert.equal(findClusters(rows).length, 0, "a plan purchase is not a cluster member");
  const mixed = [buyer(1, "2026-11-01", "2026-11-02"), buyer(2, "2026-11-02", "2026-11-03", "c2"), buyer(3, "2026-11-03", "2026-11-04", "c3")];
  assert.equal(findClusters(mixed).length, 0, "different companies");
});

function feed(rows: NRow[], built = "2026-11-15") { return buildFeed(rows, built, { companies: 3, senateThrough: null }); }

test("window rule: a cluster needs one row disclosed inside the window", () => {
  const rows = [
    buyer(1, "2026-11-01", "2026-11-02"), buyer(2, "2026-11-03", "2026-11-04"), buyer(3, "2026-11-05", "2026-11-14"),
    row({ personId: 9, txnDate: "2026-11-14", disclosedAt: "2026-11-15", code: "S", side: "sell", value: 2_000_000, companyKey: "c9", ticker: "ZZZ" }),
  ];
  const d = feed(rows);
  assert.equal(d.newest, "2026-11-15");
  assert.equal(sinceOf(d.newest, 1), "2026-11-15"); assert.equal(sinceOf(d.newest, 7), "2026-11-09");
  const s = (win: 1 | 7 | 30) => selectFeed(d, { ...DEFAULT_STATE, win, preset: "cluster" });
  assert.equal(s(30).length, 1);
  assert.equal(s(7).length, 1, "latest member disclosed 11-14, inside 7 days");
  assert.equal(s(1).length, 0, "nothing disclosed on the newest day");
  // one in-window row in a cluster whose other rows were disclosed earlier still counts
  const wide = [buyer(1, "2026-10-20", "2026-10-21"), buyer(2, "2026-10-25", "2026-10-26"), buyer(3, "2026-11-10", "2026-11-12"),
    row({ personId: 9, txnDate: "2026-11-14", disclosedAt: "2026-11-15", code: "S", side: "sell", value: 2_000_000, companyKey: "c9", ticker: "ZZZ" })];
  const d2 = feed(wide);
  assert.equal(selectFeed(d2, { ...DEFAULT_STATE, win: 7, preset: "cluster" }).length, 1);
  assert.equal(d2.clusters[0]!.n, 3);
});

test("All folds cluster members into the cluster; Insider buys lists them", () => {
  const extra = row({ personId: 77, name: "Lone Buyer", companyKey: "c5", ticker: "LONE", txnDate: "2026-11-12", disclosedAt: "2026-11-13" });
  const rows = [buyer(1, "2026-11-10", "2026-11-12"), buyer(2, "2026-11-10", "2026-11-12"), buyer(3, "2026-11-10", "2026-11-12"), extra];
  const d = feed(rows);
  const all = selectFeed(d, DEFAULT_STATE);
  assert.equal(all.length, 2);
  assert.equal(all[0]!.k, "c", "cluster pinned first");
  assert.equal(all[1]!.k, "r");
  assert.equal(selectFeed(d, { ...DEFAULT_STATE, preset: "buys" }).length, 4, "insider buys keep every row");
  assert.equal(selectFeed(d, { ...DEFAULT_STATE, preset: "congress" }).length, 0);
});

test("default sort: clusters first, then newest filed, ties by larger value", () => {
  const rows = [
    row({ personId: 1, name: "A", disclosedAt: "2026-11-12", txnDate: "2026-11-10", companyKey: "c1", ticker: "AAA", value: 200_000, change: 30 }),
    row({ personId: 2, name: "B", disclosedAt: "2026-11-14", txnDate: "2026-11-10", companyKey: "c2", ticker: "BBB", value: 150_000, change: 30 }),
    row({ personId: 3, name: "C", disclosedAt: "2026-11-14", txnDate: "2026-11-10", companyKey: "c3", ticker: "CCC", value: 900_000, change: 30 }),
    cong({ personId: 4, name: "D", disclosedAt: "2026-11-13", txnDate: "2026-11-01", ticker: "DDD", companyKey: "c4", value: 100_000 }),
    buyer(21, "2026-10-01", "2026-10-02", "c8"), buyer(22, "2026-10-02", "2026-10-03", "c8"), buyer(23, "2026-10-03", "2026-11-01", "c8"),
  ];
  const d = feed(rows);
  const out = selectFeed(d, { ...DEFAULT_STATE, win: 30 });
  assert.equal(out[0]!.k, "c");
  assert.deepEqual(out.slice(1).map((e) => (e.k === "r" ? e.n : "?")), ["C", "B", "D", "A"]);
  const large = selectFeed(d, { ...DEFAULT_STATE, win: 30, sort: "large", preset: "buys" });
  assert.deepEqual(large.slice(0, 2).map((e) => (e.k === "r" ? e.n : "?")), ["C", "A"]);
  const stake = selectFeed(d, { ...DEFAULT_STATE, win: 30, sort: "stake", preset: "stake" });
  assert.equal(stake.length, 3);
});

test("search matches ticker, company and person, case-insensitively; presets filter", () => {
  const rows = [row({ name: "Jane Smith", ticker: "JJJ", company: "Jolly Corp", companyKey: "c1" }), row({ name: "Bob", ticker: "KKK", company: "Kappa", companyKey: "c2" }),
    row({ code: "S", side: "sell", value: 3_000_000, name: "Seller", ticker: "SSS", companyKey: "c3" })];
  const d = feed(rows);
  const q = (s: string) => selectFeed(d, { ...DEFAULT_STATE, q: s }).length;
  assert.equal(q("jane"), 1); assert.equal(q("KAPPA"), 1); assert.equal(q("kk"), 1); assert.equal(q("zzzz"), 0);
  assert.equal(selectFeed(d, { ...DEFAULT_STATE, preset: "sales" }).length, 1);
  assert.equal(selectFeed(d, { ...DEFAULT_STATE, preset: "buys" }).length, 2);
});

test("top lists count the same rows as the feed", () => {
  const rows = [
    buyer(1, "2026-11-10", "2026-11-12"), buyer(2, "2026-11-10", "2026-11-12"), buyer(3, "2026-11-10", "2026-11-13"),
    row({ personId: 50, code: "S", side: "sell", value: 400_000, companyKey: "c2", ticker: "SEL", txnDate: "2026-11-10", disclosedAt: "2026-11-13" }),
    cong({ personId: 60, name: "Rep A", ticker: "NVDA", companyKey: "c3", txnDate: "2026-10-30", disclosedAt: "2026-11-13" }),
    cong({ personId: 60, name: "Rep A", ticker: "AAPL", companyKey: "c4", txnDate: "2026-10-30", disclosedAt: "2026-11-13" }),
    cong({ personId: 61, name: "Rep B", ticker: "NVDA", companyKey: "c3", txnDate: "2026-10-30", disclosedAt: "2026-11-13" }),
    row({ personId: 70, txnDate: "2026-09-01", disclosedAt: "2026-09-02", companyKey: "c7", ticker: "OLD" }),
    row({ personId: 71, jointOf: 3, companyKey: "c1" }),
  ];
  const d = feed(rows);
  const t = topLists(rows, d);
  assert.equal(t.insidersBuying[0]!.label, "ACME"); assert.match(t.insidersBuying[0]!.value, /^3 insiders/);
  assert.equal(t.largestBuys.length, 3);
  assert.equal(t.largestSales.length, 1);
  assert.equal(t.activeMembers[0]!.label, "Rep A");
  assert.equal(t.congressStocks[0]!.label, "NVDA"); assert.equal(t.congressStocks[0]!.value, "2 members");
  assert.equal(t.figures.buyRows, 3); assert.equal(t.figures.saleRows, 1); assert.equal(t.figures.members, 2);
  assert.equal(t.figures.notable, selectFeed(d, DEFAULT_STATE).length);
});
