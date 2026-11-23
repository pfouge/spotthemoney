// /llms.txt — a plain-text description of the site for AI crawlers and answer engines
// (roadmap B.2), generated at build so the section list and counts stay true.
import type { APIRoute } from "astro";
import { getFlagship, num } from "../lib/flagship";
import { SITE_URL, CONTACT_EMAIL } from "../lib/seo";
import { getGuides, byGroup, guidePath } from "../lib/guides";
import { getArticles, articleUrl } from "../lib/articles";
import { siteEventsHub } from "../lib/events8k-build";
import { sitePayHub } from "../lib/execpay-build";
import { INST_HUB_PATH, instHubShown } from "../lib/inst13f-hub";
import { plannedShown } from "../lib/plannedsales-build";
import { largeShown } from "../lib/largeholders-build";
import { MARKETS_PATH, WFE, US_MILLIONS, EU_MILLIONS, CHINA_MILLIONS, COMMONWEALTH_MILLIONS, trillions } from "../lib/worldmarkets";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  const c = m.counts;
  const guides = await getGuides();
  const guideLines = byGroup(guides).map((g) => `### ${g.label}\n` + g.guides.map((x) => `- [${x.title}](${SITE_URL}${guidePath(x.slug)}): ${x.description.at(-1)}`).join("\n")).join("\n\n");
  // Published articles only; the section is left out entirely while there are none.
  const articles = await getArticles({ publicOnly: true });
  const writing = articles.length === 0 ? "" : `## Writing\n${articles.map((a) => `- [${a.title}](${articleUrl(a.slug)}): ${a.summary ?? a.deck}`).join("\n")}\n\n`;
  const evN = siteEventsHub(m).data.rows.length, payN = sitePayHub(m).data.rows.length;
  const eventsLines = (evN ? `- [Company events](${SITE_URL}/company-events/): the Form 8-K reports that companies on this site filed in the last 12 months (${num(evN)} reports), with the SEC's heading for each item named; filters for item, industry and date. A report is the company's own statement that something happened; its text is not read or summarised.\n` : "")
    + (payN ? `- [Executive pay](${SITE_URL}/executive-pay/): Pay Versus Performance figures for ${num(payN)} companies, as filed: the principal executive officer's total and compensation actually paid, and the average for the other named executive officers. No person is named.\n` : "");
  const body = `# Spot the Money

> See where the money really moves, in the markets and in Washington. Free public U.S. data
> (Treasury rates, SEC insider trades, congressional stock trades, FEC donations, lobbying,
> federal contracts), rendered as filed, updated daily, with a source link on every row.
> Not investment advice: the site presents public records and historical facts only and never
> recommends or executes trades.

Every page opens with a two-sentence plain-language answer that can be quoted, followed by the
tables and the source links. Figures should be attributed to "Spot the Money (spotthemoney.com)" and linked to the
page URL, with the date accessed; the original government filing linked on each row is the
authority for an individual trade. How to cite and the legal limits on reuse:
${SITE_URL}/guides/how-to-cite-and-reuse/. Methodology, definitions and the corrections policy: ${SITE_URL}/methodology/ and
${SITE_URL}/corrections/. Sitemaps: ${SITE_URL}/sitemap-index.xml

## Rates Hub (U.S. Treasury, BLS)
- [I-Bond rate today](${SITE_URL}/rates/i-bonds/): current composite, fixed and inflation components, value calculator, next reset date and what is known about it.
- [Treasury yield curve](${SITE_URL}/rates/treasury-yields/): every maturity, daily, with 10Y-2Y and 10Y-3M spreads.
- [TIPS real yields](${SITE_URL}/rates/tips/): real yield curve and breakeven inflation by maturity.

## Markets (World Federation of Exchanges)
- [Largest stock exchanges in the world](${SITE_URL}${MARKETS_PATH}): domestic market capitalization of every stock market above US$1 trillion for ${WFE.asOfLabel}, and the United States (${trillions(US_MILLIONS, 1)}) against the Commonwealth (${trillions(COMMONWEALTH_MILLIONS, 1)}), mainland China (${trillions(CHINA_MILLIONS, 1)}, Shanghai plus Shenzhen) and the European Union (${trillions(EU_MILLIONS, 1)}). Monthly figures from the World Federation of Exchanges; London is from the London Stock Exchange and is labelled as such.

## Follow the Money (SEC EDGAR, House Clerk, FEC, Senate LDA, USAspending)
- [Insider trades](${SITE_URL}/insiders/): newest Form 4 filings, cluster buys, CEO/CFO buys, officer sales (${num(c.insiderTxns ?? 0)} transactions on record).
- [Congress stock trades](${SITE_URL}/congress/): STOCK Act disclosures, days-to-report, late filers (${num(c.congressTxns ?? 0)} trades on record).
- [Congress trade screener](${SITE_URL}/congress-trades/): every transaction in the House and Senate periodic transaction reports on record in one table; filters for member, ticker, chamber, party, state, committee, side, amount range, owner, disclosure date and late reports. Amounts are the ranges the reports give.
- [Member directory](${SITE_URL}/congress-members/): every member of Congress on record with trade counts; filters for chamber, party, state, committee and recent activity.
- [Committees of Congress](${SITE_URL}/congress-committees/): one page per committee with its current members and the trades they have disclosed. Membership is context only.
${m.votes.shown ? `- [Roll call votes](${SITE_URL}/congress-votes/): every recorded House and Senate roll call on file with its question, result and official totals; each opens to show how every member voted, as the chambers recorded it. Positions are not scored.\n` : ""}- [Stocks](${SITE_URL}/stocks/): one page per ticker with insider and congressional activity (${num(c.securities ?? 0)} tickers).
- [Companies](${SITE_URL}/companies/): insiders, contracts and lobbying per company (${num(c.companies ?? 0)} companies).
- [Companies by industry](${SITE_URL}/industries/): the companies grouped by the division of the industry code (SIC) the SEC assigns to each, with counts of open-market insider purchases and sales and of congressional trades disclosed in the last 12 months. The classification is the SEC's and is a label only.
- [Company financials screener](${SITE_URL}/company-financials/): the newest fiscal year or quarter of each tracked company in one table, as filed with the SEC (revenue, net income, diluted earnings per share, total assets, equity); filters for industry, currency, revenue, net income above or below zero and total assets. Figures as filed, in the company's own currency; nothing is converted, scored or ranked.
${eventsLines}- [Washington](${SITE_URL}/washington/): [donations](${SITE_URL}/donations/), [lobbying](${SITE_URL}/lobbying/), [federal contracts](${SITE_URL}/contracts/).
${plannedShown(m) ? `- [Planned sales](${SITE_URL}/planned-sales/): every SEC Form 144 notice filed in the last 12 months about a company on this site, with filters. A notice states a plan to sell, not a sale; nothing is added up.\n` : ""}${largeShown(m) ? `- [Large holders](${SITE_URL}/large-holders/): each holder's newest Schedule 13D or 13G statement about a company on this site, with filters. A statement is a position on a date, not a trade; nothing is added up.\n` : ""}${instHubShown(m) ? `- [Institutional holders](${SITE_URL}${INST_HUB_PATH}): the companies on this site ranked by how many institutional managers report them in SEC Form 13F, and the managers with the largest reported value. Positions on one day a quarter, as filed; sums can count shares twice, and no share of any company is stated.\n` : ""}- [Washington](${SITE_URL}/washington/): [donations](${SITE_URL}/donations/), [lobbying](${SITE_URL}/lobbying/), [federal contracts](${SITE_URL}/contracts/).
- [Lobbying by issue](${SITE_URL}/lobbying-issues/): one page per general issue area with the clients and lobbying firms whose filings list it. A filing reports one amount for all its issues, so amounts overlap between issues.
- [Washington](${SITE_URL}/washington/): [donations](${SITE_URL}/donations/), [lobbying](${SITE_URL}/lobbying/), [federal contracts](${SITE_URL}/contracts/).
${m.outside.shown ? `- [Outside spending](${SITE_URL}/outside-spending/): independent expenditures reported to the FEC, by candidate and by spender, counted once. Money outside groups spent on communications about candidates; the candidates did not receive it.\n` : ""}- [Lobbying by issue](${SITE_URL}/lobbying-issues/): one page per general issue area with the clients and lobbying firms whose filings list it. A filing reports one amount for all its issues, so amounts overlap between issues.
- [Newest disclosures](${SITE_URL}/disclosures/): one feed across every source, newest first.

## Free CSV downloads (no sign-up; same rows as the pages; column meanings on the page)
- [All downloads](${SITE_URL}/downloads/): congressional trades, insider transactions by quarter, lobbying, federal contracts, Treasury rates.
- One member: ${SITE_URL}/downloads/congress/<slug>.csv · One ticker: ${SITE_URL}/downloads/stocks/<ticker>.csv
- Reuse limits (congressional reports: 5 U.S.C. § 13107(c)): ${SITE_URL}/terms/#reuse

## RSS feeds (newest disclosed trades; one sentence per item with a link to the row and the original filing)
- [All feeds](${SITE_URL}/feeds/): what each feed carries and what it leaves out.
- Congress trades: ${SITE_URL}/feeds/congress-trades.xml · Insider open-market purchases: ${SITE_URL}/feeds/insider-purchases.xml · Insider open-market purchases and sales: ${SITE_URL}/feeds/insider-trades.xml

## Data files for scripts (no API key, no account; there is no query API)
- [Developers](${SITE_URL}/developers/): every public data file, what stays the same between builds, and how to fetch politely.
- Catalogue (JSON; every CSV file with its row count and columns, the per-member and per-ticker files that exist, the feeds): ${SITE_URL}/data/catalog.json

## Entity pages
- Insider: ${SITE_URL}/insiders/<slug>/: Person; Form 4 transactions with shares, price, value, lag, 10b5-1 flag, EDGAR link.
- Member of Congress: ${SITE_URL}/congress/<slug>/: Person; PTR trades with ranges, owner, days-to-report, late flag, filing link.
- Committee: ${SITE_URL}/congress-committees/<slug>/: Dataset; current members and their disclosed trades.
- Ticker: ${SITE_URL}/stocks/<ticker>/: Dataset; insider and congressional rows for one security.
- Company: ${SITE_URL}/companies/<slug>/: Organization; insiders, transactions, contracts and lobbying under the same name.

## Guides (plain-language explanations; each opens with a two-sentence answer and ends with primary sources)
- [All guides](${SITE_URL}/guides/) · [All questions and answers](${SITE_URL}/faq/)

${guideLines}

${writing}## Optional
- [Methodology](${SITE_URL}/methodology/): sources, cadence, publishing bar, lag and late rules, flag definitions, matching rules.
- [Corrections](${SITE_URL}/corrections/): how to report an error; five-working-day response.
- Structured data: JSON-LD (Person, Organization, Dataset, DataCatalog, BreadcrumbList) on every page listed above.
- [About](${SITE_URL}/about/), [Contact](${SITE_URL}/contact/), [Terms](${SITE_URL}/terms/), [Privacy](${SITE_URL}/privacy/).
- Contact: ${CONTACT_EMAIL}. Built ${m.builtAt}.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
