// Guides: corporate insider filings (SEC Form 4). See the rules at the top of congress.ts.
import type { Guide } from "./types";
import type { GuideCtx } from "./ctx";
import { ext, table } from "./html";

const U = "2026-10-08";
const FORM4 = "https://www.sec.gov/files/form4data.pdf";

export const insiderGuides: ((c: GuideCtx) => Guide)[] = [
  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "what-is-form-4", group: "insiders", updated: U,
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
<p>Form 4 filings for a tracked set of companies: about 70 large or heavily traded U.S. stocks, plus every stock that appears in a congressional trade report. That is ${c.counts.tickers} tickers and ${c.counts.insiderTxns} transactions today, not the whole market. Each row links to the filing on EDGAR.</p>
<p>The <a href="/insiders/">Insiders page</a> lists the newest filings and the <a href="/">trade map</a> shows where the dollars went.</p>` },
    ],
    faqs: [
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
    ],
    related: ["form-4-transaction-codes", "rule-10b5-1-trading-plans", "insider-buying-vs-insider-selling", "ten-percent-owners-and-joint-filings"],
    seeLive: [{ label: "Newest insider filings", href: "/insiders/" }, { label: "Stocks with insider activity", href: "/stocks/" }],
    covers: ["web/src/lib/flagship.ts#FORM4_DEADLINE_DAYS", "web/src/lib/flagship.ts#isLate"],
    ui: [],
    facts: ["foreignInsiders"],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  () => ({
    slug: "form-4-transaction-codes", group: "insiders", updated: U,
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
<p>Because nothing was paid. A grant (A) or a gift (G) has no purchase price, and some filings put a weighted average or a total in a footnote instead of the price box. Those rows show a dash for price and value here.</p>` },
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
    covers: ["ingest/src/sources/sec_form4.ts#codeToSide", "web/src/lib/vizdata.ts#isSignal", "web/src/lib/flagship.ts#sideLabel"],
    ui: [{ text: "Open-market", on: "/insiders/" }, { text: "All codes", on: "/insiders/" }],
    facts: [],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const r = c.facts.rule10b51;
    return {
      slug: "rule-10b5-1-trading-plans", group: "insiders", updated: U,
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
<p>The box applies to the whole filing, not to each row, and it has only existed since 2023, so older filings mention plans in footnotes or not at all. Treat the flag as reliable when present and its absence in an old filing as unknown.</p>` },
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
    covers: ["shared/src/tradevalue.ts", "web/src/lib/heatmap.ts#insiderRows", "web/src/lib/flagship.ts#sideLabel"],
    ui: [],
    facts: [],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "ten-percent-owners-and-joint-filings", group: "insiders", updated: U,
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
<p>Read one at a time they are all correct. Added together they multiply the trade. One real sale on this site once appeared under seven owners and summed to seven times its size.</p>` },
      { id: "rule", h: "How does this site avoid counting a trade twice?", html: `
<p>It treats Form 4 rows as one trade when the stock, the date, the code, the share count and the price all match across different filings, the holdings reported after the trade match too, and the trade is worth ${c.jointMinUsd} or more. The earliest filing keeps the trade. The others stay visible on each filer's own page, carry the flag "also in another filing", and are left out of totals and off the map.</p>
<p>The threshold is there because small identical trades do happen for real: two directors each buying 1,000 shares at the same price on the same day are two purchases.</p>
<p>The underlying filings are not changed; this is a rule for adding up, written out in the <a href="/methodology/#values">methodology</a>.</p>` },
      { id: "filter", h: "How can I look at executives only?", html: `
<p>Use the Role filter on the <a href="/insiders/">insider map</a>: "Officers", "Directors" or "10% owners". The picture often changes completely. A month that looks like heavy insider selling can turn out to be two funds, with officers and directors doing very little.</p>` },
    ],
    faqs: [
      { q: "What is a 10% owner on Form 4?", a: "A 10% owner is a person or fund that holds more than 10% of a class of a company's shares. They must report trades on Form 4 just as officers and directors do.", on: ["insiders"] },
      { q: "What does \"also in another filing\" mean?", a: `It means the same trade was reported on more than one Form 4, usually by related funds that own the shares together. Trades of ${c.jointMinUsd} or more are counted once in totals.`, on: ["insiders", "stocks"] },
      { q: "Why are the biggest insider sales by funds and not executives?", a: "Because funds that own more than 10% of a company hold far more stock than any executive, and selling down a stake is how a fund returns money to its own investors." },
    ],
    sources: [
      { name: "Securities Exchange Act § 16 (15 U.S.C. § 78p)", url: "https://www.law.cornell.edu/uscode/text/15/78p" },
      { name: "SEC Form 4 and instructions (joint and group filings)", url: FORM4 },
      { name: "SEC fact sheet: beneficial ownership reporting (Schedules 13D and 13G)", url: "https://www.sec.gov/files/33-11253-fact-sheet.pdf" },
    ],
    related: ["what-is-form-4", "insider-buying-vs-insider-selling", "insider-options-and-derivatives", "how-to-use-the-trade-map"],
    seeLive: [{ label: "Insider map by role", href: "/insiders/" }, { label: "How values are computed", href: "/methodology/#values" }],
    covers: ["web/src/lib/joint.ts", "web/src/components/TxnTable.astro"],
    ui: [{ text: "10% owners", on: "/insiders/" }, { text: "Officers", on: "/insiders/" }, { text: "Directors", on: "/insiders/" }],
    facts: [],
  }),
];
