// Names for the NAICS industry codes on contract awards.
//
// USAspending gives each award a six-digit NAICS code (North American Industry Classification
// System): the code the contracting officer chose for the work being bought. It describes the
// purchase, not the company that received the award. This file adds the code's official title
// from a fixed table (naics-titles.json), so a reader does not have to look "336411" up.
// Pure functions, no database: the pages, the CSV writer, the build log and
// scripts/naics.test.ts use them.
//
// Rules:
//  - The title is the U.S. Census Bureau's title for the code in the 2022 edition. Awards also
//    carry codes that a later edition retired (336111 "Automobile Manufacturing" ended with the
//    2017 edition), so the table also holds the 2017, 2012 and 2007 titles of codes that are not
//    in a newer edition, and the label says which edition the title is from.
//  - A code that is in no edition held here gets no title: the code is shown alone.
//  - Nothing is worked out from a code or a title (no flag, score or ranking of companies).
//    The table on /contracts/ adds up award values per code, as the sub-agency table does.
import titles from "./naics-titles.json";
import type { ContractRow } from "./flagship-core";

/** The edition whose titles are used first. */
export const NAICS_CURRENT = 2022;
/** Editions held, newest first. An older edition holds only codes that no newer one has. */
export const NAICS_EDITIONS = [2022, 2017, 2012, 2007] as const;
/** Rows of the industry-code table on /contracts/. */
export const NAICS_ROWS = 25;

const TABLE = titles as Record<string, Record<string, string>>;

export interface NaicsTitle { code: string; title: string; edition: number }

/** A six-digit code, or null for anything else. */
export function cleanNaics(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return /^\d{6}$/.test(s) ? s : null;
}

/** The code's title and the edition it is from, or null when no edition held here has the code. */
export function naicsTitle(code: string | number | null | undefined): NaicsTitle | null {
  const c = cleanNaics(code);
  if (!c) return null;
  for (const edition of NAICS_EDITIONS) {
    const title = TABLE[String(edition)]?.[c];
    if (title) return { code: c, title, edition };
  }
  return null;
}

/** The title as printed: a retired code's title is followed by its edition. */
export function naicsLabel(code: string | number | null | undefined): string | null {
  const t = naicsTitle(code);
  if (!t) return null;
  return t.edition === NAICS_CURRENT ? t.title : `${t.title} (${t.edition} edition)`;
}

export interface NaicsRow { code: string; title: string | null; edition: number | null; label: string | null; awards: number; total: number }

/** One row per code among awards that carry a six-digit code, largest total first. */
export function naicsRows(rows: ContractRow[]): NaicsRow[] {
  const m = new Map<string, NaicsRow>();
  for (const r of rows) {
    const code = cleanNaics(r.naics);
    if (!code) continue;
    let e = m.get(code);
    if (!e) { const t = naicsTitle(code); e = { code, title: t?.title ?? null, edition: t?.edition ?? null, label: naicsLabel(code), awards: 0, total: 0 }; m.set(code, e); }
    e.awards++;
    e.total += r.amount ?? 0;
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.awards - a.awards || a.code.localeCompare(b.code));
}

export interface NaicsStats { awards: number; withCode: number; withTitle: number; codes: number; codesWithTitle: number; retiredCodes: number; awardsRetired: number }

export function naicsStats(rows: ContractRow[]): NaicsStats {
  const by = naicsRows(rows);
  const named = by.filter((r) => r.title);
  const retired = named.filter((r) => r.edition !== NAICS_CURRENT);
  const n = (list: NaicsRow[]) => list.reduce((a, r) => a + r.awards, 0);
  return { awards: rows.length, withCode: n(by), withTitle: n(named), codes: by.length, codesWithTitle: named.length, retiredCodes: retired.length, awardsRetired: n(retired) };
}

/** One line for the build log, to compare with SQL on production. */
export function naicsLog(rows: ContractRow[]): string {
  const s = naicsStats(rows);
  const top = naicsRows(rows).slice(0, 5).map((r) => `${r.code} ${r.awards}/${Math.round(r.total)}`).join(", ");
  return `[web] contract industry codes: ${s.awards} awards in the window; with a NAICS code ${s.withCode}, with a title ${s.withTitle}; ${s.codes} codes, ${s.codesWithTitle} with a title, ${s.retiredCodes} from an older edition (${s.awardsRetired} awards)${top ? `; awards/value: ${top}` : ""}`;
}
