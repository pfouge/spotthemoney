// SEC Schedules 13D and 13G on stock and company pages (stage 2 of queue item "13D/13G").
//
// A Schedule 13D or 13G is the statement a person, fund or group files with the SEC after coming
// to own more than 5% of a class of a company's voting shares, and files again when the holding
// changes materially or falls below 5%. 13D is the long form; 13G is the short form for passive
// and institutional holders. A statement says what the filer says it owned on its event date.
// It is not a report of a trade. Rules that follow from that:
//   - A page lists each holder's NEWEST statement on record about the company. An amendment does
//     not say which statement it replaces, so statements are matched by the filer's SEC number
//     and the company; an older statement by the same filer is in the CSV file, not on the page.
//   - The figures are the filer's own, as filed. `shares` and `percent` are the largest any one
//     reporting person states (members of a group each report the group's combined holding), so
//     nothing is added up: not across reporting persons and not across holders.
//   - A newest statement under 5% is a notice that the holder is no longer above the threshold.
//     It is listed and marked, never dropped: dropping it would leave the older, larger figure
//     as the last word.
//   - The record starts with statements published from October 2025 on. A holder whose last
//     statement is older is not listed, so the list is never called a full list of holders.
//   - Nothing here feeds a buy or sell total, a chart, a feed or the trade map, and nothing is
//     derived from a statement (no flag, score or label such as "activist").
//   - The section is shown only once the load has reached today (caughtUp in
//     lib/coverage-stored.ts); until then no page, file or sentence claims to show statements.
//
// Pure: lib/schedule13-build.ts runs the query and passes rows in. Tests: scripts/schedule13.test.ts.

export interface Statement {
  accession: string;
  formType: string;                 // "SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A"
  schedule: "13D" | "13G";
  isAmendment: boolean;
  filedAt: string;                  // YYYY-MM-DD
  eventDate: string | null;
  issuerCik: string;                // 10 digits
  issuerCusip: string | null;
  securityClass: string | null;
  filerCik: string | null;          // the submission's filer, 10 digits
  reporterName: string | null;      // first reporting person on the cover pages
  reporterCount: number;
  shares: number | null;            // largest amount any one reporting person states
  percent: number | null;           // largest percent of class any one reporting person states
  rules: string[];                  // 13G: the rule(s) it is filed under
  purpose: string | null;           // 13D Item 4, as filed (cut at ingest)
  sourceUrl: string | null;
}

export interface Schedule13Data {
  /** True once the load has caught up with today; only then are statements loaded and shown. */
  shown: boolean;
  /** Newest filing date in the whole table (every issuer), or null. */
  lastFiled: string | null;
  /** 10-digit issuer CIK → every statement on record about that company, newest filed first. Empty unless shown. */
  byCik: Map<string, Statement[]>;
}
export const emptySchedule13 = (): Schedule13Data => ({ shown: false, lastFiled: null, byCik: new Map() });

/** Holders printed in a page's table; the rest are counted and are in the CSV file. */
export const HOLDER_ROWS = 25;
/** The percent of a class above which a statement must be filed. */
export const THRESHOLD_PERCENT = 5;
/** The record holds statements published from this month on (the load's start, SEC_13DG_SINCE). */
export const RECORD_START_LABEL = "October 2025";
/** Characters of a 13D's stated purpose kept in the CSV file. */
export const PURPOSE_MAX = 1000;

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

// The one text cleaner for filer-typed text (white space collapsed, control and direction
// characters out, cut at a length), shared with the Form 144 section.
import { cleanText } from "./form144";
export { cleanText };

/** A share count that can be shown: a finite number, zero included (a holder can report none left). */
export const sharesStated = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
/** A percent of class that can be shown: 0 to 100. */
export const percentStated = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null);

/** "9.32%", "11.5%", "0%": the figure as stated, at most two decimals, no padding. */
export function percentLabel(n: number | null | undefined): string | null {
  const p = percentStated(n);
  if (p == null) return null;
  return `${Number(p.toFixed(2)).toString()}%`;
}

/** True when the statement's own percent is under the 5% filing threshold. */
export const belowThreshold = (s: Statement): boolean => { const p = percentStated(s.percent); return p != null && p < THRESHOLD_PERCENT; };

/** "Schedule 13G", "Schedule 13D, amendment". */
export const scheduleLabel = (s: Statement): string => `Schedule ${s.schedule}${s.isAmendment ? ", amendment" : ""}`;

/** Newest filed first; ties by accession, newest first, so the order is the same in every build. */
export function sortStatements(xs: readonly Statement[]): Statement[] {
  return [...xs].sort((a, b) => b.filedAt.localeCompare(a.filedAt) || b.accession.localeCompare(a.accession));
}

/** One holder is one filer number, or, with no number, one name whatever its capitals. */
export const holderKey = (s: Statement): string => (s.filerCik ? `c:${s.filerCik}` : `n:${(cleanText(s.reporterName, 200) ?? "").toLowerCase()}`);

export interface Holder {
  /** The holder's newest statement on record about the company. */
  latest: Statement;
  /** Statements on record by this holder about the company, the newest included. */
  statements: number;
}

/**
 * Each holder's newest statement about one company, from that company's statements. Statements
 * dated after the build day are left out. Order: largest stated percent first, a statement with
 * no percent last; ties by shares, then name, then accession.
 */
export function holdersOf(xs: readonly Statement[], builtAt: string): Holder[] {
  const end = String(builtAt).slice(0, 10);
  const by = new Map<string, Holder>();
  for (const s of sortStatements(xs)) {
    if (!isDate(s.filedAt) || (isDate(end) && s.filedAt > end)) continue;
    const k = holderKey(s);
    const h = by.get(k);
    if (h) h.statements++; else by.set(k, { latest: s, statements: 1 });
  }
  const pct = (h: Holder) => percentStated(h.latest.percent) ?? -1;
  return [...by.values()].sort((a, b) =>
    pct(b) - pct(a) || (sharesStated(b.latest.shares) ?? -1) - (sharesStated(a.latest.shares) ?? -1)
    || (cleanText(a.latest.reporterName, 200) ?? "").localeCompare(cleanText(b.latest.reporterName, 200) ?? "") || b.latest.accession.localeCompare(a.latest.accession));
}

export interface HolderSummary { holders: number; atOrAbove: number; below: number; noPercent: number; on13D: number; statements: number; newest: string | null }

/** Counts over a company's holders. No shares and no percentages are added up. */
export function holderSummary(hs: readonly Holder[]): HolderSummary {
  const below = hs.filter((h) => belowThreshold(h.latest)).length;
  const noPercent = hs.filter((h) => percentStated(h.latest.percent) == null).length;
  const dates = hs.map((h) => h.latest.filedAt).sort();
  return {
    holders: hs.length, below, noPercent, atOrAbove: hs.length - below - noPercent,
    on13D: hs.filter((h) => h.latest.schedule === "13D").length,
    statements: hs.reduce((a, h) => a + h.statements, 0), newest: dates[dates.length - 1] ?? null,
  };
}

const nf = (x: number) => x.toLocaleString("en-US");
const many = (x: number, one: string, more: string) => `${nf(x)} ${x === 1 ? one : more}`;

/** The sentence above a page's table. `name` is the company as the page names it. */
export function summarySentence(name: string, s: HolderSummary): string {
  if (!s.holders) return "";
  const parts: string[] = [];
  if (s.atOrAbove) parts.push(`${many(s.atOrAbove, "reports", "report")} ${THRESHOLD_PERCENT}% or more of a class of shares`);
  if (s.below) parts.push(`${many(s.below, "reports", "report")} less than ${THRESHOLD_PERCENT}%`);
  if (s.noPercent) parts.push(`${many(s.noPercent, "states", "state")} no percentage`);
  return `${many(s.holders, "holder has", "holders have")} filed an ownership statement (Schedule 13D or 13G) about ${name} with the SEC since ${RECORD_START_LABEL}. In the newest statement of each, ${parts.join(", ")}.`;
}

/** What every section says under the summary. One wording, so the verifier can require it. */
export const HOLDER_CAVEAT =
  "Each row is the holder's newest statement on record and gives what the filer says it owned on the event date. It is not a report of a trade, and the holding may have changed since. " +
  `A holder files a statement after passing ${THRESHOLD_PERCENT}% of a class of voting shares and again when it falls below ${THRESHOLD_PERCENT}%, so a row under ${THRESHOLD_PERCENT}% is a notice that the holder is no longer above that mark. ` +
  "Members of a group each report the group's combined holding, so the rows are not to be added together. " +
  `This is not a full list of shareholders: a holder whose last statement was filed before ${RECORD_START_LABEL} is not listed. None of these figures is in any buy or sell total, chart or trade map on this site.`;

/** One build-log line to compare with SQL. */
export function schedule13Log(d: Schedule13Data, builtAt: string, companyCiks: ReadonlySet<string>): string {
  if (!d.shown) return `large holders (Schedules 13D and 13G): not shown (newest filing on file ${d.lastFiled ?? "none"}; the load has not reached the build day ${builtAt.slice(0, 10)})`;
  let rows = 0, amend = 0, issuers = 0, holders = 0, below = 0, on13D = 0, capped = 0, most = 0, maxShares = 0, newest = "";
  for (const [cik, xs] of d.byCik) {
    if (!companyCiks.has(cik)) continue;
    rows += xs.length; issuers++;
    amend += xs.filter((s) => s.isAmendment).length;
    const hs = holdersOf(xs, builtAt);
    const sum = holderSummary(hs);
    holders += sum.holders; below += sum.below; on13D += sum.on13D;
    if (hs.length > HOLDER_ROWS) capped++;
    if (hs.length > most) most = hs.length;
    for (const s of xs) { if ((s.shares ?? 0) > maxShares) maxShares = s.shares ?? 0; if (s.filedAt > newest) newest = s.filedAt; }
  }
  return `large holders (Schedules 13D and 13G): shown; ${rows} statements for ${issuers} companies on the site (${amend} amendments), newest ${newest || "none"}; ${holders} holders by newest statement, ${below} of them under ${THRESHOLD_PERCENT}%, ${on13D} on Schedule 13D; most holders for one company ${most}; ${capped} companies with more than ${HOLDER_ROWS}; largest stated holding ${Math.round(maxShares)} shares`;
}

/** A second build-log line: the filer's side. `people` and `companies` = 10-digit CIKs of people and companies with a page. */
export function holdingsLog(d: Schedule13Data, builtAt: string, people: ReadonlySet<string>, companies: ReadonlySet<string>): string {
  if (!d.shown) return "large holdings by filer: not shown";
  const pairs = new Map<string, Set<string>>();
  const end = builtAt.slice(0, 10);
  for (const [issuer, xs] of d.byCik) {
    if (!companies.has(issuer)) continue;
    for (const s of xs) {
      if (!s.filerCik || s.filerCik === issuer || s.filedAt > end || !(people.has(s.filerCik) || companies.has(s.filerCik))) continue;
      const set = pairs.get(s.filerCik); if (set) set.add(issuer); else pairs.set(s.filerCik, new Set([issuer]));
    }
  }
  let rows = 0, most = 0, onPeople = 0, onCompanies = 0;
  for (const [f, set] of pairs) { rows += set.size; if (set.size > most) most = set.size; if (companies.has(f)) onCompanies++; if (people.has(f)) onPeople++; }
  return `large holdings by filer: ${rows} filer and company pairs on ${onPeople} insider pages and ${onCompanies} company pages; most on one page ${most}`;
}

// ── the filer's side: what one filer reports holding in other companies ─────────────────────
export interface Holding {
  /** The filer's newest statement on record about the company. */
  latest: Statement;
  /** Statements on record by this filer about the company, the newest included. */
  statements: number;
}

/**
 * One filer's newest statement about each company, from that filer's statements. Statements
 * dated after the build day are left out. Order: largest stated percent first, no percent last;
 * ties by shares, then the company's number, then accession.
 */
export function holdingsOf(xs: readonly Statement[], builtAt: string): Holding[] {
  const end = String(builtAt).slice(0, 10);
  const by = new Map<string, Holding>();
  for (const s of sortStatements(xs)) {
    if (!isDate(s.filedAt) || (isDate(end) && s.filedAt > end)) continue;
    const h = by.get(s.issuerCik);
    if (h) h.statements++; else by.set(s.issuerCik, { latest: s, statements: 1 });
  }
  const pct = (h: Holding) => percentStated(h.latest.percent) ?? -1;
  return [...by.values()].sort((a, b) =>
    pct(b) - pct(a) || (sharesStated(b.latest.shares) ?? -1) - (sharesStated(a.latest.shares) ?? -1)
    || a.latest.issuerCik.localeCompare(b.latest.issuerCik) || b.latest.accession.localeCompare(a.latest.accession));
}

/** The sentence above the table on the filer's page. Counts companies; nothing is added up. */
export function holdingsSentence(name: string, hs: readonly Holding[]): string {
  if (!hs.length) return "";
  const below = hs.filter((h) => belowThreshold(h.latest)).length;
  const noPercent = hs.filter((h) => percentStated(h.latest.percent) == null).length;
  const atOrAbove = hs.length - below - noPercent;
  const parts: string[] = [];
  if (atOrAbove) parts.push(`${nf(atOrAbove)} ${atOrAbove === 1 ? "reports" : "report"} ${THRESHOLD_PERCENT}% or more of a class of shares`);
  if (below) parts.push(`${nf(below)} ${below === 1 ? "reports" : "report"} less than ${THRESHOLD_PERCENT}%`);
  if (noPercent) parts.push(`${nf(noPercent)} ${noPercent === 1 ? "states" : "state"} no percentage`);
  return `${name} is the filer of an ownership statement (Schedule 13D or 13G) about ${many(hs.length, "company", "companies")} this site tracks, filed with the SEC since ${RECORD_START_LABEL}. Of the newest statement about each, ${parts.join(", ")}.`;
}

/** What the filer's-side section says under the summary. One wording, so the verifier can require it. */
export const HOLDINGS_CAVEAT =
  "Each row is the newest statement on record under this filer's SEC number about that company and gives what the filer says it owned on the event date. It is not a report of a trade, and the holding may have changed since. " +
  `A row under ${THRESHOLD_PERCENT}% is a notice that the filer is no longer above that mark. A statement can name several reporting persons, who each report the group's combined holding, so the rows are not to be added together. ` +
  `This is not a full list of what the filer owns: only holdings above ${THRESHOLD_PERCENT}% of a class are reported this way, and only companies this site tracks are listed. None of these figures is in any buy or sell total, chart or trade map on this site.`;
