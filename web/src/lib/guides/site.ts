// Guides: using this site, and the limits of the data. See the rules at the top of congress.ts.
// These two guides describe the site's own controls and rules, so they are the ones most likely
// to go out of date: every label they quote is listed in `ui` and every rule's file in `covers`.
import type { Guide } from "./types";
import type { GuideCtx } from "./ctx";
import { table, ext } from "./html";
import { citation, CITE_STYLES } from "../cite";
import { CONTACT_EMAIL } from "../seo";

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
<p>Use "Share this view" under the map. The link carries your filters, so whoever opens it sees the same map. Every chart on the site has its own Share button with a "Save image" option, and each row in a table of trades has a share icon that links straight to that trade. The same menu writes a citation for you in four styles; see ${`<a href="/guides/how-to-cite-and-reuse/">how to cite and reuse</a>`}.</p>
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
  // ───────────────────────────────────────────────────────────────────────────────────────
  () => {
    // The examples are produced by the same code as the Cite menu (lib/cite.ts), so they cannot
    // show a format the menu does not produce.
    const sample = { title: "Late congressional trade disclosures", url: "https://spotthemoney.com/guides/late-congressional-trade-disclosures/", updated: U, accessed: U };
    const examples = CITE_STYLES.map((st) => [st.label, citation(st.key, sample).html]);
    return {
      slug: "how-to-cite-and-reuse", group: "site", updated: U,
      title: "How to cite and reuse Spot the Money",
      seoTitle: ["How to Cite and Reuse Spot the Money Data", "How to Cite Spot the Money"],
      description: ["How to credit Spot the Money in an article, paper or post, how to cite the original government filing, and the legal limits on reusing congressional and FEC records.", "How to credit Spot the Money, cite the original filing, and stay within the legal limits on reusing the records."],
      answer: "You may quote figures, tables and charts from Spot the Money with a credit to spotthemoney.com and a link to the page you used; every page, chart and trade has a Cite button that writes the citation for you. For anything that matters, cite the original government filing as well, which every row links to.",
      keyFacts: [
        "Credit line: \"Source: Spot the Money (spotthemoney.com)\", linked to the page.",
        "The Cite button gives the citation in plain, APA, MLA and Chicago form with today's date filled in.",
        "The government filing is the authority; this site is the compilation.",
        "Federal law limits commercial use of congressional reports and of FEC donor details.",
        "Charts can be embedded or saved as images with the site name on them.",
      ],
      sections: [
        { id: "credit", h: "How should I credit the site?", html: `
<p>Name the site and link to the page the figure came from. In running text, "according to Spot the Money" with a link is enough. Under a chart or table, use <strong>Source: Spot the Money (spotthemoney.com)</strong>.</p>
<p>Link to the specific page, not the home page. Pages are rebuilt as new filings arrive, so say when you looked: a total you quote today may be different next week.</p>` },
        { id: "cite-button", h: "How do I get a formatted citation?", html: `
<p>Use the "Cite" button at the top of any page. It opens a small panel with the citation in four styles, each with the page's last-updated date and today's date already filled in, and a "Copy citation" button. Charts and single trades have the same panel behind their Share buttons, with a link that goes straight to that chart or that row.</p>
<p>The four styles look like this:</p>
${table(["Style", "Example"], examples)}
<p>Copying keeps the italics when you paste into a word processor. A citation for a single trade also names the original filing and gives its address.</p>` },
        { id: "original", h: "Should I cite this site or the original filing?", html: `
<p>Both, when the claim matters. The filing made with the government is the record; this site reads it, adds it up by stated rules and links back to it. If you report that a member of Congress sold a stock, the member's own report is the source and this site is where you found it.</p>
<p>Every row in every table has a link to its filing in the last column: the Form 4 on the SEC's EDGAR system, or the periodic transaction report on the House Clerk's or the Senate's site. The "Sources and method" section at the foot of each member, insider, stock and company page lists how many filings from each source are behind the page, the dates they span, and where to read them.</p>
<p>Totals, rankings and charts are this site's arithmetic. Cite those to this site, and read the <a href="/methodology/">methodology</a> for the rules used, especially for <a href="/guides/congress-trade-amount-ranges/">congressional amounts</a>, which are tops of ranges.</p>` },
        { id: "charts", h: "Can I use the charts and tables?", html: `
<p>Yes, with the credit. Three ways are built in:</p>
<ul>
<li><strong>Link.</strong> Each chart's Share button gives a link that opens the page at that chart.</li>
<li><strong>Image.</strong> "Save image" in the same menu downloads the chart as a picture with its title, legend, the site name and the date.</li>
<li><strong>Embed.</strong> Charts on member and stock pages offer embed code that shows the live chart on your own site with a source line.</li>
</ul>
<p>Please do not crop out the site name or alter the figures. If you rebuild a chart from the numbers, credit the site as the source of the data.</p>` },
        { id: "limits", h: "Are there legal limits on reuse?", html: `
<p>Yes, two, and they apply to anyone who uses the records, not only to this site:</p>
<ul>
<li><strong>Congressional financial disclosure reports</strong> may not be used for a commercial purpose (news and media reporting to the general public is excepted), to establish anyone's credit rating, or to solicit money (${ext("https://www.law.cornell.edu/uscode/text/5/13107", "5 U.S.C. § 13107(c)")}).</li>
<li><strong>Information copied from FEC reports</strong> may not be sold or used to solicit contributions or for commercial purposes (${ext("https://www.fec.gov/updates/sale-or-use-contributor-information/", "FEC guidance")}). This site publishes donation totals only, never individual donors.</li>
</ul>
<p>SEC filings, lobbying reports, contract records and Treasury rates carry no comparable restriction. The full reuse terms are in the <a href="/terms/#reuse">terms of use</a>. This is a summary, not legal advice.</p>` },
        { id: "bulk", h: "What if I need the data in bulk?", html: `
<p>Write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and say what you are working on. Please do not crawl the site at a rate that strains it. Journalists and researchers can also ask for the rule behind any figure, or for help tracing a number to its filings.</p>
<p>The government sources are open to everyone and are listed, with links, in the <a href="/methodology/#sources">methodology</a>.</p>` },
        { id: "errors", h: "What if the figure I cited is later corrected?", html: `
<p>Filings are amended and this site fixes its own mistakes. A correction that changes a published number is logged on the <a href="/corrections/">corrections page</a> with its date. Because pages change, the access date in your citation is what shows which version you saw.</p>` },
      ],
      faqs: [
        { q: "How do I cite Spot the Money?", a: "Credit \"Spot the Money (spotthemoney.com)\" and link to the page you used. The Cite button on every page gives a ready-made citation in plain, APA, MLA and Chicago style with the access date filled in." },
        { q: "Can I use Spot the Money charts in an article?", a: "Yes, with a credit and a link. Each chart can be linked, saved as an image that carries the site name, or embedded on member and stock pages." },
        { q: "Is Spot the Money data free to reuse?", a: "Figures may be quoted and reused with a credit and a link. Federal law separately limits commercial use of congressional disclosure reports and of donor details from FEC reports." },
        { q: "Should I cite the original filing or Spot the Money?", a: "Cite the original government filing for the fact of a trade, and this site for totals, rankings and charts it computed. Every row links to its filing." },
      ],
      sources: [
        { name: "5 U.S.C. § 13107, public access to congressional reports and limits on their use", url: "https://www.law.cornell.edu/uscode/text/5/13107" },
        { name: "FEC: sale or use of contributor information", url: "https://www.fec.gov/updates/sale-or-use-contributor-information/" },
        { name: "52 U.S.C. § 30111", url: "https://www.law.cornell.edu/uscode/text/52/30111" },
      ],
      related: ["what-disclosure-data-cannot-tell-you", "congress-trade-amount-ranges", "how-to-use-the-trade-map", "campaign-donations-fec-data"],
      seeLive: [{ label: "Terms of use: reusing the data", href: "/terms/#reuse" }, { label: "Methodology", href: "/methodology/" }, { label: "Corrections", href: "/corrections/" }],
      covers: ["web/src/lib/cite.ts", "web/src/scripts/share.ts", "web/src/components/SourcePanel.astro", "web/src/pages/terms.astro"],
      ui: [{ text: "<span>Cite</span>", on: "/congress/" }, { text: "Copy citation", on: "/congress/" }, { text: ">Chicago<", on: "/congress/" }, { text: "Save image", on: "/congress/" }, { text: "Sources and method", on: "/stocks/aapl/" }],
      facts: [],
    };
  },
];
