// Military parts orders: reads nsnexplorer.com's database at build time (lib/dla.ts has the rules).
// Called once per build from lib/flagship.ts when NSN_DATABASE_URL is set (a read-only login that can
// select pub.contract_actions, pub.suppliers and pub.nsns only). Two passes over the last 12 months
// of DIBBS award records: totals per supplier code with its name, then the order rows of the codes
// that match a company with a page. A missing variable or a failed read leaves the section out.
import postgres from "postgres";
import type { Flagship } from "./flagship-core";
import { companyDla, emptyDla, makeMatcher, DLA_WINDOW_DAYS, CEILING_TYPES, type DlaData, type OrderRow, type SupplierRef } from "./dla";

/** The order rule in SQL (lib/dla.ts isOrder): a record with a delivery order, or one whose PIID is not a base contract. */
const ORDER_SQL = `(raw->>'deliveryOrder' is not null and raw->>'deliveryOrder' <> '' or upper(substr(coalesce(raw->>'awardNumber', ''), 9, 1)) not in (${CEILING_TYPES.map((t) => `'${t}'`).join(", ")}))`;
const WINDOW_SQL = `raw ? 'cage' and action_date >= current_date - ${DLA_WINDOW_DAYS} and action_date <= current_date and obligation > 0`;

interface CageRow { cage: string; rn: string | null; sname: string | null; n: number; v: number }
interface RawOrder { cage: string; d: string; nsn: string | null; item: string | null; piid: string | null; v: number; url: string | null }

export async function loadDla(m: Pick<Flagship, "companies" | "builtAt">, url: string | undefined = process.env.NSN_DATABASE_URL): Promise<DlaData> {
  const out = emptyDla();
  if (!url) return out;
  // nsnexplorer's project requires SSL for this login; the local stand-in has none.
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, { max: 1, connect_timeout: 20, idle_timeout: 5, prepare: false, ssl: local ? false : "require" });
  try {
    const cos = [...m.companies.values()].filter((c) => c.slug).map((c) => ({ id: c.id, name: c.name, ticker: c.primaryTicker }));
    const match = makeMatcher(cos);
    const cages = (await sql.unsafe(`
      select a.cage, a.rn, s.name as sname, a.n::int as n, a.v::float8 as v
        from (select raw->>'cage' as cage, max(recipient_name) as rn, count(*) as n, sum(obligation) as v
                from pub.contract_actions where ${WINDOW_SQL} and ${ORDER_SQL} group by 1) a
        left join pub.suppliers s on s.cage = a.cage`)) as unknown as CageRow[];
    out.cages = cages.length;
    const refs = new Map<string, { companyId: number; ref: SupplierRef }>();
    for (const c of cages) {
      const hit = match([c.rn, c.sname]);
      if (!hit) continue;
      refs.set(c.cage, { companyId: hit.companyId, ref: { cage: c.cage, name: (c.sname ?? c.rn ?? c.cage).trim(), rule: hit.rule, orders: c.n, value: c.v } });
    }
    out.matchedCages = refs.size;
    if (refs.size) {
      const rows = (await sql.unsafe(`
        select raw->>'cage' as cage, action_date::text as d, raw->>'nsn' as nsn, raw->>'nomenclature' as item,
               coalesce(nullif(raw->>'deliveryOrder', ''), raw->>'awardNumber') as piid, obligation::float8 as v, source_url as url
          from pub.contract_actions
         where ${WINDOW_SQL} and ${ORDER_SQL} and raw->>'cage' = any($1)`, [[...refs.keys()]])) as unknown as RawOrder[];
      const builtOn = m.builtAt.slice(0, 10);
      const byCompany = new Map<number, { sup: SupplierRef[]; rows: OrderRow[] }>();
      for (const { companyId, ref } of refs.values()) {
        const g = byCompany.get(companyId) ?? { sup: [], rows: [] };
        g.sup.push(ref); byCompany.set(companyId, g);
      }
      for (const r of rows) {
        const companyId = refs.get(r.cage)?.companyId; if (companyId == null || !r.nsn) continue;
        byCompany.get(companyId)!.rows.push({ cage: r.cage, date: r.d, nsn: r.nsn, item: r.item, piid: r.piid, value: Number(r.v), url: r.url });
        if (!out.newest || r.d > out.newest) out.newest = r.d;
      }
      for (const [id, g] of byCompany) { const c = companyDla(g.sup, g.rows, builtOn); if (c) out.byCompany.set(id, c); }
      out.builtOn = builtOn;
    }
    out.connected = true;
    return out;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
