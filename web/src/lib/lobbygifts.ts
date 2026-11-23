// Contributions that lobbyists report on Form LD-203 (migration 0033). Pure functions, no
// database: the hub, the member and company sections, the CSV, the build log and
// scripts/lobbygifts.test.ts use them. (The ingest side is ingest/src/lib/lobbycontrib.ts.)
//
// Rules:
//  - An amended report is a new filing and the API does not link it to the one it replaces. For
//    the same registrant, lobbyist (or none), filing year and filing period only the filing with
//    the newest posted date counts (the SQL in lobbygifts-build.ts; countedKey() here is the same
//    rule for tests and the verifier). Earlier ones are left out of every figure and list; the CSV
//    keeps their items with counted = false.
//  - Names are as typed by the filer. Nothing is merged: the same recipient can appear under
//    several spellings. An item is tied to a member of Congress only by memberForItem, which is
//    deliberately narrow: no fuzzy matching, no surname-only matching, nothing for an honoree
//    field that names several people. Two rules: the honoree field names the member, or the
//    payee equals the name of a campaign committee linked to the member by ids (migration 0040).
//  - A date in the future or missing: the item is listed without a date and counted in its
//    filing's period.
//  - Amounts are as reported. Nothing says a contribution was meant to change anything.
import { normalizeOrgName } from "@stm/shared";

export const LOBBY_CONTRIB_CAVEAT =
  "These are contributions and payments that lobbyists and lobbying firms reported on Form LD-203 and whose honoree field names this member, or whose payee is the member's campaign committee, as typed by the filer. A report by a lobbyist is not a statement by the member, other spellings of the name are not matched, and nothing here links a contribution to a vote, a trade or any action.";
export const LOBBY_CONTRIB_FILER_CAVEAT =
  "These are contributions and payments that this company's lobbying filings report on Form LD-203, as typed by the filer. The company is matched to the filer by exact name only, so reports under a subsidiary or a differently spelled name are not included. A report is not a statement by the recipient, and nothing here links a contribution to a vote, a trade or any action.";
export const SENATE_NOTICE = "The Senate Office of Public Records cannot vouch for the data or for analyses derived from it.";

export const MEMBER_ROWS = 25;
export const COMPANY_ROWS = 25;
export const FILER_ROWS = 50;
export const RECIPIENT_ROWS = 100;
export const NEWEST_ROWS = 100;
/** A CSV file is split by period when a year would pass this many bytes (Cloudflare allows 25 MiB). */
export const CSV_MAX_BYTES = 15 * 1024 * 1024;

export interface ItemRow {
  date: string | null; contributor: string | null; type: string | null; payee: string | null; honoree: string | null; amount: number | null;
  registrant: string | null; lobbyist: string | null; year: number | null; period: string | null; posted: string | null; filingUuid: string; sourceUrl: string | null;
  /** The page of the member the item names, by memberForItem; null otherwise. */
  memberSlug: string | null;
  /** True when the member was found through the payee (a campaign committee), not the honoree field. */
  viaPayee: boolean;
}
export interface PeriodStat { year: number; period: string; label: string; filings: number; withContributions: number; items: number; amount: number }
export interface TypeRow { type: string; items: number; amount: number }
export interface FilerRow { registrant: string; filings: number; items: number; amount: number }
export interface RecipientRow { name: string; role: "honoree" | "payee"; items: number; filers: number; amount: number; memberSlug: string | null }
export interface YearStat { year: number; items: number; filers: number; amount: number }
export interface Subject { slug: string; years: YearStat[]; items: ItemRow[] }
export interface CompanyContrib { companyId: number; registrants: string[]; years: YearStat[]; items: ItemRow[] }
export interface CsvFile { name: string; year: number; period: string | null; rows: number; bytes: number; file: string; updated: string | null }
export interface LobbyContribData {
  available: boolean;
  newestYear: number | null;
  filingsCounted: number; filingsSuperseded: number; filingsAll: number;
  newestPosted: string | null;
  periods: PeriodStat[];
  types: TypeRow[]; filers: FilerRow[]; recipients: RecipientRow[]; newest: ItemRow[];
  /** Items of the newest year, and how many of them name a member of Congress by memberForItem. */
  match: { items: number; matched: number };
  /** Counted filings that carry at least one item, by the day the Senate posted them, for the last 30 days (the home page's week count). */
  postedRecent: { date: string; filings: number }[];
  members: Map<string, Subject>;
  companies: Map<number, CompanyContrib>;
  csv: CsvFile[];
}
export const emptyLobbyContrib = (): LobbyContribData => ({
  available: false, newestYear: null, filingsCounted: 0, filingsSuperseded: 0, filingsAll: 0, newestPosted: null, periods: [], types: [], filers: [], recipients: [],
  newest: [], match: { items: 0, matched: 0 }, postedRecent: [], members: new Map(), companies: new Map(), csv: [],
});

// ── text ─────────────────────────────────────────────────────────────────────────────────
export function cleanText(s: string | null | undefined, max = 300): string | null {
  if (typeof s !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}
/** "year_end" to "Year end"; text the API already prints in mixed case ("Mid-Year (Jan 1 - Jun 30)", "FECA") is kept. */
export function sentenceCase(s: string | null | undefined): string {
  const raw = cleanText(s ?? "") ?? "";
  if (!raw) return "(not stated)";
  if (!raw.includes("_") && raw !== raw.toLowerCase()) return raw;
  const t = raw.replace(/[_]+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}
export const periodLabel = (p: string | null | undefined) => sentenceCase(p);
/** Order of the periods inside a year: mid-year reports first, year-end reports last. */
export function periodRank(p: string | null | undefined): number {
  const t = (p ?? "").toLowerCase();
  if (/end|second|2nd|h2|dec/.test(t)) return 2;
  if (/mid|first|1st|h1|jun/.test(t)) return 1;
  return 0;
}
export const periodSlug = (p: string | null | undefined) => (p ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

/** The key that makes two filings versions of one report: the newest posted one counts. */
export function countedKey(f: { registrantId: number | null; lobbyist: string | null; year: number | null; period: string | null }): string {
  return `${f.registrantId ?? ""}|${f.lobbyist ?? ""}|${f.year ?? ""}|${f.period ?? ""}`;
}
/** Which filings count: per key, the newest posted (ties: the larger uuid). Returns the uuids that count. */
export function countedFilings<T extends { uuid: string; posted: string | null; registrantId: number | null; lobbyist: string | null; year: number | null; period: string | null }>(fs: T[]): Set<string> {
  const best = new Map<string, T>();
  for (const f of fs) {
    const k = countedKey(f); const b = best.get(k);
    const fp = f.posted ?? "", bp = b?.posted ?? "";
    if (!b || fp > bp || (fp === bp && f.uuid > b.uuid)) best.set(k, f);
  }
  return new Set([...best.values()].map((f) => f.uuid));
}

// ── matching an item to a member of Congress ─────────────────────────────────────────────
const TITLES = "the\\s+honorable|hon|senator|sen|representative|rep|congressman|congresswoman|speaker|leader|chairman|chairwoman|chair|dr|mr|mrs|ms";
const LEAD_TITLE = new RegExp(`^(?:${TITLES})\\b\\.?\\s*`, "i");
const MID_TITLE = new RegExp(`[\\s,](?:${TITLES})\\.?\\s+[A-Za-z]`, "i");
const TRAIL_TAG = /\s*[[(][^\])]*[\])]\s*$/;
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Case, accents and punctuation ignored: "Rep. O'Brien, Jr." and "rep obrien jr" are the same text. */
export const nameKey = (s: string) => strip(s).toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** An honoree field after removing leading titles and trailing bracketed tags; null when it names several people or nothing. */
export function honoreeName(raw: string | null | undefined): string | null {
  let t = cleanText(raw, 300); if (!t) return null;
  if (/[;&/+]|\band\b/i.test(t)) return null;
  for (let i = 0; i < 6; i++) { const n = t.replace(TRAIL_TAG, "").trim(); if (n === t) break; t = n; }
  let guard = 0;
  while (guard++ < 6) { const n = t.replace(LEAD_TITLE, "").trim(); if (n === t) break; t = n; }
  if (!t || MID_TITLE.test(t)) return null;
  // Two or more commas: a list of people, not one name with a suffix.
  if ((t.match(/,/g) ?? []).length > 1) return null;
  return t;
}

export interface MemberName { slug: string; fullName: string; firstName: string | null; lastName: string | null }
export interface MemberIndex { full: Map<string, string | null>; pair: Map<string, string | null> }
export function buildMemberIndex(members: MemberName[]): MemberIndex {
  const full = new Map<string, string | null>(); const pair = new Map<string, string | null>();
  const put = (m: Map<string, string | null>, k: string, slug: string) => { if (!k) return; m.set(k, m.has(k) && m.get(k) !== slug ? null : slug); };
  for (const p of members) {
    put(full, nameKey(p.fullName), p.slug);
    if (p.firstName && p.lastName) put(pair, nameKey(`${p.firstName} ${p.lastName}`), p.slug);
  }
  return { full, pair };
}
/**
 * The member an item names, or null. Two ways, nothing else:
 *  (b) the honoree text (titles and bracket tags removed) equals a member's full name as on the
 *      roster, or equals first name plus last name where exactly one member has that pair;
 *  (a) the payee's name (normalised, see normalizeOrgName) equals the name of a campaign committee
 *      that is linked to a member by ids. `committees` maps that normalised name to the member's
 *      slug; a name two members' committees share is left out of the map. Rule (b) is tried first,
 *      so an honoree that names a member wins over the payee.
 * An honoree field that names several people matches nobody; so does a surname alone.
 */
export function memberForItem(item: { honoree: string | null; payee?: string | null }, idx: MemberIndex, committees?: Map<string, string>): string | null {
  const h = honoreeName(item.honoree);
  if (h) {
    const k = nameKey(h);
    const f = idx.full.get(k); if (f) return f;
    const p = idx.pair.get(k); if (p) return p;
  }
  if (committees && item.payee) {
    const c = committees.get(normalizeOrgName(item.payee)); if (c) return c;
  }
  return null;
}

// ── wording ──────────────────────────────────────────────────────────────────────────────
export function summarySentence(years: YearStat[], newestYear: number, fmt: (n: number) => string): string {
  const parts = years.filter((y) => y.items > 0).map((y) => `${y.items.toLocaleString("en-US")} ${y.items === 1 ? "item" : "items"} in ${y.year} from ${y.filers.toLocaleString("en-US")} ${y.filers === 1 ? "filer" : "filers"}, ${fmt(y.amount)} as reported`);
  return parts.length ? `Lobbyists' LD-203 reports name this member on ${parts.join("; ")}.` : `No LD-203 item names this member in ${newestYear}.`;
}
export function companySummary(name: string, years: YearStat[], fmt: (n: number) => string): string {
  const parts = years.map((y) => `${y.items.toLocaleString("en-US")} ${y.items === 1 ? "item" : "items"} and ${fmt(y.amount)} as reported in ${y.year}`);
  return `The LD-203 reports filed under the name ${name} list ${parts.join("; ")}.`;
}
export const shareText = (m: { items: number; matched: number }) =>
  m.items === 0 ? "none" : `${((100 * m.matched) / m.items).toFixed(1)}%`;

/** One line for the build log, to compare with SQL on production. */
export function lobbyContribLog(d: LobbyContribData): string {
  if (!d.available) return "[web] lobbyist contributions: none on record";
  const per = d.periods.map((p) => `${p.year} ${p.period} ${p.filings}f/${p.withContributions}w/${p.items}i/${Math.round(p.amount)}`).join(", ");
  return `[web] lobbyist contributions: ${d.filingsCounted} filings count (${d.filingsSuperseded} superseded of ${d.filingsAll}); newest year ${d.newestYear}; newest posted ${d.newestPosted ?? "-"}; periods: ${per}; ${d.types.length} types, ${d.filers.length} filers, ${d.recipients.length} recipients in the newest year; items naming a member ${d.match.matched} of ${d.match.items} (${shareText(d.match)}); ${d.members.size} members, ${d.companies.size} companies with a section; ${d.csv.length} CSV files, ${d.csv.reduce((a, f) => a + f.rows, 0)} rows`;
}

export const CSV_COLUMNS: { key: string; about: string }[] = [
  { key: "filing_year", about: "Year of the reporting period." },
  { key: "filing_period", about: "Reporting period, as the Senate's API prints it (mid-year and year-end reports)." },
  { key: "filer_type", about: "Whether an organization or a registered lobbyist filed the report." },
  { key: "registrant", about: "The lobbying firm or organization, as typed on the filing." },
  { key: "lobbyist", about: "The lobbyist whose own report it is. Empty for an organization's report." },
  { key: "contribution_type", about: "Kind of item, as the API prints it (for example contributions to candidates or committees, honorary expenses, meeting expenses)." },
  { key: "made_by", about: "Who made the contribution or payment (the lobbyist, the firm or its PAC), as typed on the filing." },
  { key: "payee", about: "Who was paid or received it, as typed on the filing." },
  { key: "honoree", about: "Who is honored or named, as typed on the filing." },
  { key: "amount", about: "Amount in dollars as reported. Empty when the filing's figure is not a number." },
  { key: "date", about: "Date of the item. Empty when missing, not a real date, or in the future." },
  { key: "posted", about: "Day the Senate posted the filing." },
  { key: "counted", about: "true when the filing counts on this site; false when a later filing for the same registrant, lobbyist, year and period replaces it." },
  { key: "member_page_url", about: "The page of the member of Congress the item is tied to, when it is tied to exactly one by the two rules on the methodology page (the honoree field names the member, or the payee is the member's campaign committee). Empty otherwise." },
  { key: "filing_uuid", about: "The Senate's id of the filing." },
  { key: "source_url", about: "Link to the filing." },
];
