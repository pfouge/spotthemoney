// The large holders hub for the build model: lib/largeholders.ts wired to the Schedule 13D and
// 13G statements (lib/schedule13-build.ts) and the companies on the site. Worked out once per
// build; the page, the data file, the sitemap and the search index read the same result.
import type { Flagship } from "./flagship";
import { companyPath } from "./flagship";
import { siteCompanyByCik } from "./form144-build";
import { holderPath } from "./schedule13-build";
import { cleanText, holdersOf, percentStated, sharesStated } from "./schedule13";
import { industryOf } from "./entity";
import { divisionSlug } from "./industries";
import { packLarge, unpackLarge, largeLog, type LargeData, type LhIn, type LhRow } from "./largeholders";

export interface SiteLarge { data: LargeData; all: LhRow[] }
const memo = new WeakMap<object, SiteLarge>();

export function siteLarge(m: Flagship): SiteLarge {
  let x = memo.get(m);
  if (x) return x;
  const ins: LhIn[] = [];
  if (m.schedule13.shown) {
    const cos = siteCompanyByCik(m);
    for (const [cik, xs] of m.schedule13.byCik) {
      const c = cos.get(cik);
      if (!c) continue;
      const path = companyPath(c);
      if (!path) continue;
      const ind = industryOf(m, c);
      const company = { name: c.name, path, ticker: c.primaryTicker ?? "", cik, division: ind?.division ? { name: ind.division, slug: divisionSlug(ind.division) } : null };
      for (const h of holdersOf(xs, m.builtAt)) {
        const s = h.latest;
        ins.push({
          company, holder: cleanText(s.reporterName, 120) ?? "Not stated", path: holderPath(m, s), schedule: s.schedule, amend: s.isAmendment,
          percent: percentStated(s.percent), shares: sharesStated(s.shares), event: s.eventDate, filed: s.filedAt, accession: s.accession,
          persons: Math.max(1, s.reporterCount), url: s.sourceUrl,
        });
      }
    }
    ins.sort((a, b) => b.filed.localeCompare(a.filed) || (a.accession < b.accession ? 1 : -1));
  }
  const data = packLarge(m.builtAt.slice(0, 10), ins);
  x = { data, all: unpackLarge(data) };
  memo.set(m, x);
  console.log(`[web] ${m.schedule13.shown ? largeLog(data) : "large holders hub: not shown (the Schedule 13 load is not current)"}`);
  return x;
}
export const largeShown = (m: Flagship): boolean => siteLarge(m).all.length > 0;
