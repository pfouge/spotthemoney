// Lobbying by issue (/lobbying-issues/ and /lobbying-issues/<slug>/), and the "Issues" cell of
// every lobbying table. A filing lists one or more general issue areas (79 codes in the Senate's
// list) and reports ONE amount for all of them. So:
//   - a filing is counted under EVERY issue it lists, not only the first;
//   - the amount beside an issue is the total reported on the filings that list it. A filing
//     that lists several issues adds its whole amount to each, so the amounts of two issues
//     overlap and must not be added together. The filing does not split its amount by issue.
// Pure: the pages, the sitemap, the search index, the CSV columns and the unit tests read this.
import type { LobbyingRow } from "./flagship";

export const ISSUES_PATH = "/lobbying-issues/";
/** Rows in an issue's client and registrant tables. */
export const ISSUE_TOP_ROWS = 25;
/** Rows in an issue's newest-filings table. */
export const ISSUE_FILING_ROWS = 100;
/** Issue names printed in one table cell before "and N more". */
export const ISSUES_INLINE = 6;

export interface IssueParty { name: string; amount: number; filings: number }
export interface Issue {
  code: string; name: string; slug: string; path: string;
  /** Filings for `year` that list the issue, and those of them that list no other issue. */
  filings: number; only: number;
  clients: number; registrants: number;
  /** Total reported on those filings (overlaps with other issues; see the top of this file). */
  amount: number;
  topClients: IssueParty[]; topRegistrants: IssueParty[];
  /** Filings that list the issue, any period on record, newest posted first. */
  newest: LobbyingRow[];
  /** How many filings on record list it, any period. */
  allFilings: number;
  latest: string | null;
}

/** Every issue code on a filing, in the filing's order, each once. Falls back to the first-issue column. */
export function rowIssues(l: Pick<LobbyingRow, "issues" | "issueArea">): string[] {
  const list = l.issues && l.issues.length ? l.issues : l.issueArea ? [l.issueArea] : [];
  return [...new Set(list.filter(Boolean))];
}

/** "Taxation/Internal Revenue Code" → "taxation-internal-revenue-code"; "Clean Air and Water (quality)" → "clean-air-and-water". */
export function issueSlug(name: string): string {
  const words = name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let out = "";
  for (const w of words) { if ((out + "-" + w).length > 60) break; out = out ? `${out}-${w}` : w; }
  return out;
}

/** code → { name, slug, path } for every code in `names` or on a row. Slugs are unique; a clash gets the code appended. */
type IssueRef = { code: string; name: string; slug: string; path: string };
const indexed = new WeakMap<LobbyingRow[], { names: Map<string, string>; size: number; index: Map<string, IssueRef> }>();
export function issueIndex(rows: LobbyingRow[], names: Map<string, string>): Map<string, IssueRef> {
  // Every company page asks for this with the same model: do the work once per build.
  const hit = indexed.get(rows);
  if (hit && hit.names === names && hit.size === names.size) return hit.index;
  const index = computeIndex(rows, names);
  indexed.set(rows, { names, size: names.size, index });
  return index;
}
function computeIndex(rows: LobbyingRow[], names: Map<string, string>): Map<string, IssueRef> {
  const codes = new Set<string>(names.keys());
  for (const l of rows) for (const c of rowIssues(l)) codes.add(c);
  const out = new Map<string, { code: string; name: string; slug: string; path: string }>();
  const taken = new Set<string>();
  for (const code of [...codes].sort()) {
    const name = names.get(code) ?? code;
    let slug = issueSlug(name) || code.toLowerCase();
    if (taken.has(slug)) slug = `${slug}-${code.toLowerCase()}`;
    taken.add(slug);
    out.set(code, { code, name, slug, path: `${ISSUES_PATH}${slug}/` });
  }
  return out;
}

const top = (m: Map<string, IssueParty>) => [...m.values()].sort((a, b) => b.amount - a.amount || b.filings - a.filings || a.name.localeCompare(b.name));
const bump = (m: Map<string, IssueParty>, name: string | null, amount: number) => {
  if (!name) return;
  const e = m.get(name) ?? { name, amount: 0, filings: 0 };
  e.amount += amount; e.filings++; m.set(name, e);
};

/** One entry per issue that any filing on record lists; figures are for `year`. Largest reported amount first. */
const built = new WeakMap<LobbyingRow[], { year: number; names: Map<string, string>; issues: Issue[] }>();
export function buildIssues(rows: LobbyingRow[], names: Map<string, string>, year: number): Issue[] {
  // One page per issue calls this with the same model: do the work once per build.
  const hit = built.get(rows);
  if (hit && hit.year === year && hit.names === names) return hit.issues;
  const issues = computeIssues(rows, names, year);
  built.set(rows, { year, names, issues });
  return issues;
}
function computeIssues(rows: LobbyingRow[], names: Map<string, string>, year: number): Issue[] {
  const index = issueIndex(rows, names);
  type Acc = { filings: number; only: number; amount: number; clients: Map<string, IssueParty>; registrants: Map<string, IssueParty>; all: LobbyingRow[] };
  const acc = new Map<string, Acc>();
  for (const l of rows) {
    const codes = rowIssues(l);
    for (const code of codes) {
      const a: Acc = acc.get(code) ?? { filings: 0, only: 0, amount: 0, clients: new Map(), registrants: new Map(), all: [] };
      a.all.push(l);
      if (l.year === year) {
        a.filings++;
        if (codes.length === 1) a.only++;
        a.amount += l.amount ?? 0;
        bump(a.clients, l.client, l.amount ?? 0);
        bump(a.registrants, l.registrant, l.amount ?? 0);
      }
      acc.set(code, a);
    }
  }
  const out: Issue[] = [];
  for (const [code, a] of acc) {
    const i = index.get(code)!;
    const newest = [...a.all].sort((x, y) => y.createdAt.localeCompare(x.createdAt) || y.id - x.id);
    out.push({
      ...i, filings: a.filings, only: a.only, amount: a.amount,
      clients: a.clients.size, registrants: a.registrants.size,
      topClients: top(a.clients).slice(0, ISSUE_TOP_ROWS), topRegistrants: top(a.registrants).slice(0, ISSUE_TOP_ROWS),
      newest: newest.slice(0, ISSUE_FILING_ROWS), allFilings: a.all.length, latest: newest[0]?.createdAt ?? null,
    });
  }
  return out.sort((a, b) => b.amount - a.amount || b.filings - a.filings || a.name.localeCompare(b.name));
}

/** What a table cell prints for one filing: the first `max` issues, and how many are left out. */
export function issueCell(l: Pick<LobbyingRow, "issues" | "issueArea">, index: Map<string, { name: string; path: string }>, max = ISSUES_INLINE): { shown: { code: string; name: string; path: string | null }[]; more: number } {
  const codes = rowIssues(l);
  const shown = codes.slice(0, max).map((code) => ({ code, name: index.get(code)?.name ?? code, path: index.get(code)?.path ?? null }));
  return { shown, more: codes.length - shown.length };
}

/** One line for the build log, to compare with a direct count on the database. */
export function issueLogLine(issues: Issue[], rows: LobbyingRow[], year: number): string {
  const y = rows.filter((l) => l.year === year);
  const pick = (code: string) => { const i = issues.find((x) => x.code === code); return i ? `${code} ${i.filings}/${i.only}/${i.clients}/${i.registrants}/${Math.round(i.amount)}` : `${code} none`; };
  return `lobbying issues: ${issues.length} issues, ${rows.length} filings on record, ${y.length} for ${year}, ${y.filter((l) => rowIssues(l).length === 0).length} of them with no issue, ${y.filter((l) => rowIssues(l).length > 1).length} with several; filings/only issue/clients/registrants/amount: ${["TAX", "DEF", "HCR", "BUD", "WEL", "DOC"].map(pick).join(", ")}`;
}
