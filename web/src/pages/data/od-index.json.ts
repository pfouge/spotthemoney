// /data/od-index.json: the on-demand (market-scope) entities that a built page links to, so a verifier
// served from static files can accept those links without fetching them (they have no file; the
// Worker renders them). Compact on purpose: slugs and tickers only, only the ones the home feed links.
// Not the whole market. Stage 3b.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { homeFeed } from "../../lib/notable-build";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  const { data } = homeFeed(m);
  const linked = new Set<string>();
  for (const it of data.items) { if (it.np) linked.add(it.np); if (it.tp) linked.add(it.tp); }
  for (const c of data.clusters) { if (c.tp) linked.add(c.tp); for (const w of c.who) if (w.p) linked.add(w.p); }
  const insiders: string[] = [], stocks: string[] = [], companies: string[] = [];
  for (const p of m.market.people.values()) if (p.slug && linked.has(`/insiders/${p.slug}/`)) insiders.push(p.slug);
  for (const s of m.market.securities.values()) {
    const path = `/stocks/${s.ticker.toLowerCase()}/`;
    if (!linked.has(path)) continue;
    stocks.push(s.ticker.toLowerCase());
    const c = s.companyId != null ? m.market.companies.get(s.companyId) : undefined;
    if (c?.slug) companies.push(c.slug);
  }
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  return new Response(JSON.stringify({ insiders: uniq(insiders), companies: uniq(companies), stocks: uniq(stocks) }), { headers: { "content-type": "application/json; charset=utf-8" } });
};
