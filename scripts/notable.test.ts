import test from "node:test";
import assert from "node:assert/strict";
import {
  CLUSTER_DAYS, CLUSTER_MIN_INSIDERS, CONGRESS_MIN_LOW, LARGE_SALE_MIN, STAKE_MIN_PCT, STAKE_MIN_VALUE,
  buildFeed, eligible, findClusters, findClusterSells, reasonsOf, selectFeed, resolveView, sinceOf, topLists, countLine, emptyLine, presetFromHash, PRESET_HASH, PRESETS,
  CLUSTER_SELL_MIN_INSIDERS, CLUSTER_SELL_MIN_VALUE, CLUSTER_SELL_MIN_PCT, DEFAULT_STATE, type NRow,
} from "../web/src/lib/notable";

const ALL = { ...DEFAULT_STATE, preset: "all" as const };
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
  assert.deepEqual([CLUSTER_SELL_MIN_INSIDERS, CLUSTER_SELL_MIN_VALUE, CLUSTER_SELL_MIN_PCT], [3, 250_000, 10]);
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
  const all = selectFeed(d, ALL);
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
  const out = selectFeed(d, { ...ALL, win: 30 });
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
  const q = (s: string) => selectFeed(d, { ...ALL, q: s }).length;
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
  assert.equal(t.figures.notable, selectFeed(d, ALL).length);
});

// ── cluster sells ─────────────────────────────────────────────────────────────────────────
/** A seller who passes on their own: $300,000 and a 25% cut. */
const seller = (i: number, txn = "2026-11-05", filed = "2026-11-10", o: Partial<NRow> = {}, co = "c1") =>
  row({ personId: 2000 + i, name: `Seller ${i}`, code: "S", side: "sell", value: 300_000, shares: 6000, price: 50, change: -25, txnDate: txn, disclosedAt: filed, companyKey: co, ...o });

test("cluster sell: three qualifying sellers make one item", () => {
  const rows = [seller(1), seller(2, "2026-11-01", "2026-11-03"), seller(3, "2026-11-08", "2026-11-12")];
  const c = findClusterSells(rows);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.b, 0); assert.equal(c[0]!.n, 3); assert.equal(c[0]!.v, 900_000);
  assert.equal(c[0]!.f, "2026-11-01"); assert.equal(c[0]!.l, "2026-11-08"); assert.equal(c[0]!.d, "2026-11-12");
  assert.equal(findClusters(rows).length, 0, "sales never make a cluster buy");
});

test("cluster sell: a plan sale does not count", () => {
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { is10b51: true })]).length, 0);
});

test("cluster sell: a holding cut under 10% does not qualify the seller", () => {
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { change: -9.9 })]).length, 0);
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { change: -10 })]).length, 1, "exactly 10% counts");
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { change: null })]).length, 0, "no holding figure, no cut");
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { change: 40 })]).length, 0, "a rise is not a cut");
});

test("cluster sell: total under $250,000 does not qualify; several rows add up, the largest cut counts", () => {
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { value: 249_999 })]).length, 0);
  const split = [seller(3, "2026-11-04", "2026-11-09", { value: 150_000, change: -4 }), seller(3, "2026-11-06", "2026-11-10", { value: 150_000, change: -12 })];
  const c = findClusterSells([seller(1), seller(2), ...split]);
  assert.equal(c.length, 1, "two rows by one person: $300,000 total, largest single-row cut 12%");
  assert.equal(c[0]!.n, 3);
  const small = [seller(3, "2026-11-04", "2026-11-09", { value: 150_000, change: -6 }), seller(3, "2026-11-06", "2026-11-10", { value: 150_000, change: -6 })];
  assert.equal(findClusterSells([seller(1), seller(2), ...small]).length, 0, "cuts are not added across rows");
});

test("cluster sell: two qualifying sellers are not enough, and a third who fails does not help", () => {
  assert.equal(findClusterSells([seller(1), seller(2)]).length, 0);
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { value: 10_000 })]).length, 0);
  assert.equal(findClusterSells([seller(1), seller(1, "2026-11-06", "2026-11-11"), seller(2)]).length, 0, "one person twice is one");
});

test("cluster sell: derivative, joint, future-dated and cross-company rows are out; 31 days apart is not a cluster", () => {
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { isDerivative: true })]).length, 0);
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", { jointOf: 4 })]).length, 0);
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-12", "2026-11-10")]).length, 0);
  assert.equal(findClusterSells([seller(1), seller(2), seller(3, "2026-11-05", "2026-11-10", {}, "c2")]).length, 0);
  assert.equal(findClusterSells([seller(1, "2026-10-01", "2026-10-02"), seller(2, "2026-10-15", "2026-10-16"), seller(3, "2026-11-01", "2026-11-02")]).length, 0);
});

test("a company with both a cluster buy and a cluster sell shows both; All folds the members of each", () => {
  const rows = [
    buyer(1, "2026-11-08", "2026-11-12"), buyer(2, "2026-11-08", "2026-11-12"), buyer(3, "2026-11-08", "2026-11-12"),
    seller(1, "2026-11-05", "2026-11-13"), seller(2, "2026-11-06", "2026-11-13"), seller(3, "2026-11-07", "2026-11-13"),
  ];
  const d = feed(rows);
  assert.equal(d.clusters.length, 2);
  const cl = selectFeed(d, DEFAULT_STATE);
  assert.deepEqual(cl.map((e) => (e.k === "c" ? e.b : -1)), [0, 1], "Clusters preset: newest disclosure first (sell filed 11-13), buys before sells only on a tie");
  assert.equal(selectFeed(d, { ...DEFAULT_STATE, preset: "cbuy" }).length, 1);
  assert.equal(selectFeed(d, { ...DEFAULT_STATE, preset: "csell" }).length, 1);
  assert.equal(selectFeed(d, { ...DEFAULT_STATE, preset: "csell" })[0]!.k, "c");
  // sale rows are $300,000 with a 25% cut: stake-change, not large-sale; folded into the cluster under All
  const all = selectFeed(d, ALL);
  assert.equal(all.filter((e) => e.k === "c").length, 2);
  assert.equal(all.filter((e) => e.k === "r").length, 0, "every member row is folded into its cluster");
  assert.equal(selectFeed(d, { ...ALL, preset: "stake" }).length, 3, "the stake-change preset still lists the sale rows");
});

test("ordering in Clusters: newest disclosure first; ties buys before sells, then larger value", () => {
  const rows = [
    buyer(1, "2026-11-08", "2026-11-13"), buyer(2, "2026-11-08", "2026-11-13"), buyer(3, "2026-11-08", "2026-11-13"),
    seller(1, "2026-11-05", "2026-11-13", {}, "c2"), seller(2, "2026-11-06", "2026-11-13", {}, "c2"), seller(3, "2026-11-07", "2026-11-13", {}, "c2"),
    seller(4, "2026-11-05", "2026-11-14", {}, "c3"), seller(5, "2026-11-06", "2026-11-13", {}, "c3"), seller(6, "2026-11-07", "2026-11-13", {}, "c3"),
    seller(7, "2026-11-05", "2026-11-13", { value: 900_000 }, "c4"), seller(8, "2026-11-06", "2026-11-13", { value: 900_000 }, "c4"), seller(9, "2026-11-07", "2026-11-13", { value: 900_000 }, "c4"),
  ];
  const d = feed(rows);
  const c = selectFeed(d, DEFAULT_STATE) as ReturnType<typeof findClusters>;
  assert.deepEqual(c.map((x) => x.d), ["2026-11-14", "2026-11-13", "2026-11-13", "2026-11-13"]);
  assert.deepEqual(c.slice(1).map((x) => [x.b, x.v]), [[1, 150_000], [0, 2_700_000], [0, 900_000]], "buy first on the tie, then larger sell");
});

test("default state is Clusters, 7 days, newest; presets and hash values", () => {
  assert.deepEqual(DEFAULT_STATE, { win: 7, preset: "cluster", q: "", sort: "new" });
  assert.deepEqual(PRESETS.map((p) => p.label), ["Clusters", "Cluster buys", "Cluster sells", "Insider buys", "Stake changes", "Large sales", "Congress", "All"]);
  assert.deepEqual(Object.values(PRESET_HASH), ["clusters", "cbuy", "csell", "buys", "stake", "sales", "congress", "all"]);
  for (const p of PRESETS) assert.equal(presetFromHash(PRESET_HASH[p.id]), p.id);
  assert.equal(presetFromHash("cluster"), "cluster", "alias");
  assert.equal(presetFromHash(null), null); assert.equal(presetFromHash("nope"), null);
});

test("Clusters falls back from 7 to 30 days, then offers All", () => {
  const rows = [buyer(1, "2026-10-20", "2026-10-22"), buyer(2, "2026-10-21", "2026-10-23"), buyer(3, "2026-10-22", "2026-10-24"),
    row({ personId: 9, txnDate: "2026-11-14", disclosedAt: "2026-11-15", code: "S", side: "sell", value: 2_000_000, companyKey: "c9", ticker: "ZZZ" })];
  const d = feed(rows);
  assert.equal(selectFeed(d, DEFAULT_STATE).length, 0, "no cluster filed in the last 7 days");
  const v = resolveView(d, DEFAULT_STATE);
  assert.equal(v.fellBack, true); assert.equal(v.win, 30); assert.equal(v.entries.length, 1); assert.equal(v.offerAll, false);
  const line = countLine(v.entries.length, v.entries.length, { ...DEFAULT_STATE, win: v.win }, d.newest, v.fellBack);
  assert.match(line, /^No clusters filed in the last 7 days\. Showing 30 days\./);
  assert.match(line, /1 cluster filed from/);
  // the fallback follows the preset, not the search: a search that matches nothing still searches 30 days, and does not offer All
  const q = resolveView(d, { ...DEFAULT_STATE, q: "zzzz" });
  assert.equal(q.fellBack, true); assert.equal(q.entries.length, 0); assert.equal(q.offerAll, false);
  // other windows and presets never fall back
  assert.equal(resolveView(d, { ...DEFAULT_STATE, win: 1 }).fellBack, false);
  assert.equal(resolveView(d, { ...DEFAULT_STATE, preset: "cbuy" }).fellBack, false);
  // nothing in 30 days either
  const none = feed([row({ txnDate: "2026-11-14", disclosedAt: "2026-11-15", code: "S", side: "sell", value: 2_000_000, companyKey: "c9", ticker: "ZZZ" })]);
  const v2 = resolveView(none, DEFAULT_STATE);
  assert.equal(v2.entries.length, 0); assert.equal(v2.fellBack, false); assert.equal(v2.offerAll, true);
  assert.equal(emptyLine(DEFAULT_STATE, true), "No clusters were filed in the last 30 days.");
  assert.equal(resolveView(none, ALL).offerAll, false);
  assert.ok(selectFeed(none, ALL).length > 0, "All has the large sale");
});

test("wording has no em-dashes and never says signal, bullish or bearish", () => {
  const texts = [countLine(0, 0, DEFAULT_STATE, "2026-11-15", true), emptyLine(DEFAULT_STATE, true), emptyLine(ALL), ...PRESETS.map((p) => p.label)];
  for (const t of texts) { assert.ok(!/—/.test(t), t); assert.ok(!/signal|bullish|bearish/i.test(t), t); }
});
