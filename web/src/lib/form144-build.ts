// Form 144 notices: the database read and the one lookup that needs the model
// (lib/form144.ts has the pure rules). Called once per build from lib/flagship.ts.
import type { Flagship, Person } from "./flagship-core";
import { personPath } from "./flagship-core";
import { caughtUp } from "./coverage-stored";
import { emptyForm144, sortNotices, type Form144Data, type Notice } from "./form144";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
const pad = (cik: string | null | undefined): string | null => (cik && /^\d{1,10}$/.test(cik.trim()) ? cik.trim().padStart(10, "0") : null);
const numOrNull = (x: unknown): number | null => (x == null ? null : Number.isFinite(Number(x)) ? Number(x) : null);

interface Row {
  accession: string; form_type: string; filed_at: string; issuer_cik: string | null; filer_cik: string | null; seller_name: string | null;
  relationships: string[] | null; security_class: string | null; shares: number | null; market_value: number | null; shares_outstanding: number | null;
  approx_sale_date: string | null; broker: string | null; plan_adoption_date: string | null; notice_date: string | null;
  sold_3m_shares: number | null; sold_3m_proceeds: number | null; nothing_sold_3m: boolean | null; source_url: string | null;
}

/**
 * Reads the newest filing date of the whole table and, only when the load has reached the build
 * day, the notices about the companies given (10-digit CIKs). While the load is still working
 * forward nothing is read, so no page, file or count can show a partial record.
 */
export async function loadForm144(sql: Sql, builtAt: string, companyCiks: ReadonlySet<string>): Promise<Form144Data> {
  const out = emptyForm144();
  const head = (await sql`select max(filed_at)::text as last from form144_notices`) as { last: string | null }[];
  out.lastFiled = head[0]?.last ?? null;
  out.shown = caughtUp(out.lastFiled, builtAt);
  if (!out.shown || !companyCiks.size) return out;
  const rows = (await sql`
    select n.accession, n.form_type, n.filed_at::text as filed_at, n.issuer_cik, n.filer_cik, n.seller_name, n.relationships, n.security_class,
           n.shares::float8 as shares, n.market_value::float8 as market_value, n.shares_outstanding::float8 as shares_outstanding,
           n.approx_sale_date::text as approx_sale_date, n.broker, n.plan_adoption_date::text as plan_adoption_date, n.notice_date::text as notice_date,
           n.sold_3m_shares::float8 as sold_3m_shares, n.sold_3m_proceeds::float8 as sold_3m_proceeds, n.nothing_sold_3m, n.source_url
      from form144_notices n
     where n.issuer_cik in (select lpad(c.cik, 10, '0') from site_companies c where c.cik is not null)`) as Row[];
  for (const r of rows) {
    const cik = pad(r.issuer_cik);
    if (!cik || !companyCiks.has(cik)) continue;
    const n: Notice = {
      accession: r.accession, formType: r.form_type, filedAt: r.filed_at, issuerCik: cik, filerCik: pad(r.filer_cik), sellerName: r.seller_name,
      relationships: Array.isArray(r.relationships) ? r.relationships : [], securityClass: r.security_class,
      shares: numOrNull(r.shares), marketValue: numOrNull(r.market_value), sharesOutstanding: numOrNull(r.shares_outstanding),
      approxSaleDate: r.approx_sale_date, broker: r.broker, planAdoptionDate: r.plan_adoption_date, noticeDate: r.notice_date,
      sold3mShares: numOrNull(r.sold_3m_shares), sold3mProceeds: numOrNull(r.sold_3m_proceeds), nothingSold3m: r.nothing_sold_3m, sourceUrl: r.source_url,
    };
    const xs = out.byCik.get(cik);
    if (xs) xs.push(n); else out.byCik.set(cik, [n]);
  }
  for (const [cik, xs] of out.byCik) out.byCik.set(cik, sortNotices(xs));
  return out;
}

/** The 10-digit CIKs of the companies on the site. */
export function siteCompanyCiks(m: Flagship): Set<string> {
  const out = new Set<string>();
  for (const c of m.companies.values()) { const k = pad(c.cik); if (k) out.add(k); }
  return out;
}

const byCikMemo = new WeakMap<Flagship, Map<string, Person>>();
/**
 * The page of the person who filed the notice, when the submission's filer number is the SEC
 * number of exactly one person with a static page here. The name shown stays the notice's own.
 */
export function sellerPath(m: Flagship, n: Notice): string | null {
  let map = byCikMemo.get(m);
  if (!map) {
    map = new Map();
    const twice = new Set<string>();
    for (const p of m.people.values()) {
      const k = pad(p.cik);
      if (!k || p.od || !personPath(p)) continue;
      if (map.has(k)) twice.add(k); else map.set(k, p);
    }
    for (const k of twice) map.delete(k);
    byCikMemo.set(m, map);
  }
  const p = n.filerCik ? map.get(n.filerCik) : undefined;
  return p ? personPath(p) : null;
}
