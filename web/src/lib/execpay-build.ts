// Executive pay: the database read, the per-build memo and the hub's rows (lib/execpay.ts has the
// pure rules). Called once per build from lib/flagship.ts.
import type { Flagship } from "./flagship-core";
import { companyPath } from "./flagship-core";
import { industryOf } from "./entity";
import { divisionSlug } from "./industries";
import { siteCompanyByCik } from "./form144-build";
import { emptyPay, isPayMeasure, sortYears, packPayHub, type PayData, type PayHubCompany, type PayHubData, type PayYear } from "./execpay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
interface Row { cik: string; measure: string; fiscal_year_end: string; value: number | null; accession: string | null }

/** Every stored figure about a company with a page (10-digit CIKs given), grouped by fiscal year. */
export async function loadPay(sql: Sql, companyCiks: ReadonlySet<string>): Promise<PayData> {
  const out = emptyPay();
  if (!companyCiks.size) return out;
  const rows = (await sql`
    select p.cik, p.measure, p.fiscal_year_end::text as fiscal_year_end, p.value::float8 as value, p.accession
      from exec_pay p
     where p.cik in (select lpad(c.cik, 10, '0') from site_companies c where c.cik is not null)`) as Row[];
  const by = new Map<string, Map<string, { y: PayYear; peoAcc: string | null }>>();
  for (const r of rows) {
    if (!companyCiks.has(r.cik) || !isPayMeasure(r.measure) || r.value == null || !Number.isFinite(Number(r.value))) continue;
    out.rows++;
    let years = by.get(r.cik);
    if (!years) by.set(r.cik, (years = new Map()));
    let e = years.get(r.fiscal_year_end);
    if (!e) years.set(r.fiscal_year_end, (e = { y: { fiscalYearEnd: r.fiscal_year_end, values: {}, accession: null }, peoAcc: null }));
    e.y.values[r.measure] = Number(r.value);
    // The filing is the principal executive officer total's, else any figure's (newest accession when several).
    if (r.measure === "peo_total") e.peoAcc = r.accession;
    else if (r.accession && (!e.y.accession || r.accession > e.y.accession)) e.y.accession = r.accession;
  }
  for (const [cik, years] of by) {
    const ys = [...years.values()].map((e) => ({ ...e.y, accession: e.peoAcc ?? e.y.accession }));
    out.byCik.set(cik, sortYears(ys));
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
