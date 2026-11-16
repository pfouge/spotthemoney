// /data/search.json — the index behind the header search (scripts/ui.ts). One row per page a
// reader might look for: members and insiders with trades on record, tickers, companies.
// Row = [kind, title, subtitle, url, weight]; weight (trades on record) breaks ranking ties.
import type { APIRoute } from "astro";
import { getFlagship, personPath, securityPath, companyPath } from "../../lib/flagship";
import { buildCommittees, COMMITTEES_PATH } from "../../lib/committees";
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
    ["Congress trades", "Every disclosed trade by members", "/congress/"], ["Member directory", "Members of Congress by chamber, party, state, committee", "/congress-members/"], ["Insider trades", "Form 4 filings", "/insiders/"],
    ["Newest disclosures", "Latest filings", "/disclosures/"], ["Free CSV downloads", "Download the data", "/downloads/"], ["Lobbying", "Senate LDA filings", "/lobbying/"],
    ["Federal contracts", "USAspending awards", "/contracts/"], ["Campaign donations", "FEC receipts", "/donations/"],
    ["Treasury yields", "Yield curve", "/rates/treasury-yields/"], ["I-Bonds", "Current rate and next reset", "/rates/i-bonds/"], ["TIPS", "Real yields", "/rates/tips/"],
    ["Methodology", "How the numbers are built", "/methodology/"], ["Guides", "How to read the filings", "/guides/"], ["FAQ", "Short answers to common questions", "/faq/"],
  ] as const) rows.push(["Page", title, sub, url, 0]);
  const committees = buildCommittees(m, new Date().toISOString().slice(0, 10), personPath);
  if (committees.length) rows.push(["Page", "Committees of Congress", "Members of each committee and their disclosed trades", COMMITTEES_PATH, 0]);
  for (const c of committees) rows.push(["Committee", c.name, `${c.members.length} members, ${c.withTrades} with trades`, c.path, c.trades]);
  // Guides are found by their title and by the questions they answer.
  for (const g of await getGuides()) rows.push(["Guide", g.title, GROUPS.find((x) => x.key === g.group)?.label ?? "Guide", guidePath(g.slug), 0]);
  return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json; charset=utf-8" } });
};
