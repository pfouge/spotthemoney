import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildItems, composeDigest, congressSentence, form4OtherSentence, form4Sentence, isDue, rangeWords, unsubscribeUrl,
  MAX_ITEMS, type DigestRow,
} from "./digest.js";

const SITE = "https://spotthemoney.com";
const TOKEN = "a".repeat(64);

const row = (o: Partial<DigestRow>): DigestRow => ({
  txnId: 1, filingId: 10, source: "house_ptr", sourceUrl: "https://example.gov/doc.pdf", personName: "Jane Doe",
  personSlug: "jane-doe", personKind: "congress", ticker: "NVDA", securityName: "NVIDIA Corp", side: "buy", txnCode: null,
  isDerivative: false, txnDate: "2026-11-03", disclosedAt: "2026-11-12", lagDays: 9, amountLow: 1001, amountHigh: 15000,
  shares: null, price: null, ownerType: null, assetType: "stock", matchKind: "member", matchKey: "jane-doe", matchLabel: "Jane Doe", ...o,
});
const f4 = (o: Partial<DigestRow>): DigestRow => row({
  source: "sec_form4", personName: "HUANG JEN HSUN", personSlug: "huang-jen-hsun", personKind: "insider", side: "sell",
  txnCode: "S", amountLow: null, amountHigh: null, shares: 1000, price: 140.5, lagDays: 2, disclosedAt: "2026-11-05",
  matchKind: "stock", matchKey: "nvda", matchLabel: "NVDA", filingId: 20, ...o,
});

test("isDue: daily needs 12 hours since the last digest and a period that is not empty", () => {
  const now = new Date("2026-11-18T19:00:00Z"), end = new Date("2026-11-18T17:00:00Z");
  assert.equal(isDue("daily", new Date("2026-11-17T19:30:00Z"), end, now), true);
  assert.equal(isDue("daily", new Date("2026-11-18T08:00:00Z"), end, now), false, "second run the same day");
  assert.equal(isDue("daily", new Date("2026-11-18T07:00:00Z"), end, now), true, "exactly 12 hours");
  assert.equal(isDue("daily", new Date("2026-11-18T18:00:00Z"), end, now), false, "opted in inside the settling time");
});

test("isDue: weekly on Monday once, any day after 8 days, not otherwise", () => {
  const mon = new Date("2026-11-16T19:00:00Z"), monEnd = new Date("2026-11-16T17:00:00Z"); // a Monday
  assert.equal(mon.getUTCDay(), 1);
  assert.equal(isDue("weekly", new Date("2026-11-09T17:00:00Z"), monEnd, mon), true);
  assert.equal(isDue("weekly", new Date("2026-11-15T23:59:00Z"), monEnd, mon), true, "opted in on Sunday");
  assert.equal(isDue("weekly", new Date("2026-11-16T10:00:00Z"), monEnd, mon), false, "opted in or already built on that Monday");
  const wed = new Date("2026-11-18T19:00:00Z"), wedEnd = new Date("2026-11-18T17:00:00Z");
  assert.equal(isDue("weekly", new Date("2026-11-16T17:00:00Z"), wedEnd, wed), false);
  assert.equal(isDue("weekly", new Date("2026-11-10T18:00:00Z"), wedEnd, wed), true, "the Monday run never happened");
});

test("rangeWords: a range, one exact figure, an open top, nothing", () => {
  assert.equal(rangeWords(1001, 15000), "$1,001 to $15,000");
  assert.equal(rangeWords(319, 319), "$319");
  assert.equal(rangeWords(1000000, null), "over $1,000,000");
  assert.equal(rangeWords(null, null), null);
  assert.equal(rangeWords(318, 74), null, "a high end below the low end is not printed");
});

test("congressSentence states the row and nothing else", () => {
  assert.equal(congressSentence(row({})),
    "Jane Doe bought $1,001 to $15,000 of NVDA on Nov 3, 2026; disclosed Nov 12, 2026, 9 days after the trade.");
  assert.equal(congressSentence(row({ side: "sell", ticker: null, securityName: "US Treasury Note", ownerType: "spouse", lagDays: 1 })),
    "Jane Doe sold $1,001 to $15,000 of US Treasury Note on Nov 3, 2026; disclosed Nov 12, 2026, 1 day after the trade. The report gives the owner as the member's spouse.");
  assert.equal(congressSentence(row({ side: "exchange", amountLow: null, amountHigh: null, txnDate: null, lagDays: null })),
    "Jane Doe exchanged NVDA; disclosed Nov 12, 2026.");
  assert.equal(congressSentence(row({ ticker: null, securityName: null, assetType: "bond", amountLow: 1000000, amountHigh: null })),
    "Jane Doe bought over $1,000,000 of a bond on Nov 3, 2026; disclosed Nov 12, 2026, 9 days after the trade.");
  assert.equal(congressSentence(row({ personName: null, side: "other", ticker: null, securityName: null, assetType: null, disclosedAt: null })),
    "A filer reported a transaction in an asset of $1,001 to $15,000 on Nov 3, 2026.");
});

test("form4Sentence: one row, many lots, no computed dollar total", () => {
  assert.equal(form4Sentence([f4({})], "sell"),
    "HUANG JEN HSUN sold 1,000 shares of NVDA at $140.50 a share on Nov 3, 2026; disclosed Nov 5, 2026. Figures are as filed on Form 4.");
  const lots = [f4({ txnId: 1, shares: 1000, price: 140.5 }), f4({ txnId: 2, shares: 2500, price: 141.25, txnDate: "2026-11-04" }),
    f4({ txnId: 3, shares: 500, price: null })];
  const s = form4Sentence(lots, "sell");
  assert.equal(s, "HUANG JEN HSUN reported 3 open-market sales of NVDA, 4,000 shares in all at $140.50 to $141.25 a share between Nov 3, 2026 and Nov 4, 2026; disclosed Nov 5, 2026. Figures are as filed on Form 4.");
  // 4,000 shares at about $141 would be about $563,000: no such figure may appear
  assert.ok(!/\$5\d\d,\d{3}/.test(s));
  assert.equal(form4Sentence([f4({ side: "buy", txnCode: "P", shares: 1, price: 0.5 })], "buy"),
    "HUANG JEN HSUN bought 1 share of NVDA at $0.50 a share on Nov 3, 2026; disclosed Nov 5, 2026. Figures are as filed on Form 4.");
});

test("form4OtherSentence is a count", () => {
  assert.equal(form4OtherSentence([f4({ txnCode: "A" }), f4({ txnId: 2, txnCode: "F" })]),
    "HUANG JEN HSUN reported 2 other transactions in NVDA on Form 4 (an award, option exercise, gift, tax withholding or derivative row); disclosed Nov 5, 2026.");
});

test("buildItems: a Form 4 is summed by filing and direction; congressional rows stay rows; repeats dropped", () => {
  const rows = [
    f4({ txnId: 5, filingId: 20 }), f4({ txnId: 6, filingId: 20 }), f4({ txnId: 6, filingId: 20 }),
    f4({ txnId: 7, filingId: 20, side: "buy", txnCode: "P" }),
    f4({ txnId: 8, filingId: 20, txnCode: "F" }),                       // tax withholding: side sell, not open market
    f4({ txnId: 9, filingId: 20, isDerivative: true }),                 // derivative row with code S
    f4({ txnId: 10, filingId: 21, disclosedAt: "2026-11-06" }),
    row({ txnId: 11, filingId: 30 }), row({ txnId: 12, filingId: 30, side: "sell" }),
  ];
  const items = buildItems(rows, SITE);
  assert.deepEqual(items.map((i) => [i.key, i.rows]),
    [["t11", 1], ["t12", 1], ["f21-sell", 1], ["f20-buy", 1], ["f20-sell", 2], ["f20-other", 2]]);
  assert.equal(items[0]!.siteUrl, "https://spotthemoney.com/congress/jane-doe/#t11");
  assert.equal(items[3]!.siteUrl, "https://spotthemoney.com/insiders/huang-jen-hsun/#t7");
  assert.equal(items[0]!.group, "Jane Doe");
  // the same rows in another order give the same items
  assert.deepEqual(buildItems([...rows].reverse(), SITE), items);
  // no person page: the stock page; nothing at all: the watchlist
  assert.equal(buildItems([row({ personSlug: null, ticker: "BRK.B" })], SITE)[0]!.siteUrl, "https://spotthemoney.com/stocks/brk.b/");
  assert.equal(buildItems([row({ personSlug: null, ticker: null })], SITE)[0]!.siteUrl, "https://spotthemoney.com/watchlist/");
});

test("composeDigest: subject, groups, links, the ways out, and nothing that reads as advice", () => {
  const items = buildItems([row({ txnId: 11 }), f4({ txnId: 5 }), f4({ txnId: 6, matchLabel: "NVDA" })], SITE);
  const d = composeDigest({ kind: "daily", items, periodEnd: new Date("2026-11-18T17:00:00Z"), site: SITE, unsubToken: TOKEN });
  assert.equal(d.subject, "2 new disclosures from the pages you follow, Nov 18, 2026");
  assert.equal(d.itemCount, 2);
  assert.ok(d.text.includes("Jane Doe\n--------\nJane Doe bought"));
  assert.ok(d.text.includes("  On the site: https://spotthemoney.com/congress/jane-doe/#t11"));
  assert.ok(d.text.includes("  Original filing: https://example.gov/doc.pdf"));
  assert.ok(d.text.includes(`Unsubscribe with one click: ${unsubscribeUrl(SITE, TOKEN)}`));
  assert.ok(d.text.includes("You are getting this email because you turned on the daily digest"));
  assert.ok(d.text.includes("Change it or turn it off: https://spotthemoney.com/watchlist/"));
  assert.ok(d.html.includes(`href="${unsubscribeUrl(SITE, TOKEN)}"`));
  for (const body of [d.text, d.html, d.subject]) {
    assert.ok(!/\b(should|recommend|bullish|bearish|signal|opportunity|insider knowledge|suspicious|because (he|she|they))\b/i.test(body));
    assert.ok(!body.includes("—"), "no em-dash");
  }
  const w = composeDigest({ kind: "weekly", items: items.slice(0, 1), periodEnd: new Date("2026-11-16T17:00:00Z"), site: SITE,
    unsubToken: TOKEN, postalAddress: "1 Main St, Sheridan, WY" });
  assert.equal(w.subject, "1 new disclosure from the pages you follow, week to Nov 16, 2026");
  assert.ok(w.text.trimEnd().endsWith("1 Main St, Sheridan, WY"));
  assert.ok(w.text.includes("the weekly digest"));
  assert.throws(() => composeDigest({ kind: "daily", items: [], periodEnd: new Date(), site: SITE, unsubToken: TOKEN }));
});

test("composeDigest: text from a filing cannot break the HTML, and a long digest is cut with a count", () => {
  const evil = row({ personName: `<script>alert("x")</script> & Co`, matchLabel: `A<b>B`, sourceUrl: "javascript:alert(1)" });
  const d = composeDigest({ kind: "daily", items: buildItems([evil], SITE), periodEnd: new Date("2026-11-18T17:00:00Z"), site: SITE, unsubToken: TOKEN });
  assert.ok(!d.html.includes("<script>"));
  assert.ok(d.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co"));
  assert.ok(d.html.includes("A&lt;b&gt;B"));
  assert.ok(!d.html.includes('href="javascript:'), "only http links become links");

  const many = Array.from({ length: MAX_ITEMS + 7 }, (_, i) => row({ txnId: 100 + i }));
  const big = composeDigest({ kind: "daily", items: buildItems(many, SITE), periodEnd: new Date("2026-11-18T17:00:00Z"), site: SITE, unsubToken: TOKEN });
  assert.equal(big.itemCount, MAX_ITEMS + 7);
  assert.equal(big.printed, MAX_ITEMS);
  assert.equal((big.text.match(/On the site:/g) ?? []).length, MAX_ITEMS);
  assert.ok(big.text.includes("7 more items are not listed here. Your watchlist shows them all: https://spotthemoney.com/watchlist/"));
  assert.ok(big.subject.startsWith(`${MAX_ITEMS + 7} new disclosures`));
});
