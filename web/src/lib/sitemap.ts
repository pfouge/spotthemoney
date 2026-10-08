// Sitemap model (roadmap B.2): one child sitemap per entity type, generated at build from the
// same in-memory graph the pages use, so a URL is in the sitemap iff the page exists AND has
// data on it (members and tickers with no published transactions are noindex and left out).
// lastmod is the newest filing/record date behind the page (or the build date for static pages),
// which is also what scripts/indexnow-ping.mjs uses to decide which URLs to ping.

import { getFlagship, personPath, companyPath, securityPath } from "./flagship";
import { SITE_URL } from "./seo";
import { getGuides, guidePath } from "./guides";

export interface SitemapUrl { loc: string; lastmod: string; changefreq?: string; priority?: number }
export interface ChildSitemap { name: string; urls: SitemapUrl[] }

const day = (iso: string | null | undefined, fallback: string) => (iso ?? fallback).slice(0, 10);

export async function buildSitemaps(): Promise<ChildSitemap[]> {
  const model = await getFlagship();
  const built = model.builtAt.slice(0, 10);
  const latestTxn = model.txns[0]?.filedAt ?? model.builtAt;
  const guides = await getGuides();

  const pages: SitemapUrl[] = [
    { loc: "/", lastmod: built, changefreq: "daily", priority: 1 },
    { loc: "/rates/", lastmod: built, changefreq: "daily", priority: 0.8 },
    { loc: "/rates/i-bonds/", lastmod: built, changefreq: "daily", priority: 0.9 },
    { loc: "/rates/treasury-yields/", lastmod: built, changefreq: "daily", priority: 0.9 },
    { loc: "/rates/tips/", lastmod: built, changefreq: "daily", priority: 0.8 },
    { loc: "/insiders/", lastmod: day(latestTxn, built), changefreq: "daily", priority: 0.9 },
    { loc: "/congress/", lastmod: day(latestTxn, built), changefreq: "daily", priority: 0.9 },
    { loc: "/stocks/", lastmod: built, changefreq: "daily", priority: 0.7 },
    { loc: "/companies/", lastmod: built, changefreq: "daily", priority: 0.7 },
    { loc: "/washington/", lastmod: built, changefreq: "daily", priority: 0.7 },
    { loc: "/donations/", lastmod: built, changefreq: "daily", priority: 0.7 },
    { loc: "/lobbying/", lastmod: built, changefreq: "daily", priority: 0.7 },
    { loc: "/contracts/", lastmod: built, changefreq: "daily", priority: 0.7 },
    { loc: "/disclosures/", lastmod: day(latestTxn, built), changefreq: "hourly", priority: 0.8 },
    { loc: "/methodology/", lastmod: built, changefreq: "monthly", priority: 0.5 },
    { loc: "/corrections/", lastmod: built, changefreq: "monthly", priority: 0.3 },
    { loc: "/about/", lastmod: built, changefreq: "monthly", priority: 0.3 },
    { loc: "/terms/", lastmod: built, changefreq: "yearly", priority: 0.2 },
    { loc: "/privacy/", lastmod: built, changefreq: "yearly", priority: 0.2 },
    { loc: "/guides/", lastmod: guides.map((g) => g.updated).sort().at(-1) ?? built, changefreq: "weekly", priority: 0.7 },
    { loc: "/faq/", lastmod: guides.map((g) => g.updated).sort().at(-1) ?? built, changefreq: "weekly", priority: 0.6 },
    ...guides.map((g) => ({ loc: guidePath(g.slug), lastmod: g.updated, changefreq: "monthly" as const, priority: 0.6 })),
  ];

  const insiders: SitemapUrl[] = [];
  const congress: SitemapUrl[] = [];
  for (const p of model.people.values()) {
    const path = personPath(p);
    if (!path) continue;
    // Pages with no published transactions are noindex (see the page templates) and stay
    // out of the sitemap: a URL is listed iff it has data to show.
    if (p.txns.length === 0) continue;
    const u = { loc: path, lastmod: day(p.lastFiledAt, built), changefreq: "weekly", priority: 0.6 };
    (p.isCongress ? congress : insiders).push(u);
  }
  const companies: SitemapUrl[] = [...model.companies.values()].filter((c) => c.slug).map((c) => ({
    loc: companyPath(c)!, lastmod: day(c.txns[0]?.filedAt, built), changefreq: "weekly", priority: 0.6,
  }));
  const seen = new Set<string>();
  const stocks: SitemapUrl[] = [];
  for (const s of [...model.securities.values()].sort((a, b) => (a.type === "equity" ? -1 : 1) - (b.type === "equity" ? -1 : 1))) {
    const loc = securityPath(s);
    if (seen.has(loc)) continue;
    if (s.txns.length === 0) continue; // empty stock pages are noindex
    seen.add(loc);
    stocks.push({ loc, lastmod: day(s.txns[0]?.filedAt, built), changefreq: "weekly", priority: 0.6 });
  }

  const sorter = (a: SitemapUrl, b: SitemapUrl) => a.loc.localeCompare(b.loc);
  return [
    { name: "pages", urls: pages },
    { name: "insiders", urls: insiders.sort(sorter) },
    { name: "congress", urls: congress.sort(sorter) },
    { name: "companies", urls: companies.sort(sorter) },
    { name: "stocks", urls: stocks.sort(sorter) },
  ].filter((c) => c.urls.length > 0);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderIndex(children: ChildSitemap[]): string {
  const built = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    children.map((c) => `  <sitemap><loc>${SITE_URL}/sitemaps/${c.name}.xml</loc><lastmod>${c.urls.reduce((m, u) => (u.lastmod > m ? u.lastmod : m), "0000") || built}</lastmod></sitemap>`).join("\n") +
    `\n</sitemapindex>\n`;
}

export function renderChild(child: ChildSitemap): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    child.urls.map((u) => `  <url><loc>${esc(SITE_URL + u.loc)}</loc><lastmod>${u.lastmod}</lastmod>${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ""}${u.priority != null ? `<priority>${u.priority}</priority>` : ""}</url>`).join("\n") +
    `\n</urlset>\n`;
}
