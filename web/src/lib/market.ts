// Market-scope entities for the sitemaps (stage 3a): the companies, tickers and insiders that have
// no static page but are rendered by the Worker on request (pages/{insiders,stocks,companies}/
// [...rest].astro). Build time only. An entity is listed iff its page would be indexable, which is
// the page's own rule: it has at least one open-market (code P or S, non-derivative) row that
// passes the publishing bar (od_vis in migration 0020). lastmod is the newest filing date behind
// the page. Never read by the Worker, and not part of flagship's model: the model stays the
// tracked set.
import { FORM4_FLOOR } from "@stm/shared";
import { flagshipSql } from "./flagship";

export interface MarketEntry { key: string; lastmod: string }
export interface MarketIndexable { insiders: MarketEntry[]; stocks: MarketEntry[]; companies: MarketEntry[] }

export const SITEMAP_URL_LIMIT = 10000;

/** Empty when there is no database, or migration 0020 is not applied yet. Never throws. */
export async function getMarketIndexable(): Promise<MarketIndexable> {
  const sql = flagshipSql();
  const none: MarketIndexable = { insiders: [], stocks: [], companies: [] };
  if (!sql) return none;
  const vis = sql`od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, false, ${FORM4_FLOOR}::date)`;
  const open = sql`bool_or(t.txn_code in ('P', 'S') and not coalesce(t.is_derivative, false))`;
  try {
    const insiders = await sql<{ k: string; d: string }[]>`
      select p.slug::text as k, ((max(f.filed_at)) at time zone 'UTC')::date::text as d
        from people p join transactions t on t.person_id = p.id join filings f on f.id = t.filing_id
       where p.slug is not null and ${vis}
         and not exists (select 1 from person_roles r where r.person_id = p.id and r.role_kind = 'congress')
         and not (od_person_visible(p.id) and exists (select 1 from person_roles r where r.person_id = p.id and r.role_kind = 'insider'
                   and (r.company_id is null or exists (select 1 from companies c where c.id = r.company_id and c.tracked))))
       group by p.slug having ${open} order by p.slug::text`;
    const stocks = await sql<{ k: string; d: string }[]>`
      select lower(s.ticker::text) as k, ((max(f.filed_at)) at time zone 'UTC')::date::text as d
        from securities s join transactions t on t.security_id = s.id join filings f on f.id = t.filing_id
       where ${vis}
         and not exists (select 1 from securities a where lower(a.ticker::text) = lower(s.ticker::text) and a.is_active)
       group by lower(s.ticker::text) having ${open} order by 1`;
    const companies = await sql<{ k: string; d: string }[]>`
      select c.slug::text as k, ((max(f.filed_at)) at time zone 'UTC')::date::text as d
        from companies c join securities s on s.company_id = c.id join transactions t on t.security_id = s.id join filings f on f.id = t.filing_id
       where c.slug is not null and not c.tracked and ${vis}
       group by c.slug having ${open} order by c.slug::text`;
    const m = (r: { k: string; d: string }[]) => r.map((x) => ({ key: x.k, lastmod: x.d }));
    return { insiders: m(insiders), stocks: m(stocks), companies: m(companies) };
  } catch (e) {
    console.warn("[web] market sitemaps skipped:", (e as Error).message);
    return none;
  }
}
