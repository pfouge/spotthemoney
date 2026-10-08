// Guides: what members of Congress must disclose and how to read it. Reader: a retail investor.
// Rules of the road for every guide file: state what a filing shows, never why someone traded;
// no advice; numbers that the site computes or enforces come from GuideCtx, dated outside facts
// come from facts.ts; every outside claim has a primary source in `sources`.
import type { Guide } from "./types";
import type { GuideCtx } from "./ctx";
import { ext, table, longDate } from "./html";

const U = "2026-10-08";

export const congressGuides: ((c: GuideCtx) => Guide)[] = [
  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const b = c.facts.tradingBan, s = c.facts.stockAct, asOf = longDate(b.asOf);
    return {
      slug: "congress-stock-trading-rules", group: "congress", updated: U,
      title: "Can members of Congress trade stocks?",
      seoTitle: ["Can Members of Congress Trade Stocks? The Rules Explained", "Can Members of Congress Trade Stocks? The Rules"],
      description: ["Yes. Members of Congress may trade individual stocks but must report each trade over $1,000 within 45 days. What the STOCK Act requires and where a ban stands.", "Members of Congress may trade stocks but must report each trade within 45 days. What the STOCK Act requires and where a ban stands."],
      answer: `Yes. Members of Congress may buy and sell individual stocks, but the STOCK Act of 2012 requires them to report each trade over ${c.usd(s.thresholdUsd)} within ${c.congressDeadlineDays} days, and it confirms that insider-trading law applies to them. As of ${asOf}, no ban on members' stock trading has become law.`,
      keyFacts: [
        `Trades over ${c.usd(s.thresholdUsd)} must be reported within ${s.noticeDays} days of the member learning of the trade, and never later than ${c.congressDeadlineDays} days after it.`,
        "The rule covers trades by the member, their spouse and their dependent children.",
        `The standard penalty for a late report is a ${c.usd(s.lateFeeUsd)} fee.`,
        "Amounts are reported in ranges, not exact dollars.",
        `The House passed a bill restricting members' stock purchases on ${b.houseVote.date}; it did not advance in the Senate on ${b.senateVote.date}.`,
      ],
      sections: [
        { id: "legal", h: "Is it legal for members of Congress to trade stocks?", html: `
<p>Yes. No federal law stops a senator or representative from owning or trading individual stocks. What the law requires is disclosure: every purchase, sale or exchange of a stock, bond or similar security worth more than ${c.usd(s.thresholdUsd)} has to be reported in a public filing called a periodic transaction report, or PTR.</p>
<p>The rule comes from the ${ext("https://www.govinfo.gov/content/pkg/PLAW-112publ105/html/PLAW-112publ105.htm", "STOCK Act")} (the Stop Trading on Congressional Knowledge Act), signed in April 2012. The same law states that members and their staff are not exempt from insider-trading law: they owe a duty not to trade on important information that is not yet public and that they learned through their position.</p>` },
        { id: "what-must-be-reported", h: "What exactly must be reported, and how fast?", html: `
<p>A member must file a report within ${s.noticeDays} days of being told about a trade, and in no case later than ${c.congressDeadlineDays} days after the trade itself. The second limit is why you will see "${c.congressDeadlineDays} days" quoted as the deadline: a broker's statement can arrive late, but the outer limit does not move.</p>
<p>The report covers trades in accounts owned by the member, by their spouse, or by a dependent child. It lists the asset, whether it was bought or sold, the date, and a dollar range. It does not give the exact amount, the price, or the reason. Our guide to ${`<a href="/guides/how-to-read-a-congressional-trade-report/">reading a trade report</a>`} walks through one line by line.</p>
<p>Some holdings do not need a transaction report at all, including widely held mutual funds and exchange-traded funds, bank accounts and real estate. A member whose savings sit in index funds may never file one.</p>` },
        { id: "penalty", h: "What happens if a member reports late?", html: `
<p>The usual consequence is a ${c.usd(s.lateFeeUsd)} late fee, charged when a report arrives more than ${s.lateFeeAfterDays} days past its due date. The ethics committee of the member's chamber can waive the fee in unusual circumstances. Knowingly failing to file, or filing something false, can bring a much larger civil penalty.</p>
<p>This site marks a trade as late when the report was filed more than ${c.congressDeadlineDays} days after the trade. See ${`<a href="/guides/late-congressional-trade-disclosures/">late disclosures</a>`} for how the count works and what it does not show.</p>` },
        { id: "ban", h: "Has Congress banned its members from trading stocks?", html: `
<p>No. As of ${asOf}, no ban or restriction on members' stock trading has been enacted.</p>
<p>The closest any bill has come is the ${b.billName}. The House passed it on ${b.houseVote.date} by ${b.houseVote.yeas} to ${b.houseVote.nays} (${ext(b.houseVote.url, "House roll call")}). On ${b.senateVote.date} the Senate voted ${b.senateVote.yeas} to ${b.senateVote.nays} on a motion to take the bill up, short of the ${b.senateVote.needed} votes needed (${ext(b.senateVote.url, "Senate roll call")}), so it did not move forward. Several other proposals, some stricter, have been introduced in both chambers and remain in committee.</p>
<p>Until a bill is signed into law, the rules described on this page are the rules in force.</p>` },
        { id: "debate", h: "Why do some people want a ban, and why do others oppose one?", html: `
<p>Supporters of a ban argue that members vote on laws, sit on committees and receive briefings that can move share prices, so even well-timed legal trades damage public trust. In their view disclosure after the fact is too slow and the ${c.usd(s.lateFeeUsd)} fee too small to matter, and the simplest fix is to keep members out of individual stocks altogether.</p>
<p>Opponents argue that members already face insider-trading law and public disclosure, that a ban would deter people with business or investing experience from running for office, and that forcing sales could impose real costs on families whose wealth was built before taking office. Others support restrictions in principle but disagree about the details: whether spouses are covered, whether existing holdings can be kept, and how blind trusts should work.</p>
<p>This site takes no side. It shows the filings so you can read them yourself.</p>` },
        { id: "where", h: "Where can I see the trades?", html: `
<p>On this site, the <a href="/congress/">Congress page</a> lists the newest reports, each member has a page with their trades, and the <a href="/">trade map</a> shows which stocks members bought and sold over a period you choose. There are ${c.counts.congressTxns} congressional trades on record here from ${c.counts.members} members. Every row links to the original document.</p>
<p>The official sources are the ${ext("https://disclosures-clerk.house.gov/FinancialDisclosure", "House Clerk's disclosure site")} and the Senate's ${ext("https://efdsearch.senate.gov/search/home/", "eFD search")}.</p>` },
      ],
      faqs: [
        { q: "Can members of Congress legally buy and sell stocks?", a: `Yes. Members of Congress may trade individual stocks. The STOCK Act requires them to report each trade over ${c.usd(s.thresholdUsd)} within ${c.congressDeadlineDays} days and confirms that insider-trading law applies to them.`, on: ["congress"] },
        { q: "Has Congress passed a stock trading ban?", a: `No. As of ${asOf}, no ban has become law. The House passed the ${b.billName} on ${b.houseVote.date}, but a Senate vote to take it up fell short on ${b.senateVote.date}.`, on: ["congress"] },
        { q: "Do spouses of members of Congress have to report trades?", a: "Yes. A member's report covers trades in assets owned by the member, their spouse or a dependent child, and each row says whose asset it was." },
        { q: "What is the penalty for a late congressional stock disclosure?", a: `The standard penalty is a ${c.usd(s.lateFeeUsd)} late fee for a report filed more than ${s.lateFeeAfterDays} days past its due date. The chamber's ethics committee may waive it in unusual circumstances.` },
      ],
      sources: [
        { name: "STOCK Act, Public Law 112-105 (full text)", url: "https://www.govinfo.gov/content/pkg/PLAW-112publ105/html/PLAW-112publ105.htm" },
        { name: "5 U.S.C. § 13105, filing of reports (the 30/45-day rule is subsection (l))", url: "https://www.law.cornell.edu/uscode/text/5/13105" },
        { name: "5 U.S.C. § 13106, late fee and penalties", url: "https://www.law.cornell.edu/uscode/text/5/13106" },
        { name: "House Committee on Ethics, financial disclosure", url: "https://ethics.house.gov/financial-disclosure/" },
        { name: "House vote on H.R. 7008, July 22, 2026", url: b.houseVote.url },
        { name: "Senate vote on H.R. 7008, September 30, 2026", url: b.senateVote.url },
      ],
      related: ["how-to-read-a-congressional-trade-report", "late-congressional-trade-disclosures", "congress-trade-amount-ranges", "what-disclosure-data-cannot-tell-you"],
      seeLive: [{ label: "Newest congressional trades", href: "/congress/" }, { label: "Trade map", href: "/" }],
      covers: ["web/src/lib/flagship.ts#CONGRESS_DEADLINE_DAYS"],
      ui: [],
      facts: ["tradingBan", "stockAct"],
    };
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "how-to-read-a-congressional-trade-report", group: "congress", updated: U,
    title: "How to read a congressional trade report",
    seoTitle: ["How to Read a Congressional Stock Trade Report (PTR)", "How to Read a Congressional Trade Report"],
    description: ["A periodic transaction report lists the asset, owner, type, trade date, filing date and a dollar range. What each column means, with the House and Senate codes.", "What each column of a congressional trade report means: owner, type, dates and the dollar range, with House and Senate codes."],
    answer: "A periodic transaction report (PTR) is the form a member of Congress files after trading a security. Each row gives the owner, the asset, whether it was bought or sold, the trade date and a dollar range; it never gives the exact amount, the price paid or the reason.",
    keyFacts: [
      "Owner tells you whose asset it was: the member, the spouse, a dependent child, or held jointly.",
      "Type is purchase, sale (full or partial) or exchange.",
      "Two dates matter: when the trade happened and when it was reported.",
      "The amount is one of ten fixed ranges, starting at $1,001–$15,000.",
      "Each row on this site links to the original filing.",
    ],
    sections: [
      { id: "what-is-a-ptr", h: "What is a periodic transaction report?", html: `
<p>A periodic transaction report is the public form a member of Congress files to disclose a trade in a stock, bond or similar security. House members file with the Clerk of the House; senators file with the Senate's electronic disclosure system. One report can list one trade or dozens.</p>
<p>The reports are separate from the annual financial disclosure, which lists what a member owns and owes once a year. A PTR records a change: something was bought, sold or swapped.</p>` },
      { id: "columns", h: "What does each column mean?", html: `
${table(["Column", "What it tells you"], [
  ["Owner", "Whose asset it was. House reports use SP (spouse), DC (dependent child) and JT (joint); a blank means the member. Senate reports spell it out: Self, Spouse, Joint or Child."],
  ["Asset", "The name of the security, usually with a ticker symbol. Some rows have no ticker: bonds, private funds and other assets."],
  ["Type", "House: P (purchase), S (sale) or S (partial). Senate: Purchase, Sale (Full), Sale (Partial) or Exchange. An exchange is a swap, most often after a merger."],
  ["Transaction date", "The day the trade happened."],
  ["Notification date", "House reports only: the day the member says they learned of the trade."],
  ["Amount", "A dollar range, not an exact figure."],
])}
<p>On this site the same fields appear in each member's table as Security, Side, Trade date, Disclosed, Lag, Value and Flags, with a link to the source document in the last column.</p>` },
      { id: "dates", h: "Which date should I look at?", html: `
<p>Both, because the gap between them is the point. The trade date tells you when the member bought or sold. The disclosed date tells you when the public could first know. A member has up to ${c.congressDeadlineDays} days, so a trade you are reading about today may be six weeks old.</p>
<p>The Lag column on this site is the number of days between the two. When it is more than ${c.congressDeadlineDays}, the row carries a "late" flag. See ${`<a href="/guides/late-congressional-trade-disclosures/">late disclosures</a>`}.</p>
<p>The trade map counts a trade in the period when it was <em>disclosed</em>, not when it happened, so the 30-day view shows what became public in the last 30 days.</p>` },
      { id: "amounts", h: "Why is the amount a range?", html: `
<p>Because the law asks for a range. The form offers ten brackets, from $1,001–$15,000 up to over $50,000,000, and the member ticks one. A row marked $15,001–$50,000 could be a $16,000 trade or a $49,000 trade; nothing in the filing says which.</p>
<p>That has consequences for any total you see, here or elsewhere. Our guide to ${`<a href="/guides/congress-trade-amount-ranges/">amount ranges</a>`} explains how this site adds them up.</p>` },
      { id: "missing", h: "What is not in the report?", html: `
<p>The report does not give the share count, the price, the profit or loss, or the reason for the trade. It does not say whether the member chose the trade personally or whether an adviser did. It does not show what the member still holds; that is in the annual disclosure.</p>
<p>It also says nothing about what the member knew. A purchase before good news is a fact about timing, not evidence of anything else.</p>` },
      { id: "amendments", h: "What if a report is corrected?", html: `
<p>Members can file an amendment that replaces an earlier report. When a Senate amendment replaces a report on this site, the earlier version's rows are removed so the trade is not counted twice.</p>
<p>Reports filed on paper or as scanned images cannot be read automatically. This site holds them until a person has transcribed them${c.heldPaper ? ` (${c.heldPaper} are waiting now)` : ""}, so a member who files on paper may show fewer trades here than they reported. The <a href="/methodology/#coverage">coverage section</a> of the methodology gives the current counts.</p>` },
    ],
    faqs: [
      { q: "What does SP mean on a congressional trade report?", a: "SP means the asset belongs to the member's spouse. House reports also use DC for a dependent child and JT for a joint holding; a blank owner means the member.", on: ["congress"] },
      { q: "What is a PTR in Congress?", a: "A PTR is a periodic transaction report, the public form a member of Congress files after buying, selling or exchanging a security worth more than $1,000." },
      { q: "Do congressional trade reports show how many shares were traded?", a: "No. A report gives a dollar range and the trade date. It does not give the number of shares, the price or the profit." },
      { q: "Why do some congressional trades have no ticker?", a: "Because the asset is not a listed stock. Bonds, private funds and other assets are reported by name only, so they appear in a member's table but not on the trade map, which is organised by ticker." },
    ],
    sources: [
      { name: "House periodic transaction report form and instructions", url: "https://ethics.house.gov/wp-content/uploads/2026/02/Final-CY-2025-PTR-Form-1.pdf" },
      { name: "Senate Select Committee on Ethics, financial disclosure instructions", url: "https://www.ethics.senate.gov/public/_cache/files/acfec831-2c03-4c3b-a020-e914de75a5b0/cy25-fd-instructions.pdf" },
      { name: "House Clerk, financial disclosure reports", url: "https://disclosures-clerk.house.gov/FinancialDisclosure" },
      { name: "Senate eFD search", url: "https://efdsearch.senate.gov/search/home/" },
    ],
    related: ["congress-stock-trading-rules", "congress-trade-amount-ranges", "late-congressional-trade-disclosures", "house-and-senate-disclosure-differences"],
    seeLive: [{ label: "Congress trades, newest first", href: "/congress/" }, { label: "What is covered and what is not", href: "/methodology/#coverage" }],
    covers: ["web/src/components/TxnTable.astro", "ingest/py/senate_import.py"],
    ui: [{ text: "Trade date", on: "/congress/" }, { text: "Disclosed", on: "/congress/" }, { text: "Lag", on: "/congress/" }],
    facts: ["stockAct"],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "congress-trade-amount-ranges", group: "congress", updated: U,
    title: "Why congressional trade amounts are ranges",
    seoTitle: ["Why Congressional Trade Amounts Are Ranges, Not Dollars", "Why Congressional Trade Amounts Are Ranges"],
    description: ["Members of Congress report each trade in one of ten dollar ranges, from $1,001–$15,000 to over $50 million. How to read the ranges and how totals are built.", "Congress reports trades in ten dollar ranges, not exact amounts. How to read them and how totals are built from them."],
    answer: "Members of Congress report each trade as one of ten dollar ranges, such as $1,001–$15,000, because the disclosure law asks for a range and not an exact figure. Any dollar total built from these reports is therefore an estimate, and on this site the trade map and charts use the top of each range.",
    keyFacts: [
      "There are ten ranges; the lowest is $1,001–$15,000 and the highest is over $50,000,000.",
      "The widest gap between bottom and top is fifteen-fold.",
      "Tables on this site show the range exactly as filed.",
      "The trade map and charts add up the top of each range, and say so.",
    ],
    sections: [
      { id: "the-ranges", h: "What are the ranges?", html: `
${table(["Range on the form", "Top of range used in totals here"], [
  ["$1,001 – $15,000", "$15,000"], ["$15,001 – $50,000", "$50,000"], ["$50,001 – $100,000", "$100,000"], ["$100,001 – $250,000", "$250,000"],
  ["$250,001 – $500,000", "$500,000"], ["$500,001 – $1,000,000", "$1,000,000"], ["$1,000,001 – $5,000,000", "$5,000,000"],
  ["$5,000,001 – $25,000,000", "$25,000,000"], ["$25,000,001 – $50,000,000", "$50,000,000"], ["Over $50,000,000", "No top is stated"],
])}
<p>There is one more box, used only for an asset owned solely by a spouse or dependent child: "over $1,000,000", with no upper brackets.</p>` },
      { id: "why", h: "Why not exact amounts?", html: `
<p>Because the disclosure law asks for a category of value, not a figure. Financial disclosure for federal officials has worked this way since long before the STOCK Act: the forms show the scale of a holding or a trade, not a household's exact finances. The STOCK Act added speed (reports within ${c.congressDeadlineDays} days) and kept the ranges.</p>` },
      { id: "totals", h: "How does this site turn ranges into totals?", html: `
<p>In tables, it does not: each row shows the range as filed. For the <a href="/">trade map</a> and the charts, where trades have to be added together, the site uses the top of each range. A trade reported as $15,001–$50,000 counts as $50,000.</p>
<p>That choice is stated next to each chart, and it means totals here are upper estimates. A member whose page shows $2 million of purchases reported trades whose ranges top out at $2 million; the true figure is somewhere between the bottoms and the tops, and is usually well below the top.</p>
<p>Other sites use the midpoint or the bottom. None of these is the "real" number, which is not public. Comparing members on the same basis is sound; comparing a top-of-range total here with a midpoint total somewhere else is not.</p>` },
      { id: "compare", h: "Can I compare Congress with corporate insiders?", html: `
<p>Only roughly. Corporate insiders report exact share counts and prices on <a href="/guides/what-is-form-4/">Form 4</a>, so their dollar figures are precise. Congressional figures are tops of ranges. The site keeps the two apart for that reason: on the combined map the tooltip shows the Congress and insider amounts separately.</p>` },
    ],
    faqs: [
      { q: "Why are congressional stock trades reported in ranges?", a: "Because federal disclosure law asks officials to report the value of a trade in a category, not an exact figure. The form has ten ranges, from $1,001–$15,000 to over $50,000,000.", on: ["congress"] },
      { q: "How are dollar totals for Congress calculated on Spot the Money?", a: "The trade map and charts add up the top of each reported range, so totals are upper estimates. Tables show each range exactly as filed.", on: ["congress", "stocks"] },
      { q: "What is the smallest congressional trade that must be reported?", a: "A trade must be reported when it is worth more than $1,000. The lowest range on the form is $1,001–$15,000." },
    ],
    sources: [
      { name: "House periodic transaction report form (the ten ranges)", url: "https://ethics.house.gov/wp-content/uploads/2026/02/Final-CY-2025-PTR-Form-1.pdf" },
      { name: "5 U.S.C. § 13104, contents of reports", url: "https://www.law.cornell.edu/uscode/text/5/13104" },
    ],
    related: ["how-to-read-a-congressional-trade-report", "how-to-use-the-trade-map", "what-disclosure-data-cannot-tell-you"],
    seeLive: [{ label: "Trade map", href: "/" }, { label: "How values are computed", href: "/methodology/#values" }],
    covers: ["web/src/lib/heatmap.ts", "web/src/lib/flagship.ts#amountLabel"],
    ui: [],
    facts: ["stockAct"],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const s = c.facts.stockAct;
    return {
      slug: "late-congressional-trade-disclosures", group: "congress", updated: U,
      title: "Late congressional trade disclosures",
      seoTitle: ["Late Congressional Stock Disclosures: The 45-Day Rule", "Late Congressional Stock Disclosures Explained"],
      description: [`A congressional trade is late when it is reported more than ${c.congressDeadlineDays} days after it happened. How the deadline works, the $200 fee, and how lateness is counted.`, "When a congressional trade report is late, what the penalty is, and how lateness is counted."],
      answer: `A congressional trade report is late when it is filed more than ${c.congressDeadlineDays} days after the trade. The standard penalty is a ${c.usd(s.lateFeeUsd)} fee, and this site flags every late row and shows the number of days each trade took to report.`,
      keyFacts: [
        `The law gives ${s.noticeDays} days from learning of a trade, and at most ${c.congressDeadlineDays} days from the trade.`,
        `This site measures from the trade date to the filing date and flags anything over ${c.congressDeadlineDays} days.`,
        `The fee is ${c.usd(s.lateFeeUsd)} and can be waived by the chamber's ethics committee.`,
        "A late report is a paperwork failure; on its own it says nothing about the trade.",
      ],
      sections: [
        { id: "deadline", h: "What is the deadline?", html: `
<p>A member must report a trade within ${s.noticeDays} days of being notified of it, and no later than ${c.congressDeadlineDays} days after the trade. No extensions are available for these reports.</p>
<p>The two limits exist because members do not always place their own trades. A spouse or a money manager may trade, and the member finds out when a statement arrives. The ${s.noticeDays}-day clock starts then; the ${c.congressDeadlineDays}-day limit applies regardless.</p>` },
        { id: "how-counted", h: "How does this site decide a trade is late?", html: `
<p>It subtracts the trade date from the filing date. If the result is more than ${c.congressDeadlineDays} days, the row gets a "late" flag and the member's page counts it. The number itself is shown on every row in the Lag column.</p>
<p>This is the outer limit of the law, so the flag is conservative: a member who learned of a trade on day one and filed on day 40 broke the ${s.noticeDays}-day rule, but the public record does not always say when they learned of it, so the site does not flag it.</p>
<p>Rows from an amended Senate report carry no lag, because the gap would be measured to the date of the correction and not to the original filing.</p>` },
        { id: "penalty", h: "What is the penalty?", html: `
<p>A ${c.usd(s.lateFeeUsd)} fee, owed when a report is more than ${s.lateFeeAfterDays} days past due. The ethics committee of the member's chamber may waive it in extraordinary circumstances. Fee payments and waivers are not published trade by trade, so this site cannot tell you whether a particular late report was fined.</p>` },
        { id: "meaning", h: "Does a late report mean something improper happened?", html: `
<p>Not by itself. Reports are late for dull reasons: a broker's statement that arrived slowly, a trade in a spouse's account, a staff error. They can also be late for reasons the public would care about. The filing does not say which.</p>
<p>What a pattern of late reports does show is how seriously an office treats the disclosure rule. A member with one late row out of two hundred and a member who is late on most of them are telling you different things, and the <a href="/congress/">Congress page</a> lets you compare.</p>` },
        { id: "why-old", h: "Why are the newest trades already weeks old?", html: `
<p>Because of the deadline itself. A trade made today can lawfully stay private for ${c.congressDeadlineDays} days. So the newest disclosures you see are trades from the last month or two, and the most recent few weeks of trading are always incomplete. This is why the trade map counts by disclosure date: a 30-day view by trade date would miss most of what will eventually be reported.</p>` },
      ],
      faqs: [
        { q: "How long do members of Congress have to report a stock trade?", a: `They have ${s.noticeDays} days from being notified of the trade, and never more than ${c.congressDeadlineDays} days from the trade itself.`, on: ["congress"] },
        { q: "What does the late flag mean on Spot the Money?", a: `It means the report was filed more than ${c.congressDeadlineDays} days after the trade date. For corporate insiders the flag means a Form 4 filed more than ${c.form4LateAfterDays} days after the trade.`, on: ["congress", "stocks"] },
        { q: "Is a late congressional stock disclosure illegal?", a: `It breaks the STOCK Act's deadline and normally carries a ${c.usd(s.lateFeeUsd)} late fee. It is not, by itself, evidence of insider trading.` },
      ],
      sources: [
        { name: "5 U.S.C. § 13105(l), the 30/45-day rule", url: "https://www.law.cornell.edu/uscode/text/5/13105" },
        { name: "5 U.S.C. § 13106(d), the late fee", url: "https://www.law.cornell.edu/uscode/text/5/13106" },
        { name: "House Committee on Ethics, late fee waiver form", url: "https://ethics.house.gov/wp-content/uploads/2024/11/Late-Fee-Waiver-form-final.pdf" },
      ],
      related: ["congress-stock-trading-rules", "how-to-read-a-congressional-trade-report", "what-disclosure-data-cannot-tell-you"],
      seeLive: [{ label: "Congress trades with days-to-report", href: "/congress/" }, { label: "Lag and late rules", href: "/methodology/#lag" }],
      covers: ["web/src/lib/flagship.ts#isLate", "web/src/lib/flagship.ts#CONGRESS_DEADLINE_DAYS", "web/src/lib/flagship.ts#FORM4_DEADLINE_DAYS"],
      ui: [{ text: "Lag", on: "/congress/" }],
      facts: ["stockAct"],
    };
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "house-and-senate-disclosure-differences", group: "congress", updated: U,
    title: "House and Senate disclosures: how they differ",
    seoTitle: ["House vs Senate Stock Trade Disclosures: The Differences", "House vs Senate Stock Disclosures"],
    description: ["House and Senate members follow the same trade-reporting law but file in different systems. How the two differ, and how each reaches this site.", "House and Senate members follow the same law but file trades in different systems. How the two differ."],
    answer: `House and Senate members follow the same law and the same ${c.congressDeadlineDays}-day deadline, but they file in two different systems with different formats. On this site House reports are read every day from the Clerk's PDFs, while Senate reports are added in batches because the Senate's site does not allow automated readers.`,
    keyFacts: [
      "Same law, same ranges, same deadline in both chambers.",
      "House reports are PDF documents; Senate reports are web pages.",
      "House reports arrive here daily; Senate reports arrive in batches.",
      "Paper and scanned filings in either chamber are held until read by hand.",
    ],
    sections: [
      { id: "same", h: "What is the same in both chambers?", html: `
<p>The law. A senator and a representative both report trades over $1,000 within ${c.congressDeadlineDays} days, in the same ten dollar ranges, covering their own, their spouse's and their dependent children's assets. See ${`<a href="/guides/congress-stock-trading-rules/">the rules</a>`}.</p>` },
      { id: "different", h: "What is different?", html: `
${table(["", "House", "Senate"], [
  ["Where reports are published", ext("https://disclosures-clerk.house.gov/FinancialDisclosure", "Clerk of the House"), ext("https://efdsearch.senate.gov/search/home/", "Senate eFD")],
  ["Format", "PDF document", "Web page (paper filings are scanned images)"],
  ["Owner labels", "SP, DC, JT, or blank", "Self, Spouse, Joint, Child"],
  ["Trade types", "P, S, S (partial)", "Purchase, Sale (Full), Sale (Partial), Exchange"],
  ["Access", "Open", "Visitors must first accept an agreement on how the reports may be used"],
  ["On this site", "Read daily", "Added in batches"],
])}` },
      { id: "senate-batches", h: "Why do Senate trades arrive in batches here?", html: `
<p>Because the Senate's disclosure site turns away automated readers, and this site does not disguise its reader as a person's browser. Senate reports are instead opened in an ordinary browser by a person, saved, and loaded from those saved copies. The result is the same data, arriving every so often and not every morning.</p>
<p>${c.hasSenate ? "Senate reports are on the site now." : "No Senate report has been loaded yet."} The <a href="/methodology/#coverage">coverage section</a> shows how many reports from each chamber are on file and through what date. If you need the very latest Senate filing, check the Senate's own search.</p>` },
      { id: "paper", h: "What about paper filings?", html: `
<p>Both chambers still accept some reports on paper. These are published as scanned images with no readable text. This site stores them but shows no trades from them until a person has typed them in${c.heldPaper ? `; ${c.heldPaper} are waiting now` : ""}. A member who files on paper will therefore look less active here than their filings show.</p>` },
      { id: "former", h: "What happens when a member leaves office?", html: `
<p>Their reports stay on this site, attached to their own page, with the dates of their term. A seat that changes hands does not change who filed what: reports filed by a former member are never moved to their successor.</p>` },
    ],
    faqs: [
      { q: "Are Senate stock trades included on Spot the Money?", a: c.hasSenate ? "Yes. Senate periodic transaction reports are included and are added in batches, because the Senate's site does not allow automated readers. House reports are read daily." : "Not yet. The Senate's site does not allow automated readers, so Senate reports are being added in batches by hand. House reports are read daily.", on: ["congress"] },
      { q: "Do senators and House members follow the same stock trading rules?", a: `Yes. Both report trades over $1,000 within ${c.congressDeadlineDays} days, in the same dollar ranges. They file in different systems, so the forms look different.` },
      { q: "Why does a member show fewer trades here than on their filing?", a: "The most common reason is a paper or scanned filing, which cannot be read automatically and is held until a person transcribes it. Rows without a ticker also stay off the trade map." },
    ],
    sources: [
      { name: "House Clerk, financial disclosure reports", url: "https://disclosures-clerk.house.gov/FinancialDisclosure" },
      { name: "Senate eFD search", url: "https://efdsearch.senate.gov/search/home/" },
      { name: "5 U.S.C. § 13107, public access to reports and limits on their use", url: "https://www.law.cornell.edu/uscode/text/5/13107" },
    ],
    related: ["how-to-read-a-congressional-trade-report", "congress-stock-trading-rules", "what-disclosure-data-cannot-tell-you"],
    seeLive: [{ label: "Coverage by chamber", href: "/methodology/#coverage" }, { label: "Congress trades", href: "/congress/" }],
    covers: ["ingest/py/senate_import.py", "ingest/py/congress_ptr_job.py", "web/src/lib/coverage.ts"],
    ui: [],
    facts: [],
  }),
];
