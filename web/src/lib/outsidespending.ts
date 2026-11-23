// Independent expenditures (outside spending in federal races), as the spenders reported them to
// the FEC. Pure rules; the database read is lib/outsidespending-build.ts.
//
// An independent expenditure is money a person or group spends on a communication that expressly
// advocates the election or defeat of a clearly identified federal candidate, not coordinated with
// the candidate. The candidate does not receive it.
//
// The counted rule (one rule, written once in SQL in the loader and once here, with the same result):
//   per spending committee, a row with is_notice = false (a regular report) counts; a row with
//   is_notice = true (a 24-hour or 48-hour notice) counts only when its spent_at is later than the
//   committee's newest spent_at among its regular-report rows, or the committee has none.
//   A row with no amount or no side is listed but in no total. Support and oppose are never added
//   together or netted.
import type { Column } from "./csv";

export const OUTSIDE_PATH = "/outside-spending/";
export const OUTSIDE_ROWS = 25;
export const OUTSIDE_SIDE_ROWS = 10;
export const DESCRIPTION_SHOWN = 80;
export const CANDIDATE_MIN_ROWS = 5;
export const CANDIDATE_MAX = 400;
export const SPENDER_ROWS = 100;
export const NEWEST_ROWS = 100;
export const COUNT_RULE = "A row from a regular report counts. A row from a 24-hour or 48-hour notice counts only when it was spent after the newest expenditure in that same committee's regular reports, so an expenditure reported on a notice and again on a regular report is counted once.";
export const OUTSIDE_CAVEAT = "Independent expenditures are made by outside groups without coordination with the candidate, as those groups reported them to the FEC. The member did not receive this money. Totals follow the rule described under Methodology so that an expenditure reported on a notice and again on a regular report is counted once.";

export type Side = "S" | "O";
export const SIDE_LABEL: Record<Side, string> = { S: "Support", O: "Oppose" };
export interface Expenditure {
  subId: string;
  committeeId: string | null; committeeName: string;
  candidateId: string | null; candidateName: string | null; office: "H" | "S" | "P" | null; state: string | null; district: string | null; party: string | null;
  personId: number | null; side: Side | null; amount: number | null;
  spentAt: string | null; disseminatedAt: string | null; description: string | null;
  isNotice: boolean; url: string | null; counted: boolean;
}

/** Control and direction characters out, white space collapsed, cut at a word with an ellipsis. */
export function cleanOutsideText(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1), sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd().replace(/[,;:.\s]+$/, "") + "…";
}

/** The counted rule, over rows with the fields it needs. Returns a flag per row, in order. */
export function countedFlags(rows: readonly { committeeId: string | null; committeeName?: string; isNotice: boolean | null; spentAt: string | null }[]): boolean[] {
  const key = (r: { committeeId: string | null; committeeName?: string }) => r.committeeId ?? `name:${r.committeeName ?? ""}`;
  const newest = new Map<string, string>();
  for (const r of rows) {
    if (r.isNotice || !r.spentAt) continue;
    const k = key(r), c = newest.get(k);
    if (!c || r.spentAt > c) newest.set(k, r.spentAt);
  }
  return rows.map((r) => {
    if (!r.isNotice) return true;
    const nr = newest.get(key(r));
    return nr == null || (r.spentAt != null && r.spentAt > nr);
  });
}
/** A row that enters a dollar total: counted, with an amount and a side. */
export const inTotals = (r: Expenditure): boolean => r.counted && r.amount != null && r.side != null;

export interface SideTotals { support: number; oppose: number; supportRows: number; opposeRows: number; supportSpenders: number; opposeSpenders: number; spenders: number }
export function sideTotals(rows: readonly Expenditure[]): SideTotals {
  const t: SideTotals = { support: 0, oppose: 0, supportRows: 0, opposeRows: 0, supportSpenders: 0, opposeSpenders: 0, spenders: 0 };
  const s = new Set<string>(), o = new Set<string>(), all = new Set<string>();
  for (const r of rows) {
    if (!r.counted) continue;
    const k = r.committeeId ?? `name:${r.committeeName}`;
    all.add(k);
    if (!inTotals(r)) continue;
    if (r.side === "S") { t.support += r.amount!; t.supportRows++; s.add(k); } else { t.oppose += r.amount!; t.opposeRows++; o.add(k); }
  }
  t.supportSpenders = s.size; t.opposeSpenders = o.size; t.spenders = all.size;
  return t;
}
export interface SpenderRow { committeeId: string | null; name: string; side: Side; amount: number; rows: number }
/** The largest spenders on one side (counted rows with an amount), largest first. */
export function bySpender(rows: readonly Expenditure[], side: Side, limit = OUTSIDE_SIDE_ROWS): SpenderRow[] {
  const m = new Map<string, SpenderRow>();
  for (const r of rows) {
    if (!inTotals(r) || r.side !== side) continue;
    const k = r.committeeId ?? `name:${r.committeeName}`;
    const c = m.get(k);
    if (c) { c.amount += r.amount!; c.rows++; } else m.set(k, { committeeId: r.committeeId, name: r.committeeName, side, amount: r.amount!, rows: 1 });
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, limit);
}
/** Counted rows, newest first (undated last). */
export function newestCounted(rows: readonly Expenditure[], limit: number): Expenditure[] {
  return rows.filter((r) => r.counted).sort((a, b) => (a.spentAt ?? "") < (b.spentAt ?? "") ? 1 : (a.spentAt ?? "") > (b.spentAt ?? "") ? -1 : a.subId < b.subId ? 1 : -1).slice(0, limit);
}

export interface CandidateRow { key: string; name: string; personId: number | null; office: string | null; state: string | null; district: string | null; party: string | null; support: number; oppose: number; rows: number; spenders: number }
export function byCandidate(rows: readonly Expenditure[], min = CANDIDATE_MIN_ROWS, max = CANDIDATE_MAX): CandidateRow[] {
  const m = new Map<string, CandidateRow & { s: Set<string> }>();
  for (const r of rows) {
    if (!r.counted) continue;
    const key = r.candidateId ?? (r.candidateName ? `name:${r.candidateName}` : null);
    if (!key) continue;
    let c = m.get(key);
    if (!c) { c = { key, name: r.candidateName ?? key, personId: r.personId, office: r.office, state: r.state, district: r.district, party: r.party, support: 0, oppose: 0, rows: 0, spenders: 0, s: new Set() }; m.set(key, c); }
    c.rows++; c.s.add(r.committeeId ?? `name:${r.committeeName}`);
    if (c.personId == null && r.personId != null) c.personId = r.personId;
    if (inTotals(r)) { if (r.side === "S") c.support += r.amount!; else c.oppose += r.amount!; }
  }
  return [...m.values()].filter((c) => c.rows >= min).map(({ s, ...c }) => ({ ...c, spenders: s.size }))
    .sort((a, b) => b.support + b.oppose - (a.support + a.oppose) || a.name.localeCompare(b.name)).slice(0, max);
}
export interface SpenderTotal { committeeId: string | null; name: string; support: number; oppose: number; candidates: number; rows: number }
export function largestSpenders(rows: readonly Expenditure[], limit = SPENDER_ROWS): SpenderTotal[] {
  const m = new Map<string, SpenderTotal & { c: Set<string> }>();
  for (const r of rows) {
    if (!r.counted) continue;
    const k = r.committeeId ?? `name:${r.committeeName}`;
    let s = m.get(k);
    if (!s) { s = { committeeId: r.committeeId, name: r.committeeName, support: 0, oppose: 0, candidates: 0, rows: 0, c: new Set() }; m.set(k, s); }
    s.rows++; const ck = r.candidateId ?? r.candidateName; if (ck) s.c.add(ck);
    if (inTotals(r)) { if (r.side === "S") s.support += r.amount!; else s.oppose += r.amount!; }
  }
  return [...m.values()].map(({ c, ...s }) => ({ ...s, candidates: c.size }))
    .sort((a, b) => b.support + b.oppose - (a.support + a.oppose) || a.name.localeCompare(b.name)).slice(0, limit);
}

/** The FEC cycle (an even year) that holds the newest spending date. */
export function cycleOf(rows: readonly Expenditure[]): number | null {
  let max: string | null = null;
  for (const r of rows) if (r.spentAt && (!max || r.spentAt > max)) max = r.spentAt;
  if (!max) return null;
  const y = Number(max.slice(0, 4));
  return y % 2 === 0 ? y : y + 1;
}

export interface MemberOutside { rows: Expenditure[]; totals: SideTotals; supportBy: SpenderRow[]; opposeBy: SpenderRow[]; newest: Expenditure[]; countedRows: number }
export function memberOutside(rows: readonly Expenditure[]): MemberOutside {
  return { rows: [...rows], totals: sideTotals(rows), supportBy: bySpender(rows, "S"), opposeBy: bySpender(rows, "O"), newest: newestCounted(rows, OUTSIDE_ROWS), countedRows: rows.filter((r) => r.counted).length };
}
export interface OutsideData {
  shown: boolean; cycle: number | null; builtAt: string;
  rows: Expenditure[];
  /** people.id to that member's rows. */
  byPerson: Map<number, MemberOutside>;
  candidates: CandidateRow[]; spenders: SpenderTotal[]; newest: Expenditure[];
  totalRows: number; countedRows: number; spenderCount: number; candidateCount: number;
  sqlMismatch: number;
}
export const emptyOutside = (): OutsideData => ({ shown: false, cycle: null, builtAt: "", rows: [], byPerson: new Map(), candidates: [], spenders: [], newest: [], totalRows: 0, countedRows: 0, spenderCount: 0, candidateCount: 0, sqlMismatch: 0 });

export function usdFull(x: number): string { return `$${Math.round(x).toLocaleString("en-US")}`; }
export function usdShort(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${Math.round(x)}`;
}
export function memberOutsideSentence(name: string, cycle: number | null, t: SideTotals): string {
  const cy = cycle ? ` in the ${cycle} cycle` : "";
  const sup = `${usdFull(t.support)} reported in support by ${t.supportSpenders} ${t.supportSpenders === 1 ? "committee" : "committees"}`;
  const opp = `${usdFull(t.oppose)} reported in opposition by ${t.opposeSpenders} ${t.opposeSpenders === 1 ? "committee" : "committees"}`;
  return `Outside groups reported independent expenditures naming ${name}${cy}: ${sup}, and ${opp}.`;
}
export const sourceUrlOk = (u: unknown): string | null => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
export const fecCommitteeUrl = (id: string | null): string | null => (id && /^C\d{8}$/.test(id) ? `https://www.fec.gov/data/committee/${id}/` : null);

export const CSV_COLUMNS = (pageOf: (personId: number) => string | null): Column<Expenditure>[] => [
  { key: "sub_id", about: "The FEC's identifier for the line of the filing.", get: (r) => r.subId },
  { key: "spender", about: "The committee that reported the expenditure, as it reported it.", get: (r) => r.committeeName },
  { key: "spender_fec_id", about: "The spender's FEC committee ID.", get: (r) => r.committeeId },
  { key: "candidate", about: "The candidate the communication names, as reported.", get: (r) => r.candidateName },
  { key: "candidate_fec_id", about: "The candidate's FEC ID.", get: (r) => r.candidateId },
  { key: "office", about: "H (House), S (Senate) or P (President).", get: (r) => r.office },
  { key: "state", about: "The candidate's state, as reported.", get: (r) => r.state },
  { key: "district", about: "The House district, as reported.", get: (r) => r.district },
  { key: "party", about: "The candidate's party, as reported.", get: (r) => r.party },
  { key: "support_oppose", about: "S if the spender reported support, O if opposition. Empty when not reported.", get: (r) => r.side },
  { key: "amount", about: "Dollars, as reported. Empty when not reported.", get: (r) => r.amount },
  { key: "date", about: "The date the money was spent (YYYY-MM-DD). Empty when not reported or in the future.", get: (r) => r.spentAt },
  { key: "disseminated", about: "The date the communication was publicly distributed.", get: (r) => r.disseminatedAt },
  { key: "purpose", about: "The purpose, as reported.", get: (r) => r.description },
  { key: "is_notice", about: "true for a 24-hour or 48-hour notice, false for a regular report.", get: (r) => r.isNotice },
  { key: "counted", about: "true when the row counts under the rule on the Methodology page. Rows that are not counted are repeat reports of the same spending.", get: (r) => r.counted },
  { key: "member_page_url", about: "The page on this site for the member the row names, when there is one.", get: (r) => (r.personId != null ? pageOf(r.personId) : null) },
  { key: "source_url", about: "The FEC filing image.", get: (r) => r.url },
];

export function outsideLog(o: OutsideData): string {
  if (!o.shown) return "outside spending: not shown (no expenditure on record)";
  let withPerson = 0, memberPages = 0;
  for (const r of o.rows) if (r.personId != null) withPerson++;
  memberPages = o.byPerson.size;
  const dates = o.rows.map((r) => r.spentAt).filter(Boolean).sort() as string[];
  return `outside spending: ${o.totalRows} rows (${o.countedRows} counted, ${o.totalRows - o.countedRows} not), cycle ${o.cycle}, ${dates[0] ?? "no date"} to ${dates.at(-1) ?? "no date"}; ${o.spenderCount} spending committees, ${o.candidateCount} candidates named, ${o.candidates.length} in the candidate table; ${withPerson} rows name a person, ${memberPages} members with a page; ${o.sqlMismatch} rows where SQL and the rule disagree`;
}
