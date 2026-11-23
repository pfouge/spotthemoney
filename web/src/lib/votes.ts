// Roll-call votes of the House and the Senate: what a member page and the hub (/congress-votes/)
// show. Pure: the database read is lib/votes-build.ts; the browser script (scripts/congressvotes.ts)
// and the unit tests use the same filter, sort and address functions as the page.
//
// Rules:
//   - A member's positions are matched by person_id only (the ingest sets it from the Bioguide or
//     LIS id). Never by name.
//   - Counts and the table are what the Clerk of the House and the Secretary of the Senate
//     recorded. "Not voting" covers every reason for missing a vote.
//   - No "voted with party" figure, no attendance percentage, no ranking of members by missed
//     votes, and no pairing of a vote with a trade or a contribution.
import { toCsv, type Column } from "./csv";

export const VOTES_PATH = "/congress-votes/";
export const VOTES_DATA = "/data/congress-votes.json";
export const VOTES_MONTH_DIR = "/data/votes/";
/** Rows in a member page's table. */
export const VOTE_ROWS = 25;
/** The member-page counts cover this many days back from the build day. */
export const VOTES_WINDOW_DAYS = 365;
/** A question is cut at this length (at a word) in a member page's table. */
export const MEMBER_QUESTION_MAX = 120;
/** And at this length in the hub's table and data file; the CSV keeps up to CSV_TEXT_MAX. */
export const HUB_QUESTION_MAX = 300;
export const CSV_TEXT_MAX = 1000;

export const VOTES_CAVEAT = "Positions are as recorded by the Clerk of the House or the Secretary of the Senate. Not voting covers every reason for missing a vote. This site does not score votes, and nothing here links a vote to a trade or a contribution.";

export type Chamber = "house" | "senate";
export type Position = "yea" | "nay" | "present" | "not_voting";
export const POSITIONS: readonly Position[] = ["yea", "nay", "present", "not_voting"];
export const POSITION_LABEL: Record<Position, string> = { yea: "Yea", nay: "Nay", present: "Present", not_voting: "Not voting" };
/** One character per roster entry in a monthly position file; "-" means no recorded position. */
export const POSITION_CHAR: Record<Position, string> = { yea: "y", nay: "n", present: "p", not_voting: "x" };
export const CHAR_POSITION: Record<string, Position> = { y: "yea", n: "nay", p: "present", x: "not_voting" };
export const CHAMBER_LABEL: Record<Chamber, string> = { house: "House", senate: "Senate" };

export interface Roll {
  id: number; chamber: Chamber; congress: number; session: number; roll: number;
  /** YYYY-MM-DD. */
  date: string;
  /** Cleaned question, cut at HUB_QUESTION_MAX. */
  question: string | null;
  result: string | null; bill: string | null; type: string | null;
  yeas: number | null; nays: number | null; present: number | null; notVoting: number | null;
  url: string | null;
}
export interface MemberVoteRow { roll: Roll; position: Position }
export interface MemberVotes {
  /** Counts over the last VOTES_WINDOW_DAYS days. */
  yea: number; nay: number; present: number; notVoting: number;
  /** Positions on record, any date, and the newest vote date. */
  total: number; newest: string | null;
  /** The newest VOTE_ROWS roll calls with a position, newest first. */
  rows: MemberVoteRow[];
}
export interface VotesModel {
  /** False when the tables are missing or hold no roll call. */
  shown: boolean;
  builtAt: string;
  rolls: Roll[];
  /** Member page id (people.id) to that member's votes. Only members with a page and a position on record. */
  byPerson: Map<number, MemberVotes>;
  /** Slug and name of every member with a page and a position on record, for the hub's member pin. */
  members: { slug: string; name: string }[];
  /** Months with positions, per chamber: the monthly files. */
  months: { chamber: Chamber; month: string; rolls: number }[];
  positions: number;
  matched: number;
}
export const emptyVotes = (): VotesModel => ({ shown: false, builtAt: "", rolls: [], byPerson: new Map(), members: [], months: [], positions: 0, matched: 0 });

/** Text from the Clerk and the Senate: control and direction characters out, white space collapsed, cut at a word. */
export function cleanVoteText(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd().replace(/[,;:.\s]+$/, "") + "…";
}

const n0 = (x: unknown): number | null => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
export interface RollRow {
  id: number | string; chamber: string; congress: number; session: number; roll_number: number; voted_at: string;
  question: string | null; result: string | null; bill: string | null; vote_type: string | null;
  yeas: number | null; nays: number | null; present: number | null; not_voting: number | null; source_url: string | null;
}
export function rollFromRow(r: RollRow, questionMax = HUB_QUESTION_MAX): Roll {
  return {
    id: Number(r.id), chamber: r.chamber === "senate" ? "senate" : "house", congress: Number(r.congress), session: Number(r.session), roll: Number(r.roll_number),
    date: String(r.voted_at).slice(0, 10), question: cleanVoteText(r.question, questionMax), result: cleanVoteText(r.result, 200), bill: cleanVoteText(r.bill, 60),
    type: cleanVoteText(r.vote_type, 100), yeas: n0(r.yeas), nays: n0(r.nays), present: n0(r.present), notVoting: n0(r.not_voting), url: httpUrl(r.source_url),
  };
}
const httpUrl = (u: unknown): string | null => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
/** The newest first order used everywhere: date, then chamber, then roll number, all descending. */
export function newestFirst(a: Roll, b: Roll): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : a.chamber < b.chamber ? 1 : a.chamber > b.chamber ? -1 : b.roll - a.roll || b.id - a.id;
}

/** The first day (YYYY-MM-DD) of the member-page window, counted back from the build day. */
export function windowStart(builtAt: string, days = VOTES_WINDOW_DAYS): string {
  const d = new Date(`${builtAt.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
export const inWindow = (date: string, builtAt: string, days = VOTES_WINDOW_DAYS): boolean => date >= windowStart(builtAt, days) && date <= builtAt.slice(0, 10);

/** The member's counts and rows from the positions themselves (the tests and the verifier use this; the build does it in SQL). */
export function memberVotesFrom(positions: { roll: Roll; position: Position }[], builtAt: string): MemberVotes {
  const c: Record<Position, number> = { yea: 0, nay: 0, present: 0, not_voting: 0 };
  let newest: string | null = null;
  for (const p of positions) {
    if (inWindow(p.roll.date, builtAt)) c[p.position]++;
    if (!newest || p.roll.date > newest) newest = p.roll.date;
  }
  const rows = [...positions].sort((a, b) => newestFirst(a.roll, b.roll)).slice(0, VOTE_ROWS).map((p) => ({ roll: p.roll, position: p.position }));
  return { yea: c.yea, nay: c.nay, present: c.present, notVoting: c.not_voting, total: positions.length, newest, rows };
}
export const windowTotal = (v: MemberVotes): number => v.yea + v.nay + v.present + v.notVoting;

const n = (x: number) => x.toLocaleString("en-US");
const many = (x: number, one: string, more: string) => `${n(x)} ${x === 1 ? one : more}`;
/** The one summary sentence of a member page's section. */
export function memberVotesSentence(name: string, v: MemberVotes): string {
  const t = windowTotal(v);
  if (t === 0) return `No roll call in the last 12 months has a recorded position for ${name}${v.newest ? `; the newest on record is from ${v.newest}` : ""}.`;
  return `In the last 12 months, ${name} has a recorded position on ${many(t, "roll call", "roll calls")}: ${n(v.yea)} yea, ${n(v.nay)} nay, ${n(v.present)} present and ${n(v.notVoting)} not voting.`;
}

/** The roll call's label: "House roll call 214" with the congress and session in the title. */
export const rollLabel = (r: Roll): string => `${CHAMBER_LABEL[r.chamber]} ${r.roll}`;
export const rollTitle = (r: Roll): string => `${CHAMBER_LABEL[r.chamber]} roll call ${r.roll}, ${ordinalCongress(r.congress)} Congress, session ${r.session}`;
function ordinalCongress(c: number): string { const v = c % 100; const s = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[c % 10] ?? "th"; return `${c}${s}`; }

// ── the hub: filters, order, address ─────────────────────────────────────────────────────
export const WINDOWS = ["30", "90", "365", "all"] as const;
export type Win = (typeof WINDOWS)[number];
export const WINDOW_LABEL: Record<Win, string> = { "30": "Last 30 days", "90": "Last 90 days", "365": "Last 12 months", all: "All on record" };
export const DEFAULT_WIN: Win = "90";
export const PER_PAGE = [25, 50, 100] as const;
export const DEFAULT_PER = 50;
export const SORT_KEYS = ["date", "chamber", "bill", "result", "yeas", "nays", "present", "notVoting"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const KEYS = ["q", "chamber", "result", "w", "member", "sort", "dir", "page", "n"];

export interface VoteFilter { q: string; chamber: "" | Chamber; result: string; w: Win; member: string }
export const NO_FILTER: VoteFilter = { q: "", chamber: "", result: "", w: DEFAULT_WIN, member: "" };
export interface VoteView { f: VoteFilter; sort: SortKey; dir: "asc" | "desc"; page: number; per: number }
export const DEFAULT_VIEW: VoteView = { f: NO_FILTER, sort: "date", dir: "desc", page: 1, per: DEFAULT_PER };
export function firstDir(k: SortKey): "asc" | "desc" { return k === "chamber" || k === "bill" || k === "result" ? "asc" : "desc"; }

export function winStart(w: Win, built: string): string | null { return w === "all" ? null : windowStart(built, Number(w)); }
export function matches(r: Roll, f: VoteFilter, built: string): boolean {
  if (f.chamber && r.chamber !== f.chamber) return false;
  if (f.result && r.result !== f.result) return false;
  const s = winStart(f.w, built);
  if (s && (r.date < s || r.date > built.slice(0, 10))) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${r.bill ?? ""} ${r.question ?? ""}`.toLowerCase();
    for (const word of q.split(/\s+/)) if (!hay.includes(word)) return false;
  }
  return true;
}
function sortValue(r: Roll, k: SortKey): number | string | null {
  switch (k) {
    case "date": return r.date;
    case "chamber": return r.chamber;
    case "bill": return r.bill ? r.bill.toLowerCase() : null;
    case "result": return r.result ? r.result.toLowerCase() : null;
    case "yeas": return r.yeas; case "nays": return r.nays; case "present": return r.present; default: return r.notVoting;
  }
}
/** Sorted copy. Empty values go last in either direction; ties fall back to the newest-first order. */
export function sortRolls(rows: readonly Roll[], k: SortKey, dir: "asc" | "desc"): Roll[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows.map((r) => ({ r, v: sortValue(r, k) })).sort((a, b) => {
    const x = a.v, y = b.v;
    if (x == null || y == null) { if (x != null) return -1; if (y != null) return 1; }
    else if (x < y) return -sign; else if (x > y) return sign;
    return newestFirst(a.r, b.r);
  }).map((x) => x.r);
}
export interface VoteResult { rows: Roll[]; total: number; all: number; page: number; pages: number; from: number; to: number }
export function screen(all: readonly Roll[], v: VoteView, built: string): VoteResult {
  const sorted = sortRolls(all.filter((r) => matches(r, v.f, built)), v.sort, v.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / v.per));
  const page = Math.min(Math.max(1, v.page), pages);
  const from = (page - 1) * v.per;
  const rows = sorted.slice(from, from + v.per);
  return { rows, total: sorted.length, all: all.length, page, pages, from: rows.length ? from + 1 : 0, to: from + rows.length };
}
export function summaryLine(r: VoteResult): string {
  if (r.total === 0) return r.all === 0 ? "No roll call is on record yet." : "No roll call matches these filters.";
  const head = r.total === r.all ? `All ${many(r.total, "roll call", "roll calls")} on record` : `${many(r.total, "roll call", "roll calls")} of ${n(r.all)} on record`;
  return `${head}. Showing ${n(r.from)} to ${n(r.to)}.`;
}

export function isDefaultFilter(f: VoteFilter): boolean { return !f.q.trim() && !f.chamber && !f.result && f.w === DEFAULT_WIN && !f.member; }
/** True when a hash is a view (carries one of the page's keys), not a jump link. */
export function isViewHash(hash: string): boolean {
  if (!hash.includes("=")) return false;
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return KEYS.some((k) => p.has(k));
}
export function parseHash(hash: string): VoteView {
  const f: VoteFilter = { ...NO_FILTER };
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const ch = p.get("chamber"); if (ch === "house" || ch === "senate") f.chamber = ch;
  f.result = (p.get("result") ?? "").slice(0, 200);
  const w = p.get("w"); if ((WINDOWS as readonly string[]).includes(w ?? "")) f.w = w as Win;
  const m = (p.get("member") ?? "").toLowerCase(); if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m) && m.length <= 80) f.member = m;
  f.q = (p.get("q") ?? "").slice(0, 60);
  const so = p.get("sort") ?? ""; const sort = (SORT_KEYS as readonly string[]).includes(so) ? (so as SortKey) : DEFAULT_VIEW.sort;
  const di = p.get("dir"); const dir = di === "asc" || di === "desc" ? di : firstDir(sort);
  const pg = Number(p.get("page")); const page = Number.isInteger(pg) && pg >= 1 && pg <= 100000 ? pg : 1;
  const pe = Number(p.get("n")); const per = (PER_PAGE as readonly number[]).includes(pe) ? pe : DEFAULT_PER;
  return { f, sort, dir, page, per };
}
export function toHash(v: VoteView): string {
  const p = new URLSearchParams(), f = v.f;
  if (f.chamber) p.set("chamber", f.chamber);
  if (f.result) p.set("result", f.result);
  if (f.w !== DEFAULT_WIN) p.set("w", f.w);
  if (f.member) p.set("member", f.member);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (v.sort !== DEFAULT_VIEW.sort || v.dir !== firstDir(v.sort)) { p.set("sort", v.sort); p.set("dir", v.dir); }
  if (v.page > 1) p.set("page", String(v.page));
  if (v.per !== DEFAULT_PER) p.set("n", String(v.per));
  const s = p.toString();
  return s ? `#${s}` : "";
}
/** The hub opened for one member (and a chamber): the link from a member page. */
export function votesHref(f: Partial<Pick<VoteFilter, "member" | "chamber">>): string {
  return `${VOTES_PATH}${toHash({ ...DEFAULT_VIEW, f: { ...NO_FILTER, ...f } })}`;
}

// ── packed data file ──────────────────────────────────────────────────────────────────────
/** [id, chamber (0 House, 1 Senate), congress, session, roll, date, bill, question, result index (-1 none), yeas, nays, present, not voting, url]. */
export type PackedRoll = [number, 0 | 1, number, number, number, string, string, string, number, number | null, number | null, number | null, number | null, string];
export interface VotesData {
  built: string;
  results: string[];
  /** Members with a page and a position on record: [slug, name]. */
  members: [string, string][];
  rows: PackedRoll[];
}
export function packVotes(built: string, rolls: readonly Roll[], members: { slug: string; name: string }[]): VotesData {
  const results: string[] = [], idx = new Map<string, number>();
  for (const r of rolls) if (r.result && !idx.has(r.result)) idx.set(r.result, results.push(r.result) - 1);
  return {
    built, results, members: members.map((m) => [m.slug, m.name]),
    rows: rolls.map((r) => [r.id, r.chamber === "senate" ? 1 : 0, r.congress, r.session, r.roll, r.date, r.bill ?? "", r.question ?? "", r.result ? idx.get(r.result)! : -1, r.yeas, r.nays, r.present, r.notVoting, r.url ?? ""]),
  };
}
export function unpackVotes(d: VotesData): Roll[] {
  return d.rows.map((x) => ({
    id: x[0], chamber: x[1] === 1 ? "senate" : "house", congress: x[2], session: x[3], roll: x[4], date: x[5], bill: x[6] || null, question: x[7] || null,
    result: x[8] >= 0 ? d.results[x[8]] ?? null : null, type: null, yeas: x[9], nays: x[10], present: x[11], notVoting: x[12], url: x[13] || null,
  }));
}

// ── monthly position files ────────────────────────────────────────────────────────────────
/** One file per chamber and calendar month: a roster, and per roll call id one character per roster entry. */
export interface MonthFile {
  chamber: Chamber; month: string;
  /** [member key, name as recorded, party, state, the member's page slug or ""]. */
  roster: [string, string, string, string, string][];
  /** Roll call id (as text) to its position string. */
  rolls: Record<string, string>;
}
export const monthFileName = (chamber: Chamber, month: string): string => `${chamber}-${month}`;
export const monthFilePath = (chamber: Chamber, month: string): string => `${VOTES_MONTH_DIR}${monthFileName(chamber, month)}.json`;
export const monthOf = (date: string): string => date.slice(0, 7);
export const MONTH_FILE_RE = /^(house|senate)-(\d{4})-(0[1-9]|1[0-2])$/;
/** Counts of y, n, p, x in a position string. */
export function countChars(s: string): Record<Position, number> {
  const c: Record<Position, number> = { yea: 0, nay: 0, present: 0, not_voting: 0 };
  for (const ch of s) { const p = CHAR_POSITION[ch]; if (p) c[p]++; }
  return c;
}
/** One member's position on a roll call from a month file, or null. */
export function positionIn(file: MonthFile, rollId: number, memberSlug: string): Position | null {
  const s = file.rolls[String(rollId)]; if (s == null) return null;
  const i = file.roster.findIndex((r) => r[4] === memberSlug);
  return i < 0 ? null : CHAR_POSITION[s[i] ?? ""] ?? null;
}
/** The four groups of a roll call, members grouped by party within each position. */
export function groupPositions(file: MonthFile, rollId: number): { position: Position; count: number; parties: { party: string; members: MonthFile["roster"] }[] }[] {
  const s = file.rolls[String(rollId)] ?? "";
  return POSITIONS.map((pos) => {
    const members = file.roster.filter((_, i) => CHAR_POSITION[s[i] ?? ""] === pos);
    const by = new Map<string, MonthFile["roster"]>();
    for (const m of members) { const k = m[2] || "?"; const a = by.get(k); if (a) a.push(m); else by.set(k, [m]); }
    const parties = [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([party, ms]) => ({ party, members: ms.sort((a, b) => a[1].localeCompare(b[1])) }));
    return { position: pos, count: members.length, parties };
  });
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────
export const CSV_COLUMNS: Column<Roll>[] = [
  { key: "chamber", about: "house or senate.", get: (r) => r.chamber },
  { key: "congress", about: "Number of the Congress (119 for 2025 and 2026).", get: (r) => r.congress },
  { key: "session", about: "Session of that Congress (1 or 2). Roll call numbers restart every session.", get: (r) => r.session },
  { key: "roll_number", about: "Roll call number within the chamber, congress and session.", get: (r) => r.roll },
  { key: "date", about: "The day of the vote (YYYY-MM-DD).", get: (r) => r.date },
  { key: "bill", about: "The bill, resolution or nomination the vote is about, as the chamber gave it. Empty when it gives none.", get: (r) => r.bill },
  { key: "question", about: "What was being voted on, as the chamber states it.", get: (r) => r.question },
  { key: "vote_type", about: "The kind of vote as the chamber states it (for example a recorded vote or yea-and-nay).", get: (r) => r.type },
  { key: "result", about: "The result as the chamber states it (Passed, Failed, Agreed to ...).", get: (r) => r.result },
  { key: "yeas", about: "Yea (aye) votes in the official totals.", get: (r) => r.yeas },
  { key: "nays", about: "Nay (no) votes in the official totals.", get: (r) => r.nays },
  { key: "present", about: "Members recorded present.", get: (r) => r.present },
  { key: "not_voting", about: "Members recorded not voting, for any reason.", get: (r) => r.notVoting },
  { key: "source_url", about: "The official record of the vote.", get: (r) => r.url },
];
export const votesCsv = (rolls: readonly Roll[]): string => toCsv(CSV_COLUMNS, [...rolls].sort(newestFirst));
/** The rows on screen, every page, as CSV: the same columns, in the view's order. Made in the browser. */
export function viewCsv(all: readonly Roll[], v: VoteView, built: string): string {
  return toCsv(CSV_COLUMNS, sortRolls(all.filter((r) => matches(r, v.f, built)), v.sort, v.dir));
}
export function viewCsvName(v: VoteView, built: string): string {
  const f = v.f;
  const bits = [f.chamber, f.w, f.member, f.result, f.q.trim() ? `q-${f.q.trim()}` : ""].filter(Boolean).map((b) => String(b).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30));
  return `congress-votes-${bits.join("-")}-${built}.csv`;
}

export function votesLog(m: VotesModel): string {
  if (!m.shown) return "roll-call votes: not shown (no roll call on record)";
  const h = m.rolls.filter((r) => r.chamber === "house").length, s = m.rolls.length - h;
  const dates = m.rolls.map((r) => r.date).sort();
  const inWin = m.rolls.filter((r) => inWindow(r.date, m.builtAt)).length;
  let withWin = 0;
  for (const v of m.byPerson.values()) if (windowTotal(v) > 0) withWin++;
  return `roll-call votes: ${m.rolls.length} roll calls (${h} House, ${s} Senate), ${dates[0]} to ${dates.at(-1)}, ${inWin} in the last ${VOTES_WINDOW_DAYS} days; ${m.positions} positions, ${m.matched} matched to a person; ${m.byPerson.size} members with a page and a position, ${withWin} with one in the window; ${m.months.length} monthly position files`;
}
