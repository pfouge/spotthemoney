// Industry pages (/industries/ and /industries/<division>/): the companies on the site grouped by
// the industry code (SIC) the SEC has assigned to each, with plain counts of the open-market
// insider trades and congressional trades disclosed in the last 12 months.
// Pure: the pages, the sitemap, the search index, the company and stock pages' Industry link and
// the unit tests all read `buildIndustries`.
//
// Nothing here is inferred. The code and wording are the SEC's (company_sic, migration 0021); the
// division is a lookup on the code's first two digits with the SIC manual's ranges
// (shared/src/sic.ts). The figures are counts of filed rows. An industry is a label: no page
// ranks industries, adds dollars across them or says what a count means.
import type { Company, Flagship, Txn } from "./flagship-core";
import { SIC_DIVISIONS, cleanSicCode, sicDivision } from "@stm/shared";

export const INDUSTRIES_PATH = "/industries/";
/** Window for the "12 months" figures, in days, by disclosure date, counted back from the build day. */
export const INDUSTRY_WINDOW_DAYS = 365;

export interface IndustryCompany {
  id: number; name: string; path: string | null; ticker: string | null; tickerPath: string | null;
  /** Four-digit SIC code and the SEC's wording for it (null when the SEC gives none). */
  sic: string; description: string | null;
  /** Open-market purchases (Form 4 code P) and sales (code S) disclosed in the window: rows. */
  buys: number; sells: number;
  /** Rows of congressional reports in the company's securities disclosed in the window. */
  congress: number;
  /** Newest Form 4 disclosure date on record, any transaction code. */
  latest: string | null;
}
export interface IndustryCode { sic: string; description: string | null; companies: number; anchor: string }
export interface IndustryDivision {
  /** Letter of the division in the SIC manual. */
  code: string; name: string; slug: string; path: string;
  /** First and last two-digit major group of the division. */
  from: number; to: number;
  /** Companies, by SIC code and then by name. */
  companies: IndustryCompany[];
  /** The SIC codes the division's companies carry, by code. */
  codes: IndustryCode[];
  /** Companies with at least one open-market purchase / sale / congressional row in the window. */
  withBuys: number; withSells: number; withCongress: number;
  buys: number; sells: number; congress: number;
  latest: string | null;
}
export interface Industries {
  divisions: IndustryDivision[];
  /** Companies with a CIK on the site, and how many of them have a SIC code. */
  companies: number; withCode: number;
  /** Companies whose code falls in no division of the manual (not on any page). */
  noDivision: number;
  /** Distinct SIC codes across the divisions. */
  codes: number;
}

/** "Finance, insurance and real estate" → "finance-insurance-and-real-estate". */
export const divisionSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const divisionPath = (name: string) => `${INDUSTRIES_PATH}${divisionSlug(name)}/`;
export const sicAnchor = (sic: string) => `sic-${sic}`;
/** Where a company's Industry line links: the division page at the first company with that code. */
export function industryHref(sic: string | null | undefined): string | null {
  const code = cleanSicCode(sic);
  const d = code ? sicDivision(code) : null;
  return d && code ? `${divisionPath(d.name)}#${sicAnchor(code)}` : null;
}

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const fromDay = (today: string, days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400_000).toISOString().slice(0, 10);
const isForm4 = (t: Txn) => t.source === "sec_form4";

export interface IndustryPaths { company: (c: Company) => string | null; ticker: (ticker: string) => string | null }

export function buildIndustries(m: Flagship, today: string, paths: IndustryPaths): Industries {
  const from = fromDay(today, INDUSTRY_WINDOW_DAYS);
  const inWindow = (t: Txn) => { const d = day(t.disclosedAt); return !!d && d >= from && d <= today; };
  const by = new Map<string, IndustryCompany[]>();
  let companies = 0, withCode = 0, noDivision = 0;
  for (const c of m.companies.values()) {
    if (!c.cik || !c.slug) continue;
    companies++;
    const e = m.companySic.get(c.cik.padStart(10, "0"));
    const sic = e ? cleanSicCode(e.sic) : null;
    if (!e || !sic) continue;
    withCode++;
    const d = sicDivision(sic);
    if (!d) { noDivision++; continue; }
    let buys = 0, sells = 0, congress = 0, latest: string | null = null;
    for (const t of c.txns) {
      if (isForm4(t)) {
        const dd = day(t.disclosedAt);
        if (dd && dd <= today && (!latest || dd > latest)) latest = dd;
        if (!inWindow(t)) continue;
        if (t.code === "P" && t.side === "buy") buys++;
        else if (t.code === "S" && t.side === "sell") sells++;
      } else if (inWindow(t)) congress++;
    }
    const row: IndustryCompany = {
      id: c.id, name: c.name, path: paths.company(c), ticker: c.primaryTicker, tickerPath: c.primaryTicker ? paths.ticker(c.primaryTicker) : null,
      sic, description: e.description?.trim() || null, buys, sells, congress, latest,
    };
    const list = by.get(d.code); if (list) list.push(row); else by.set(d.code, [row]);
  }
  const divisions: IndustryDivision[] = [];
  const allCodes = new Set<string>();
  for (const d of SIC_DIVISIONS) {
    const rows = by.get(d.code);
    if (!rows?.length) continue;
    rows.sort((a, b) => a.sic.localeCompare(b.sic) || a.name.localeCompare(b.name) || a.id - b.id);
    const codes: IndustryCode[] = [];
    for (const r of rows) {
      allCodes.add(r.sic);
      const last = codes.at(-1);
      if (last && last.sic === r.sic) { last.companies++; last.description ??= r.description; }
      else codes.push({ sic: r.sic, description: r.description, companies: 1, anchor: sicAnchor(r.sic) });
    }
    const n = (f: (r: IndustryCompany) => number) => rows.reduce((a, r) => a + f(r), 0);
    divisions.push({
      code: d.code, name: d.name, slug: divisionSlug(d.name), path: divisionPath(d.name), from: d.from, to: d.to, companies: rows, codes,
      withBuys: rows.filter((r) => r.buys > 0).length, withSells: rows.filter((r) => r.sells > 0).length, withCongress: rows.filter((r) => r.congress > 0).length,
      buys: n((r) => r.buys), sells: n((r) => r.sells), congress: n((r) => r.congress),
      latest: rows.reduce<string | null>((a, r) => (r.latest && (!a || r.latest > a) ? r.latest : a), null),
    });
  }
  return { divisions, companies, withCode, noDivision, codes: allCodes.size };
}

let _memo: { model: Flagship; today: string; out: Industries } | null = null;
/** `buildIndustries`, built once per build (the list, every division page, the sitemap and the search index ask for it). */
export function industriesOf(m: Flagship, today: string, paths: IndustryPaths): Industries {
  if (_memo?.model !== m || _memo.today !== today) _memo = { model: m, today, out: buildIndustries(m, today, paths) };
  return _memo.out;
}

/** One line for the build log, to compare with a direct count on the database. */
export function industryLogLine(x: Industries): string {
  const parts = x.divisions.map((d) => `${d.code} ${d.companies.length}/${d.codes.length}/${d.buys}/${d.sells}/${d.congress}`);
  return `industries: ${x.divisions.length} divisions, ${x.withCode} of ${x.companies} companies with a code, ${x.codes} codes, ${x.noDivision} in no division; companies/codes/purchases/sales/congress rows in 12 months: ${parts.join(", ")}`;
}
