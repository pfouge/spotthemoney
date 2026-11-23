// The company financials screener for the build model: lib/finscreen.ts wired to the companies
// on the site, their financials (lib/financials-build.ts) and their industry (lib/entity.ts).
// Worked out once per build; the page, the data file, the industry pages, the sitemap and the
// search index read the same result, so they cannot disagree.
import type { Company, Flagship } from "./flagship";
import { companyPath, mainTicker } from "./flagship";
import { financialsOf } from "./financials-build";
import { sourceFilings, type Period } from "./financials";
import { industryOf } from "./entity";
import { divisionSlug } from "./industries";
import { FS_CONCEPTS, packFinScreen, unpackFinScreen, finScreenCounts, finScreenLog, type FinScreenData, type FsCompany, type FsConcept, type FsPeriod } from "./finscreen";

function toPeriod(p: Period | undefined): FsPeriod | null {
  if (!p) return null;
  const src = sourceFilings(p)[0];
  if (!src) return null; // a period with none of the figures a page prints
  const v = {} as Record<FsConcept, number | null>, held = {} as Record<FsConcept, boolean>;
  for (const c of FS_CONCEPTS) { const cell = p.cells[c.key]; v[c.key] = cell ? cell.value : null; held[c.key] = !!cell?.held; }
  return { end: p.end, start: p.start, filed: src.filed, form: src.form, accession: src.accession, v, held };
}

/** One entry per company with a page and a fiscal year or a quarter on file, by name. */
export function finScreenCompanies(m: Flagship): FsCompany[] {
  const seen = new Set<string>(), out: FsCompany[] = [];
  const companies = [...m.companies.values()].filter((c): c is Company & { cik: string; slug: string } => !!c.cik && !!c.slug)
    .sort((a, b) => a.name.localeCompare(b.name) || a.cik.localeCompare(b.cik));
  for (const c of companies) {
    const cik = c.cik.padStart(10, "0");
    if (seen.has(cik)) continue;
    const f = financialsOf(m, c.cik);
    if (!f) continue;
    const year = toPeriod(f.years[0]), quarter = toPeriod(f.quarters[0]);
    if (!year && !quarter) continue;
    seen.add(cik);
    const ind = industryOf(m, c);
    out.push({
      name: c.name, path: companyPath(c), ticker: mainTicker(c) ?? "", cik,
      division: ind?.division ? { name: ind.division, slug: divisionSlug(ind.division) } : null, sic: ind?.code ?? "", unit: f.unit, year, quarter,
    });
  }
  return out;
}

export interface SiteFinScreen { data: FinScreenData; all: FsCompany[]; counts: ReturnType<typeof finScreenCounts> }
const memo = new WeakMap<object, SiteFinScreen>();
export function siteFinScreen(m: Flagship): SiteFinScreen {
  let x = memo.get(m);
  if (!x) {
    const data = packFinScreen(m.builtAt.slice(0, 10), finScreenCompanies(m));
    // Read back through the packed form, so the page prints exactly what the data file holds.
    const all = unpackFinScreen(data);
    x = { data, all, counts: finScreenCounts(all) };
    memo.set(m, x);
    // Build log: the figures to compare with a direct count on the database.
    console.log(`[web] ${finScreenLog(all)}`);
  }
  return x;
}
