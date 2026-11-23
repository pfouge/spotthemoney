// Rows of the institutional-holders hub page (/institutional-holders/): one list of companies by
// the number of managers reporting them, one list of the largest managers. Kept apart from
// inst13f-build.ts (which flagship.ts imports) because it needs entity.ts, which imports flagship.
import type { Flagship } from "./flagship";
import { companyPath } from "./flagship";
import { industryOf } from "./entity";
import { managerPath } from "./inst13f-build";
import { managerBrowseUrl, cleanName, INST_HUB_MANAGERS } from "./inst13f";

export const INST_HUB_PATH = "/institutional-holders/";

/** The hub is listed (sitemap, search, llms.txt) only when it has companies to show. */
export function instHubShown(m: Flagship): boolean {
  return hubCompanies(m).length > 0;
}

export interface HubCompany { name: string; ticker: string | null; path: string; division: string | null; managers: number; prev: number | null; value: number }
export interface HubManager { name: string; cik: string; issuers: number; value: number; path: string | null; secUrl: string }

export function hubCompanies(m: Flagship): HubCompany[] {
  const out: HubCompany[] = [];
  if (!m.inst.shown) return out;
  const byCik = new Map<string, (typeof m.companies extends Map<any, infer C> ? C : never)>();
  for (const c of m.companies.values()) if (c.cik) byCik.set(c.cik.padStart(10, "0"), c);
  for (const [cik, ic] of m.inst.byCik) {
    const c = byCik.get(cik);
    const p = c ? companyPath(c) : null;
    if (!c || !p) continue;
    out.push({ name: cleanName(c.name, 120), ticker: c.primaryTicker ?? null, path: p, division: industryOf(m, c)?.division ?? null, managers: ic.managers, prev: ic.prevManagers, value: ic.value });
  }
  return out.sort((a, b) => b.managers - a.managers || b.value - a.value || a.name.localeCompare(b.name));
}

export function hubManagers(m: Flagship): HubManager[] {
  if (!m.inst.shown) return [];
  return m.inst.managers.slice(0, INST_HUB_MANAGERS).map((x) => ({ name: cleanName(x.name, 160), cik: x.cik, issuers: x.issuers, value: x.value, path: managerPath(m, x.cik), secUrl: managerBrowseUrl(x.cik) }));
}
