// Guides: campaign donations, lobbying, federal contracts. See the rules at the top of congress.ts.
import type { Guide } from "./types";
import type { GuideCtx } from "./ctx";
import { ext, table } from "./html";

const U = "2026-10-08";

export const washingtonGuides: ((c: GuideCtx) => Guide)[] = [
  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const f = c.facts.fecLimits;
    return {
      slug: "campaign-donations-fec-data", group: "washington", updated: "2026-11-23",
      title: "Campaign donations: how to read FEC data",
      seoTitle: ["Campaign Donations Explained: How to Read FEC Data", "How to Read FEC Campaign Donation Data"],
      description: [`Federal campaigns must list every donor who gives over ${c.usd(f.itemizeOverUsd)}. What FEC records show, why companies cannot donate, and what an "employer" total means.`, "What FEC campaign donation records show, why companies cannot donate directly, and what an employer total means."],
      answer: `Federal campaigns and political committees must report their donors to the Federal Election Commission (FEC), naming everyone who gives more than ${c.usd(f.itemizeOverUsd)}. Companies cannot give to candidates directly, so a company's "donations" on any website are the combined gifts of people who listed that company as their employer.`,
      keyFacts: [
        `Donors above ${c.usd(f.itemizeOverUsd)} are listed by name, with their employer and occupation.`,
        `An individual may give a candidate ${c.usd(f.perElectionToCandidateUsd)} per election in ${f.cycle}.`,
        "Corporations and unions may not give to federal candidates from their own funds.",
        "Reports are filed quarterly or monthly, so donations appear weeks or months later.",
        "This site shows totals by committee, employer and state, never individual donors.",
      ],
      sections: [
        { id: "what", h: "What do campaigns have to disclose?", html: `
<p>Every committee that raises money for a federal election files regular reports with the ${ext("https://www.fec.gov/data/", "FEC")}. The reports list money in and money out. On the money-in side, any person whose gifts to that committee add up to more than ${c.usd(f.itemizeOverUsd)} is "itemized": named, with their address, occupation, employer, the date and the amount.</p>
<p>Smaller gifts are reported only as a lump sum. That is why donor records skew towards larger givers: a campaign funded by many small gifts has few names to show.</p>` },
        { id: "limits", h: "How much can one person give?", html: `
<p>For the ${f.cycle} election cycle an individual may give ${c.usd(f.perElectionToCandidateUsd)} per election to a candidate (the primary and the general count separately), ${c.usd(f.perYearToPacUsd)} a year to a political action committee, and ${c.usd(f.perYearToNationalPartyUsd)} a year to a national party committee. The candidate and party limits are raised for inflation every two years; the ${ext(f.source, "FEC's chart")} has the current figures.</p>` },
        { id: "companies", h: "Can companies donate to candidates?", html: `
<p>No. Federal law bars corporations and labor unions from giving their own money to federal candidates (${ext("https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/who-can-and-cant-contribute/", "who can and can't contribute")}). A company can sponsor a political action committee, funded by voluntary gifts from its employees and shareholders, and that committee can give within its own limits.</p>
<p>So when a table says "Acme Corp: $400,000", it means people who wrote "Acme Corp" in the employer box gave $400,000 between them. It is a fact about where donors work. It is not company money and not a decision by the company.</p>
<p>Employer names are typed by donors, so the same employer appears under many spellings, and "retired", "self-employed" and "not employed" are among the largest "employers" in any list.</p>` },
        { id: "committees", h: "What kinds of committees are there?", html: `
${table(["Type", "What it is"], [
  ["Principal campaign committee", "The one official committee of a candidate. Its name includes the candidate's name."],
  ["PAC sponsored by a company, union or trade group", "Raises money only from people connected to its sponsor and gives to candidates within limits."],
  ["Non-connected PAC", "Has no sponsor and may ask the general public for money."],
  ["Super PAC", "May take unlimited sums, including from companies and unions, but may not give to candidates; it spends independently."],
  ["Conduit", "A platform that passes each donor's gift on to the committee the donor chose. ActBlue is the best-known example."],
])}
<p>Conduits matter when reading totals: the same dollar can appear once at the conduit and again at the campaign that finally received it.</p>` },
        { id: "lag", h: "How current is the data?", html: `
<p>Not very. House and Senate campaigns report quarterly, due on the 15th of April, July and October and at the end of January, with extra reports close to an election. Many PACs and parties report monthly. A gift made at the start of a quarter can take about three and a half months to become public.</p>` },
        { id: "independent-expenditures", h: "What is an independent expenditure?", html: `
<p>An independent expenditure is money a person or group spends on a communication that expressly advocates the election or defeat of a clearly identified federal candidate, and that is not made in concert or cooperation with the candidate or at the candidate's request (the legal definition is in ${ext("https://www.law.cornell.edu/cfr/text/11/100.16", "11 CFR 100.16")}, and ${ext("https://www.law.cornell.edu/uscode/text/52/30101", "52 U.S.C. 30101")}). Typical examples are television ads, mailers and digital ads bought by a super PAC.</p>
<p>The candidate does not receive this money. It is not a donation and it does not appear in the candidate's own receipts. The spender reports it as a disbursement and says whether it supports or opposes the named candidate.</p>
<p>Spenders report independent expenditures on short-notice reports when the spending is close to an election: a 24-hour report once spending on an election reaches $1,000 in the days just before it, and a 48-hour report earlier in the cycle once it reaches $10,000 (${ext("https://www.fec.gov/help-candidates-and-committees/filing-pac-reports/24-hour-reports/", "FEC: 24-hour reports")}, ${ext("https://www.fec.gov/help-candidates-and-committees/filing-pac-reports/48-hour-reports", "FEC: 48-hour reports")}). The same spending is reported again on the spender's next regular report, so the FEC's raw file lists many expenditures twice.</p>
<p>This site counts each expenditure once, by one rule: a line from a regular report always counts, and a line from a short-notice report counts only when it was spent after the newest expenditure in that same committee's regular reports. Totals add the dollars for support and the dollars for opposition separately, and never net them. Rows with no amount, or with no stated side, are listed and left out of totals. The <a href="/outside-spending/">outside spending page</a> and each member's page follow this rule, and the CSV file has a <code>counted</code> column that shows which rows count.</p>` },
        { id: "member-committee", h: "What does a member's page show about their campaign committee?", html: `
<p>A member's page has a "Campaign committee" section when this site has linked the member to a campaign committee and holds itemized receipts for it. The link is made by ids only: the FEC candidate id on the committee is matched to the member's Bioguide id through the public congress-legislators roster. No name is ever matched, so a member with no id match has no section rather than a guessed one. At most ${c.campaignMaxCommittees} committees are shown for one member.</p>
<p>For each committee the section gives the itemized receipts this site holds, with their sum and the same for the last ${c.campaignRecentDays} days, the dates of the first and newest receipt held, the ${c.campaignEmployerRows} employers donors named with the largest sums, and the ${c.campaignStateRows} largest donor states. Receipts where the donor gave no employer, or wrote a word such as retired, self-employed or none, are left out of the employer table and counted beside it. The committee's name links to its FEC page, which has the committee's reported totals.</p>
<p>These are not totals. For a large committee the site holds a sample of the itemized receipts, so a sum here is not what the committee received in all, and the section never presents it as a total. A receipt says who gave and when, and nothing ties it to a trade, a vote or any other action by the member. The site lists no donor names. ${c.campaignLinked} campaign committees are linked to members today; they are in one file on the <a href="/downloads/">downloads page</a>, with counts only.</p>` },
        { id: "here", h: "What does this site show?", html: `
<p>Receipts of the main campaign committee of every current member of Congress and of the 200 largest PACs, summed by committee, by donor employer and by state. The <a href="/donations/">donations page</a> covers the last ${c.donationWindowDays} days of receipts on file and says so on the page; it is a recent sample, not a campaign's lifetime total.</p>
<p>The site never lists individual donors. Federal law forbids using contributor details from FEC reports to ask for money or for commercial purposes (${ext("https://www.fec.gov/updates/sale-or-use-contributor-information/", "FEC guidance")}), and names of private citizens add nothing to the question this site asks, which is where the money comes from in aggregate. If you need an individual record, the FEC's own search has it.</p>` },
      ],
      faqs: [
        { q: "Can corporations donate to members of Congress?", a: "No. Corporations and unions may not give their own funds to federal candidates. They can sponsor a PAC funded by voluntary gifts from employees and shareholders, and company totals on donation sites are sums of gifts from people who work there.", on: ["washington"] },
        { q: "How much can an individual donate to a federal candidate?", a: `For ${f.cycle}, ${c.usd(f.perElectionToCandidateUsd)} per election to a candidate, with the primary and the general counted separately.`, on: ["washington"] },
        { q: "Why does a donation take months to show up?", a: "Because campaigns report on a schedule. House and Senate campaigns file quarterly, so a gift made early in a quarter can become public about three and a half months later." },
        { q: "Is independent expenditure money given to the candidate?", a: "No. An independent expenditure is spent by an outside person or group on a communication about a candidate, without coordination with the candidate. The candidate does not receive it, and it is not a donation." },
        { q: "Why do notices and regular reports overlap in independent expenditure data?", a: "Spenders file a 24-hour or 48-hour notice when they spend near an election, and then report the same spending again on their next regular report. This site counts the expenditure once: regular-report lines always count, and a notice counts only when it was spent after that committee's newest regular-report expenditure." },
        { q: "Does Spot the Money show individual donors?", a: "No. It shows totals by committee, by donor employer and by state. Individual records are available from the FEC's own search." },
      ],
      sources: [
        { name: "FEC campaign finance data", url: "https://www.fec.gov/data/" },
        { name: "11 CFR 100.16, independent expenditure", url: "https://www.law.cornell.edu/cfr/text/11/100.16" },
        { name: "FEC: 24-hour reports of independent expenditures", url: "https://www.fec.gov/help-candidates-and-committees/filing-pac-reports/24-hour-reports/" },
        { name: "FEC contribution limits", url: f.source },
        { name: "FEC: who can and can't contribute", url: "https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/who-can-and-cant-contribute/" },
        { name: "FEC: how individual contributions are reported", url: "https://www.fec.gov/help-candidates-and-committees/filing-reports/individual-contributions/" },
        { name: "FEC: political action committees", url: "https://www.fec.gov/press/resources-journalists/political-action-committees-pacs/" },
        { name: "FEC: sale or use of contributor information", url: "https://www.fec.gov/updates/sale-or-use-contributor-information/" },
        { name: "FEC 2026 quarterly reporting dates", url: "https://www.fec.gov/help-candidates-and-committees/dates-and-deadlines/2026-reporting-dates/2026-quarterly-filers/" },
      ],
      related: ["lobbying-disclosure-reports", "federal-contracts-usaspending", "what-disclosure-data-cannot-tell-you"],
      seeLive: [{ label: "Campaign donations", href: "/donations/" }, { label: "Outside spending", href: "/outside-spending/" }, { label: "Washington overview", href: "/washington/" }],
      covers: ["web/src/pages/donations/index.astro", "ingest/src/sources/fec_committees.ts", "web/src/lib/campaign.ts", "web/src/components/CampaignCommittee.astro", "web/src/lib/outsidespending.ts", "web/src/components/OutsideSpending.astro"],
      ui: [{ text: "By donor employer", on: "/donations/" }, { text: "Largest spenders", on: "/outside-spending/" }],
      facts: ["fecLimits"],
    };
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const l = c.facts.ldaThresholds;
    return {
      slug: "lobbying-disclosure-reports", group: "washington", updated: "2026-11-22",
      title: "Lobbying disclosure reports",
      seoTitle: ["Lobbying Disclosure Reports Explained (LD-2 Filings)", "Lobbying Disclosure Reports Explained"],
      description: ["Lobbyists must report who pays them, how much, and which issues they work on, every quarter. How to read a lobbying report and what it leaves out.", "Lobbyists report clients, amounts and issues every quarter. How to read a lobbying report and what it leaves out."],
      answer: "Under the Lobbying Disclosure Act, lobbying firms and organisations with in-house lobbyists file a report every quarter naming the client, the amount of money involved, the issues lobbied and the parts of government contacted. The reports do not say which members of Congress were contacted or what was asked for.",
      keyFacts: [
        "Reports are due about 20 days after each quarter ends.",
        "Amounts are estimates rounded to the nearest $10,000.",
        "A firm reports income from a client; a company lobbying for itself reports its spending.",
        "The report names the House, the Senate or an agency, never an individual lawmaker.",
        "Lobbying is legal and protected; the reports show its scale.",
      ],
      sections: [
        { id: "what", h: "What is a lobbying report?", html: `
<p>A lobbying report is a quarterly filing, known as form LD-2, made to the Senate and the House under the Lobbying Disclosure Act of 1995. A lobbying firm files one for each client. A company, union or association that employs its own lobbyists files one for itself.</p>
<p>Registration is required once the money passes a threshold: more than ${c.usd(l.firmIncomePerQuarterUsd)} of income from a client in a quarter for a firm, or more than ${c.usd(l.inHouseExpensePerQuarterUsd)} of lobbying spending in a quarter for an organisation with in-house lobbyists (figures in force since ${l.effective}; ${ext(l.source, "House Clerk")}). Below that, nothing is filed.</p>` },
        { id: "contents", h: "What does a report show?", html: `
<ul>
<li><strong>Registrant and client.</strong> Who did the lobbying and for whom. When a company lobbies for itself they are the same.</li>
<li><strong>An amount.</strong> Income (for a firm) or expenses (for in-house lobbying), as a good-faith estimate rounded to the nearest $10,000. Small amounts are reported only as "less than $5,000".</li>
<li><strong>Issue areas.</strong> General codes such as taxation, defence or health, with a short description of the specific bills or rules.</li>
<li><strong>Who was contacted, at the level of institutions.</strong> "U.S. Senate", "House of Representatives", "Department of Energy".</li>
<li><strong>The lobbyists' names</strong>, and any senior government job they held before.</li>
</ul>` },
        { id: "missing", h: "What does it leave out?", html: `
<p>The report does not name the senators, representatives or staff who were contacted. It does not say what the lobbyist asked for, which side of a bill they were on, or whether they got it. And it covers only "lobbying" as the law defines it: advice, public relations, advertising and grassroots campaigns are outside it, and a person counts as a lobbyist only if lobbying takes up at least a fifth of their time for that client.</p>
<p>Reported lobbying is therefore a floor on what an interest spends to influence Washington, not the whole of it.</p>` },
        { id: "double", h: "Can lobbying amounts be added together?", html: `
<p>With care. A company that lobbies for itself and also hires three outside firms appears in four sets of reports. Its own report states its total lobbying spending, which already includes what it paid the firms; the firms' reports state the same fees again as their income. Adding all four counts the fees twice.</p>
<p>Amended reports are another trap, since an amendment repeats the whole filing. This site keeps one row per registrant, client and period, the most recently posted, so a corrected report replaces the original and is not added to it.</p>` },
        { id: "here", h: "What does this site show?", html: `
<p>Filings posted since October 2025, read from the official ${ext("https://lda.gov/system/public/", "lobbying disclosure site")}: the largest clients and lobbying firms by reported amount, the newest filings, and lobbying by issue. There are ${c.counts.lobbying} filings on the <a href="/lobbying/">lobbying page</a> today, each linked to its record. Company pages show lobbying filed under the same name as the company.</p>
<p>Names are matched exactly as written, so a subsidiary that lobbies under its own name is not folded into its parent.</p>` },
        { id: "issues", h: "How does this site show the issues a filing lists?", html: `
<p>A report can name several of the 79 general issue areas, and many do. Each row in a lobbying table here lists every issue area the filing names, the first ${c.issuesInline} when there are more, and each name opens that issue's page. The <a href="/lobbying-issues/">lobbying by issue</a> list has one row per issue area: the filings that name it this year, how many of them name no other issue, and the clients and registrants behind them. An issue's own page lists its ${c.issueTopRows} largest clients and registrants and the ${c.issueFilingRows} newest filings that name it.</p>
<p>A report gives one amount for the quarter, not an amount for each issue. So the amount beside an issue is the total on the reports that name it, and a report that names three issues adds its whole amount to all three. The amounts of two issues overlap and cannot be added together, and none of them is what was spent on that issue alone. The chart on the lobbying page is different on purpose: it counts each report once, under its first issue, so that its tiles add up to the year's total.</p>
<p>New filings are added once a day, newest first. If a daily run has to stop before it reaches filings it already has, it notes the gap, and the next run closes it, so a filing can occasionally appear a day late but should not stay missing.</p>` },
        { id: "contributions", h: "What is a lobbyist contribution report (LD-203)?", html: `
<p>Twice a year, every registered lobbying firm, every organization with in-house lobbyists and every individual lobbyist files a second kind of report, form LD-203. It is due 30 days after the end of each half of the year (${ext("https://www.law.cornell.edu/uscode/text/2/1604", "2 U.S.C. § 1604(d)")}). It lists contributions to federal candidates, officeholders, leadership PACs and party committees that add up to $200 or more for one recipient, payments for events that honor covered officials or for meetings they host, payments to entities named for or controlled by them, and payments to presidential library foundations and inaugural committees. A filer with nothing to list still files, and says so (${ext("https://lobbyingdisclosure.house.gov/ldaguidance.pdf", "House Clerk guidance")}).</p>
<p>The <a href="/lobbyist-contributions/">lobbyist contributions page</a> totals the reports by period and type, lists the largest filers, the names that appear most and the newest items. Names are as the filers typed them, and nothing merges two spellings of one recipient. The Senate publishes the data and notes that its Office of Public Records cannot vouch for it.</p>
<p>An amended report is a new filing that the Senate's data does not tie to the one it replaces. For the same registrant, lobbyist, year and period this site counts the version posted last and leaves the earlier ones out of every figure, though the CSV files keep them marked as not counted. An item with no date, or a date in the future, is listed without a date and counted in its report's period only.</p>
<p>A member's page lists the items tied to that member by one of two rules. By the first, the honoree field names the member. The match is deliberately narrow: titles such as "Rep." and bracketed tags are removed, and what is left must equal the member's full name, or equal first and last name where one member has that pair. A surname alone, or a field naming several people, matches nobody. A second rule ties an item to a member when the payee equals the name of that member's campaign committee, which this site links to the member by FEC and Bioguide ids, never by name; the honoree rule is tried first and a payee that only resembles a committee name matches nobody. Items that name neither the member nor the member's committee are not counted on the member's page, so it can hold fewer items than the reports do. A company page shows items from reports filed under the company's exact name, with the same caution.</p>
<p>An LD-203 report is the filer's statement. It says that money went to a recipient, not why, and it is not a statement by the recipient. Nothing on this site connects a contribution to a vote, a trade or any other action.</p>` },
      ],
      faqs: [
        { q: "What is an LD-203 contribution report?", a: "It is the report each lobbyist and lobbying firm files twice a year listing certain contributions and payments: gifts to federal candidates and party committees of $200 or more, payments for events honoring officials, and some others. It does not say why a contribution was made.", on: ["washington"] },
        { q: "Why does a member's page list fewer lobbyist contributions than the reports hold?", a: "Because an item is tied to a member only when its honoree field is exactly the member's name, after titles are removed, or its payee is exactly the name of the member's campaign committee as this site has linked it by ids. A surname alone, a field naming several people, a payee that only resembles a committee name, or a committee this site has not linked is not counted on the member's page. It is still on the lobbyist contributions page and in the CSV files." },
        { q: "How much was spent lobbying on one issue, such as taxation?", a: "The reports cannot say. A lobbying report gives one amount for the quarter and a list of issue areas, with no split between them. This site shows the total on the reports that name an issue, which also covers every other issue those reports name." },
        { q: "What is an LD-2 lobbying report?", a: "An LD-2 is the quarterly report a lobbying firm or an organisation with in-house lobbyists files under the Lobbying Disclosure Act. It names the client, the amount, the issues and the institutions contacted.", on: ["washington"] },
        { q: "Do lobbying reports say which lawmakers were lobbied?", a: "No. A report lists the House, the Senate or a federal agency as the body contacted. It does not name individual members of Congress or staff.", on: ["washington"] },
        { q: "How accurate are reported lobbying amounts?", a: "They are good-faith estimates rounded to the nearest $10,000, and they cover only activity the law defines as lobbying, so they understate total spending on influence." },
        { q: "Is lobbying legal?", a: "Yes. Petitioning the government is protected by the First Amendment. The Lobbying Disclosure Act does not restrict lobbying; it requires paid lobbying above a threshold to be reported." },
      ],
      sources: [
        { name: "Lobbying disclosure search (LDA.gov)", url: "https://lda.gov/system/public/" },
        { name: "House Clerk: lobbying disclosure, thresholds and deadlines", url: "https://lobbyingdisclosure.house.gov/" },
        { name: "Lobbying Disclosure Act guidance", url: "https://lobbyingdisclosure.house.gov/ldaguidance.pdf" },
        { name: "2 U.S.C. § 1604, reports by registered lobbyists", url: "https://www.law.cornell.edu/uscode/text/2/1604" },
        { name: "Senate lobbying disclosure database (LDA.gov)", url: "https://lda.gov/" },
      ],
      related: ["campaign-donations-fec-data", "federal-contracts-usaspending", "what-disclosure-data-cannot-tell-you"],
      seeLive: [{ label: "Lobbying filings", href: "/lobbying/" }, { label: "Lobbying by issue", href: "/lobbying-issues/" }, { label: "Lobbyist contributions", href: "/lobbyist-contributions/" }, { label: "Washington overview", href: "/washington/" }],
      covers: ["ingest/src/sources/senate_lda.ts", "web/src/pages/lobbying/index.astro", "web/src/lib/lobbyissues.ts", "web/src/pages/lobbying-issues/index.astro", "web/src/pages/lobbying-issues/[slug].astro", "web/src/lib/lobbygifts.ts", "web/src/pages/lobbyist-contributions/index.astro"],
      ui: [{ text: "Browse by issue", on: "/lobbying/" }, { text: "Only issue listed", on: "/lobbying-issues/" }, { text: "Reported on those filings", on: "/lobbying-issues/" }, { text: "Most named recipients", on: "/lobbyist-contributions/" }],
      facts: ["ldaThresholds"],
    };
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const k = c.facts.contractLag;
    return {
      slug: "federal-contracts-usaspending", group: "washington", updated: "2026-11-22",
      title: "Federal contracts: how to read USAspending data",
      seoTitle: ["Federal Contracts Explained: How to Read USAspending", "How to Read USAspending Contract Data"],
      description: ["USAspending.gov publishes every federal contract award. What award value, obligation and outlay mean, why Defense data runs 90 days behind, and what is shown here.", "What USAspending contract records show: award value, obligations, outlays, and why Defense data runs behind."],
      answer: "USAspending.gov is the Treasury's public record of federal spending, including every contract the government awards. An award's headline value is what has been committed so far, not cash already paid, and many large awards are ceilings that are never fully spent.",
      keyFacts: [
        "Obligation = money the government has committed. Outlay = money actually paid.",
        "Current value = committed so far. Potential value = the most it could reach with every option used.",
        `Contracts are reported within ${k.reportWithinBusinessDays} business days; Defense records are released ${k.defenseDelayDays} days later.`,
        "A contract award is not evidence of lobbying success or political favour.",
        "This site shows the largest recent awards and awards to tracked companies, not every contract.",
      ],
      sections: [
        { id: "what", h: "What is USAspending?", html: `
<p>${ext("https://www.usaspending.gov/", "USAspending.gov")} is the official website that shows where federal money goes. It is run by the Treasury and exists because two laws, in 2006 and 2014, required the government to publish its awards in one searchable place (${ext("https://tfx.treasury.gov/data-transparency/about", "background")}). It covers contracts, grants, loans and other payments. This site uses the contract records.</p>` },
        { id: "terms", h: "What do the dollar figures mean?", html: `
${table(["Term", "Meaning"], [
  ["Obligation", "A binding promise to pay: the contract is signed or the order placed."],
  ["Outlay", "Money that has actually left the Treasury."],
  ["Current award value", "The total committed so far, including options already taken up."],
  ["Potential award value", "The most the award could reach if every option were taken up."],
])}
<p>The gap between these can be huge. A ten-year agreement with a $5 billion ceiling may have $40 million committed in its first year. News reports usually quote the ceiling. This site shows the award value as USAspending reports it and labels it "award value".</p>` },
        { id: "types", h: "What kinds of award are there?", html: `
<p>A <strong>contract</strong> buys goods or services. An <strong>indefinite delivery vehicle</strong> is an umbrella agreement under which separate orders are placed later, which is how much of government buying is done; the umbrella's value and its orders can both appear, so adding them double counts. A <strong>prime award</strong> goes directly from the government to a company; a <strong>sub-award</strong> is what that company passes on to a subcontractor and must not be added to the prime's total.</p>
<p>Each contract carries a NAICS code for the industry and a product or service code for what was bought. The <a href="#naics">NAICS code</a> is shown on this site; the product or service code is not.</p>` },
        { id: "details", h: "What do the description, sub-agency and end date tell you?", html: `
<p>Three more facts come with each award, and this site shows them as USAspending reports them.</p>
<p>The <strong>description</strong> is a line the contracting office typed when it recorded the award. It is often short, in capitals and full of abbreviations, and it can describe the latest change to a contract instead of the whole job. Tables here show its first ${c.contractDescriptionShown} characters; the full text is on the award's USAspending page and in the <a href="/downloads/">CSV file</a>. This site does not sort, label or total awards by what a description says.</p>
<p>The <strong>awarding sub-agency</strong> is the part of a department that made the award: the Navy or the Army inside the Department of Defense, the Coast Guard inside Homeland Security. The <a href="/contracts/#sub-agencies">contracts page</a> counts awards by sub-agency. Awards stored before these details were kept get them from a daily job that asks USAspending for each such award by its id, newest first; until it has reached an award, or when USAspending lists no description for it, the cell shows a dash, and the table says how many awards carry one.</p>
<p>The <strong>end date</strong> is the day the work is currently due to end. It is not a fixed term: it moves when a contract is extended or cut short, and options not yet taken up can push it later.</p>` },
        { id: "naics", h: "What is the industry code on an award?", html: `
<p>It is a six-digit code from the North American Industry Classification System (${ext("https://www.census.gov/naics/", "NAICS")}), the scheme federal statistics use to sort businesses by what they do. The contracting office picks the code that best fits the work being bought, and it also decides which size limit counts as a small business for that contract.</p>
<p>The code describes the purchase, not the company. A large contractor wins awards under many codes, and the code on an award can differ from the industry the SEC lists for the same company on its <a href="/stocks/">own page</a>, which comes from an older scheme with its own codes.</p>
<p>This site prints the code as USAspending reports it and adds the Census Bureau's title for it, so 336411 reads "Aircraft Manufacturing". The classification is revised every five years and some codes are retired. Titles here come from the 2022 edition; when an award carries a code that edition no longer uses, the title is from the last edition that had it and the year follows in brackets. The <a href="/contracts/#naics">contracts page</a> adds up award values by code. Nothing else is worked out from a code.</p>` },
        { id: "assistance", h: "What are grants, loans and direct payments?", html: `
<p>Contracts are the government buying something. USAspending also records money it gives or lends. A <strong>grant</strong> is financial assistance for a public purpose that does not have to be repaid. A <strong>loan</strong> is money the recipient must repay, made directly or guaranteed by the government. A <strong>direct payment</strong> is a cash payment to a person, a company or another organization, such as a retirement or pension benefit (${ext("https://api.usaspending.gov/api/v2/references/glossary/", "USAspending glossary")}). The <a href="/grants/">grants and loans page</a> lists the largest awards of each kind that started in the last ${c.assistanceWindowDays} days, with the agency and the assistance program that made them.</p>
<p>The three kinds are shown apart and never added together. A loan's amount here is its <strong>face value</strong>, the total lent or guaranteed. That is not money spent: the loan is meant to be repaid, and a guarantee only pays if the borrower defaults. The government's own estimate of what a loan or guarantee will cost, after expected repayments, is its <strong>subsidy cost</strong>; it is much smaller than the face value and can be negative when the government expects to earn money. USAspending's pages may headline a loan by either figure, so this site prints both columns and labels each.</p>
<p>Some recipients are masked. For awards to individuals USAspending replaces the name, for example with "MULTIPLE RECIPIENTS", and groups the awards by area, to protect personal information. This site shows the name as returned, counts such awards, and never links one to a company. A company page lists an award only when the recipient name equals the company's name exactly, and a name two companies share matches neither.</p>
<p>As with contracts, the page is not every award: it holds the largest of each kind that started in each 30-day stretch, plus awards to followed companies, and amounts are what agencies report and can be revised. An award to a company does not show that the company asked for it or that anyone influenced it.</p>` },
        { id: "lag", h: "How current is the data?", html: `
<p>Civilian agencies must report a contract action within ${k.reportWithinBusinessDays} business days of the award (${ext(k.source, "federal acquisition rules")}), and it reaches USAspending shortly after. Department of Defense records are released after a ${k.defenseDelayDays}-day delay, so the newest three months of defence contracting are always missing.</p>
<p>Records are also revised. An award's value changes as options are exercised or work is cancelled, so the same contract can show different figures on different days.</p>` },
        { id: "here", h: "What does this site show?", html: `
<p>Two sets of awards that started in the last 180 days: the largest awards from each month, and awards to companies whose shares this site tracks. That is ${c.counts.contracts} awards on the <a href="/contracts/">contracts page</a> today. It is not every federal contract; there are millions of those a year.</p>
<p>Companies are matched to awards by exact name. A contract won by a subsidiary under a different name will not appear on its parent's page, and a company page with no contracts does not mean the company has none.</p>
<p>The newest two months of awards are refreshed every day, and the whole window is re-read about once a week to pick up changes to older awards, so a recently revised figure can take up to a week to show. An award whose start date is later than today is left out.</p>` },
        { id: "reading", h: "Does a contract mean a company has political influence?", html: `
<p>The record cannot tell you. Contracts are awarded by agency contracting officers under detailed procurement rules, and large contractors lobby and donate as a matter of routine. Seeing a company's contracts, lobbying and its executives' trades on one page shows that these things coexist. It does not show that one caused another, and this site does not suggest it.</p>` },
      ],
      faqs: [
        { q: "What is the difference between an obligation and an outlay?", a: "An obligation is money the government has committed to pay, for example by signing a contract. An outlay is money that has actually been paid.", on: ["washington"] },
        { q: "Why are Department of Defense contracts missing from recent data?", a: `Because Defense contract records are released to the public after a ${k.defenseDelayDays}-day delay.` },
        { q: "Does Spot the Money list every federal contract?", a: "No. It shows the largest awards that started in each of the last six months and awards to companies it tracks, matched by exact name.", on: ["washington"] },
        { q: "Who writes the description of a federal contract award?", a: "The contracting office that records the award. It is free text, often abbreviated, and this site shows it as entered without drawing anything from it." },
        { q: "What does the NAICS code on a federal contract mean?", a: "It is the industry code the contracting office gave the work being bought. It describes the purchase, not the company that won the award, and one company can hold awards under many codes." },
        { q: "What is the difference between a loan's face value and its subsidy cost?", a: "Face value is the total the government lends or guarantees, which is meant to be repaid and is not spending. Subsidy cost is the government's estimate of the loan's long-term cost after expected repayments and defaults. It is usually far smaller than the face value and can be negative." },
        { q: "Why are some grant and loan recipients hidden on USAspending?", a: "Awards to individuals are aggregated and the recipient name is replaced, for example with MULTIPLE RECIPIENTS, to protect personal information. This site shows the name as returned and does not link such awards to any company." },
        { q: "Is a contract's award value the amount paid?", a: "No. The current award value is what has been committed so far, and the potential value is a ceiling. The amount actually paid is the outlay, which is often lower." },
      ],
      sources: [
        { name: "USAspending.gov", url: "https://www.usaspending.gov/" },
        { name: "Treasury: about the data transparency program", url: "https://tfx.treasury.gov/data-transparency/about" },
        { name: "Federal Acquisition Regulation, subpart 4.6 (contract reporting)", url: k.source },
        { name: "U.S. Census Bureau: North American Industry Classification System", url: "https://www.census.gov/naics/" },
        { name: "Federal Funding Accountability and Transparency Act of 2006", url: "https://www.govinfo.gov/content/pkg/PLAW-109publ282/html/PLAW-109publ282.htm" },
        { name: "USAspending glossary (loans, grants, direct payments, masked recipients)", url: "https://api.usaspending.gov/api/v2/references/glossary/" },
      ],
      related: ["lobbying-disclosure-reports", "campaign-donations-fec-data", "what-disclosure-data-cannot-tell-you"],
      seeLive: [{ label: "Federal contracts", href: "/contracts/" }, { label: "Grants and loans", href: "/grants/" }, { label: "Stocks and companies", href: "/stocks/" }],
      covers: ["ingest/src/sources/usaspending.ts", "ingest/src/sources/usaspending_details.ts", "web/src/pages/contracts/index.astro", "web/src/lib/contracts.ts", "web/src/lib/naics.ts", "web/src/lib/assistance.ts", "web/src/pages/grants/index.astro"],
      ui: [{ text: "Description, as reported", on: "/contracts/" }, { text: "Awarding sub-agencies", on: "/contracts/" }, { text: "Industry code (NAICS)", on: "/contracts/" }, { text: "Awards by industry code", on: "/contracts/" }, { text: "Largest grants", on: "/grants/" }],
      facts: ["contractLag"],
    };
  },
];
