// The industry pages' figures for the build model: lib/industries.ts wired to the site's paths.
// The window counts back from the build day, so the list, every division page, the sitemap and
// the search index agree, and the verifier can recount it.
import type { Flagship } from "./flagship";
import { companyPath, securityPath } from "./flagship";
import { tickerPages } from "./entity";
import { industriesOf, type Industries } from "./industries";

export function siteIndustries(model: Flagship): Industries {
  const pages = tickerPages(model);
  return industriesOf(model, model.builtAt.slice(0, 10), {
    company: companyPath,
    ticker: (t) => { const s = pages.get(t.toLowerCase()); return s ? securityPath(s) : null; },
  });
}
