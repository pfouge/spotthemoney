// Company financials: the database read and the per-company memo (lib/financials.ts has the pure
// rules). Called once per build from lib/flagship.ts.
import type { Flagship } from "./flagship-core";
import { companyFinancials, emptyFinancials, LOADED_CONCEPTS, QUARTER_DAYS, YEAR_DAYS, type CompanyFinancials, type FinancialsData, type FinRow } from "./financials";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

interface Row { cik: string; concept: string; tag: string; unit: string; period_start: string | null; period_end: string; value: number; form: string; filed: string; accession: string }

/**
 * Reads, for the companies given (10-digit CIKs), the stored figures a page can show: quarter and
 * fiscal-year periods and balance-sheet dates of the shown concepts. Year-to-date rows of other
 * lengths stay in the database.
 */
export async function loadFinancials(sql: Sql, companyCiks: ReadonlySet<string>): Promise<FinancialsData> {
  const out = emptyFinancials();
  if (!companyCiks.size) return out;
  const rows = (await sql`
    select f.cik, f.concept, f.tag, f.unit, f.period_start::text as period_start, f.period_end::text as period_end,
           f.value::float8 as value, f.form, f.filed::text as filed, f.accession
      from company_financials f
     where f.concept in ${sql([...LOADED_CONCEPTS])}
       and (f.period_start is null
            or (f.period_end - f.period_start) between ${QUARTER_DAYS[0]} and ${QUARTER_DAYS[1]}
            or (f.period_end - f.period_start) between ${YEAR_DAYS[0]} and ${YEAR_DAYS[1]})`) as Row[];
  for (const r of rows) {
    if (!companyCiks.has(r.cik) || !Number.isFinite(Number(r.value))) continue;
    const x: FinRow = { concept: r.concept, tag: r.tag, unit: r.unit, start: r.period_start, end: r.period_end, value: Number(r.value), form: r.form, filed: r.filed, accession: r.accession };
    const xs = out.byCik.get(r.cik);
    if (xs) xs.push(x); else out.byCik.set(r.cik, [x]);
    if (!out.newestFiled || x.filed > out.newestFiled) out.newestFiled = x.filed;
  }
  return out;
}

const memo = new WeakMap<FinancialsData, Map<string, CompanyFinancials | null>>();
/** A company's fiscal years and quarters, or null when it has none on file. Worked out once per build. */
export function financialsOf(m: Flagship, cik: string | null | undefined): CompanyFinancials | null {
  if (!cik || !/^\d{1,10}$/.test(cik.trim())) return null;
  const k = cik.trim().padStart(10, "0");
  let map = memo.get(m.financials);
  if (!map) { map = new Map(); memo.set(m.financials, map); }
  if (!map.has(k)) { const rows = m.financials.byCik.get(k); map.set(k, rows ? companyFinancials(rows) : null); }
  return map.get(k) ?? null;
}
