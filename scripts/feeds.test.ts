import { test } from "node:test";
import assert from "node:assert/strict";
import { congressItems, insiderItems, filingSentence, rssXml, xmlEscape, feedDef, feedLogLine, FEEDS, type FeedLookup } from "../web/src/lib/feeds.ts";
import type { Txn } from "../web/src/lib/flagship-core.ts";

const names: Record<number, string> = { 1: "Jane Doe", 2: "ACME & SONS <TRUST>", 3: "No Page" };
const look: FeedLookup = {
  name: (t) => names[t.personId ?? 0] ?? null,
  path: (t) => (t.personId === 3 ? null : t.source === "sec_form4" ? `/insiders/p${t.personId}/` : `/congress/p${t.personId}/`),
  ticker: (t) => (t.securityId === 9 ? null : "NVDA"),
  amount: (t) => (t.value != null ? `$${t.value}` : "$1K–$15K"),
  asset: () => "bond",
  source: (t) => t.sourceUrl,
  role: (t) => (t.personId === 1 ? "Director at Example Corp" : null),
  late: (t) => (t.lagDays ?? 0) > 45,
  money: (n) => `$${n}`,
  num: (n) => n.toLocaleString("en-US"),
};
let id = 0;
const row = (o: Partial<Txn>): Txn => ({
  id: ++id, filingId: 100, personId: 1, securityId: 1, side: "buy", code: "P", isDerivative: false, txnDate: "2026-11-02", disclosedAt: "2026-11-04",
  amountLow: null, amountHigh: null, shares: 100, price: 10, lagDays: 2, is10b51: false, ownerType: "self", assetType: "stock",
  source: "sec_form4", sourceUrl: "https://www.sec.gov/x/", filedAt: "2026-11-04", isPublished: true, value: 1000, ...o,
});
const ptr = (o: Partial<Txn>): Txn => row({ source: "house_ptr", code: null, shares: null, price: null, value: 15000, amountLow: 1001, amountHigh: 15000, sourceUrl: "https://clerk.example/1.pdf", ...o });
const today = "2026-11-10";

test("congress: one item per published row, newest disclosure first, with anchor, source and flags", () => {
  const a = ptr({ disclosedAt: "2026-11-03", lagDays: 60, ownerType: "spouse" }), b = ptr({ disclosedAt: "2026-11-05T10:00:00Z", side: "sell" }), c = ptr({ disclosedAt: "2026-11-05" });
  const items = congressItems([a, b, c, row({})], look, today, 10);
  assert.deepEqual(items.map((i) => i.guid), [`stm-txn-${c.id}`, `stm-txn-${b.id}`, `stm-txn-${a.id}`]);
  assert.equal(items[0].link, `/congress/p1/#t${c.id}`);
  assert.equal(items[1].date, "2026-11-05");
  assert.match(items[2].title, /^Jane Doe bought \$15000 of NVDA on Nov 2, 2026; disclosed Nov 3, 2026, 60 days later\.$/);
  assert.match(items[2].description, /Owner: spouse\. Disclosed after the filing deadline\. Original filing \(House periodic transaction report\): https:\/\/clerk\.example\/1\.pdf$/);
  assert.ok(!/deadline/.test(items[0].description));
  assert.deepEqual(items[0].categories, ["Congress", "NVDA"]);
});

test("congress: under-review, undated, future-dated and pathless rows stay out; the limit holds", () => {
  const rows = [ptr({ isPublished: false }), ptr({ disclosedAt: null }), ptr({ disclosedAt: "2026-11-11" }), ptr({ personId: 3 }), ptr({}), ptr({}), ptr({})];
  assert.equal(congressItems(rows, look, today, 10).length, 3);
  assert.equal(congressItems(rows, look, today, 2).length, 2);
  const noTicker = congressItems([ptr({ securityId: 9 })], look, today, 5)[0];
  assert.match(noTicker.title, /bought \$15000 of bond/);
  assert.deepEqual(noTicker.categories, ["Congress"]);
});

test("insiders: only open-market purchases and sales; one item per filing and direction", () => {
  const f1 = [row({ filingId: 1, txnDate: "2026-11-02" }), row({ filingId: 1, txnDate: "2026-11-03", value: 500 }), row({ filingId: 1, side: "sell", code: "S", is10b51: true })];
  const out = [
    row({ filingId: 2, code: "A", side: "buy" }), row({ filingId: 2, code: "F", side: "sell" }), row({ filingId: 2, code: "M", side: "option", isDerivative: true }),
    row({ filingId: 2, code: "S", side: "other" }), row({ filingId: 2, isPublished: false }), row({ filingId: 2, disclosedAt: "2026-12-01" }), ptr({ filingId: 2 }),
  ];
  const items = insiderItems([...f1, ...out], look, today, 10);
  assert.deepEqual(items.map((i) => [i.guid, i.rows]), [["stm-form4-1-buy", 2], ["stm-form4-1-sell", 1]]);
  assert.equal(items[0].title, "Jane Doe bought $1500 of NVDA in 2 open-market purchases between Nov 2, 2026 and Nov 3, 2026; disclosed Nov 4, 2026.");
  assert.equal(items[0].link, `/insiders/p1/#t${f1[0].id}`);
  assert.match(items[0].description, /Director at Example Corp\. Original filing \(SEC Form 4\): https:\/\/www\.sec\.gov\/x\/$/);
  assert.match(items[1].title, /^Jane Doe sold \$1000 of NVDA on Nov 2, 2026; disclosed Nov 4, 2026, 2 days later\.$/);
  assert.match(items[1].description, /Made under a Rule 10b5-1 trading plan, as stated on the form\./);
  assert.deepEqual(items[1].categories, ["Insiders", "Sale", "NVDA"]);
  assert.deepEqual(insiderItems([...f1, ...out], look, today, 10, true).map((i) => i.guid), ["stm-form4-1-buy"]);
});

test("insiders: order is disclosure day, then filing, purchases first; a row with no price gives shares", () => {
  const rows = [row({ filingId: 5, disclosedAt: "2026-11-03" }), row({ filingId: 7, disclosedAt: "2026-11-04", side: "sell", code: "S" }), row({ filingId: 7, disclosedAt: "2026-11-04" }), row({ filingId: 6, disclosedAt: "2026-11-04" })];
  assert.deepEqual(insiderItems(rows, look, today, 10).map((i) => i.guid), ["stm-form4-7-buy", "stm-form4-7-sell", "stm-form4-6-buy", "stm-form4-5-buy"]);
  const s = filingSentence([row({ side: "sell", code: "S", shares: 1500, price: 0, value: null }), row({ side: "sell", code: "S", shares: 500 })], look);
  assert.equal(s, "Jane Doe sold 2,000 shares of NVDA in 2 open-market sales on Nov 2, 2026; disclosed Nov 4, 2026.");
  const part = insiderItems([row({ filingId: 8, side: "sell", code: "S", is10b51: true }), row({ filingId: 8, side: "sell", code: "S" })], look, today, 5)[0];
  assert.match(part.description, /1 of the 2 transactions were made under a Rule 10b5-1 trading plan/);
});

test("rss: well-formed, escaped, absolute links, no advice wording", () => {
  const items = congressItems([ptr({ personId: 2 })], look, today, 5);
  const xml = rssXml(feedDef("congress-trades"), items, "https://example.org", "2026-11-10");
  assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"`));
  assert.match(xml, /<title>ACME &amp; SONS &lt;TRUST&gt; bought/);
  assert.match(xml, /<link>https:\/\/example\.org\/congress\/p2\/#t\d+<\/link>/);
  assert.match(xml, /<guid isPermaLink="false">stm-txn-\d+<\/guid>/);
  assert.match(xml, /<pubDate>Wed, 04 Nov 2026 12:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<atom:link href="https:\/\/example\.org\/feeds\/congress-trades\.xml" rel="self"/);
  assert.equal((xml.match(/<item>/g) ?? []).length, 1);
  assert.equal(xmlEscape("a\u0000b\u000Bc & \"d\""), "abc &amp; &quot;d&quot;");
  const empty = rssXml(feedDef("insider-trades"), [], "https://example.org", "2026-11-10");
  assert.match(empty, /<lastBuildDate>Tue, 10 Nov 2026 12:00:00 GMT<\/lastBuildDate>/);
  assert.ok(!/<item>/.test(empty));
  for (const f of FEEDS) assert.ok(!/\b(should|recommend|signal|bullish|bearish)\b/i.test(f.title + f.description));
});

test("log line counts items and the rows behind them", () => {
  const items = insiderItems([row({ filingId: 1 }), row({ filingId: 1 }), row({ filingId: 2, disclosedAt: "2026-11-01" })], look, today, 10);
  assert.equal(feedLogLine("insider-trades", items), "feed insider-trades: 2 items (3 rows), newest 2026-11-04, oldest 2026-11-01, 1 items (2 rows) on the newest day");
});
