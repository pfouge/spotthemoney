// Schedules 13D and 13G: the database read and the one lookup that needs the model
// (lib/schedule13.ts has the pure rules). Called once per build from lib/flagship.ts.
import type { Flagship } from "./flagship-core";
import { personPath, companyPath } from "./flagship-core";
import { caughtUp } from "./coverage-stored";
import { emptySchedule13, sortStatements, type Schedule13Data, type Statement } from "./schedule13";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
const pad = (cik: string | null | undefined): string | null => (cik && /^\d{1,10}$/.test(cik.trim()) ? cik.trim().padStart(10, "0") : null);
const numOrNull = (x: unknown): number | null => (x == null ? null : Number.isFinite(Number(x)) ? Number(x) : null);

interface Row {
  accession: string; form_type: string; schedule: string; is_amendment: boolean; filed_at: string; event_date: string | null;
  issuer_cik: string | null; issuer_cusip: string | null; security_class: string | null; filer_cik: string | null;
  reporter_name: string | null; reporter_count: number | null; shares_owned: number | null; percent_of_class: number | null;
  rules: string[] | null; purpose: string | null; source_url: string | null;
}

/**
 * Reads the newest filing date of the whole table and, only when the load has reached the build
 * day, the statements about the companies given (10-digit CIKs). While the load is still working
 * forward nothing is read, so no page, file or count can show a partial record: with half the
 * year on file a holder's "newest statement" would not be its newest.
 */
export async function loadSchedule13(sql: Sql, builtAt: string, companyCiks: ReadonlySet<string>): Promise<Schedule13Data> {
  const out = emptySchedule13();
  const head = (await sql`select max(filed_at)::text as last from schedule13_filings`) as { last: string | null }[];
  out.lastFiled = head[0]?.last ?? null;
  out.shown = caughtUp(out.lastFiled, builtAt);
  if (!out.shown || !companyCiks.size) return out;
  const rows = (await sql`
    select n.accession, n.form_type, n.schedule, n.is_amendment, n.filed_at::text as filed_at, n.event_date::text as event_date,
           n.issuer_cik, n.issuer_cusip, n.security_class, n.filer_cik, n.reporter_name, n.reporter_count,
           n.shares_owned::float8 as shares_owned, n.percent_of_class::float8 as percent_of_class, n.rules,
           n.payload->>'purpose' as purpose, n.source_url
      from schedule13_filings n
     where n.issuer_cik in (select lpad(c.cik, 10, '0') from site_companies c where c.cik is not null)`) as Row[];
  for (const r of rows) {
    const cik = pad(r.issuer_cik);
    if (!cik || !companyCiks.has(cik)) continue;
    const s: Statement = {
      accession: r.accession, formType: r.form_type, schedule: r.schedule === "13D" ? "13D" : "13G", isAmendment: !!r.is_amendment,
      filedAt: r.filed_at, eventDate: r.event_date, issuerCik: cik, issuerCusip: r.issuer_cusip, securityClass: r.security_class,
      filerCik: pad(r.filer_cik), reporterName: r.reporter_name, reporterCount: Number(r.reporter_count) || 0,
      shares: numOrNull(r.shares_owned), percent: numOrNull(r.percent_of_class), rules: Array.isArray(r.rules) ? r.rules : [],
      purpose: r.purpose, sourceUrl: r.source_url,
    };
    const xs = out.byCik.get(cik);
    if (xs) xs.push(s); else out.byCik.set(cik, [s]);
  }
  for (const [cik, xs] of out.byCik) out.byCik.set(cik, sortStatements(xs));
  return out;
}

const memo = new WeakMap<Flagship, Map<string, string>>();
/**
 * A page on this site for the filer of a statement: the person or the company whose SEC number
 * is the submission's filer number, when exactly one entity with a static page has it. The name
 * shown stays the statement's own.
 */
export function holderPath(m: Flagship, s: Statement): string | null {
  let map = memo.get(m);
  if (!map) {
    map = new Map();
    const twice = new Set<string>();
    const put = (cik: string | null | undefined, path: string | null) => {
      const k = pad(cik);
      if (!k || !path) return;
      if (map!.has(k)) twice.add(k); else map!.set(k, path);
    };
    for (const p of m.people.values()) if (!p.od) put(p.cik, personPath(p));
    for (const c of m.companies.values()) put(c.cik, companyPath(c));
    for (const k of twice) map.delete(k);
    memo.set(m, map);
  }
  return s.filerCik ? map.get(s.filerCik) ?? null : null;
}
