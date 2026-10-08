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
      slug: "campaign-donations-fec-data", group: "washington", updated: U,
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
        { id: "here", h: "What does this site show?", html: `
<p>Receipts of the main campaign committee of every current member of Congress and of the 200 largest PACs, summed by committee, by donor employer and by state. The <a href="/donations/">donations page</a> covers the last ${c.donationWindowDays} days of receipts on file and says so on the page; it is a recent sample, not a campaign's lifetime total.</p>
<p>The site never lists individual donors. Federal law forbids using contributor details from FEC reports to ask for money or for commercial purposes (${ext("https://www.fec.gov/updates/sale-or-use-contributor-information/", "FEC guidance")}), and names of private citizens add nothing to the question this site asks, which is where the money comes from in aggregate. If you need an individual record, the FEC's own search has it.</p>` },
      ],
      faqs: [
        { q: "Can corporations donate to members of Congress?", a: "No. Corporations and unions may not give their own funds to federal candidates. They can sponsor a PAC funded by voluntary gifts from employees and shareholders, and company totals on donation sites are sums of gifts from people who work there.", on: ["washington"] },
        { q: "How much can an individual donate to a federal candidate?", a: `For ${f.cycle}, ${c.usd(f.perElectionToCandidateUsd)} per election to a candidate, with the primary and the general counted separately.`, on: ["washington"] },
        { q: "Why does a donation take months to show up?", a: "Because campaigns report on a schedule. House and Senate campaigns file quarterly, so a gift made early in a quarter can become public about three and a half months later." },
        { q: "Does Spot the Money show individual donors?", a: "No. It shows totals by committee, by donor employer and by state. Individual records are available from the FEC's own search." },
      ],
      sources: [
        { name: "FEC campaign finance data", url: "https://www.fec.gov/data/" },
        { name: "FEC contribution limits", url: f.source },
        { name: "FEC: who can and can't contribute", url: "https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/who-can-and-cant-contribute/" },
        { name: "FEC: how individual contributions are reported", url: "https://www.fec.gov/help-candidates-and-committees/filing-reports/individual-contributions/" },
        { name: "FEC: political action committees", url: "https://www.fec.gov/press/resources-journalists/political-action-committees-pacs/" },
        { name: "FEC: sale or use of contributor information", url: "https://www.fec.gov/updates/sale-or-use-contributor-information/" },
        { name: "FEC 2026 quarterly reporting dates", url: "https://www.fec.gov/help-candidates-and-committees/dates-and-deadlines/2026-reporting-dates/2026-quarterly-filers/" },
      ],
      related: ["lobbying-disclosure-reports", "federal-contracts-usaspending", "what-disclosure-data-cannot-tell-you"],
      seeLive: [{ label: "Campaign donations", href: "/donations/" }, { label: "Washington overview", href: "/washington/" }],
      covers: ["web/src/pages/donations/index.astro", "ingest/src/sources/fec_committees.ts"],
      ui: [{ text: "By donor employer", on: "/donations/" }],
      facts: ["fecLimits"],
    };
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const l = c.facts.ldaThresholds;
    return {
      slug: "lobbying-disclosure-reports", group: "washington", updated: U,
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
      ],
      faqs: [
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
      ],
      related: ["campaign-donations-fec-data", "federal-contracts-usaspending", "what-disclosure-data-cannot-tell-you"],
      seeLive: [{ label: "Lobbying filings", href: "/lobbying/" }, { label: "Washington overview", href: "/washington/" }],
      covers: ["ingest/src/sources/senate_lda.ts", "web/src/pages/lobbying/index.astro"],
      ui: [],
      facts: ["ldaThresholds"],
    };
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const k = c.facts.contractLag;
    return {
      slug: "federal-contracts-usaspending", group: "washington", updated: U,
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
<p>Each contract carries a NAICS code for the industry and a product or service code for what was bought.</p>` },
        { id: "lag", h: "How current is the data?", html: `
<p>Civilian agencies must report a contract action within ${k.reportWithinBusinessDays} business days of the award (${ext(k.source, "federal acquisition rules")}), and it reaches USAspending shortly after. Department of Defense records are released after a ${k.defenseDelayDays}-day delay, so the newest three months of defence contracting are always missing.</p>
<p>Records are also revised. An award's value changes as options are exercised or work is cancelled, so the same contract can show different figures on different days.</p>` },
        { id: "here", h: "What does this site show?", html: `
<p>Two sets of awards that started in the last 180 days: the largest awards from each month, and awards to companies whose shares this site tracks. That is ${c.counts.contracts} awards on the <a href="/contracts/">contracts page</a> today. It is not every federal contract; there are millions of those a year.</p>
<p>Companies are matched to awards by exact name. A contract won by a subsidiary under a different name will not appear on its parent's page, and a company page with no contracts does not mean the company has none.</p>` },
        { id: "reading", h: "Does a contract mean a company has political influence?", html: `
<p>The record cannot tell you. Contracts are awarded by agency contracting officers under detailed procurement rules, and large contractors lobby and donate as a matter of routine. Seeing a company's contracts, lobbying and its executives' trades on one page shows that these things coexist. It does not show that one caused another, and this site does not suggest it.</p>` },
      ],
      faqs: [
        { q: "What is the difference between an obligation and an outlay?", a: "An obligation is money the government has committed to pay, for example by signing a contract. An outlay is money that has actually been paid.", on: ["washington"] },
        { q: "Why are Department of Defense contracts missing from recent data?", a: `Because Defense contract records are released to the public after a ${k.defenseDelayDays}-day delay.` },
        { q: "Does Spot the Money list every federal contract?", a: "No. It shows the largest awards that started in each of the last six months and awards to companies it tracks, matched by exact name.", on: ["washington"] },
        { q: "Is a contract's award value the amount paid?", a: "No. The current award value is what has been committed so far, and the potential value is a ceiling. The amount actually paid is the outlay, which is often lower." },
      ],
      sources: [
        { name: "USAspending.gov", url: "https://www.usaspending.gov/" },
        { name: "Treasury: about the data transparency program", url: "https://tfx.treasury.gov/data-transparency/about" },
        { name: "Federal Acquisition Regulation, subpart 4.6 (contract reporting)", url: k.source },
        { name: "Federal Funding Accountability and Transparency Act of 2006", url: "https://www.govinfo.gov/content/pkg/PLAW-109publ282/html/PLAW-109publ282.htm" },
      ],
      related: ["lobbying-disclosure-reports", "campaign-donations-fec-data", "what-disclosure-data-cannot-tell-you"],
      seeLive: [{ label: "Federal contracts", href: "/contracts/" }, { label: "Companies", href: "/companies/" }],
      covers: ["ingest/src/sources/usaspending.ts", "web/src/pages/contracts/index.astro"],
      ui: [],
      facts: ["contractLag"],
    };
  },
];
