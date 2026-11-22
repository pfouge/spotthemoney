// Reading roll-call vote XML from the House Clerk and the Senate. Pure: text in, rows out.
// Small regex helpers, no XML library (the style of sec_form144.ts).
//
// House  (clerk.house.gov/evs/<year>/roll<NNN>.xml): <rollcall-vote><vote-metadata> with
//   congress, session ("1st"), rollcall-num, legis-num, vote-question, vote-type, vote-result,
//   action-date ("3-Jan-2025"), action-time, vote-desc, vote-totals/totals-by-vote; then
//   <vote-data><recorded-vote><legislator name-id party state>Name</legislator><vote>Yea</vote>.
// Senate (senate.gov/.../vote_<congress>_<session>_<NNNNN>.xml): <roll_call_vote> with congress,
//   session, vote_number, vote_date ("January 9, 2025, 02:54 PM"), question, vote_question_text,
//   vote_document_text, vote_result, document{document_type, document_number, document_name},
//   count{yeas, nays, present, absent}, members/member{member_full, last_name, first_name, party,
//   state, vote_cast, lis_member_id}.
// The element names were read through a summarising fetch tool, not as raw text: every optional
// field is tolerated missing, and only the required ones decide the shape (hasShape*).

import { blocks, cleanText, leaf } from "../sources/sec_form144.js";

export type Position = "yea" | "nay" | "present" | "not_voting";

export interface ParsedPosition {
  memberKey: string;
  name: string | null;
  party: string | null;
  state: string | null;
  position: Position | null; // null: a value the table cannot hold (e.g. "Guilty")
  rawPosition: string | null;
}

export interface ParsedVote {
  chamber: "house" | "senate";
  congress: number | null;
  session: number | null;
  rollNumber: number | null;
  votedAt: string | null; // YYYY-MM-DD
  voteTime: string | null;
  question: string | null;
  voteType: string | null;
  result: string | null;
  bill: string | null;
  description: string | null;
  yeas: number | null;
  nays: number | null;
  present: number | null;
  notVoting: number | null;
  positions: ParsedPosition[];
}

export const DESCRIPTION_MAX = 600;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "3-Jan-2025" -> "2025-01-03". */
export function parseHouseDate(s: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})\s*$/.exec(s ?? "");
  if (!m) return null;
  const mon = MONTHS[m[2]!.toLowerCase()];
  return mon ? iso(Number(m[3]), mon, Number(m[1])) : null;
}

/** "January 9, 2025, 02:54 PM" -> { date: "2025-01-09", time: "02:54 PM" }. */
export function parseSenateDate(s: string | null | undefined): { date: string | null; time: string | null } {
  const m = /^\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:,?\s*(\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp][Mm]?))?\s*$/.exec(s ?? "");
  if (!m) return { date: null, time: null };
  const mon = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
  if (!mon) return { date: null, time: null };
  return { date: iso(Number(m[3]), mon, Number(m[2])), time: m[4] ? m[4].replace(/\s+/g, " ").toUpperCase() : null };
}

export function mapPosition(raw: string | null | undefined): Position | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "yea" || t === "aye" || t === "yes") return "yea";
  if (t === "nay" || t === "no") return "nay";
  if (t === "present") return "present";
  if (t === "not voting" || t === "not_voting" || t === "absent") return "not_voting";
  return null;
}

function int(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = s.replace(/[,\s]/g, "");
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Value of attribute `attr` in the first `<tag ...>` of `xml`. */
function attrOf(xml: string, tag: string, attr: string): string | null {
  const m = new RegExp(`<${tag}\\b([^>]*)>`, "i").exec(xml);
  if (!m) return null;
  const a = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i").exec(m[1]!);
  return a ? cleanText(a[1]!, 200) : null;
}

/** "1st" -> 1, "2nd" -> 2, "2" -> 2. */
function sessionNumber(s: string | null): number | null {
  const m = /^\s*(\d+)/.exec(s ?? "");
  return m ? Number(m[1]) : null;
}

export function parseHouseVoteXml(xml: string): ParsedVote {
  const meta = blocks(xml, "vote-metadata")[0] ?? "";
  const totals = blocks(meta, "totals-by-vote")[0] ?? "";
  const positions: ParsedPosition[] = [];
  for (const rv of blocks(xml, "recorded-vote")) {
    const key = attrOf(rv, "legislator", "name-id");
    if (!key) continue;
    const raw = leaf(rv, "vote");
    positions.push({
      memberKey: key,
      name: leaf(rv, "legislator"),
      party: attrOf(rv, "legislator", "party"),
      state: attrOf(rv, "legislator", "state"),
      position: mapPosition(raw),
      rawPosition: raw,
    });
  }
  const timeEl = /<action-time\b[^>]*>([\s\S]*?)<\/action-time>/i.exec(meta);
  const bill = leaf(meta, "legis-num");
  return {
    chamber: "house",
    congress: int(leaf(meta, "congress")),
    session: sessionNumber(leaf(meta, "session")),
    rollNumber: int(leaf(meta, "rollcall-num")),
    votedAt: parseHouseDate(leaf(meta, "action-date")),
    voteTime: timeEl ? cleanText(timeEl[1]!, 40) : null,
    question: leaf(meta, "vote-question"),
    voteType: leaf(meta, "vote-type"),
    result: leaf(meta, "vote-result"),
    bill: bill && !/^(none|n\/a)$/i.test(bill) ? bill : null,
    description: cleanText(leaf(meta, "vote-desc"), DESCRIPTION_MAX),
    yeas: int(leaf(totals, "yea-total")),
    nays: int(leaf(totals, "nay-total")),
    present: int(leaf(totals, "present-total")),
    notVoting: int(leaf(totals, "not-voting-total")),
    positions,
  };
}

/** "Alsobrooks (D-MD)" -> { party: "D", state: "MD" }. */
function partyStateFromFull(full: string | null): { party: string | null; state: string | null } {
  const m = /\(([A-Z]{1,3})-([A-Z]{2})\)\s*$/.exec(full ?? "");
  return m ? { party: m[1]!, state: m[2]! } : { party: null, state: null };
}

export function parseSenateVoteXml(xml: string): ParsedVote {
  const count = blocks(xml, "count")[0] ?? "";
  const doc = blocks(xml, "document")[0] ?? "";
  const positions: ParsedPosition[] = [];
  for (const mem of blocks(xml, "member")) {
    const key = leaf(mem, "lis_member_id");
    if (!key) continue;
    const full = leaf(mem, "member_full");
    const ps = partyStateFromFull(full);
    const first = leaf(mem, "first_name");
    const last = leaf(mem, "last_name");
    const raw = leaf(mem, "vote_cast");
    positions.push({
      memberKey: key,
      name: first && last ? `${first} ${last}` : full,
      party: leaf(mem, "party") ?? ps.party,
      state: leaf(mem, "state") ?? ps.state,
      position: mapPosition(raw),
      rawPosition: raw,
    });
  }
  const when = parseSenateDate(leaf(xml, "vote_date"));
  const dType = leaf(doc, "document_type");
  const dNum = leaf(doc, "document_number");
  const bill = leaf(doc, "document_name") ?? (dType && dNum ? `${dType} ${dNum}` : null) ?? leaf(xml, "issue");
  return {
    chamber: "senate",
    congress: int(leaf(xml, "congress")),
    session: sessionNumber(leaf(xml, "session")),
    rollNumber: int(leaf(xml, "vote_number")),
    votedAt: when.date,
    voteTime: when.time,
    question: leaf(xml, "question") ?? leaf(xml, "vote_question_text"),
    voteType: leaf(xml, "majority_requirement"),
    result: leaf(xml, "vote_result"),
    bill,
    description: cleanText(leaf(xml, "vote_document_text") ?? leaf(xml, "vote_title"), DESCRIPTION_MAX),
    yeas: int(leaf(count, "yeas")),
    nays: int(leaf(count, "nays")),
    present: int(leaf(count, "present")),
    notVoting: int(leaf(count, "absent")),
    positions,
  };
}

/** The layout this job reads: a vote number, a date and at least one recorded position. */
export function hasVoteShape(v: ParsedVote): boolean {
  return v.rollNumber != null && v.votedAt != null && v.positions.length > 0;
}

/** Fill counts from the positions when the totals block is missing. */
export function withCounts(v: ParsedVote): ParsedVote {
  const n = (p: Position) => v.positions.filter((x) => x.position === p).length;
  return {
    ...v,
    yeas: v.yeas ?? n("yea"),
    nays: v.nays ?? n("nay"),
    present: v.present ?? n("present"),
    notVoting: v.notVoting ?? n("not_voting"),
  };
}

export function houseVoteUrl(base: string, year: number, roll: number): string {
  const n = roll > 999 ? String(roll) : String(roll).padStart(3, "0");
  return `${base.replace(/\/+$/, "")}/evs/${year}/roll${n}.xml`;
}

export function senateMenuUrl(base: string, congress: number, session: number): string {
  return `${base.replace(/\/+$/, "")}/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
}

export function senateVoteUrl(base: string, congress: number, session: number, roll: number): string {
  const n = String(roll).padStart(5, "0");
  return `${base.replace(/\/+$/, "")}/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${n}.xml`;
}

/** Vote numbers listed in a Senate menu file. */
export function parseSenateMenu(xml: string): number[] {
  const out = new Set<number>();
  for (const v of blocks(xml, "vote")) {
    const n = int(leaf(v, "vote_number"));
    if (n != null && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Congress number and session for a calendar year (119th Congress began 2025). */
export function congressSession(year: number): { congress: number; session: number } {
  return { congress: Math.floor((year - 1789) / 2) + 1, session: year % 2 === 1 ? 1 : 2 };
}
