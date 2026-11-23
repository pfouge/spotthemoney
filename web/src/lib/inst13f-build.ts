// Form 13F institutional holdings: the database read (lib/inst13f.ts has the pure rules).
// Called once per build from lib/flagship.ts. The build never reads inst_holdings row by row:
// four set-based statements return small results (the periods, one row per company and quarter,
// the 25 largest managers per company, the 200 largest managers).
import type { Flagship } from "./flagship-core";
import { holderPath } from "./schedule13-build";
import type { Statement } from "./schedule13";
import {
  emptyInst, pickPeriods, instShown, cleanName, INST_TOP, INST_HUB_MANAGERS,
  type InstData, type InstCompany, type InstManagerRow, type PeriodRow,
} from "./inst13f";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
const num = (x: unknown): number => (x == null ? 0 : Number.isFinite(Number(x)) ? Number(x) : 0);
const numOrNull = (x: unknown): number | null => (x == null ? null : Number.isFinite(Number(x)) ? Number(x) : null);

// A row is the shares themselves when it has no put or call, and a count of shares (not a principal amount).
const PLAIN = `btrim(put_call) = '' and amount_type = 'SH'`;

/**
 * Reads the quarters on file and, only when the newer quarter is recent enough, the figures for the
 * companies given (10-digit CIKs). Nothing is read while the load is stale or incomplete.
 */
export async function loadInst(sql: Sql, builtAt: string, companyCiks: ReadonlySet<string>): Promise<InstData> {
  const out = emptyInst();
  const today = String(builtAt).slice(0, 10);
  // 1. The quarters: distinct managers and newest filing per quarter end. Newest eight only.
  const periodRows = (await sql`
    select period::text as period, count(distinct manager_cik)::int as managers, max(filed)::text as last_filed
      from inst_holdings
     where btrim(put_call) = '' and amount_type = 'SH' and period <= ${today}::date and period >= (${today}::date - interval '2 years')
     group by period order by period desc limit 8`) as { period: string; managers: number; last_filed: string | null }[];
  const periods: PeriodRow[] = periodRows.map((r) => ({ period: r.period, managers: Number(r.managers), lastFiled: r.last_filed }));
  const { p1, p0 } = pickPeriods(periods, builtAt);
  if (!p1) return out;
  out.period = p1.period;
  out.prior = p0?.period ?? null;
  out.managersInPeriod = p1.managers;
  out.lastFiled = p1.lastFiled;
  out.shown = instShown(p1.period, p1.lastFiled, builtAt);
  if (!out.shown || !companyCiks.size) return out;
  const ciks = [...companyCiks];
  const p1d = p1.period, p0d = p0?.period ?? "1900-01-01";

  // 2. One row per company and quarter: managers, summed shares and value; managers with options.
  const agg = (await sql`
    select issuer_cik, period::text as period,
           count(distinct manager_cik) filter (where btrim(put_call) = '' and amount_type = 'SH')::int as managers,
           coalesce(sum(shares) filter (where btrim(put_call) = '' and amount_type = 'SH'), 0)::float8 as shares,
           coalesce(sum(value) filter (where btrim(put_call) = '' and amount_type = 'SH'), 0)::float8 as value,
           count(distinct manager_cik) filter (where upper(btrim(put_call)) in ('PUT', 'CALL'))::int as options
      from inst_holdings
     where period in (${p1d}::date, ${p0d}::date) and issuer_cik = any(${ciks})
     group by issuer_cik, period`) as { issuer_cik: string; period: string; managers: number; shares: number; value: number; options: number }[];
  const prev = new Map<string, number>();
  for (const r of agg) {
    if (r.period === p0?.period) prev.set(r.issuer_cik, num(r.managers));
  }
  for (const r of agg) {
    if (r.period !== p1d || num(r.managers) <= 0) continue;
    const c: InstCompany = {
      cik: r.issuer_cik, managers: num(r.managers), shares: num(r.shares), value: num(r.value), options: num(r.options),
      prevManagers: p0 ? (prev.get(r.issuer_cik) ?? 0) : null, top: [],
    };
    out.byCik.set(r.issuer_cik, c);
  }

  // 3. The INST_TOP largest managers per company in the newer quarter (sum per manager and company first),
  //    with the same manager's shares in the prior quarter.
  const top = (await sql`
    with m as (
      select issuer_cik, manager_cik, sum(shares)::float8 as shares, sum(value)::float8 as value,
             (array_agg(accession order by filed desc nulls last, accession desc))[1] as accession, max(filed)::text as filed
        from inst_holdings
       where period = ${p1d}::date and ${sql.unsafe(PLAIN)} and issuer_cik = any(${ciks})
       group by issuer_cik, manager_cik
    ), r as (
      select m.*, row_number() over (partition by issuer_cik order by value desc nulls last, manager_cik) as rn from m
    )
    select r.issuer_cik, r.manager_cik, n.name, r.shares, r.value, r.accession, r.filed,
           (select sum(h.shares)::float8 from inst_holdings h
             where h.period = ${p0d}::date and h.issuer_cik = r.issuer_cik and h.manager_cik = r.manager_cik
               and btrim(h.put_call) = '' and h.amount_type = 'SH') as prev_shares
      from r left join inst_managers n on n.cik = r.manager_cik
     where r.rn <= ${INST_TOP}
     order by r.issuer_cik, r.rn`) as { issuer_cik: string; manager_cik: string; name: string | null; shares: number; value: number; accession: string; filed: string | null; prev_shares: number | null }[];
  for (const r of top) {
    const c = out.byCik.get(r.issuer_cik);
    if (!c) continue;
    const row: InstManagerRow = {
      cik: r.manager_cik, name: cleanName(r.name) || `Manager ${r.manager_cik}`, shares: num(r.shares), value: num(r.value),
      prevShares: p0 ? numOrNull(r.prev_shares) : null, accession: r.accession, filed: r.filed,
    };
    c.top.push(row);
  }

  // 4. The managers with the largest reported value across the companies on the site.
  const mgr = (await sql`
    select h.manager_cik, n.name, count(distinct h.issuer_cik)::int as issuers, sum(h.value)::float8 as value
      from inst_holdings h left join inst_managers n on n.cik = h.manager_cik
     where h.period = ${p1d}::date and ${sql.unsafe(PLAIN.replaceAll("put_call", "h.put_call").replaceAll("amount_type", "h.amount_type"))} and h.issuer_cik = any(${ciks})
     group by h.manager_cik, n.name
     order by value desc nulls last, h.manager_cik
     limit ${INST_HUB_MANAGERS}`) as { manager_cik: string; name: string | null; issuers: number; value: number }[];
  out.managers = mgr.map((r) => ({ cik: r.manager_cik, name: cleanName(r.name) || `Manager ${r.manager_cik}`, issuers: num(r.issuers), value: num(r.value) }));
  return out;
}

/** A page on this site for a manager, only when its SEC number belongs to exactly one person or company with a static page. */
export function managerPath(m: Flagship, cik: string): string | null {
  return holderPath(m, { filerCik: cik } as Statement);
}
