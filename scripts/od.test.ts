import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOd, figures, answerText, type OdDoc } from "../web/src/lib/server/od.ts";

// row layout: id, filing_id, person_id, security_id, side, txn_code, is_derivative, txn_date, disclosed_at,
// amount_low, amount_high, shares, price, lag, is_10b5_1, owner_type, asset_type, owned_after
type Row = [number, number, number, number, string, string, boolean, string | null, string, null, null, number | null, number | null, number | null, boolean, string, string, number | null];
const row = (id: number, o: Partial<{ filing: number; person: number; side: string; code: string; deriv: boolean; txn: string | null; disc: string; shares: number; price: number; owned: number | null }> = {}): Row => [
  id, o.filing ?? id, o.person ?? 1, 10, o.side ?? "buy", o.code ?? "P", o.deriv ?? false, o.txn === undefined ? "2026-03-02" : o.txn, o.disc ?? "2026-03-04", null, null,
  o.shares ?? 1000, o.price ?? 10, 2, false, "direct", "stock", o.owned === undefined ? 5000 : o.owned];
const filingsFor = (rows: Row[], filed = "2026-03-04T12:00:00Z") => Object.fromEntries(rows.map((r) => [String(r[1]), [`https://www.sec.gov/Archives/edgar/data/1/${r[1]}-index.htm`, filed, true, `0000000000-26-${r[1]}`]]));
const doc = (kind: OdDoc["kind"], rows: Row[], o: Partial<OdDoc> = {}): OdDoc => ({
  kind, columns: [], rows, peers: [], filings: filingsFor(rows), people: { "1": ["Doe Jane", "doe-jane", "CEO", false], "2": ["Roe Rich", "roe-rich", null, true] },
  securities: { "10": ["ACMR", "equity", "Acme", 5, true] }, refPrices: { "10": 10 }, footnotes: {},
  stats: { rowCount: rows.length, filingCount: rows.length, firstFiledAt: "2026-03-04T12:00:00Z", lastFiledAt: "2026-03-04T12:00:00Z", newestUrl: null },
  truncated: false, entity: kind === "insider" ? { id: 1, name: "Doe Jane", slug: "doe-jane", cik: "1" } : kind === "company" ? { id: 5, name: "Acme", slug: "acme", cik: "9" } : { ticker: "ACMR" },
  roles: [{ companyId: 5, title: "CEO", isDirector: false, company: { id: 5, name: "Acme", slug: "acme", ticker: "ACMR", cik: "9" } }],
  siblings: [{ id: 10, ticker: "ACMR", type: "equity", name: "Acme" }], company: { id: 5, name: "Acme", slug: "acme", cik: "9", ticker: "ACMR" }, insiderCount: 2, ...o } as OdDoc);

test("a derivative buy or sell becomes side option and stays out of every total", () => {
  const p = buildOd(doc("stock", [row(1), row(2, { deriv: true, code: "M", side: "buy", shares: 500 }), row(3, { side: "sell", code: "S", deriv: true })]));
  assert.deepEqual(p.txns.map((t) => t.side).sort(), ["buy", "option", "option"]);
  const f = figures(p);
  assert.equal(f.buys, 1); assert.equal(f.sells, 0); assert.equal(f.bought, 10000);
});

test("a trade dated after its filing loses its date and keeps its row", () => {
  const p = buildOd(doc("insider", [row(1, { txn: "2026-12-26" })]));
  assert.equal(p.txns.length, 1); assert.equal(p.txns[0].txnDate, null); assert.equal(p.txns[0].lagDays, null);
});

test("a row total typed into the price box is read as the total (price-box rule)", () => {
  // 627,486 options with 'price' $12,502,658.55: the stock trades near $10
  const p = buildOd(doc("stock", [row(1, { deriv: true, code: "S", side: "sell", shares: 627486, price: 12502658.55 })]));
  assert.ok(Math.abs((p.txns[0].value ?? 0) - 12502658.55) < 1);
  assert.ok(Math.abs((p.txns[0].price ?? 0) - 19.925) < 0.01);
});

test("a joint filing counts once on a company's rows, and the other copy leaves the totals", () => {
  const a = row(1, { filing: 1, person: 1, shares: 100000, price: 20, side: "sell", code: "S", owned: 900000 });
  const b = row(2, { filing: 2, person: 2, shares: 100000, price: 20, side: "sell", code: "S", owned: 900000 });
  const p = buildOd(doc("company", [a, b]));
  const f = figures(p);
  assert.equal(f.sells, 1); assert.equal(f.sold, 2000000);
  assert.equal(p.txns.filter((t) => t.jointOf != null).length, 1);
  assert.equal(p.txns.find((t) => t.jointOf != null)!.side, "other");
});

test("holdings after the trade and the change are read from the filing's own holding", () => {
  const p = buildOd(doc("insider", [row(1, { shares: 1000, owned: 5000 }), row(2, { side: "sell", code: "S", shares: 1000, owned: 4000 })]));
  const buy = p.txns.find((t) => t.id === 1)!, sell = p.txns.find((t) => t.id === 2)!;
  assert.equal(buy.ownedAfter, 5000); assert.ok(Math.abs((buy.holdingsChange as number) - 25) < 1e-9);
  assert.equal(sell.ownedAfter, 4000); assert.ok((sell.holdingsChange as number) < 0);
});

test("noindex unless there is an open-market, non-derivative row", () => {
  assert.equal(buildOd(doc("insider", [row(1)])).noindex, false);
  assert.equal(buildOd(doc("insider", [row(1, { code: "A", side: "buy" })])).noindex, true);
  assert.equal(buildOd(doc("insider", [row(1, { code: "S", side: "sell", deriv: true })])).noindex, true);
  assert.equal(buildOd(doc("insider", [])).noindex, true);
});

test("a capped document keeps the true row count and says so", () => {
  const rows = [row(1), row(2)];
  const p = buildOd(doc("stock", rows, { truncated: true, stats: { rowCount: 9876, filingCount: 5000, firstFiledAt: "2025-10-02T00:00:00Z", lastFiledAt: "2026-03-04T12:00:00Z", newestUrl: null } }));
  assert.equal(p.truncated, true); assert.equal(p.stats.rowCount, 9876); assert.equal(p.txns.length, 2);
  const text = answerText(p, "ACMR (Acme)", "", figures(p));
  assert.match(text, /9,876/); assert.match(text, /newest 2 rows/);
});

test("the answer states counts and dollars and never a reason", () => {
  const p = buildOd(doc("insider", [row(1), row(2, { side: "sell", code: "S" })]));
  const t = answerText(p, "Doe Jane", "CEO", figures(p));
  assert.match(t, /1 open-market purchase/); assert.match(t, /1 open-market sale/);
  assert.doesNotMatch(t, /because|signal|bullish|bearish|should/i);
});

test("an entity with no visible rows gets the empty answer, not a crash", () => {
  const p = buildOd(doc("company", [], { stats: null }));
  assert.equal(p.txns.length, 0);
  assert.match(answerText(p, "Acme", "", figures(p)), /no Form 4 transactions on record/);
});
