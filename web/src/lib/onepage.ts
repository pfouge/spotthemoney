// One page per company. A company that has a ticker page of its own is shown on that page,
// /stocks/<ticker>/, and has no separate /companies/<slug>/ page: the old address redirects
// (pages/companies/[...rest].astro reads /data/company-redirects.json). A company with no ticker
// page (a fund or trust with insiders on file) keeps /companies/<slug>/. A ticker with no company
// (an ETF, a fund Congress trades) keeps a ticker-only page.
// Which ticker: the company's main ticker when that ticker's page shows a security the company
// owns; otherwise the company's own security with a page, shares before other kinds, the one with
// the most rows first. A company's other tickers keep their pages and link to the main one.
import type { Company, Flagship, Security } from "./flagship-core";
import { securityPath } from "./flagship-core";

/** The security each ticker's page shows: the equity row when several kinds share a ticker. */
export function pageSecurities(m: Pick<Flagship, "securities">): Map<string, Security> {
  const map = new Map<string, Security>();
  for (const s of [...m.securities.values()].sort((a, b) => (a.type === "equity" ? -1 : 1) - (b.type === "equity" ? -1 : 1))) { const k = s.ticker.toLowerCase(); if (!map.has(k)) map.set(k, s); }
  return map;
}

export function homeSecurity(c: Company, pages: Map<string, Security>, securities: Map<number, Security>): Security | null {
  const main = c.primaryTicker ? pages.get(c.primaryTicker.toLowerCase()) : undefined;
  if (main && main.companyId === c.id) return main;
  const own = c.securityIds.map((id) => securities.get(id)).filter((s): s is Security => !!s && pages.get(s.ticker.toLowerCase()) === s && s.companyId === c.id);
  const rank = (s: Security) => (s.type === "equity" ? 0 : s.type === "adr" ? 1 : 2);
  own.sort((a, b) => rank(a) - rank(b) || b.txns.length - a.txns.length || a.ticker.localeCompare(b.ticker));
  return own[0] ?? null;
}

export interface OnePageStats { companies: number; onTicker: number; companyOnly: number; tickers: number; tickerOnly: number }
/** Sets `stockPath` on every company that is shown on a ticker page. Run once when the model is built. */
export function assignCompanyPages(m: Pick<Flagship, "securities" | "companies">): OnePageStats {
  const pages = pageSecurities(m);
  let onTicker = 0, companies = 0;
  const used = new Set<string>();
  for (const c of m.companies.values()) {
    c.stockPath = null;
    if (!c.slug) continue;
    companies++;
    const s = homeSecurity(c, pages, m.securities);
    if (!s) continue;
    c.stockPath = securityPath(s);
    used.add(s.ticker.toLowerCase());
    onTicker++;
  }
  return { companies, onTicker, companyOnly: companies - onTicker, tickers: pages.size, tickerOnly: pages.size - used.size };
}

/** True when the company has a record of its own to show (the test for listing its page). */
export function companyHasRecords(c: Company): boolean { return c.txns.length > 0 || c.contracts.length > 0 || c.lobbying.length > 0; }

/** Old company address (slug) to the ticker page that replaced it. */
export function companyRedirects(m: Pick<Flagship, "companies">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of [...m.companies.values()].sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? ""))) if (c.slug && c.stockPath) out[c.slug.toLowerCase()] = c.stockPath;
  return out;
}

export function onePageLog(s: OnePageStats): string {
  return `one page per company: ${s.companies} companies with a page, ${s.onTicker} shown on their ticker page (old address redirects), ${s.companyOnly} keep a company page; ${s.tickers} ticker pages, ${s.tickerOnly} of them with no company page folded in`;
}
