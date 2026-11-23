// Company events (Form 8-K): the database read, the per-build memo and the hub's company list
// (lib/events8k.ts has the pure rules). Called once per build from lib/flagship.ts.
import type { Flagship } from "./flagship-core";
import { companyPath } from "./flagship-core";
import { industryOf } from "./entity";
import { divisionSlug } from "./industries";
import { siteCompanyByCik } from "./form144-build";
import { emptyEvents, eventsInWindow, sortEvents, packHub, type CompanyEvent, type EventsData, type HubCompany, type HubData } from "./events8k";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
interface Row { accession: string; cik: string; form: string; filed: string; report_date: string | null; items: string[] | null; source_url: string | null }

/** Every stored report about a company with a page (10-digit CIKs given). */
export async function loadEvents(sql: Sql, companyCiks: ReadonlySet<string>): Promise<EventsData> {
  const out = emptyEvents();
  if (!companyCiks.size) return out;
  const rows = (await sql`
    select e.accession, e.cik, e.form, e.filed::text as filed, e.report_date::text as report_date, e.items, e.source_url
      from company_events e
     where e.cik in (select lpad(c.cik, 10, '0') from site_companies c where c.cik is not null)`) as Row[];
  for (const r of rows) {
    if (!companyCiks.has(r.cik)) continue;
    const e: CompanyEvent = { accession: r.accession, cik: r.cik, form: r.form, filed: r.filed, reportDate: r.report_date, items: Array.isArray(r.items) ? r.items : [], sourceUrl: r.source_url };
    const xs = out.byCik.get(r.cik);
    if (xs) xs.push(e); else out.byCik.set(r.cik, [e]);
    out.rows++;
    if (!out.newestFiled || e.filed > out.newestFiled) out.newestFiled = e.filed;
  }
  for (const [cik, xs] of out.byCik) out.byCik.set(cik, sortEvents(xs));
  return out;
}

/** A company's reports, newest first, or an empty list. */
export function eventsOf(m: Flagship, cik: string | null | undefined): CompanyEvent[] {
  if (!cik || !/^\d{1,10}$/.test(cik.trim())) return [];
  return m.events.byCik.get(cik.trim().padStart(10, "0")) ?? [];
}

const hubMemo = new WeakMap<EventsData, { companies: HubCompany[]; data: HubData }>();
/** The companies and packed rows of /company-events/ (and its data file), worked out once per build. */
export function siteEventsHub(m: Flagship): { companies: HubCompany[]; data: HubData } {
  let h = hubMemo.get(m.events);
  if (!h) {
    const companies: HubCompany[] = [];
    for (const [cik, c] of siteCompanyByCik(m)) {
      if (!m.events.byCik.has(cik)) continue;
      const ind = industryOf(m, c);
      companies.push({
        name: c.name, path: companyPath(c) ?? "", ticker: c.primaryTicker ?? "", cik,
        division: ind?.division ? { name: ind.division, slug: divisionSlug(ind.division) } : null,
      });
    }
    companies.sort((a, b) => a.name.localeCompare(b.name) || a.cik.localeCompare(b.cik));
    const built = m.builtAt.slice(0, 10);
    h = { companies, data: packHub(built, companies, m.events.byCik) };
    hubMemo.set(m.events, h);
  }
  return h;
}
/** Window rows for one company, for pages. */
export const eventsInYear = (m: Flagship, cik: string | null | undefined) => eventsInWindow(eventsOf(m, cik), m.builtAt.slice(0, 10));
