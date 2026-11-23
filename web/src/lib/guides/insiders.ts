// Guides: corporate insider filings (SEC Form 4). See the rules at the top of congress.ts.
import type { Guide } from "./types";
import type { GuideCtx } from "./ctx";
import { ext, table } from "./html";

const U = "2026-10-08";
const FORM4 = "https://www.sec.gov/files/form4data.pdf";

export const insiderGuides: ((c: GuideCtx) => Guide)[] = [
  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "what-is-form-4", group: "insiders", updated: "2026-11-24",
    title: "What is SEC Form 4?",
    seoTitle: ["What Is SEC Form 4? Insider Trading Filings Explained", "What Is SEC Form 4? Insider Filings Explained"],
    description: ["Form 4 is the SEC filing a company's officers, directors and 10% owners must make within two business days of trading its stock. What it shows and how to read it.", "Form 4 is the SEC filing company insiders make within two business days of trading their company's stock. What it shows."],
    answer: "Form 4 is the filing a company's officers, directors and owners of more than 10% of its stock must send to the SEC within two business days of buying or selling that stock. It gives the date, the number of shares, the price and the insider's holdings afterwards, and it is public the moment it is filed.",
    keyFacts: [
      "Who files: officers, directors and owners of more than 10% of a class of the company's shares.",
      "Deadline: before the end of the second business day after the trade.",
      "It reports exact shares and prices, unlike congressional reports.",
      "Trading by insiders is legal when it is reported and not based on secret information.",
      `Since ${c.facts.foreignInsiders.since}, officers and directors of foreign companies listed in the U.S. file too.`,
    ],
    sections: [
      { id: "what", h: "What is Form 4?", html: `
<p>Form 4 is a short public filing called a "statement of changes in beneficial ownership". When a person closely tied to a public company trades that company's shares, they must report it to the Securities and Exchange Commission (SEC) on ${ext(FORM4, "Form 4")}, and the SEC publishes it at once on its EDGAR system.</p>
<p>It has two siblings. Form 3 is filed once, when someone first becomes an insider, and lists what they already own. Form 5 is an annual catch-up for a few items that did not need a Form 4. This site reads Form 4 only.</p>` },
      { id: "who", h: "Who has to file one?", html: `
<p>Three groups, under Section 16 of the Securities Exchange Act: a company's officers (its senior executives), its directors (board members), and anyone who owns more than 10% of a class of its shares. That last group is mostly funds and founders, and it accounts for a large part of the dollars on Form 4. See ${`<a href="/guides/ten-percent-owners-and-joint-filings/">10% owners and joint filings</a>`}.</p>
<p>Until this year, insiders of foreign companies listed in the United States were exempt. A law passed in December 2025 ended that: since ${c.facts.foreignInsiders.since}, their officers and directors file the same forms (${ext(c.facts.foreignInsiders.source, "SEC rule")}).</p>` },
      { id: "when", h: "How quickly must it be filed?", html: `
<p>Before the end of the second business day after the trade. That makes Form 4 far faster than congressional disclosure, where the limit is ${c.congressDeadlineDays} days.</p>
<p>This site flags a Form 4 as late when it was filed more than ${c.form4LateAfterDays} calendar days after the trade, a deliberately cautious reading of "two business days" that allows for weekends and holidays.</p>` },
      { id: "read", h: "How do I read one?", html: `
<p>A Form 4 has two tables. Table I lists ordinary shares bought, sold or otherwise changed. Table II lists derivatives: stock options, warrants and similar instruments. Each row has:</p>
<ul>
<li><strong>A transaction code</strong>, a single letter that says what kind of event it was. P is a purchase, S is a sale; most other letters are not market trades at all. The full list is in ${`<a href="/guides/form-4-transaction-codes/">Form 4 transaction codes</a>`}.</li>
<li><strong>The date, share count and price.</strong></li>
<li><strong>Shares owned afterwards</strong>, which lets you see whether a sale was a small trim or most of a holding.</li>
<li><strong>Direct or indirect ownership.</strong> Indirect means the shares sit in a trust, a family member's account or a fund the insider controls.</li>
</ul>
<p>A checkbox near the top says whether the trade was made under a ${`<a href="/guides/rule-10b5-1-trading-plans/">Rule 10b5-1 plan</a>`}, a schedule set up in advance.</p>` },
      { id: "legal", h: "Is this the illegal kind of insider trading?", html: `
<p>No. The phrase covers two different things. Illegal insider trading is buying or selling while using important information that the public does not have, in breach of a duty of trust (${ext("https://www.investor.gov/introduction-investing/investing-basics/glossary/insider-trading", "the SEC's definition")}). Legal insider trading is an executive or director buying or selling their own company's stock in the open and reporting it. Form 4 is the report.</p>
<p>A Form 4 therefore tells you that a trade happened, not that anything was wrong with it.</p>` },
      { id: "here", h: "Which insider filings are on this site?", html: `
<p>Form 4 filings for a tracked set of companies: about 70 large or heavily traded U.S. stocks, plus every stock that appears in a congressional trade report. That is ${c.counts.tickers} tickers and ${c.counts.insiderTxns} transactions today, not the whole market. The record starts with filings made on or after ${c.form4Floor}; older filings are not shown, so an insider's year-by-year table never includes a year this site holds only a few rows for. Each row links to the filing on EDGAR.</p>
<p>The <a href="/insiders/">Insiders page</a> lists the newest filings and the <a href="/">trade map</a> shows where the dollars went.</p>
<p>Three kinds of page hold the detail, and they link to one another:</p>
<p>Stock, company, insider and member pages share one shape. A row of "At a glance" tiles near the top gives the main counts, and each tile opens its section. A bar under it jumps between the groups on the page, always in this order when they apply: Trading, Ownership, Company, Washington and About this record. A group appears only when the page has something to put in it, and a page with no records on file has no tiles and no bar. What each page type holds:</p>
<ul>
<li><strong>A stock's page</strong> lists the insiders who filed for that ticker and the members of Congress who traded it, each with the number of rows, open-market purchases and sales, and the latest date. Above that list, a table sums the insiders' open-market purchases and sales over the last 3 and 12 months: trades, people, shares, dollars, how many sales were made under a 10b5-1 plan, and bought minus sold. It counts code P and code S rows only, by the date each was disclosed. A folded table breaks the rows down by Form 4 code. Where members of Congress have traded the ticker, a link above their rows opens the ${`<a href="/congress-trades/">Congress trade screener</a>`} on that ticker alone, to filter, sort and download them. "Related stocks" are the tickers traded by the same people, ranked by the number of filers in common.${c.schedule13Shown ? ` When a holder of more than ${c.holderThreshold}% has an ownership statement on record, the page also has a section "Large holders: Schedules 13D and 13G", which lists positions, not trades; the guide to <a href="/guides/ten-percent-owners-and-joint-filings/#large-holders">10% owners and large holders</a> explains it.` : ""}${c.instShown ? ` When institutional managers report the company in their quarterly Form 13F, a section "Institutional holders: Form 13F" lists the largest of them; it too shows positions on one day, not trades, and the <a href="/guides/form-13f-institutional-holdings/">guide to Form 13F</a> explains it.` : ""}</li>
<li><strong>An insider's page</strong> shows the same person's rows by code and by year, then every transaction, the filings, and the other insiders at the same company. When the company has filed Form 8-K reports in the last 12 months, one line above the figures gives the number and links to the company's events section; it counts the company's reports and says nothing about the insider.</li>
<li><strong>A company with a ticker has one page</strong>, at its ticker's address. Besides the rows above it holds the company's federal contracts, its federal grants, loans and direct payments, its lobbying filings and the contributions its own lobbying reports list, all matched by the company's exact name, and any insider rows its filings do not put under that ticker. Sections are grouped as Trading, Ownership, Company and Washington, and a group appears only when it has something to show. An older company address opens the same page. A company's other share classes (GOOG beside GOOGL, or a preferred share) are on that page too, which names them near the top; the address of the other class opens the same page. A company with no ticker here keeps a page of its own with the same sections.</li>
</ul>
<p>A row is listed under a ticker when its Form 4 names, as issuer, the company that ticker belongs to (or an earlier registrant of the same stock, after a merger or reorganisation). Some issuers have no trading symbol of their own, for example a fund run by a listed asset manager. Their insiders' rows are on the issuer's company page and the insider's page, shown without a ticker, and are left out of the manager's stock page and its totals. The <a href="/methodology/#ticker-owners">methodology</a> says how a ticker's company is settled.</p>
<p>The "Industry" line at the top of a company's page is the industry code (SIC) the SEC has assigned to the company, in the SEC's wording, followed by the broad division that code belongs to. It is the SEC's classification and a label only; a company with no code on file has no such line. The line opens the page for that division under <a href="/industries/">Companies by industry</a>, which lists the tracked companies the SEC classifies there, each with the number of open-market insider purchases and sales and of congressional trades disclosed in the last 12 months. Those pages count rows; they do not rank industries or compare a trade with a company's industry.</p>
<p>The same three kinds of page also exist for stocks, companies and insiders outside the tracked set, when the market-wide Form 4 filings for them are on file. Those pages are put together from the filings when someone first opens them and are kept for up to a day, so they can lag the tracked pages. They show the newest rows only, leave out the charts, the Industry line, the Congress and lobbying tables and the follow button, and are listed in the sitemap only when the page has at least one open-market purchase or sale; a page without one carries a noindex tag.</p>
<p>In every trade table a flag such as "late" or "10b5-1 plan" is a link to the guide that explains it, and each of these pages ends with the guides that cover what is on it. "Related" lists describe overlap in public filings and nothing more. Every trade table can be sorted: click a column title such as Trade date, Value or Lag to sort by it, click again to reverse, and click a third time to return to the original newest-first order. Insider tables also carry <strong>Held after</strong>, the shares the insider reports owning once the row is done, and <strong>Change</strong>, how much of the earlier holding the row added or removed ("new" for a first purchase, −100% for a sale that leaves nothing); rows with no holding on file show a dash. Where a filing has footnotes, each of its rows carries a link such as "2 notes": the text opens under the table, word for word as filed, and the filing itself shows which row each note is about. A <strong>Follow</strong> button beside the name on all three adds the page to your free watchlist; see ${`<a href="/guides/how-to-follow-members-insiders-and-stocks/">how to follow</a>`}.</p>` },
      ...(c.financialsShown ? [{ id: "financials", h: "What are the financial figures on a company's page?", html: `
<p>A company's page has a section titled "Financials, as filed" when the company's annual and quarterly reports to the SEC are on file here. It has two small tables: the ${c.finYears} newest fiscal years and the ${c.finQuarters} newest quarters. The lines are revenue, net income, diluted earnings per share, cash and equivalents, total assets, total liabilities and shareholders' equity; the fiscal-year table adds cash from operations and capital expenditure. Under each column is a link to the report the figures came from.</p>
<p>The figures are the company's own. Companies file their financial statements with every number labelled (${ext("https://www.sec.gov/search-filings/edgar-application-programming-interfaces", "the SEC publishes those labelled figures")}), and this site reads a fixed set of them. They are shown as filed, in the currency the company reports in, and nothing is estimated or converted. When a later report restates an earlier period, the later report's figure is the one shown.</p>
<p>Four things follow from showing only what was filed. A period is told by its length, so a column is either a quarter of about three months or a fiscal year. A fourth fiscal quarter has no column, because companies report it inside the annual report and not on its own. Cash-flow lines are in the fiscal-year table only, because a quarterly report gives them for the year so far. And a dash means the report did not give that figure under a label this site reads, which happens: not every company reports a total for liabilities, for instance.</p>
<p>A few filed figures look wrong as stored, and the page prints "not shown" in their place: earnings per share that would mean the company has fewer than ${c.finMinImpliedShares} shares, total assets that do not equal liabilities plus equity on the same date, and cash larger than total assets. The first of these is usually a figure filed in the wrong scale, but a very small company can really have that few shares; either way the figure as filed is in the download. A small letter beside a figure means it was filed under a different label than the same line in the newest column. Every fiscal year and quarter on file, with the figures as filed, is in one file on the <a href="/downloads/">downloads page</a>. There are no ratios that need a share price, no scores and no forecasts, and the section is a record of filings, not a view on the company.</p>
<p>Two more sections sit beside it in the "Company" group of a page, when the company has the data: "Executive pay, as filed", the Pay Versus Performance table of its proxy statement (<a href="/guides/executive-pay-pay-versus-performance/">how to read it</a>), and "Company events: Form 8-K reports", the current reports it filed in the last 12 months (<a href="/guides/form-8-k-company-events/">what a Form 8-K is</a>). Neither enters any buy or sell total, and neither is read for the reason behind a trade.</p>
<p>To see many companies at once, use the <a href="/company-financials/">company financials screener</a>. It lists the newest fiscal year, or the newest quarter, of every company on this site in one table, with the same figures as filed and the same "not shown" rule. It can be narrowed by industry, by the currency a company reports in, by revenue, by total assets, by whether net income was above or below zero and by whether the company has executive pay on file, and any column can be sorted. The "CEO pay, as reported" column is the total compensation of the principal executive officer from the company's newest pay table, with its fiscal year beside it; it belongs to the company, is blank where no table is on file, and is never compared with revenue or income. Because nothing is converted, the revenue and total-assets filters read only companies that report in U.S. dollars. The table has no score or rating: sorting a column orders companies by that one filed figure.</p>` }] : []),
      ...(c.form144Shown ? [{ id: "form-144", h: "What is a Form 144 notice, and how is it different from a Form 4?", html: `
<p>A Form 144 is a notice of a planned sale. Under the SEC's Rule 144, an affiliate of a company (an officer, a director or a large holder) who intends to sell restricted or control shares files one with the SEC when the sale in any three months is to be more than 5,000 shares or more than $50,000. It is filed when the order is placed with a broker, and it has been filed electronically since 2023, so it is public the same day.</p>
<p>The difference from a Form 4 matters. A Form 4 reports a trade that has happened: the date, the shares and the price. A Form 144 reports an intention. The sale it describes may happen that day, later, in part or not at all, and the form's dollar figure is the market value the filer states for the shares, not what anyone was paid. When an officer or director does sell, that sale appears on a Form 4 in the usual way. Some sellers who file a Form 144 never file a Form 4 at all, because they are not officers, directors or 10% owners.</p>
<p>On this site, a company's page has a section titled "Planned sales: Form 144 notices" when a notice about the company was filed in the last 12 months. It lists the ${c.form144Rows} newest: the filing date, the seller and the relationship to the company in the filer's own words, the class and number of shares, the stated market value, the approximate sale date, the date a Rule 10b5-1 plan was adopted when the notice gives one, and a link to the notice at the SEC. Notices are shown for the companies this site tracks, from notices filed on or after ${c.form4Floor}. The figures are printed as filed, with one exception: forms are typed by hand and now and then a market value is plainly wrong for the number of shares, so a stated value of more than $${c.form144ValueMaxPerShare} a share reads "not shown" on the page. The figure as filed is still in the CSV file, marked, and on the notice itself.</p>
<p>Three rules keep the notices apart from the trades. No figure from a notice is in any buy or sell total, chart, feed or trade map here. An amended notice (144/A) is listed as its own row; it repeats the notice it corrects and the form does not say which one, so the rows are not added together and the section counts notices and sellers only. And nothing is read into a notice: it carries no flag or label. All notices are in one file on the <a href="/downloads/">downloads page</a>.</p>
<p>An insider's own page shows the same notices from the filer's side, under "Planned sales: Form 144 notices this filer submitted": the notices sent in under that person's SEC number in the last 12 months, each with the company, the figures as filed and the seller the notice names, which is sometimes a trust or a family entity and not the person.</p>
<p>The <a href="/planned-sales/">planned sales page</a> puts every notice filed in the last 12 months about a company on this site in one table. It opens on the last 30 days and can be narrowed by company, seller, industry, notice or amendment, whether the notice states a Rule 10b5-1 plan date, the stated value and the filing window; a value shown as "not shown" passes no value filter, and the count line counts notices, companies and sellers and never adds up shares or dollars. "Download these rows (CSV)" saves the rows that match, made in your browser.</p>` }] : []),
    ],
    faqs: [
      ...(c.financialsShown ? [{ q: "Where do the financial figures on a company's page come from?", a: "From the company's own annual and quarterly reports to the SEC (forms 10-K, 10-Q, 20-F and 40-F). The figures are shown as filed, in the currency the company reports in, each column with a link to the report. Nothing is estimated." }] : []),
      ...(c.financialsShown ? [{ q: "Can I filter companies by their filed financial figures?", a: "Yes. The company financials screener lists the newest fiscal year or quarter of every company on this site, as filed, and can be narrowed by industry, reporting currency, revenue, total assets and whether net income was above or below zero. The revenue and total-assets filters read only companies that report in U.S. dollars, because nothing is converted. It has no score or rating." }] : []),
      ...(c.form144Shown ? [{ q: "Is a Form 144 a report of an insider sale?", a: "No. A Form 144 is a notice that a holder plans to sell restricted or control shares. The sale may happen later, in part or not at all. A sale by an officer, director or 10% owner that does happen is reported on Form 4." }] : []),
      { q: "What is a Form 4 filing?", a: "Form 4 is the SEC filing that a company's officers, directors and owners of more than 10% of its stock must make within two business days of trading that stock. It shows the date, shares, price and holdings afterwards.", on: ["insiders", "stocks"] },
      { q: "Is insider trading reported on Form 4 legal?", a: "Yes. Form 4 reports lawful trades by company insiders in their own company's stock. Illegal insider trading means trading on important information that is not public, in breach of a duty of trust.", on: ["insiders"] },
      { q: "How soon after a trade must an insider file Form 4?", a: "Before the end of the second business day after the trade." },
      { q: "Who counts as a corporate insider?", a: "For SEC reporting, a company's officers, its directors, and anyone who owns more than 10% of a class of its shares." },
    ],
    sources: [
      { name: "SEC Form 4 and instructions", url: FORM4 },
      { name: "Securities Exchange Act § 16 (15 U.S.C. § 78p)", url: "https://www.law.cornell.edu/uscode/text/15/78p" },
      { name: "SEC Rule 16a-3, reporting transactions and holdings", url: "https://www.law.cornell.edu/cfr/text/17/240.16a-3" },
      { name: "Investor.gov: insider trading", url: "https://www.investor.gov/introduction-investing/investing-basics/glossary/insider-trading" },
      { name: "SEC rule on insiders of foreign private issuers (2026)", url: c.facts.foreignInsiders.source },
      ...(c.financialsShown ? [{ name: "SEC: EDGAR application programming interfaces (XBRL company facts)", url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces" }] : []),
      ...(c.form144Shown ? [{ name: "Investor.gov: Form 144", url: "https://www.investor.gov/introduction-investing/investing-basics/glossary/form-144" }, { name: "SEC Rule 144 (17 CFR § 230.144)", url: "https://www.law.cornell.edu/cfr/text/17/230.144" }] : []),
    ],
    related: ["form-4-transaction-codes", "rule-10b5-1-trading-plans", "insider-buying-vs-insider-selling", "ten-percent-owners-and-joint-filings"],
    seeLive: [{ label: "Newest insider filings", href: "/insiders/" }, { label: "Stocks with insider activity", href: "/stocks/" }],
    covers: ["web/src/lib/flagship-core.ts#FORM4_DEADLINE_DAYS", "web/src/lib/flagship-core.ts#isLate", "web/src/lib/entity.ts", "web/src/lib/issuer.ts", "web/src/lib/industries.ts", "web/src/lib/links.ts", "web/src/lib/footnotes.ts", "web/src/components/TxnTable.astro", "web/src/lib/server/od.ts", "web/src/components/OdPageView.astro", "web/src/lib/market.ts", "web/src/pages/stocks/[ticker].astro", "web/src/pages/insiders/[slug].astro", "web/src/pages/companies/[slug].astro", "web/src/lib/form144.ts", "web/src/lib/plannedsales.ts", "web/src/lib/inst13f.ts", "web/src/components/PlannedSales.astro", "web/src/lib/financials.ts", "web/src/components/Financials.astro", "web/src/components/FiledNotices.astro", "web/src/lib/finscreen.ts", "web/src/pages/company-financials.astro"],
    ui: [{ text: "Guides for this page", on: "/stocks/aapl/" }, { text: "Related stocks", on: "/stocks/aapl/" }, { text: "Companies by industry", on: "/industries/" }, { text: "Financials, as filed", on: "/stocks/aapl/" }, { text: "Company financials screener", on: "/company-financials/" }, { text: "Net income above zero", on: "/company-financials/" }],
    facts: ["foreignInsiders"],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  () => ({
    slug: "form-4-transaction-codes", group: "insiders", updated: "2026-11-16",
    title: "Form 4 transaction codes",
    seoTitle: ["Form 4 Transaction Codes: P, S, A, M, F, G and the Rest", "Form 4 Transaction Codes Explained"],
    description: ["Every Form 4 transaction code in plain words: P is a purchase, S a sale, A a grant, M an option exercise, F shares withheld for tax, G a gift, and more.", "Every Form 4 transaction code in plain words, and which ones are real market trades."],
    answer: "Each row on a Form 4 carries a one-letter code that says what happened: P is an open-market or private purchase and S is a sale, while most other letters (A, M, F, G and others) are grants, option exercises, tax withholdings or gifts and are not decisions to buy or sell on the market. Only P and S are counted as buying and selling on this site's trade map by default.",
    keyFacts: [
      "P = purchase. S = sale. These are the two market trades.",
      "A = shares or options granted by the company as pay.",
      "M and X = an option was exercised.",
      "F = shares handed back to cover tax or the exercise price.",
      "G = a gift, such as a donation to charity.",
    ],
    sections: [
      { id: "table", h: "What does each code mean?", html: `
${table(["Code", "Plain meaning", "How this site treats it"], [
  ["P", "Bought shares, on the market or privately", "Buy"],
  ["S", "Sold shares, on the market or privately", "Sell"],
  ["A", "Received a grant or award from the company (pay)", "Other"],
  ["M", "Exercised or converted an option or similar award", "Option / conversion"],
  ["X", "Exercised an option that was in or at the money", "Option / conversion"],
  ["F", "Gave shares back to pay tax or an exercise price", "Shown as Sell with its code; left out of the map's default view"],
  ["D", "Returned or sold shares to the company itself", "Shown as Sell with its code; left out of the map's default view"],
  ["C", "Converted one security into another", "Exchange"],
  ["G", "Gave shares away as a gift", "Other"],
  ["J", "Something else, explained in a footnote", "Other"],
  ["W", "Received or passed on by inheritance", "Other"],
  ["I, L, Z, K, U, E, H, O", "Rarer events: plan transfers, small acquisitions, voting trusts, swaps, tender offers, expiring options", "Other"],
])}
<p>A letter V next to a code only means the insider reported earlier than required. The official wording for every code is in the instructions to ${ext(FORM4, "Form 4")}.</p>` },
      { id: "market-trades", h: "Which codes are real buying and selling?", html: `
<p>P and S. A code P purchase means the insider paid for shares, which is the event most readers are looking for. A code S sale means they sold shares for cash.</p>
<p>Everything else is mostly the mechanics of being paid in stock. A senior executive's filings are typically a cycle: an award is granted (A), it later vests or an option is exercised (M), some shares are withheld to pay the tax bill (F), and some of the rest may be sold (S). Only the last step is a choice to sell, and often not even that if it was scheduled under a ${`<a href="/guides/rule-10b5-1-trading-plans/">10b5-1 plan</a>`}.</p>` },
      { id: "site", h: "How do the codes shape what I see here?", html: `
<p>The trade map opens on "Open-market", which shows only P and S rows. Switching to "All codes" brings in the rest. The site-wide charts (buy / sell pressure, weekly flow, the activity calendar) count only P and S rows that were not made under a pre-arranged plan. Charts on a single insider's or stock's page count every row marked Buy or Sell, including codes F and D.</p>
<p>In tables, each Form 4 row shows its side with the code beside it, for example "Sell F", so you can tell a market sale from a tax withholding at a glance. Rows from Table II (options and other derivatives) are labelled "Option / conversion" and are kept out of buy and sell totals; see ${`<a href="/guides/insider-options-and-derivatives/">options and derivatives</a>`}.</p>` },
      { id: "price-zero", h: "Why do some rows have no price?", html: `
<p>Because nothing was paid. A grant (A) or a gift (G) has no purchase price, and some filings put a weighted average or a total in a footnote instead of the price box. Those rows show a dash for price and value here. Where a filing has footnotes, each of its rows carries a link such as "2 notes" that opens the text under the table, as filed.</p>` },
    ],
    faqs: [
      { q: "What does code P mean on Form 4?", a: "Code P means the insider purchased shares, on the open market or in a private deal. It is the code that marks a real insider buy.", on: ["insiders"] },
      { q: "What does code F mean on Form 4?", a: "Code F means shares were handed back to the company to pay tax or the exercise price when an award vested or an option was exercised. It is not a decision to sell on the market." },
      { q: "What does code M mean on Form 4?", a: "Code M means an option or similar award was exercised or converted into shares. It is usually followed by rows showing the shares received." },
      { q: "What does code A mean on Form 4?", a: "Code A means the insider received a grant or award from the company, such as restricted stock or options given as pay." },
    ],
    sources: [
      { name: "SEC Form 4 and instructions (General Instruction 8, transaction codes)", url: FORM4 },
      { name: "SEC Rule 16a-3", url: "https://www.law.cornell.edu/cfr/text/17/240.16a-3" },
    ],
    related: ["what-is-form-4", "insider-options-and-derivatives", "insider-buying-vs-insider-selling", "how-to-use-the-trade-map"],
    seeLive: [{ label: "Newest insider filings", href: "/insiders/" }, { label: "Flag and code definitions", href: "/methodology/#flags" }],
    covers: ["ingest/src/sources/sec_form4.ts#codeToSide", "web/src/lib/vizdata.ts#isSignal", "web/src/lib/flagship-core.ts#sideLabel"],
    ui: [{ text: "Open-market", on: "/insiders/" }, { text: "All codes", on: "/insiders/" }],
    facts: [],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const r = c.facts.rule10b51;
    return {
      slug: "rule-10b5-1-trading-plans", group: "insiders", updated: "2026-11-16",
      title: "Rule 10b5-1 trading plans",
      seoTitle: ["Rule 10b5-1 Plans: Pre-Scheduled Insider Sales Explained", "Rule 10b5-1 Trading Plans Explained"],
      description: ["A Rule 10b5-1 plan lets a company insider schedule stock trades in advance. How the plans work, the 90-day waiting period, and why they are filtered out by default.", "A Rule 10b5-1 plan lets an insider schedule trades in advance. How the plans work and why they matter when reading Form 4."],
      answer: `A Rule 10b5-1 plan is a written schedule an insider sets up in advance, telling a broker to buy or sell fixed amounts on fixed dates or prices. Trades made under a plan are reported on Form 4 with a checkbox, and because they were decided months earlier they say little about what the insider thinks today, which is why this site leaves them out of its default view.`,
      keyFacts: [
        "The plan must be set up when the insider has no important non-public information.",
        `Officers and directors must wait at least ${r.insiderCoolingDays} days before the first trade.`,
        `Form 4 has had a 10b5-1 checkbox since ${r.checkboxSince}.`,
        "Most large, regular sales by executives are plan sales.",
      ],
      sections: [
        { id: "what", h: "What is a 10b5-1 plan?", html: `
<p>A 10b5-1 plan is an instruction given to a broker ahead of time: sell 5,000 shares on the first trading day of each month, for example, or sell 20,000 shares if the price reaches $80. Once it is in place the insider is not supposed to influence the trades.</p>
<p>The name comes from SEC Rule 10b5-1. Executives nearly always know something the public does not, which makes any sale open to suspicion. The rule offers a defence: if the plan was adopted in good faith at a time when the insider had no important non-public information, later trades under it are protected even if the insider learns something in between.</p>` },
        { id: "rules", h: "What limits apply to these plans?", html: `
<p>The SEC tightened the rule with changes that took effect on February 27, 2023 (${ext(r.source, "SEC fact sheet")}):</p>
<ul>
<li><strong>A waiting period.</strong> An officer or director cannot trade under a new or changed plan until ${r.insiderCoolingDays} days have passed, or two business days after the company's next quarterly results if that is later, up to a maximum of ${r.insiderCoolingMaxDays} days. Other people must wait ${r.othersCoolingDays} days.</li>
<li><strong>A certification.</strong> Officers and directors must state in writing that they hold no important non-public information when adopting the plan.</li>
<li><strong>No stacking.</strong> Overlapping plans are generally not allowed, and a plan covering a single trade can be used only once in twelve months.</li>
<li><strong>Disclosure.</strong> Forms 4 filed on or after ${r.checkboxSince} have a box to tick when a trade was made under a plan.</li>
</ul>` },
        { id: "spot", h: "How do I tell a plan trade from a discretionary one?", html: `
<p>By the checkbox. On this site a row from a filing with the box ticked carries a "10b5-1 plan" flag. The trade map has a filter with two settings, "No 10b5-1 plans" (the default) and "With plans".</p>
<p>In an insider's trade table the "Held after" and "Change" columns show how much of the reported holding a row removed. They sit beside the plan flag, but the filing does not link the two: a large change under a plan is a fact about the holding, not a reason.</p>
<p>The box applies to the whole filing, not to each row, and it has only existed since 2023, so older filings mention plans in footnotes or not at all. Treat the flag as reliable when present and its absence in an old filing as unknown. Many filers also state the plan and the date it was adopted in a footnote: where a filing on this site has footnotes, the "notes" link on its rows opens them under the table, as filed.</p>` },
        { id: "why-filter", h: "Why are plan trades left out by default?", html: `
<p>Because of when the decision was made. A plan sale executed this week was decided at least ${r.insiderCoolingDays} days ago, often a year or more. It tells you how the insider chose to cash out over time, not how they feel about the company now. Leaving plan trades out of the default view keeps the map closer to recent decisions.</p>
<p>That is a choice about emphasis, and you can undo it with one click. Plan sales are still real money leaving insiders' hands, and a plan can itself be informative: a new plan to sell a large share of a holding is a decision too, made on the day the plan was adopted.</p>` },
        { id: "criticism", h: "Are 10b5-1 plans controversial?", html: `
<p>They have been. Critics argued that the old rule let insiders adopt a plan and trade within days, or cancel a plan when the news turned out well, which defeated the purpose. The 2023 waiting periods and limits were the SEC's answer. Defenders point out that executives paid largely in stock need an orderly way to sell, and that a scheduled sale is fairer to the market than one timed by hand.</p>` },
      ],
      faqs: [
        { q: "What is a 10b5-1 plan?", a: "A 10b5-1 plan is a written instruction an insider gives a broker in advance to trade fixed amounts on set dates or prices. It protects the insider from insider-trading claims if it was adopted in good faith without important non-public information.", on: ["insiders", "stocks"] },
        { q: "Why does Spot the Money hide 10b5-1 trades by default?", a: `Because a plan trade was decided at least ${r.insiderCoolingDays} days earlier, so it says little about the insider's current view. The map's "With plans" setting brings them back.`, on: ["insiders"] },
        { q: "How long is the cooling-off period for a 10b5-1 plan?", a: `For officers and directors, at least ${r.insiderCoolingDays} days, or two business days after the next quarterly results if later, up to ${r.insiderCoolingMaxDays} days. For other people, ${r.othersCoolingDays} days.` },
      ],
      sources: [
        { name: "SEC fact sheet: Rule 10b5-1 insider trading arrangements", url: r.source },
        { name: "SEC final rule, Release 33-11138", url: "https://www.sec.gov/files/rules/final/2022/33-11138.pdf" },
        { name: "Rule 10b5-1 (17 CFR 240.10b5-1)", url: "https://www.law.cornell.edu/cfr/text/17/240.10b5-1" },
      ],
      related: ["what-is-form-4", "insider-buying-vs-insider-selling", "form-4-transaction-codes", "how-to-use-the-trade-map"],
      seeLive: [{ label: "Insider trade map", href: "/insiders/" }, { label: "Flag definitions", href: "/methodology/#flags" }],
      covers: ["web/src/lib/vizdata.ts#isSignal", "web/src/components/TxnTable.astro"],
      ui: [{ text: "No 10b5-1 plans", on: "/insiders/" }, { text: "With plans", on: "/insiders/" }],
      facts: ["rule10b51"],
    };
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "insider-buying-vs-insider-selling", group: "insiders", updated: U,
    title: "Insider buying vs insider selling",
    seoTitle: ["Insider Buying vs Insider Selling: Why Selling Is Larger", "Insider Buying vs Insider Selling"],
    description: ["Insiders sell far more stock than they buy because most are paid in shares. Why selling dominates, what a purchase tells you, and what neither can prove.", "Insiders sell far more than they buy because most are paid in shares. What a purchase and a sale each tell you."],
    answer: "Insiders sell far more stock than they buy, in almost every period, because executives and directors are paid largely in shares and must sell to turn pay into cash. A purchase is rarer and costs the insider their own money, so it is usually read as the more telling event, but neither a buy nor a sale shows what the insider knew or what the share price will do.",
    keyFacts: [
      "Selling outweighs buying by a wide margin in normal times.",
      "Insiders receive shares as pay; outside investors do not.",
      "Common reasons to sell: tax bills, diversification, a house, a planned schedule.",
      "The usual reason to buy with one's own cash: believing the shares are worth more.",
      "Averages across many trades say nothing certain about any one trade.",
    ],
    sections: [
      { id: "why-selling", h: "Why is there so much more selling than buying?", html: `
<p>Because insiders get their shares without buying them. A large part of executive and director pay is stock and options. Those shares arrive through grants, not purchases, so they never appear as buying. When the insider wants cash, the only way to get it is to sell, and that does appear.</p>
<p>The result is lopsided by design. An executive might receive stock worth millions over several years (code A rows), sell part of it steadily (code S rows), and never make a single open-market purchase. Add the large holders who own over 10% of a company and sell in blocks, and total selling can run to many times total buying without anyone turning negative on anything.</p>` },
      { id: "sale-reasons", h: "What are the ordinary reasons for an insider sale?", html: `
<ul>
<li><strong>Tax.</strong> Vesting shares create an income-tax bill; shares are sold or withheld to pay it.</li>
<li><strong>Diversification.</strong> An executive's salary, bonus and savings all depend on one company. Advisers tell them to spread the risk.</li>
<li><strong>Spending.</strong> Houses, tuition, divorce settlements, charitable gifts.</li>
<li><strong>A schedule.</strong> Many sales follow a ${`<a href="/guides/rule-10b5-1-trading-plans/">10b5-1 plan</a>`} set up long before.</li>
<li><strong>Fund mechanics.</strong> A private-equity or venture fund that owns a large stake sells because its own investors are due their money back.</li>
</ul>
<p>A sale can also reflect a view that the shares are fully priced. The filing does not say which reason applied.</p>` },
      { id: "buys", h: "Why do purchases get more attention?", html: `
<p>Because an insider has many reasons to sell and few to buy. They are already heavily exposed to the company and get more shares for free; choosing to add to that with their own cash is hard to explain except by a belief that the shares are cheap. That logic, and a good deal of published research over several decades, is why open-market purchases are generally treated as more informative than sales.</p>
<p>"More informative on average" is a weak promise. Insiders buy too early, buy for show after bad news, and are sometimes simply wrong. This site reports the trades and draws no conclusion from them.</p>` },
      { id: "cluster", h: "What is a cluster buy?", html: `
<p>A cluster buy is several insiders at the same company buying within a short period. One purchase can be personal; three or four at once is less likely to be coincidence, which is why the pattern gets its own name. On this site a cluster is three or more different insiders making open-market purchases of the same stock within 30 days, and the <a href="/insiders/#cluster-buys">Insiders page</a> has a feed for it.</p>
<p>Check that the buyers are separate people. Funds that hold a stake together often each file a Form 4 for the same purchase; this site counts such a trade once (see ${`<a href="/guides/ten-percent-owners-and-joint-filings/">joint filings</a>`}).</p>` },
      { id: "reading", h: "How should I read the buy and sell numbers on this site?", html: `
<p>With the mix in mind. The "Buy / sell pressure" chart counts only open-market trades (codes P and S) that were not made under a pre-arranged plan, and compares the last 30 days with the last twelve complete months. A low buying share is the normal state, so the useful question is whether it has moved, not whether it is below half.</p>
<p>Size matters as well. One fund selling a block can outweigh every officer and director in the market for that month. Use the Role filter on the map to separate officers, directors and 10% owners.</p>` },
    ],
    faqs: [
      { q: "Why do insiders sell more stock than they buy?", a: "Because most executives and directors are paid partly in shares. They receive stock through grants, which are not purchases, and must sell it to raise cash, so sales greatly outnumber purchases in normal times.", on: ["insiders", "stocks"] },
      { q: "Is insider selling a bad sign?", a: "Not by itself. Insiders sell to pay tax, diversify, fund spending or follow a pre-set plan, and a filing does not say which reason applied. A sale shows that shares were sold, not what the seller expects." },
      { q: "Is insider buying a good sign?", a: "An open-market purchase costs the insider their own money and is generally treated as more informative than a sale. It is still not a forecast: insiders can be early or wrong, and this site makes no recommendations." },
      { q: "What is a cluster buy?", a: "A cluster buy is several insiders of the same company buying shares on the open market within a short period.", on: ["insiders"] },
    ],
    sources: [
      { name: "SEC Form 4 and instructions", url: FORM4 },
      { name: "Investor.gov: insider trading", url: "https://www.investor.gov/introduction-investing/investing-basics/glossary/insider-trading" },
    ],
    related: ["what-is-form-4", "form-4-transaction-codes", "rule-10b5-1-trading-plans", "ten-percent-owners-and-joint-filings", "what-disclosure-data-cannot-tell-you"],
    seeLive: [{ label: "Insider charts and feeds", href: "/insiders/" }, { label: "Trade map", href: "/" }],
    covers: ["web/src/lib/vizdata.ts#isSignal", "web/src/lib/vizdata.ts#gaugeData", "web/src/components/VizFlow.astro", "web/src/pages/insiders/index.astro"],
    ui: [{ text: "Buy / sell pressure", on: "/insiders/" }, { text: "10% owners", on: "/insiders/" }],
    facts: [],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  () => ({
    slug: "insider-options-and-derivatives", group: "insiders", updated: U,
    title: "Options and derivatives on Form 4",
    seoTitle: ["Options and Derivatives on Form 4: Why They Are Separate", "Options and Derivatives on Form 4"],
    description: ["Form 4 has a second table for options, warrants and other derivatives. What those rows mean and why they are kept out of buy and sell totals.", "Form 4's second table covers options and other derivatives. What the rows mean and why they are kept out of totals."],
    answer: "Table II of Form 4 reports options, warrants and other derivatives, which are rights to buy or sell shares later and not shares themselves. This site shows those rows as \"Option / conversion\" and leaves them out of every buy and sell total, because buying a put or selling a call is not buying or selling the stock.",
    keyFacts: [
      "Table I = shares. Table II = options and other derivatives.",
      "An option exercise shows up twice: the option leaves Table II and shares arrive in Table I.",
      "A put bought is a bet on a fall; counting it as \"buying\" would be backwards.",
      "Derivative rows are listed in tables here but never added to buy or sell totals.",
    ],
    sections: [
      { id: "what", h: "What is a derivative on Form 4?", html: `
<p>A derivative is a contract whose value depends on the share price: an employee stock option, a warrant, a convertible security, a call or put bought on an exchange. Form 4 reports these in its second table, apart from ordinary shares.</p>
<p>For most executives the entries are employee options and similar awards: granted as pay (code A), later exercised (code M). For large holders such as hedge funds they can be exchange-traded puts and calls.</p>` },
      { id: "exercise", h: "What does an option exercise look like?", html: `
<p>Two or three rows filed together. In Table II the option disappears with code M. In Table I the same number of shares arrives, also code M, at the option's exercise price, which may be far below the market price. Often a code F or code S row follows, where shares are withheld or sold to cover tax and the exercise cost.</p>
<p>None of this is the insider deciding the stock is cheap. The option was granted years earlier and was about to expire or had vested.</p>` },
      { id: "why-separate", h: "Why are these rows kept out of buy and sell totals?", html: `
<p>Because adding them would mislead in both direction and size. A fund that buys put options is positioned for the price to fall, yet the row is an "acquisition". A fund that sells call options has "disposed" of something without selling a share. Counting either as buying or selling the stock would turn the meaning upside down.</p>
<p>Size is the other problem. The dollar value of an option trade is the premium, not the value of the shares it covers, and some filers put the total for the row in the "price per share" box. Multiplying that by the number of contracts once produced a single row worth tens of trillions of dollars on this site. The rule now is: a derivative row is listed with its own value, labelled "Option / conversion" and flagged "derivative", and it is left off the trade map and out of every chart total.</p>` },
      { id: "find", h: "Where can I still see them?", html: `
<p>In the tables on each insider's and each stock's page, and on the map when you choose "All codes" for non-derivative rows. If a large holder is active in a company's options, the rows are there to read; they are simply not summed with share trades.</p>` },
    ],
    faqs: [
      { q: "What does Option / conversion mean on an insider's trades?", a: "It marks a row from the derivatives table of Form 4, or an exercise or conversion of an option. These rows are listed but are not counted as buying or selling the stock.", on: ["insiders", "stocks"] },
      { q: "Does exercising stock options count as insider buying?", a: "No. An exercise converts an award granted earlier into shares at a preset price. It is reported with code M and is not an open-market purchase." },
      { q: "Why are insider option trades not in the buy and sell totals?", a: "Because an option is not the stock. Buying a put is a bet on a fall and selling a call sells no shares, so adding them to buying or selling would misstate both direction and size." },
    ],
    sources: [
      { name: "SEC Form 4 and instructions (Table II, derivative securities)", url: FORM4 },
      { name: "SEC Rule 16a-3", url: "https://www.law.cornell.edu/cfr/text/17/240.16a-3" },
    ],
    related: ["form-4-transaction-codes", "what-is-form-4", "ten-percent-owners-and-joint-filings"],
    seeLive: [{ label: "How values are computed", href: "/methodology/#values" }, { label: "Newest insider filings", href: "/insiders/" }],
    covers: ["shared/src/tradevalue.ts", "web/src/lib/heatmap.ts#insiderRows", "web/src/lib/flagship-core.ts#sideLabel"],
    ui: [],
    facts: [],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "ten-percent-owners-and-joint-filings", group: "insiders", updated: c.schedule13Shown ? "2026-11-22" : "2026-11-16",
    title: "10% owners and joint filings",
    seoTitle: ["10% Owners and Joint Form 4 Filings: One Trade, Many Forms", "10% Owners and Joint Form 4 Filings"],
    description: ["Funds that own over 10% of a company file Form 4 like executives, and related funds often each report the same trade. How to read them without double counting.", "Funds owning over 10% of a company file Form 4 too, and related funds often report the same trade. How to avoid double counting."],
    answer: `Anyone who owns more than 10% of a company's shares must file Form 4, so the largest "insider" trades are usually by investment funds, not executives. Funds that hold a stake together often each file for the same trade, and this site counts such a trade once when it is worth ${c.jointMinUsd} or more.`,
    keyFacts: [
      "A 10% owner is an insider for reporting purposes even with no role at the company.",
      "Most of the largest sales on Form 4 are funds reducing a stake.",
      "Several related entities can each report the same shares.",
      `Matching trades of ${c.jointMinUsd} or more are counted once and flagged "also in another filing".`,
    ],
    sections: [
      { id: "who", h: "Who are 10% owners?", html: `
<p>They are holders of more than 10% of a class of a company's shares: private-equity firms that took the company public, venture funds, founders and their family trusts, holding companies, occasionally another corporation. The law treats them as insiders because a holder that large may be close to the company, whether or not it has a board seat.</p>
<p>Their trades look different from an executive's. They are larger, often by a factor of a hundred, and they are usually sales: a fund exists to return money to its own investors, so selling down a holding after a company goes public is its ordinary business.</p>` },
      { id: "joint", h: "Why does one trade appear on several filings?", html: `
<p>Because the shares can have several legal owners at once. A private-equity stake may be held by a fund, controlled by a general partner, which is controlled by a management company, which is controlled by named individuals. Each of them "beneficially owns" the same shares in the law's eyes, and each may file a Form 4 for the same sale, sometimes on one joint form and sometimes on separate ones.</p>
<p>The filings usually explain the chain of owners in their footnotes. Where a filing has them, the "notes" link on its rows opens the text under the trade table, word for word as filed.</p>
<p>Read one at a time they are all correct. Added together they multiply the trade. One real sale on this site once appeared under seven owners and summed to seven times its size.</p>` },
      { id: "rule", h: "How does this site avoid counting a trade twice?", html: `
<p>It treats Form 4 rows as one trade when the stock, the date, the code, the share count and the price all match across different filings, the holdings reported after the trade match too, and the trade is worth ${c.jointMinUsd} or more. The earliest filing keeps the trade. The others stay visible on each filer's own page, carry the flag "also in another filing", and are left out of totals and off the map.</p>
<p>The holding used for that match is the one the trade table shows in its "Held after" column.</p>
<p>The threshold is there because small identical trades do happen for real: two directors each buying 1,000 shares at the same price on the same day are two purchases.</p>
<p>The underlying filings are not changed; this is a rule for adding up, written out in the <a href="/methodology/#values">methodology</a>.</p>` },
      { id: "filter", h: "How can I look at executives only?", html: `
<p>Use the Role filter on the <a href="/insiders/">insider map</a>: "Officers", "Directors" or "10% owners". The picture often changes completely. A month that looks like heavy insider selling can turn out to be two funds, with officers and directors doing very little.</p>` },
      ...(c.schedule13Shown ? [{ id: "large-holders", h: "What are Schedules 13D and 13G, and where are large holders listed?", html: `
<p>They are the statements a holder files with the SEC after coming to own more than ${c.holderThreshold}% of a class of a company's voting shares. Schedule 13D is the long form: it is due within five business days of passing ${c.holderThreshold}% and states, among other things, the purpose of the holding. Schedule 13G is a short form that passive investors and institutions such as index fund managers may use instead; its deadlines depend on the kind of holder. A holder amends its statement when the holding changes materially, and files a last one when it falls to ${c.holderThreshold}% or less.</p>
<p>A statement is not a Form 4. A Form 4 reports a trade: a date, a number of shares, a price. A Schedule 13D or 13G reports a position: how many shares the filer says it owned on the event date and what percent of the class that was. It does not say when or at what price the shares were bought or sold, and by the time anyone reads it the position may have changed. The two overlap only for the largest holders: one who passes 10% must file Form 4 for its trades as well.</p>
<p>On this site, a company's page has a section titled "Large holders: Schedules 13D and 13G" when a statement about the company is on record. It lists each holder's newest statement, largest stated percentage first, at most ${c.holderRows} rows, each with a link to the statement at the SEC. Three things to keep in mind when reading it:</p>
<ul>
<li><strong>It is not a full list of shareholders.</strong> The record starts with statements published from ${c.holderRecordStart} on. A holder that filed before then and has not filed since is not listed, and holders under ${c.holderThreshold}% never had to file.</li>
<li><strong>A row marked "below ${c.holderThreshold}%" is an exit notice.</strong> It is the holder reporting that it is no longer above the mark, sometimes with nothing left. It stays listed so that an older, larger figure is not left standing as the last word.</li>
<li><strong>Rows are not to be added together.</strong> Related entities often file one statement together, and each reports the whole group's holding. The row shows the largest figure any one of them states, and the name of the first, "with 3 other reporting persons". Two rows can also describe overlapping shares, for example a fund manager and its parent company.</li>
</ul>
<p>The same statements can be read from the filer's side. When the filer of a statement is an insider or a company with a page here, that page has a section titled "Large holdings this filer reports: Schedules 13D and 13G": its newest statement about each other company this site tracks. It is not a list of everything the filer owns, because only holdings above ${c.holderThreshold}% of a class are reported on these schedules.</p>
<p>The <a href="/large-holders/">large holders page</a> puts every holder's newest statement about a company on this site in one table, newest filing first. It can be narrowed by company or holder, industry, schedule, the percent the statement states (${c.holderThreshold}% or more, 10% or more, or below ${c.holderThreshold}%) and the filing window. A statement that states no percent passes no percent filter, the count line counts holders and companies and never adds shares or percentages together, and "Download these rows (CSV)" saves the rows that match, made in your browser.</p>
<p>None of these figures enters any buy or sell total, chart or the trade map. The rules are written out in the <a href="/methodology/#schedule-13">methodology</a>.</p>` }] : []),
    ],
    faqs: [
      { q: "What is a 10% owner on Form 4?", a: "A 10% owner is a person or fund that holds more than 10% of a class of a company's shares. They must report trades on Form 4 just as officers and directors do.", on: ["insiders"] },
      { q: "What does \"also in another filing\" mean?", a: `It means the same trade was reported on more than one Form 4, usually by related funds that own the shares together. Trades of ${c.jointMinUsd} or more are counted once in totals.`, on: ["insiders", "stocks"] },
      ...(c.schedule13Shown ? [{ q: "What is the difference between Schedule 13D and Schedule 13G?", a: `Both are ownership statements filed with the SEC by a holder of more than ${c.holderThreshold}% of a class of a company's voting shares. Schedule 13D is the long form and states the purpose of the holding. Schedule 13G is a short form for passive investors and institutions. Neither reports a trade: each says what the filer owned on a date.`, on: ["stocks" as const] }] : []),
      { q: "Why are the biggest insider sales by funds and not executives?", a: "Because funds that own more than 10% of a company hold far more stock than any executive, and selling down a stake is how a fund returns money to its own investors." },
    ],
    sources: [
      { name: "Securities Exchange Act § 16 (15 U.S.C. § 78p)", url: "https://www.law.cornell.edu/uscode/text/15/78p" },
      { name: "SEC Form 4 and instructions (joint and group filings)", url: FORM4 },
      { name: "SEC fact sheet: beneficial ownership reporting (Schedules 13D and 13G)", url: "https://www.sec.gov/files/33-11253-fact-sheet.pdf" },
    ],
    related: ["what-is-form-4", "insider-buying-vs-insider-selling", "insider-options-and-derivatives", "how-to-use-the-trade-map"],
    seeLive: [{ label: "Insider map by role", href: "/insiders/" }, { label: "How values are computed", href: "/methodology/#values" }],
    covers: ["web/src/lib/joint.ts", "web/src/components/TxnTable.astro", "web/src/lib/schedule13.ts", "web/src/lib/largeholders.ts", "web/src/components/LargeHolders.astro", "web/src/components/ReportedHoldings.astro"],
    ui: [{ text: "10% owners", on: "/insiders/" }, { text: "Officers", on: "/insiders/" }, { text: "Directors", on: "/insiders/" }, ...(c.schedule13Shown ? [{ text: "Large holders: Schedules 13D and 13G", on: "/stocks/nvda/" }] : [])],
    facts: [],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "form-8-k-company-events", group: "insiders", updated: "2026-11-22",
    title: "Form 8-K: what company event reports are",
    seoTitle: ["Form 8-K Explained: Company Event Reports and Their Items", "Form 8-K Explained: Company Event Reports"],
    description: ["A Form 8-K is a company's own report that something happened. What triggers one, the four-business-day deadline, the common items and how to read them.", "What a Form 8-K is, what triggers one, its deadline, the common items such as 2.02 and 5.02, and how to read them."],
    answer: `A Form 8-K is the report a public company files with the SEC when something specific happens, such as an earnings release, a major agreement or a change of officers. Most are due within four business days of the event, and each names the numbered items, with fixed SEC headings, that the event falls under.`,
    keyFacts: [
      "Most 8-K reports are due within four business days of the event; a few are due sooner.",
      "Each report names one or more numbered items, and the SEC fixes the heading of each item.",
      "Item 9.01 attaches financial statements and exhibits to another item, so it is on most reports.",
      "An amendment is filed as an 8-K/A; the form does not say which report it amends.",
      `This site lists the reports of the last ${c.eventWindowDays} days and their items. It does not read or summarise their text.`,
    ],
    sections: [
      { id: "what", h: "What is a Form 8-K?", html: `
<p>It is the "current report" of a public company: a short filing that tells the market, within days, about an event the SEC considers important to investors. The annual report (Form 10-K) and the quarterly report (Form 10-Q) arrive on a fixed calendar. An 8-K arrives when something happens, which is why a company can file several in one week and none for a quarter.</p>
<p>The report is the company's own statement. It is not a review by the SEC and it is not a judgement about whether the event is good or bad for anyone.</p>` },
      { id: "triggers", h: "What triggers a Form 8-K, and when is it due?", html: `
<p>Triggers are listed in the form as numbered items grouped into sections: business and operations, financial information, securities and trading markets, matters relating to accountants, corporate governance and management, and others. Examples are signing or ending a material agreement (Item 1.01 and Item 1.02), completing an acquisition (Item 2.01), publishing quarterly results (Item 2.02), a change of the auditor (Item 4.01), the departure or appointment of a director or certain officers (Item 5.02) and the results of a shareholder vote (Item 5.07).</p>
<p>Most items must be reported within four business days of the event. A few are due earlier or have their own rules. The text of a report usually carries the date of the event, and the filing date is within days of it. The <a href="/company-events/">company events list</a> shows the filing date and, in the CSV file, the event date the report states.</p>` },
      { id: "items", h: "Which items are the most common, and what do they mean?", html: ` 
<p>A handful of items account for most reports.</p>
${table(["Item", "SEC heading", "What it usually is"], [
  ["1.01", "Entry into a Material Definitive Agreement", "A significant contract, loan or merger agreement was signed."],
  ["2.02", "Results of Operations and Financial Condition", "The company announced results, often attached as a press release."],
  ["5.02", "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers", "A director or senior officer left or joined, or pay arrangements for named officers changed."],
  ["7.01", "Regulation FD Disclosure", "Information given to the public at once, such as an investor presentation."],
  ["8.01", "Other Events", "Anything the company considers important that no other item covers."],
  ["9.01", "Financial Statements and Exhibits", "The documents attached to another item: press releases, agreements, statements."],
])}
<p>Item 9.01 is on most reports because the exhibits of the other items are listed under it. For that reason the lists on this site print it last, in softer ink, and leave it out when they name the items a company files most often.</p>` },
      { id: "amendments", h: "What is an 8-K/A?", html: `
<p>An 8-K/A is an amendment: the company adds or corrects something in an earlier report, or files financial statements it was allowed to supply later. The form does not state which earlier report it amends, so this site shows an amendment as its own row, marked "amendment", and does not link it to any other.</p>` },
      { id: "site", h: "What does this site show about Form 8-K reports?", html: `
<p>Three things. A stock's page and its company's page have a section titled "Company events: Form 8-K reports" when the company has a report filed in the last ${c.eventWindowDays} days: a sentence with the count, the ${c.eventRows} newest reports with their filing and event dates and the SEC's heading for each item, a folded table of reports by item, and a link to each report at the SEC. The <a href="/company-events/">company events list</a> has every report filed in the last 12 months by any company with a page here, with filters for item, industry, form and date. And <a href="/downloads/">the CSV file</a> lists every report on record, with the item headings.</p>
<p>What the site does not do: it does not read, summarise or rate the text of a report, it does not call any report good or bad news, and it does not set a report beside any trade. A report and a trade on the same day can be a coincidence, a routine schedule or something else; a filing cannot say which.${c.eventsShown ? ' The rules are written out in the <a href="/methodology/#company-events">methodology</a>.' : ""}</p>` },
    ],
    faqs: [
      { q: "What is a Form 8-K?", a: "A Form 8-K is the report a public company files with the SEC when something specific happens, such as an earnings release, a major agreement or a change of officers. It is the company's own statement, filed within days of the event.", on: ["stocks"] },
      { q: "How soon after an event is a Form 8-K filed?", a: "Most items must be reported within four business days of the event, and a few are due sooner. The filing date is therefore close to the event date, which the report states.", on: ["stocks"] },
      { q: "What does Item 2.02 on a Form 8-K mean?", a: "Item 2.02 is titled Results of Operations and Financial Condition. A company files it when it announces results, usually with the earnings press release attached as an exhibit." },
      { q: "What does Item 5.02 on a Form 8-K mean?", a: "Item 5.02 covers the departure or election of directors, the appointment or departure of certain officers, and compensatory arrangements of certain officers. It is the item behind most announcements of a new chief executive or director." },
      { q: "Why is Item 9.01 on almost every Form 8-K?", a: "Item 9.01 lists the financial statements and exhibits attached to the report, such as a press release or an agreement. Because other items usually come with an exhibit, 9.01 is on most reports." },
      { q: "Does this site say whether a Form 8-K is good or bad news?", a: "No. The site lists each report, its dates and the SEC's headings for its items, and does not read or rate the text. A filing cannot show why an insider traded or whether the news moved a price." },
    ],
    sources: [
      { name: "Investor.gov: How to read an 8-K", url: "https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/how-read-8" },
      { name: "SEC: Form 8-K investor bulletin (PDF)", url: "https://www.sec.gov/files/readan8k.pdf" },
    ],
    related: ["what-is-form-4", "insider-buying-vs-insider-selling", "executive-pay-pay-versus-performance", "how-to-cite-and-reuse"],
    seeLive: [{ label: "Company events list", href: "/company-events/" }, ...(c.eventsShown ? [{ label: "How reports are counted", href: "/methodology/#company-events" }] : [])],
    covers: ["web/src/lib/events8k.ts", "web/src/components/CompanyEvents.astro", "shared/src/events8k.ts"],
    ui: c.eventsShown ? [{ text: "Company events: Form 8-K reports", on: "/stocks/nvda/" }, { text: "Reports by item, last 12 months", on: "/stocks/nvda/" }] : [],
    facts: [],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "executive-pay-pay-versus-performance", group: "insiders", updated: "2026-11-22",
    title: "Executive pay: the Pay Versus Performance table",
    seoTitle: ["Executive Pay Explained: The Pay Versus Performance Table", "Executive Pay: The Pay Versus Performance Table"],
    description: ["What the Pay Versus Performance table shows: total pay in the summary table, compensation actually paid, why it can be negative, and what the data cannot tell you.", "What the Pay Versus Performance table shows, why compensation actually paid can be negative, and the limits of the data."],
    answer: `The Pay Versus Performance table, in a company's annual proxy statement, gives for each fiscal year the principal executive officer's total pay in the Summary Compensation Table, a second figure called compensation actually paid, and averages for the other named executive officers. Compensation actually paid is a measure the SEC defines, and it is not the cash a person received.`,
    keyFacts: [
      "The table is required by Item 402(v) of Regulation S-K for fiscal years ending on or after December 16, 2022.",
      "Compensation actually paid revalues share awards each year, so it can be larger, smaller or negative compared with the summary total.",
      "The figures cover the principal executive officer and, as an average, the other named executive officers.",
      `This site shows the ${c.payYears} newest fiscal years a company has on file and marks figures of ${c.payLarge} or more.`,
      "The data names no person, and a company can be missing for reasons the data does not give.",
    ],
    sections: [
      { id: "what", h: "What is the Pay Versus Performance table?", html: `
<p>It is a table in the proxy statement, the document a company sends before its annual shareholder meeting. Since the SEC's 2022 rule it must show, year by year, how the pay of the company's top executives compares with the company's results. The rule is Item 402(v) of Regulation S-K and first applied to fiscal years ending on or after December 16, 2022, which for most companies meant the proxy statement of spring 2023.</p>
<p>This site shows only the pay columns, because those are the ones the SEC publishes as structured data. The other columns of the table, such as shareholder return and net income, are not part of this page.</p>` },
      { id: "figures", h: "What are the four figures?", html: `
${table(["Figure on this site", "What it is"], [
  ["Principal executive officer: total, Summary Compensation Table", "The total pay of the chief executive in the Summary Compensation Table: salary, bonus, the grant-date value of share awards and options, and other pay."],
  ["Principal executive officer: compensation actually paid", "The SEC's adjusted measure for the same person: the summary total changed to reflect the year's change in the value of share awards and pension benefits."],
  ["Other named executive officers, average: total", "The same Summary Compensation Table total, averaged over the other named executive officers, usually the next highest paid executives."],
  ["Other named executive officers, average: compensation actually paid", "The adjusted measure, averaged over the same group."],
])}
<p>All four are in dollars, as the company tagged them for the SEC. A dash on this site means the company did not tag that figure.</p>` },
      { id: "actually-paid", h: "What does \"compensation actually paid\" mean, and why can it be negative?", html: `
<p>It is an SEC-defined measure, not a payment. It starts from the Summary Compensation Table total and replaces the grant-date value of share awards and options with their value as it changed during the year, and it adjusts pension amounts. When a company's share price falls, awards granted earlier lose value, and the adjustment can outweigh the rest of the pay, so the figure can fall below the summary total and even below zero. When the share price rises it can be far higher.</p>
<p>So "actually paid" is not what a person took home in the year. Cash pay is part of it; much of the rest is a revaluation of awards the person may not yet have received and may never receive. Where a figure is negative this site prints it with a minus sign and does not change it.</p>` },
      { id: "site", h: "How does this site present the figures?", html: `
<p>A stock's page and its company's page have a section titled "Executive pay, as filed" when the company has figures on file. It is a table of the ${c.payYears} newest fiscal years, newest first, headed by the date each fiscal year ended, with a link to the filing each column came from. The <a href="/executive-pay/">executive pay list</a> has one row per company with its newest year, with filters for industry, fiscal year and the size of the principal executive officer's total, and every column can be sorted. <a href="/downloads/">The CSV file</a> has every fiscal year on file.</p>
<p>A figure of ${c.payLarge} or more, or a total of less than ${c.paySmall}, is marked with a small "a". The mark does not say the figure is wrong; it says the figure is unusual and worth checking against the filing, because a company can tag a number in the wrong scale. Nothing is held back, computed or converted.</p>` },
      { id: "limits", h: "What can this data not tell you?", html: `
<p>It cannot name the person: the data carries no name, and a principal executive officer's own page on this site never carries these figures. It cannot say why pay was set at a level or whether it was deserved; it is not a ranking of companies by pay quality and the site does not rate any company. It covers only companies that file the table in the structured data the SEC publishes, which is roughly four in ten of the companies with a page here. The rest are smaller reporting companies with a reduced disclosure, foreign companies and funds that do not file the table, or companies that tagged it differently.</p>
<p>A company that had two principal executives in a year may report them in separate columns, and the data can then hold one figure or none for that year. The table in the proxy statement is the authority.${c.execPayShown ? ' The rules are written out in the <a href="/methodology/#executive-pay">methodology</a>.' : ""}</p>` },
    ],
    faqs: [
      { q: "What is compensation actually paid?", a: "Compensation actually paid is a measure the SEC defines for the Pay Versus Performance table. It starts from the Summary Compensation Table total and revalues share awards and pension benefits for the year, so it is not the cash a person received.", on: ["stocks"] },
      { q: "Why can compensation actually paid be negative?", a: "When a company's share price falls, share awards granted in earlier years lose value, and the revaluation can be larger than the rest of the pay. The measure then falls below the summary total and can drop below zero." },
      { q: "Which companies have to file a Pay Versus Performance table?", a: "Companies that file a proxy statement with executive compensation disclosure, for fiscal years ending on or after December 16, 2022. Smaller reporting companies give a reduced version, and some kinds of filers are exempt. Not every company on this site has figures on file." },
      { q: "Does this site name the executive behind each figure?", a: "No. The data the site reads names no person, and the figures are shown for the company only. Nothing here says who received them." },
      { q: "Why is a company on this site missing executive pay figures?", a: "It may be exempt, it may have given a reduced version, its proxy statement may not be in the data yet, or it may have tagged the table in a way the data does not capture. The data does not say which." },
    ],
    sources: [
      { name: "SEC: Pay Versus Performance, final rule 34-95607 (PDF)", url: "https://www.sec.gov/rules/final/2022/34-95607.pdf" },
      { name: "Harvard Law School Forum on Corporate Governance: the SEC's pay versus performance rule", url: "https://corpgov.law.harvard.edu/?p=151133" },
    ],
    related: ["what-is-form-4", "form-8-k-company-events", "insider-buying-vs-insider-selling", "how-to-cite-and-reuse"],
    seeLive: [{ label: "Executive pay list", href: "/executive-pay/" }, ...(c.execPayShown ? [{ label: "How the figures are read", href: "/methodology/#executive-pay" }] : [])],
    covers: ["web/src/lib/execpay.ts", "web/src/components/ExecutivePay.astro", "shared/src/execpay.ts"],
    ui: c.execPayShown ? [{ text: "Executive pay, as filed", on: "/stocks/nvda/" }] : [],
    facts: [],
  }),

  // ─────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "form-13f-institutional-holdings", group: "insiders", updated: "2026-11-22",
    title: "Form 13F: what institutional managers report holding",
    seoTitle: ["Form 13F Explained: Institutional Holdings Reports", "Form 13F: Institutional Holdings"],
    description: ["Form 13F is the quarterly list of long positions held by large institutional managers. Who files, the $100 million rule, the 45-day delay and what it cannot show.", "Form 13F is the quarterly list of positions held by large institutional managers. Who files, the delay, and what it cannot show."],
    answer: "A Form 13F is a quarterly report in which an institutional investment manager that oversees at least $100 million in covered securities lists its long positions on the last day of the quarter. It is filed up to 45 days later, so it is a snapshot of the past, not a record of trades, and it does not show short positions.",
    keyFacts: [
      "Filed by managers with $100 million or more in 13(f) securities, within 45 days of each quarter end.",
      "Shows long positions on one day: no trade dates, no short positions, no options a manager wrote.",
      "A manager can request confidential treatment, which delays a position from appearing.",
      "Two managers can report the same shares, so sums across managers can count shares twice.",
      "It is not a Form 4 (an insider's trade) or a Schedule 13D or 13G (a holder of more than 5%).",
    ],
    sections: [
      { id: "who", h: "Who files a Form 13F?", html: `
<p>An institutional investment manager files one when it uses the mails or interstate commerce and exercises investment discretion over $100 million or more in what the SEC calls Section 13(f) securities. The test is made on the last trading day of each month, and a manager that passes it files for the quarter. Mutual fund companies, banks, insurers, pension funds, hedge funds and investment advisers are the usual filers.</p>
<p>The filer is the manager, not the fund. A large adviser can file one report covering the funds and accounts it runs, so the name on a 13F is often an adviser or a bank rather than a fund a retail investor would recognize.</p>` },
      { id: "what", h: "What does a 13F list, and what is left out?", html: `
<p>It lists long positions in 13(f) securities on the last day of the quarter: mainly U.S. exchange-traded stocks, closed-end funds and ETFs, plus certain convertible bonds, warrants and options. For each position it gives the issuer, the class, the number of shares or principal amount, and the value the manager reports.</p>
<p>Several things are not in it:</p>
<ul>
<li><strong>Short positions.</strong> They are not reported and are not netted against long positions.</li>
<li><strong>Trades.</strong> A 13F shows what was held on one day. It does not say when a position was bought or sold, or what happened between two quarter ends.</li>
<li><strong>Most other assets.</strong> Bonds, cash, open-end mutual funds, foreign shares that do not trade on a U.S. exchange, and private holdings are outside the list.</li>
<li><strong>Positions under confidential treatment.</strong> A manager can ask the SEC to keep a position out of public view for a period, so it appears later or in a changed filing.</li>
</ul>
<p>Put and call options a manager holds can be listed, and are marked as puts or calls in the filing. This site leaves them out of its share and value figures and says how many managers report them.</p>` },
      { id: "timing", h: "How old is the information?", html: `
<p>Up to 45 days older than the quarter, and often more. A filing is due within 45 days after the quarter ends, for example by mid-February for the fourth quarter. The positions are as of the last day of the quarter, so a report filed in mid-May describes March 31. A manager may have bought or sold a great deal since.</p>
<p>That is why a 13F is read for the shape of a holding over several quarters and not for what a manager is doing now.</p>` },
      { id: "vs", h: "How is a 13F different from Form 4 and Schedules 13D and 13G?", html: `
<p>Each answers a different question. A <a href="/guides/what-is-form-4/">Form 4</a> reports a trade by one of a company's own insiders, within two business days. A Schedule 13D or 13G reports that a holder has passed ${c.holderThreshold}% of a company's voting shares, and states the size of the stake on a date; see <a href="/guides/ten-percent-owners-and-joint-filings/">10% owners and joint filings</a> for how this site lists them. A Form 13F covers a whole portfolio, quarterly, for managers of any size above the threshold, and reports every position it holds in covered securities, however small a share of the company.</p>
<p>A manager can appear in all three: its 13F lists a position in a company, and the same company's Form 4s may show its own officers selling in the same quarter. The filings are separate records and say nothing about each other.</p>` },
      { id: "double", h: "Why can adding up the managers count shares twice?", html: `
<p>Because the same shares can be reported by more than one manager. An adviser that picks the investments and the fund company that holds them can each state the position, and a parent and its subsidiary can each file. Each report is correct as filed. Added together they overstate the total.</p>
<p>For that reason this site never says what share of a company managers hold. It states, for each company, how many managers reported it, the shares and value each reported, and a sum labelled as a sum of what managers reported.</p>` },
      ...(c.instShown ? [{ id: "on-site", h: "How does this site show Form 13F holdings?", html: `
<p>A stock's page and its company's page have a section titled "Institutional holders: Form 13F" when a manager reported the company for the newest quarter loaded, ${c.instPeriod}. It states how many managers reported the company, the summed reported value, and how many report put or call options, and lists the ${c.instTop} managers with the largest reported value: shares, reported value, shares for the quarter before and the change when both quarters are on file, the filing date and a link to the manager's filing at the SEC. A manager with no row for the earlier quarter reads "not reported for" that quarter; it is not called new, because a manager can hold a position and not report it.</p>
<p>The <a href="/institutional-holders/">institutional holders page</a> ranks the companies on this site by the number of managers reporting them and lists the largest managers by the value they report in these companies.</p>
<ul>
<li><strong>A quarter counts as loaded</strong> when at least ${c.instMinManagers} managers have filed for it, so a partial first week of filings is not shown as the whole.</li>
<li><strong>A stalled load hides the sections.</strong> They appear only while the newest filing in the newest quarter is at most ${c.instShownDays} days old.</li>
<li><strong>Only companies on this site</strong> are covered. A manager's figure here counts those companies, not its whole portfolio.</li>
</ul>
<p>The rules are written out in the <a href="/methodology/#institutional-holders">methodology</a>.</p>` }] : []),
    ],
    faqs: [
      { q: "What is a Form 13F?", a: "A Form 13F is a quarterly report that an institutional investment manager with $100 million or more in covered securities files with the SEC, listing its long positions on the last day of the quarter. It is filed up to 45 days after the quarter ends.", on: ["insiders", "stocks"] },
      { q: "Does a 13F show what a fund bought or sold?", a: "No. It shows what a manager held on one day. Comparing two quarters shows that a position grew or shrank, not when or at what price, and it says nothing about trades between those days.", on: ["insiders"] },
      { q: "Why is a 13F always out of date?", a: "Because it is filed up to 45 days after the quarter ends and describes the last day of the quarter. A filing made in mid-May describes March 31.", on: ["stocks"] },
      { q: "Are short positions in a 13F?", a: "No. Only long positions are reported, and they are not netted against short ones. Options a manager wrote are not reported either; put and call options it holds can be." },
      { q: "Is the 13F total the share of a company that institutions own?", a: "No. Two managers can report the same shares, so a sum can count them twice, and managers under the $100 million threshold do not file. This site states what each manager reported and never a share of the company." },
    ],
    sources: [
      { name: "SEC: Frequently asked questions about Form 13F", url: "https://www.sec.gov/divisions/investment/13ffaq" },
      { name: "SEC: Official list of Section 13(f) securities", url: "https://www.sec.gov/rules-regulations/staff-guidance/official-list-section-13f-securities" },
      { name: "SEC: Form 13F data sets", url: "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets" },
    ],
    related: ["what-is-form-4", "ten-percent-owners-and-joint-filings", "insider-buying-vs-insider-selling", "what-disclosure-data-cannot-tell-you"],
    seeLive: [{ label: "Institutional holders", href: "/institutional-holders/" }, { label: "How values are computed", href: "/methodology/#institutional-holders" }],
    covers: ["web/src/lib/inst13f.ts", "web/src/lib/inst13f-build.ts", "web/src/components/InstHolders.astro"],
    ui: c.instShown ? [{ text: "Institutional holders: Form 13F", on: "/stocks/nvda/" }] : [],
    facts: [],
  }),
];
