// /data/search.json — the index behind the header search (scripts/ui.ts). One row per page a
// reader might look for: members and insiders with trades on record, tickers, companies.
// Row = [kind, title, subtitle, url, weight]; weight (trades on record) breaks ranking ties.
import type { APIRoute } from "astro";
import { getFlagship, personPath, securityPath, companyPath } from "../../lib/flagship";
import { buildCommittees, COMMITTEES_PATH } from "../../lib/committees";
import { buildIssues, ISSUES_PATH } from "../../lib/lobbyissues";
import { siteIndustries } from "../../lib/industries-build";
import { siteFinScreen } from "../../lib/finscreen-build";
import { FIN_SCREENER_PATH } from "../../lib/finscreen";
import { siteEventsHub } from "../../lib/events8k-build";
import { sitePayHub } from "../../lib/execpay-build";
import { EVENTS_PATH } from "../../lib/events8k";
import { PAY_PATH } from "../../lib/execpay";
import { INDUSTRIES_PATH } from "../../lib/industries";
import { INST_HUB_PATH, instHubShown } from "../../lib/inst13f-hub";
import { plannedShown } from "../../lib/plannedsales-build";
import { largeShown } from "../../lib/largeholders-build";
import { PLANNED_PATH } from "../../lib/plannedsales";
import { LARGE_PATH } from "../../lib/largeholders";
import { getGuides, guidePath, GROUPS } from "../../lib/guides";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  const rows: [string, string, string, string, number][] = [];
  for (const s of m.securities.values()) {
    if (s.txns.length === 0) continue;
    const name = s.name ?? (s.companyId != null ? m.companies.get(s.companyId)?.name : null) ?? "";
    rows.push(["Ticker", s.ticker, name, securityPath(s), s.txns.length]);
  }
  for (const p of m.people.values()) {
    const path = personPath(p);
    if (!path || p.txns.length === 0) continue;
    rows.push([p.isCongress ? "Congress" : "Insider", p.name, p.isCongress ? "Member of Congress" : "Corporate insider", path, p.txns.length]);
  }
  for (const c of m.companies.values()) {
    const path = companyPath(c);
    if (!path) continue;
    rows.push(["Company", c.name, c.primaryTicker ?? "", path, c.txns.length]);
  }
  for (const [title, sub, url] of [
    ["Congress trades", "Every disclosed trade by members", "/congress/"], ["Member directory", "Members of Congress by chamber, party, state, committee", "/congress-members/"], ["Congress trade screener", "Filter every disclosed trade by member, ticker, party, state, committee, amount", "/congress-trades/"], ["Insider trades", "Form 4 filings", "/insiders/"],
    ["Newest disclosures", "Latest filings", "/disclosures/"], ["Free CSV downloads", "Download the data", "/downloads/"], ["RSS feeds", "Newest congressional and insider trades in a feed reader", "/feeds/"], ["Data files for developers", "CSV files, RSS feeds and a JSON catalogue; no API key", "/developers/"], ["Lobbying", "Senate LDA filings", "/lobbying/"],
    ["Federal contracts", "USAspending awards", "/contracts/"], ["Campaign donations", "FEC receipts", "/donations/"],
    ["Treasury yields", "Yield curve", "/rates/treasury-yields/"], ["I-Bonds", "Current rate and next reset", "/rates/i-bonds/"], ["TIPS", "Real yields", "/rates/tips/"], ["Largest stock exchanges", "World stock markets by size, United States vs Commonwealth, China and European Union", "/markets/largest-stock-exchanges/"],
    ["Methodology", "How the numbers are built", "/methodology/"], ["Guides", "How to read the filings", "/guides/"], ["FAQ", "Short answers to common questions", "/faq/"],
  ] as const) rows.push(["Page", title, sub, url, 0]);
  const committees = buildCommittees(m, new Date().toISOString().slice(0, 10), personPath);
  if (committees.length) rows.push(["Page", "Committees of Congress", "Members of each committee and their disclosed trades", COMMITTEES_PATH, 0]);
  for (const c of committees) rows.push(["Committee", c.name, `${c.members.length} members, ${c.withTrades} with trades`, c.path, c.trades]);
  const issues = buildIssues(m.lobbying, m.issueNames, new Date().getUTCFullYear());
  if (issues.length) rows.push(["Page", "Lobbying by issue", "Filings, clients and firms for each issue area", ISSUES_PATH, 0]);
  for (const i of issues) rows.push(["Lobbying issue", i.name, `${i.filings} filings this year`, i.path, 0]);
  const industries = siteIndustries(m).divisions;
  if (industries.length) rows.push(["Page", "Companies by industry", "Companies grouped by the SEC's industry code", INDUSTRIES_PATH, 0]);
  for (const d of industries) rows.push(["Industry", d.name, `${d.companies.length} companies, ${d.codes.length} industry codes`, d.path, 0]);
  if (plannedShown(m)) rows.push(["Page", "Planned sales (Form 144)", "Notices of planned sales filed in the last 12 months, as filed with the SEC", PLANNED_PATH, 0]);
  if (largeShown(m)) rows.push(["Page", "Large holders (13D and 13G)", "Holders that report more than 5% of a company, by newest statement", LARGE_PATH, 0]);
  if (instHubShown(m)) rows.push(["Page", "Institutional holders", "Which companies the most Form 13F managers report, and the largest managers", INST_HUB_PATH, 0]);
  if (siteFinScreen(m).all.length) rows.push(["Page", "Company financials screener", "Filter companies by revenue, net income and total assets, as filed with the SEC", FIN_SCREENER_PATH, 0]);
  if (siteEventsHub(m).data.rows.length) rows.push(["Page", "Company events (Form 8-K)", "The newest Form 8-K reports from companies on this site, by item", EVENTS_PATH, 0]);
  if (sitePayHub(m).data.rows.length) rows.push(["Page", "Executive pay", "Pay Versus Performance figures as companies filed them", PAY_PATH, 0]);
  // Guides are found by their title and by the questions they answer.
  for (const g of await getGuides()) rows.push(["Guide", g.title, GROUPS.find((x) => x.key === g.group)?.label ?? "Guide", guidePath(g.slug), 0]);
  return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json; charset=utf-8" } });
};
