// Executive pay: the database read, the per-build memo and the hub's rows (lib/execpay.ts has the
// pure rules). Called once per build from lib/flagship.ts.
import type { Flagship } from "./flagship-core";
import { companyPath } from "./flagship-core";
import { industryOf } from "./entity";
import { divisionSlug } from "./industries";
import { siteCompanyByCik } from "./form144-build";
import { emptyPay, isPayMeasure, mergePay, packPayHub, type PayData, type PayFact, type PayHubCompany, type PayHubData, type PayYear, type ProxyPayFact } from "./execpay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
interface Row { cik: string; measure: string; fiscal_year_end: string; value: number | null; accession: string | null }
interface ProxyRow extends Row { seq: number; dimensioned: boolean }

/** Every stored figure about a company with a page (10-digit CIKs given), grouped by fiscal year: the
 *  frames data first, a proxy statement's figure where frames has none (mergePay in lib/execpay.ts).
 *  The proxy table is read in its own step, so a database without it still gives the frames figures. */
export async function loadPay(sql: Sql, companyCiks: ReadonlySet<string>): Promise<PayData> {
  const out = emptyPay();
  if (!companyCiks.size) return out;
  const rows = (await sql`
    select p.cik, p.measure, p.fiscal_year_end::text as fiscal_year_end, p.value::float8 as value, p.accession
      from exec_pay p
     where p.cik in (select lpad(c.cik, 10, '0') from site_companies c where c.cik is not null)`) as Row[];
  let proxyRows: ProxyRow[] = [];
  try {
    proxyRows = (await sql`
      select p.cik, p.measure, p.fiscal_year_end::text as fiscal_year_end, p.value::float8 as value, p.accession, p.seq::int as seq, p.dimensioned
        from exec_pay_proxy p
       where p.cik in (select lpad(c.cik, 10, '0') from site_companies c where c.cik is not null)`) as ProxyRow[];
  } catch (err) {
    console.warn("[web] executive pay from proxy statements skipped:", (err as Error).message);
  }
  const frames = new Map<string, PayFact[]>(), proxy = new Map<string, ProxyPayFact[]>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (const r of rows) {
    if (!companyCiks.has(r.cik) || !isPayMeasure(r.measure) || r.value == null || !Number.isFinite(Number(r.value))) continue;
    out.rows++;
    push(frames, r.cik, { measure: r.measure, fiscalYearEnd: r.fiscal_year_end, value: Number(r.value), accession: r.accession });
  }
  for (const r of proxyRows) {
    if (!companyCiks.has(r.cik) || !isPayMeasure(r.measure) || r.value == null || !Number.isFinite(Number(r.value))) continue;
    out.sources.proxyRows++;
    push(proxy, r.cik, { measure: r.measure, fiscalYearEnd: r.fiscal_year_end, value: Number(r.value), accession: r.accession, seq: Number(r.seq) || 0, dimensioned: r.dimensioned === true });
  }
  for (const cik of new Set([...frames.keys(), ...proxy.keys()])) {
    const ys: PayYear[] = mergePay(frames.get(cik) ?? [], proxy.get(cik) ?? [], out.sources);
    if (!ys.length) continue;
    out.byCik.set(cik, ys);
    const newest = out.byCik.get(cik)![0]?.fiscalYearEnd;
    if (newest && (!out.newestYearEnd || newest > out.newestYearEnd)) out.newestYearEnd = newest;
  }
  return out;
}

export function payOf(m: Flagship, cik: string | null | undefined): PayYear[] {
  if (!cik || !/^\d{1,10}$/.test(cik.trim())) return [];
  return m.execPay.byCik.get(cik.trim().padStart(10, "0")) ?? [];
}

const hubMemo = new WeakMap<PayData, { companies: PayHubCompany[]; data: PayHubData }>();
export function sitePayHub(m: Flagship): { companies: PayHubCompany[]; data: PayHubData } {
  let h = hubMemo.get(m.execPay);
  if (!h) {
    const companies: PayHubCompany[] = [];
    const all = siteCompanyByCik(m);
    for (const [cik, c] of all) {
      const ind = industryOf(m, c);
      companies.push({
        name: c.name, path: companyPath(c) ?? "", ticker: c.primaryTicker ?? "", cik,
        division: ind?.division ? { name: ind.division, slug: divisionSlug(ind.division) } : null,
      });
    }
    companies.sort((a, b) => a.name.localeCompare(b.name) || a.cik.localeCompare(b.cik));
    h = { companies, data: packPayHub(m.builtAt.slice(0, 10), companies, m.execPay.byCik) };
    hubMemo.set(m.execPay, h);
  }
  return h;
}
