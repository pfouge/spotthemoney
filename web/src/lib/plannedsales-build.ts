// The planned sales hub for the build model: lib/plannedsales.ts wired to the Form 144 notices
// (lib/form144-build.ts) and the companies on the site. Worked out once per build; the page, the
// data file, the sitemap and the search index read the same result.
import type { Flagship } from "./flagship";
import { companyPath } from "./flagship";
import { siteCompanyByCik, sellerPath } from "./form144-build";
import { NOTICE_WINDOW_DAYS, cleanText, isAmendment, noticesInWindow, relationshipLabel, sellerKey, stated, valueOutOfRange } from "./form144";
import { industryOf } from "./entity";
import { divisionSlug } from "./industries";
import { packPlanned, unpackPlanned, plannedLog, type PlannedData, type PsIn, type PsRow } from "./plannedsales";

export interface SitePlanned { data: PlannedData; all: PsRow[] }
const memo = new WeakMap<object, SitePlanned>();

/** The hub is listed (sitemap, search, llms.txt, navigation) only while the Form 144 load is current and has rows. */
export function sitePlanned(m: Flagship): SitePlanned {
  let x = memo.get(m);
  if (x) return x;
  const ins: PsIn[] = [];
  if (m.form144.shown) {
    const cos = siteCompanyByCik(m);
    for (const [cik, xs] of m.form144.byCik) {
      const c = cos.get(cik);
      if (!c) continue;
      const path = companyPath(c);
      if (!path) continue;
      const ind = industryOf(m, c);
      const company = { name: c.name, path, ticker: c.primaryTicker ?? "", cik, division: ind?.division ? { name: ind.division, slug: divisionSlug(ind.division) } : null };
      for (const n of noticesInWindow(xs, m.builtAt, NOTICE_WINDOW_DAYS)) {
        const name = cleanText(n.sellerName, 120) ?? "Not stated";
        ins.push({
          filed: n.filedAt, amend: isAmendment(n), company, seller: { name, path: sellerPath(m, n), key: sellerKey(n) },
          relationship: relationshipLabel(n.relationships), shares: stated(n.shares), value: valueOutOfRange(n) ? null : stated(n.marketValue), held: valueOutOfRange(n),
          sale: n.approxSaleDate, plan: n.planAdoptionDate, accession: n.accession, url: n.sourceUrl,
        });
      }
    }
    ins.sort((a, b) => b.filed.localeCompare(a.filed) || (a.accession < b.accession ? 1 : -1));
  }
  const data = packPlanned(m.builtAt.slice(0, 10), ins);
  // Read back through the packed form, so the page prints exactly what the data file holds.
  x = { data, all: unpackPlanned(data) };
  memo.set(m, x);
  console.log(`[web] ${m.form144.shown ? plannedLog(data) : "planned sales hub: not shown (the Form 144 load is not current)"}`);
  return x;
}
export const plannedShown = (m: Flagship): boolean => sitePlanned(m).all.length > 0;
