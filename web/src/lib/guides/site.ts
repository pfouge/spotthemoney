// Guides: using this site, and the limits of the data. See the rules at the top of congress.ts.
// These two guides describe the site's own controls and rules, so they are the ones most likely
// to go out of date: every label they quote is listed in `ui` and every rule's file in `covers`.
import type { Guide } from "./types";
import type { GuideCtx } from "./ctx";
import { table } from "./html";

const U = "2026-10-08";

export const siteGuides: ((c: GuideCtx) => Guide)[] = [
  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "how-to-use-the-trade-map", group: "site", updated: U,
    title: "How to use the trade map",
    seoTitle: ["How to Use the Trade Map: Tiles, Filters and Time Windows", "How to Use the Spot the Money Trade Map"],
    description: ["The trade map shows one tile per stock, sized by dollars disclosed and coloured by buying or selling. What each filter does and how to share a view.", "One tile per stock, sized by dollars and coloured by direction. What each trade map filter does."],
    answer: "The trade map shows one tile for each stock that members of Congress or company insiders traded in the period you pick. A tile's size is the dollars disclosed and its colour is the direction: green for net buying, red for net selling.",
    keyFacts: [
      "Bigger tile = more dollars disclosed. Greener = more buying; redder = more selling.",
      "The period (7D, 30D, 90D, 1Y) counts trades by the date they were disclosed.",
      "The insider view starts with open-market trades only, without pre-arranged plan trades.",
      "Click a tile to open that stock's page.",
      "Filters are kept in the page address, so a link reproduces the view.",
    ],
    sections: [
      { id: "tiles", h: "What does a tile show?", html: `
<p>Each tile is one stock. Its area is proportional to the dollars traded in that stock during the period, so the largest tile is where the most money moved. Its colour shows direction: green when buying outweighed selling, red when selling outweighed buying, and a stronger shade the more one-sided the trading was. The ticker and the dollar total are written on the tile when it is large enough.</p>
<p>Hover over a tile to see the split between buying and selling, the number of trades and the people behind them. Click it to open the stock's page with every trade listed.</p>
<p>The list beside the map ranks the same stocks, and its "Tickers" switch changes it to a ranking of people.</p>` },
      { id: "three-maps", h: "Which map am I looking at?", html: `
<p>The home page has three views: "All insiders" combines Congress and company insiders, "Congress" shows members only and "Corporate insiders" shows Form 4 filers only. The <a href="/congress/">Congress</a> and <a href="/insiders/">Insiders</a> pages open on their own map.</p>
<p>Dollar amounts for the two groups are built differently. Company insiders report exact shares and prices. Members of Congress report ranges, and the map uses the top of each range (see ${`<a href="/guides/congress-trade-amount-ranges/">amount ranges</a>`}). The line under the map states which rule applies.</p>` },
      { id: "filters", h: "What does each filter do?", html: `
${table(["Filter", "What it does"], [
  ["7D, 30D, 90D, 1Y", "The period, counted by the date a trade was disclosed. 1Y loads an older file of insider trades the first time you choose it."],
  ["Net, Buying, Selling", "Net colours tiles by direction. Buying or Selling sizes and colours tiles by that side alone."],
  ["Both chambers, House, Senate", "Limits Congress trades to one chamber."],
  ["Any party, Democrats, Republicans, Independents", "Limits Congress trades by party."],
  ["All roles, Officers, Directors, 10% owners", "Limits insider trades by the filer's relationship to the company."],
  ["Open-market, All codes", "Open-market keeps only purchases and sales (Form 4 codes P and S). All codes adds grants, exercises, tax withholdings and the rest."],
  ["No 10b5-1 plans, With plans", "Whether to include trades made under a schedule set up in advance."],
  ["Market cap", "Limits the map to companies of one size band."],
  ["Tickers", "Type one or more tickers, separated by commas, to see only those."],
  ["Reset", "Returns every filter to its starting position."],
])}
<p>On the combined map, choosing a filter that belongs to one group narrows the map to that group: picking "Democrats" shows Democrats in Congress and hides company insiders, since insiders have no party.</p>` },
      { id: "window", h: "Why does the period use the disclosure date?", html: `
<p>Because that is when the public found out. Members of Congress have up to ${c.congressDeadlineDays} days to report, so a 30-day view by trade date would always look nearly empty and would fill in weeks later. Counting by disclosure date means "30D" answers the question "what was reported in the last 30 days?", and the answer does not change afterwards.</p>` },
      { id: "cap", h: "How are the market cap bands worked out?", html: `
<p>They are estimates from SEC filings, not live market values, because this site carries no licensed price feed. A company's size is its reported shares outstanding multiplied by the typical price in recent insider trades, or its reported public float when that is the better figure. The bands are:</p>
${table(["Band", "Estimated size"], c.capBands.map((b) => [b.label, b.range]))}
<p>Funds and some foreign companies have no usable figures and drop out when a band is selected. A company near a boundary may sit in the neighbouring band.</p>` },
      { id: "defaults", h: "Why does the insider map start with some trades hidden?", html: `
<p>To show decisions and leave out mechanics. Most Form 4 rows are pay arriving, options being exercised or tax being withheld; and many sales follow a schedule fixed long before. The starting view keeps open-market purchases and sales that were not made under a plan. Both switches are one click from the full picture. See ${`<a href="/guides/form-4-transaction-codes/">transaction codes</a>`} and ${`<a href="/guides/rule-10b5-1-trading-plans/">10b5-1 plans</a>`}.</p>
<p>Three kinds of row are never on the map: options and other derivatives, a trade already counted from another filing, and anything without a ticker.</p>` },
      { id: "share", h: "How do I share or save a view?", html: `
<p>Use "Share this view" under the map. The link carries your filters, so whoever opens it sees the same map. Every chart on the site has its own Share button with a "Save image" option, and each row in a table of trades has a share icon that links straight to that trade.</p>
<p>To find a person or a stock directly, press <kbd>/</kbd> or use the search box at the top of any page.</p>` },
    ],
    faqs: [
      { q: "What do the colours on the trade map mean?", a: "Green means buying outweighed selling in that stock over the chosen period, red means selling outweighed buying, and a stronger shade means the trading was more one-sided. Tile size is the dollars disclosed.", on: ["congress", "insiders", "stocks"] },
      { q: "Does the trade map use the trade date or the filing date?", a: "The filing date. The 7D, 30D, 90D and 1Y periods count trades by when they were disclosed, because that is when the public could first see them." },
      { q: "Are the market cap bands live market values?", a: "No. They are estimates from SEC filings: reported shares outstanding times the typical price in recent insider trades, or the reported public float." },
      { q: "Can I share a filtered view of the trade map?", a: "Yes. \"Share this view\" under the map gives a link that keeps your filters, so the same view opens for anyone who follows it." },
    ],
    sources: [
      { name: "SEC Form 4 and instructions (transaction codes)", url: "https://www.sec.gov/files/form4data.pdf" },
      { name: "House periodic transaction report form (amount ranges)", url: "https://ethics.house.gov/wp-content/uploads/2026/02/Final-CY-2025-PTR-Form-1.pdf" },
    ],
    related: ["congress-trade-amount-ranges", "form-4-transaction-codes", "rule-10b5-1-trading-plans", "what-disclosure-data-cannot-tell-you"],
    seeLive: [{ label: "Trade map", href: "/" }, { label: "Methodology", href: "/methodology/" }],
    covers: ["web/src/components/Heatmap.astro", "web/src/scripts/heatmap.ts", "web/src/lib/heatmap.ts", "web/src/lib/capband.ts", "web/src/scripts/share.ts"],
    ui: [
      { text: "All insiders", on: "/" }, { text: "Corporate insiders", on: "/" },
      { text: ">7D<", on: "/" }, { text: ">30D<", on: "/" }, { text: ">90D<", on: "/" }, { text: ">1Y<", on: "/" },
      { text: ">Net<", on: "/" }, { text: ">Buying<", on: "/" }, { text: ">Selling<", on: "/" },
      { text: "Both chambers", on: "/" }, { text: "Any party", on: "/" }, { text: "All roles", on: "/" }, { text: "10% owners", on: "/" },
      { text: "Open-market", on: "/" }, { text: "All codes", on: "/" }, { text: "No 10b5-1 plans", on: "/" }, { text: "With plans", on: "/" },
      { text: "Market cap", on: "/" }, { text: ">Reset<", on: "/" }, { text: ">Tickers<", on: "/" }, { text: "Share this view", on: "/" },
      { text: "Save image", on: "/" },
    ],
    facts: [],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "what-disclosure-data-cannot-tell-you", group: "site", updated: U,
    title: "What disclosure data cannot tell you",
    seoTitle: ["What Congress and Insider Trade Data Cannot Tell You", "Limits of Congress and Insider Trade Data"],
    description: ["Public trade filings show what was traded and when it was reported. They do not show motive, knowledge, profit or the whole portfolio. The limits, in plain words.", "Trade filings show what was traded and when it was reported. They do not show motive, knowledge or profit."],
    answer: "Public filings show that a trade happened, roughly how large it was and when it was reported. They do not show why the person traded, what they knew, whether they made money, or what else they own, and nothing on this site is a recommendation to buy or sell.",
    keyFacts: [
      `Filings are late by design: up to ${c.congressDeadlineDays} days for Congress, two business days for insiders.`,
      "Congressional amounts are ranges; totals built from them are estimates.",
      "No filing states a reason or what the filer knew.",
      "Coverage is not complete: scanned filings wait to be read, and insiders are a tracked set.",
      "Past trades do not predict future prices.",
    ],
    sections: [
      { id: "motive", h: "Can a filing tell me why someone traded?", html: `
<p>No. A filing records a transaction. It has no field for a reason, and the people who file are not asked for one. A member of Congress may not even have placed the trade; a spouse or an adviser may have.</p>
<p>It is tempting to line a trade up with later news and infer knowledge. Sometimes that inference will be right. A filing cannot confirm it, and with hundreds of people making thousands of trades, some will precede good or bad news by chance. This site shows the record and leaves the inference out.</p>` },
      { id: "timing", h: "How old is the information by the time I see it?", html: `
<p>Older than it looks. A member of Congress may report up to ${c.congressDeadlineDays} days after trading, and some report later still. A company insider reports within two business days. So a congressional purchase you read about today may be six weeks old, and the price has moved since.</p>
<p>Anyone hoping to copy a trade is acting on stale information by construction. Whether that has worked in the past is argued over at length; this site does not test it and makes no claim either way.</p>` },
      { id: "size", h: "How exact are the dollar figures?", html: `
<p>For company insiders, exact: shares times price, as filed. For Congress, not exact at all: each trade is a range whose top can be fifteen times its bottom, and the map and charts here use the top (see ${`<a href="/guides/congress-trade-amount-ranges/">amount ranges</a>`}). A member's "total traded" is an upper estimate.</p>
<p>The site also applies a small number of written rules when adding trades up: options are kept out of buy and sell totals, a trade reported on several filings is counted once, and a few filings with an obvious error in the price box are corrected for display. Each is described in the <a href="/methodology/#values">methodology</a>, and the underlying filings are never altered.</p>` },
      { id: "coverage", h: "Is every trade here?", html: `
<p>No, and the gaps are specific:</p>
<ul>
<li><strong>Scanned and paper filings</strong> from Congress cannot be read automatically and wait for a person to transcribe them${c.heldPaper ? ` (${c.heldPaper} at present)` : ""}.</li>
<li><strong>Senate reports</strong> are added in batches, not daily.</li>
<li><strong>Company insiders</strong> are covered for a tracked set of ${c.counts.tickers} stocks, not the whole market.</li>
<li><strong>Assets without a ticker</strong>, such as bonds and private funds, appear in tables but not on the map.</li>
<li><strong>Exempt holdings</strong>, including broad mutual funds and index funds, are never reported by members at all.</li>
</ul>
<p>The <a href="/methodology/#coverage">coverage section</a> of the methodology gives current counts for each source.</p>` },
      { id: "profit", h: "Can I tell whether someone made money?", html: `
<p>Not from these filings. Congressional reports give no price and no share count. Insider reports give a price for each trade but not the cost of shares received as pay, and a sale is rarely matched to a particular purchase. This site carries no licensed price history, so it does not calculate returns for anyone.</p>` },
      { id: "advice", h: "Is any of this investment advice?", html: `
<p>No. Spot the Money republishes public records and adds them up by stated rules. It does not recommend, rank or score trades, does not suggest copying anyone, and does not execute trades. The <a href="/terms/#advice">terms of use</a> say the same in full. If you are making a financial decision, check the original filing, which every row links to, and consider speaking to a licensed adviser.</p>` },
      { id: "errors", h: "What if something here is wrong?", html: `
<p>Tell us. A figure that does not match its source filing is an error and will be fixed and logged; the <a href="/corrections/">corrections page</a> explains how to report it. If the filing itself is wrong, only the person who filed it can amend it, and the amended version replaces the original here on the next update.</p>` },
    ],
    faqs: [
      { q: "Does a congressional stock trade prove insider trading?", a: "No. A filing shows that a trade happened and when it was reported. It does not show what the member knew or why they traded.", on: ["congress"] },
      { q: "Is Spot the Money investment advice?", a: "No. The site republishes public records and totals them by stated rules. It makes no recommendations and does not execute trades.", on: ["stocks"] },
      { q: "Can I see how much profit a member of Congress made on a trade?", a: "No. Congressional reports give a dollar range and a date, with no price or share count, so profit cannot be calculated from them." },
      { q: "Is every congressional and insider trade on the site?", a: "No. Scanned filings wait to be read by hand, Senate reports arrive in batches, insider filings are covered for a tracked set of stocks, and assets without a ticker are not on the map." },
    ],
    sources: [
      { name: "5 U.S.C. § 13105, filing of congressional reports", url: "https://www.law.cornell.edu/uscode/text/5/13105" },
      { name: "SEC Form 4 and instructions", url: "https://www.sec.gov/files/form4data.pdf" },
      { name: "Investor.gov: insider trading", url: "https://www.investor.gov/introduction-investing/investing-basics/glossary/insider-trading" },
    ],
    related: ["congress-stock-trading-rules", "congress-trade-amount-ranges", "insider-buying-vs-insider-selling", "how-to-use-the-trade-map"],
    seeLive: [{ label: "Methodology", href: "/methodology/" }, { label: "Coverage", href: "/methodology/#coverage" }, { label: "Corrections", href: "/corrections/" }],
    covers: ["web/src/lib/joint.ts", "shared/src/tradevalue.ts", "web/src/lib/coverage.ts", "web/src/pages/terms.astro"],
    ui: [],
    facts: ["stockAct"],
  }),
];
