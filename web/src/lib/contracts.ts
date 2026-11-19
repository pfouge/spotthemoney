// Contract award details as USAspending reports them (migration 0027): the awarding
// sub-agency, the date the work is currently due to end, and the award's description.
// Pure functions, no database: the pages, the build log and scripts/contracts.test.ts use them.
//
// Rules:
//  - Everything is shown as reported. Nothing is derived from a description (no label, flag,
//    category or total), and a description is never called the purpose "of the company".
//  - A sub-agency is shown only when it says more than the agency does (many small agencies
//    are listed as their own sub-agency).
//  - A table of sub-agencies counts only awards that carry one, and says how many do.
import type { ContractRow } from "./flagship-core";

/** Characters of a description printed in a table cell; the rest is on USAspending and in the CSV. */
export const DESCRIPTION_SHOWN = 140;
/** Rows of the sub-agency table on /contracts/. */
export const SUB_AGENCY_ROWS = 25;

/** White space collapsed; null when nothing is left. */
export function cleanDescription(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t || null;
}

/** A description cut for a table cell: whole words up to `max` characters, then an ellipsis. */
export function shortDescription(s: string | null | undefined, max = DESCRIPTION_SHOWN): string | null {
  const t = cleanDescription(s);
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at >= max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:.\-]+$/, "")}…`;
}

const key = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/** The sub-agency when it says more than the agency does, else null. */
export function subAgencyLabel(agency: string | null | undefined, sub: string | null | undefined): string | null {
  const s = cleanDescription(sub);
  if (!s) return null;
  return key(s) === key(agency) ? null : s;
}

export interface SubAgencyRow { subAgency: string; agency: string | null; awards: number; total: number }

/** One row per agency and sub-agency among awards that carry a sub-agency, largest total first. */
export function subAgencyRows(rows: ContractRow[]): SubAgencyRow[] {
  const m = new Map<string, SubAgencyRow>();
  for (const r of rows) {
    const sub = cleanDescription(r.subAgency);
    if (!sub) continue;
    const k = `${key(r.agency)}|${key(sub)}`;
    const e = m.get(k) ?? { subAgency: sub, agency: cleanDescription(r.agency), awards: 0, total: 0 };
    e.awards++;
    e.total += r.amount ?? 0;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.awards - a.awards || a.subAgency.localeCompare(b.subAgency));
}

export interface ContractDetailStats { awards: number; withDescription: number; withSubAgency: number; withEndDate: number; subAgencies: number; longestDescription: number }

export function contractDetailStats(rows: ContractRow[]): ContractDetailStats {
  let withDescription = 0, withSubAgency = 0, withEndDate = 0, longest = 0;
  for (const r of rows) {
    const d = cleanDescription(r.description);
    if (d) { withDescription++; longest = Math.max(longest, d.length); }
    if (cleanDescription(r.subAgency)) withSubAgency++;
    if (r.endDate) withEndDate++;
  }
  return { awards: rows.length, withDescription, withSubAgency, withEndDate, subAgencies: subAgencyRows(rows).length, longestDescription: longest };
}

/** One line for the build log, to compare with SQL on production. */
export function contractDetailLog(rows: ContractRow[]): string {
  const s = contractDetailStats(rows);
  const top = subAgencyRows(rows).slice(0, 5).map((r) => `${r.subAgency} ${r.awards}/${Math.round(r.total)}`).join(", ");
  return `[web] contract details: ${s.awards} awards in the window; with a description ${s.withDescription}, a sub-agency ${s.withSubAgency}, an end date ${s.withEndDate}; ${s.subAgencies} sub-agencies; longest description ${s.longestDescription}${top ? `; awards/value: ${top}` : ""}`;
}
