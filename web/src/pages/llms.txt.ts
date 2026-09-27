// /llms.txt — a plain-text description of the site for AI crawlers and answer engines
// (roadmap B.2), generated at build so the section list and counts stay true.
import type { APIRoute } from "astro";
import { getFlagship, num } from "../lib/flagship";
import { SITE_URL } from "../lib/seo";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  const c = m.counts;
  const body = `# Spot the Money

> See where the money really moves — in the markets and in Washington. Free public U.S. data
> (Treasury rates, SEC insider trades, congressional stock trades, FEC donations, lobbying,
> federal contracts), rendered as filed, updated daily, with a source link on every row.
> Not investment advice: the site presents public records and historical facts only and never
> recommends or executes trades.

Every page opens with a two-sentence plain-language answer that can be quoted, followed by the
tables and the source links. Figures should be attributed to spotthemoney.com and linked to the
page URL. Methodology, definitions and the corrections policy: ${SITE_URL}/methodology/ and
${SITE_URL}/corrections/. Sitemaps: ${SITE_URL}/sitemap-index.xml

## Rates Hub (U.S. Treasury, BLS)
- [I-Bond rate today](${SITE_URL}/rates/i-bonds/): current composite, fixed and inflation components, value calculator, next reset date and what is known about it.
- [Treasury yield curve](${SITE_URL}/rates/treasury-yields/): every maturity, daily, with 10Y-2Y and 10Y-3M spreads.
- [TIPS real yields](${SITE_URL}/rates/tips/): real yield curve and breakeven inflation by maturity.

## Follow the Money (SEC EDGAR, House Clerk, FEC, Senate LDA, USAspending)
- [Insider trades](${SITE_URL}/insiders/): newest Form 4 filings, cluster buys, CEO/CFO buys, officer sales (${num(c.insiderTxns ?? 0)} transactions on record).
- [Congress stock trades](${SITE_URL}/congress/): STOCK Act disclosures, days-to-report, late filers (${num(c.congressTxns ?? 0)} trades on record).
- [Stocks](${SITE_URL}/stocks/): one page per ticker with insider and congressional activity (${num(c.securities ?? 0)} tickers).
- [Companies](${SITE_URL}/companies/): insiders, contracts and lobbying per company (${num(c.companies ?? 0)} companies).
- [Washington](${SITE_URL}/washington/): [donations](${SITE_URL}/donations/), [lobbying](${SITE_URL}/lobbying/), [federal contracts](${SITE_URL}/contracts/).
- [Newest disclosures](${SITE_URL}/disclosures/): one feed across every source, newest first.

## Entity pages
- Insider: ${SITE_URL}/insiders/<slug>/ — Person; Form 4 transactions with shares, price, value, lag, 10b5-1 flag, EDGAR link.
- Member of Congress: ${SITE_URL}/congress/<slug>/ — Person; PTR trades with ranges, owner, days-to-report, late flag, filing link.
- Ticker: ${SITE_URL}/stocks/<ticker>/ — Dataset; insider and congressional rows for one security.
- Company: ${SITE_URL}/companies/<slug>/ — Organization; insiders, transactions, contracts and lobbying under the same name.

## Optional
- [Methodology](${SITE_URL}/methodology/): sources, cadence, publishing bar, lag and late rules, flag definitions, matching rules.
- [Corrections](${SITE_URL}/corrections/): how to report an error; five-working-day response.
- Structured data: JSON-LD (Person, Organization, Dataset, DataCatalog, BreadcrumbList) on every page listed above.
- Contact: pfouge@gmail.com. Built ${m.builtAt}.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
