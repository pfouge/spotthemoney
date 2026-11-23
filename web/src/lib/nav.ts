// The site's navigation, in one place: the header menus, the footer columns and the group a page
// belongs to. Pure data and small helpers, so the unit test can read it.
//
// An item with live: false is never rendered anywhere (its page does not exist yet); the change
// that builds the page flips the flag. Descriptions are one plain line, under 60 characters.

export interface NavItem { href: string; label: string; desc: string; live: boolean }
export interface NavGroup { key: string; label: string; href: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { key: "congress", label: "Congress", href: "/congress/", items: [
    { href: "/congress/", label: "Overview and trade map", desc: "Who in Congress is buying and selling", live: true },
    { href: "/congress-trades/", label: "Trade screener", desc: "Every disclosed trade, filtered your way", live: true },
    { href: "/congress-members/", label: "Members", desc: "Each member, party, seat and activity", live: true },
    { href: "/congress-committees/", label: "Committees", desc: "Committee members and their disclosed trades", live: true },
    { href: "/congress-votes/", label: "Votes", desc: "Recorded floor votes by member", live: false },
    { href: "/outside-spending/", label: "Outside spending", desc: "Independent spending in federal races", live: false },
  ] },
  { key: "insiders", label: "Insiders", href: "/insiders/", items: [
    { href: "/insiders/", label: "Overview and trade map", desc: "Corporate insiders buying and selling", live: true },
    { href: "/disclosures/", label: "Newest filings", desc: "The latest disclosures as they arrive", live: true },
    { href: "/planned-sales/", label: "Planned sales", desc: "Form 144 notices of proposed sales", live: true },
    { href: "/large-holders/", label: "Large holders", desc: "Owners of more than 5 percent of a company", live: true },
    { href: "/institutional-holders/", label: "Institutional holders", desc: "What funds report holding each quarter", live: true },
  ] },
  { key: "companies", label: "Companies", href: "/companies/", items: [
    { href: "/stocks/", label: "Stocks", desc: "Insider and Congress activity by ticker", live: true },
    { href: "/companies/", label: "Companies", desc: "Insiders, contracts and lobbying by company", live: true },
    { href: "/industries/", label: "Industries", desc: "Companies grouped by SEC industry code", live: true },
    { href: "/company-financials/", label: "Financials screener", desc: "Filed revenue, income and assets side by side", live: true },
    { href: "/company-events/", label: "Company events", desc: "Filings that announce company news", live: false },
    { href: "/executive-pay/", label: "Executive pay", desc: "What companies report paying their officers", live: false },
  ] },
  { key: "washington", label: "Washington", href: "/washington/", items: [
    { href: "/washington/", label: "Overview", desc: "Money moving through Washington", live: true },
    { href: "/lobbying/", label: "Lobbying", desc: "Lobbying reports, clients and registrants", live: true },
    { href: "/lobbying-issues/", label: "Lobbying by issue", desc: "Filings grouped by the issue they name", live: true },
    { href: "/lobbyist-contributions/", label: "Lobbyist contributions", desc: "Gifts and contributions reported by lobbyists", live: false },
    { href: "/donations/", label: "Donations", desc: "Campaign receipts reported to the FEC", live: true },
    { href: "/contracts/", label: "Contracts", desc: "Federal contract awards by agency", live: true },
    { href: "/grants/", label: "Grants and loans", desc: "Federal grants and loans to recipients", live: false },
  ] },
  { key: "markets", label: "Markets", href: "/rates/", items: [
    { href: "/rates/", label: "Rates overview", desc: "Treasury rates and inflation in one place", live: true },
    { href: "/rates/i-bonds/", label: "I bonds", desc: "Current rate and the next reset", live: true },
    { href: "/rates/treasury-yields/", label: "Treasury yields", desc: "The yield curve, today and a month ago", live: true },
    { href: "/rates/tips/", label: "TIPS real yields", desc: "Inflation-protected Treasury yields", live: true },
    { href: "/markets/largest-stock-exchanges/", label: "World stock markets", desc: "The largest exchanges by market value", live: true },
  ] },
];

/** The footer's "About and data" column, in order. */
export const FOOT_ABOUT: { href: string; label: string }[] = [
  { href: "/about/", label: "About" },
  { href: "/guides/", label: "Guides" },
  { href: "/writing/", label: "Writing" },
  { href: "/faq/", label: "FAQ" },
  { href: "/methodology/", label: "Methodology" },
  { href: "/downloads/", label: "Downloads" },
  { href: "/feeds/", label: "RSS feeds" },
  { href: "/developers/", label: "Developers" },
  { href: "/guides/how-to-cite-and-reuse/", label: "How to cite" },
  { href: "/corrections/", label: "Corrections" },
  { href: "/terms/", label: "Terms" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/contact/", label: "Contact" },
  { href: "/llms.txt", label: "llms.txt" },
];

export function liveItems(group: NavGroup): NavItem[] { return group.items.filter((i) => i.live); }

// Prefix rules for groupFor: the longest matching prefix wins. A prefix ending in "-" matches a
// family of pages (/congress-trades/, /congress-members/ ...).
const RULES: [prefix: string, key: string][] = [
  ["/congress/", "congress"], ["/congress-", "congress"], ["/outside-spending/", "washington"],
  ["/insiders/", "insiders"], ["/disclosures/", "insiders"], ["/planned-sales/", "insiders"], ["/large-holders/", "insiders"], ["/institutional-holders/", "insiders"],
  ["/stocks/", "companies"], ["/companies/", "companies"], ["/industries/", "companies"], ["/company-", "companies"], ["/executive-pay/", "companies"],
  ["/washington/", "washington"], ["/lobbying", "washington"], ["/lobbyist-", "washington"], ["/donations/", "washington"], ["/contracts/", "washington"], ["/grants/", "washington"],
  ["/rates/", "markets"], ["/markets/", "markets"],
];

/** The group a page belongs to, or null (home, About, Guides, Writing and so on). */
export function groupFor(pathname: string): NavGroup | null {
  let best: [string, string] | null = null;
  for (const r of RULES) if (pathname.startsWith(r[0]) && (!best || r[0].length > best[0].length)) best = r;
  return best ? NAV.find((g) => g.key === best![1]) ?? null : null;
}
