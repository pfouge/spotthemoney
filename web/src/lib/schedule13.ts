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
//   - A holder that reports on two classes of a company's shares (Alphabet's Class A and Class C,
//     say) gets a row per class. A class is told by the CUSIP number the statement gives, and
//     only by this test (rowsByClass): the holder's statements under one number and under
//     another overlap in time, that is, the filer went back to the first number after using the
//     second, or filed under both on one day. When every statement under one number was filed
//     before every statement under another, the number is taken to have CHANGED (a reverse
//     split, a move of the company, a corrected typing mistake) and only the newest statement
//     counts: on production (2026-11-24) 54 filer and company pairs carry two numbers, 26 of
//     them overlap (two classes) and 28 follow one another (the same stake under a new number).
//     A holder with any statement that gives no CUSIP is never split.
//   - Before that test, a number that cannot be a CUSIP number (it fails the check digit, or is
//     not nine characters) and is within TYPO_MAX_DISTANCE characters of exactly one nearest
//     valid number of the same holder and company is read as that number mistyped: its
//     statements join that number's. So a slip of the keyboard between two statements under
//     the right number does not make a second row. On production (2026-11-24) 8 of 1,021
//     numbers fail the check and one of them sits beside the number it was meant to be. A
//     wrong number that happens to pass the check (one in ten does) is not caught.
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

/**
 * The CUSIP number of a statement as a key for its class of shares: white space out, capitals,
 * the nine characters inside a U.S. ISIN ("US50101L1061"), and "" for none or all zeros. The
 * number is otherwise taken as typed: a mistyped number is another key. classRows folds such a
 * key into the number it was meant to be when it can tell (cusipValid, keyDistance); otherwise
 * the overlap test treats it like any other number.
 */
export function classKey(cusip: string | null | undefined): string {
  const c = String(cusip ?? "").replace(/\s+/g, "").toUpperCase();
  if (!c || /^0+$/.test(c)) return "";
  if (c.length === 12 && c.startsWith("US")) return c.slice(2, 11);
  return c;
}

/** A number that fails the check may differ from a valid one by at most this many characters to be read as that number mistyped. */
export const TYPO_MAX_DISTANCE = 2;

const cusipCharValue = (ch: string): number => {
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 90) return c - 55;
  return ch === "*" ? 36 : ch === "@" ? 37 : ch === "#" ? 38 : -1;
};

/**
 * True when a class key can be a CUSIP number: nine characters, the ninth being the check digit
 * of the first eight (digits count as themselves, letters as 10 to 35, "*", "@" and "#" as 36
 * to 38; every second value is doubled; the digits of the eight values are added; the check
 * digit brings the sum to a multiple of ten). A number that passes can still be the wrong one.
 */
export function cusipValid(key: string): boolean {
  if (key.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let v = cusipCharValue(key[i]!);
    if (v < 0) return false;
    if (i % 2 === 1) v *= 2;
    sum += Math.floor(v / 10) + (v % 10);
  }
  return key[8] === String((10 - (sum % 10)) % 10);
}

/**
 * How far apart two keys are as typed: the number of differing characters when they are equally
 * long, 1 when one is the other with a single character added, and Infinity otherwise.
 */
export function keyDistance(a: string, b: string): number {
  if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  if (long.length - short.length !== 1) return Infinity;
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return 1;
  return Infinity;
}

export interface Holder {
  /** The holder's newest statement on record about the company, or about one class of its shares. */
  latest: Statement;
  /** Statements on record that this row stands for (the newest included). Over a holder's rows they add up to all its statements about the company. */
  statements: number;
  /** holderKey of the statements: rows with the same key are one holder reporting on several classes. */
  holder: string;
}

export interface ClassRows {
  rows: { latest: Statement; statements: number }[];
  /** Numbers read as replaced by a later number (no row of their own). */
  changed: number;
  /** Numbers that fail the CUSIP check and were read as another number of the holder, mistyped. */
  mistyped: number;
}

/**
 * The rows for ONE filer's statements about ONE company, given newest first: one row, the
 * newest statement, unless the statements name several CUSIP numbers whose filing dates overlap
 * (see the header). First a number that cannot be a CUSIP number joins the one valid number
 * nearest to it, when that is within TYPO_MAX_DISTANCE characters and no other valid number is
 * as near. Then a number all of whose statements were filed before all statements under another
 * number is taken to have been replaced by it and gets no row. The statements of replaced
 * numbers are counted with the row of the newest statement.
 */
export function classRows(xs: readonly Statement[]): ClassRows {
  if (!xs.length) return { rows: [], changed: 0, mistyped: 0 };
  type G = { key: string; latest: Statement; at: number; first: string; last: string; n: number };
  const groups = new Map<string, G>();
  xs.forEach((s, i) => {
    const k = classKey(s.issuerCusip);
    const g = groups.get(k);
    if (g) { g.n++; if (s.filedAt < g.first) g.first = s.filedAt; } else groups.set(k, { key: k, latest: s, at: i, first: s.filedAt, last: s.filedAt, n: 1 });
  });
  const one = (mistyped: number): ClassRows => ({ rows: [{ latest: xs[0]!, statements: xs.length }], changed: 0, mistyped });
  if (groups.size === 1 || groups.has("")) return one(0);
  let mistyped = 0;
  const valid = [...groups.values()].filter((g) => cusipValid(g.key));
  for (const g of [...groups.values()]) {
    if (cusipValid(g.key)) continue;
    let best: G | null = null, bestD = Infinity, tie = false;
    for (const v of valid) {
      const d = keyDistance(g.key, v.key);
      if (d < bestD) { best = v; bestD = d; tie = false; } else if (d === bestD) tie = true;
    }
    if (!best || tie || bestD > TYPO_MAX_DISTANCE) continue;
    best.n += g.n;
    if (g.first < best.first) best.first = g.first;
    if (g.last > best.last) best.last = g.last;
    if (g.at < best.at) { best.at = g.at; best.latest = g.latest; }
    groups.delete(g.key);
    mistyped++;
  }
  if (groups.size === 1) return one(mistyped);
  // Newest first, so the group of the newest statement, which is always kept, comes first.
  const all = [...groups.values()].sort((x, y) => x.at - y.at);
  const kept = all.filter((g) => !all.some((o) => o !== g && o.first > g.last));
  const replaced = all.filter((g) => !kept.includes(g));
  const extra = replaced.reduce((n, g) => n + g.n, 0);
  return { rows: kept.map((g, i) => ({ latest: g.latest, statements: g.n + (i === 0 ? extra : 0) })), changed: replaced.length, mistyped };
}

/** The rows of classRows alone. */
export const rowsByClass = (xs: readonly Statement[]): { latest: Statement; statements: number }[] => classRows(xs).rows;

/** One company's statements, newest first, by holder; statements dated after the build day are left out. */
function byHolder(xs: readonly Statement[], builtAt: string): Map<string, Statement[]> {
  const end = String(builtAt).slice(0, 10);
  const by = new Map<string, Statement[]>();
  for (const s of sortStatements(xs)) {
    if (!isDate(s.filedAt) || (isDate(end) && s.filedAt > end)) continue;
    const k = holderKey(s);
    const ys = by.get(k);
    if (ys) ys.push(s); else by.set(k, [s]);
  }
  return by;
}

/** For the build log: the holders of one company with a number read as replaced, and with a number read as mistyped. */
export function classNotes(xs: readonly Statement[], builtAt: string): { changed: number; mistyped: number } {
  let changed = 0, mistyped = 0;
  for (const ys of byHolder(xs, builtAt).values()) { const r = classRows(ys); if (r.changed) changed++; if (r.mistyped) mistyped++; }
  return { changed, mistyped };
}

/**
 * Each holder's newest statement about one company, from that company's statements; a holder
 * that reports on several classes of its shares has a row per class (rowsByClass). Statements
 * dated after the build day are left out. Order: largest stated percent first, a statement with
 * no percent last; ties by shares, then name, then accession.
 */
export function holdersOf(xs: readonly Statement[], builtAt: string): Holder[] {
  const rows: Holder[] = [];
  for (const [holder, ys] of byHolder(xs, builtAt)) for (const r of rowsByClass(ys)) rows.push({ ...r, holder });
  const pct = (h: Holder) => percentStated(h.latest.percent) ?? -1;
  return rows.sort((a, b) =>
    pct(b) - pct(a) || (sharesStated(b.latest.shares) ?? -1) - (sharesStated(a.latest.shares) ?? -1)
    || (cleanText(a.latest.reporterName, 200) ?? "").localeCompare(cleanText(b.latest.reporterName, 200) ?? "") || b.latest.accession.localeCompare(a.latest.accession));
}

export interface HolderSummary {
  /** Different holders (filer numbers). */
  holders: number;
  /** Rows: one per holder, and one more for each further class of shares a holder reports on. */
  rows: number;
  /** Holders with more than one row. */
  multiClass: number;
  /** These three count ROWS and add up to `rows`. */
  atOrAbove: number; below: number; noPercent: number;
  on13D: number; statements: number; newest: string | null;
}

/** Counts over a company's rows. No shares and no percentages are added up. */
export function holderSummary(hs: readonly Holder[]): HolderSummary {
  const below = hs.filter((h) => belowThreshold(h.latest)).length;
  const noPercent = hs.filter((h) => percentStated(h.latest.percent) == null).length;
  const dates = hs.map((h) => h.latest.filedAt).sort();
  const perHolder = new Map<string, number>();
  for (const h of hs) perHolder.set(h.holder, (perHolder.get(h.holder) ?? 0) + 1);
  return {
    holders: perHolder.size, rows: hs.length, multiClass: [...perHolder.values()].filter((n) => n > 1).length,
    below, noPercent, atOrAbove: hs.length - below - noPercent,
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
  const head = `${many(s.holders, "holder has", "holders have")} filed an ownership statement (Schedule 13D or 13G) about ${name} with the SEC since ${RECORD_START_LABEL}`;
  if (s.rows > s.holders) return `${head}, ${nf(s.multiClass)} of them about more than one class of shares, so the table has ${many(s.rows, "row", "rows")}, one for each holder and class. In the newest statement of each row, ${parts.join(", ")}.`;
  return `${head}. In the newest statement of each, ${parts.join(", ")}.`;
}

/** What every section says under the summary. One wording, so the verifier can require it. */
export const HOLDER_CAVEAT =
  "Each row is the holder's newest statement on record about a class of shares and gives what the filer says it owned on the event date. It is not a report of a trade, and the holding may have changed since. " +
  `A holder files a statement after passing ${THRESHOLD_PERCENT}% of a class of voting shares and again when it falls below ${THRESHOLD_PERCENT}%, so a row under ${THRESHOLD_PERCENT}% is a notice that the holder is no longer above that mark. ` +
  "Members of a group each report the group's combined holding, so the rows are not to be added together. " +
  `This is not a full list of shareholders: a holder whose last statement was filed before ${RECORD_START_LABEL} is not listed. None of these figures is in any buy or sell total, chart or trade map on this site.`;

/** One build-log line to compare with SQL. */
export function schedule13Log(d: Schedule13Data, builtAt: string, companyCiks: ReadonlySet<string>): string {
  if (!d.shown) return `large holders (Schedules 13D and 13G): not shown (newest filing on file ${d.lastFiled ?? "none"}; the load has not reached the build day ${builtAt.slice(0, 10)})`;
  let rows = 0, amend = 0, issuers = 0, holders = 0, below = 0, on13D = 0, capped = 0, most = 0, maxShares = 0, newest = "", tableRows = 0, multi = 0, multiCos = 0, changed = 0, mistyped = 0;
  for (const [cik, xs] of d.byCik) {
    if (!companyCiks.has(cik)) continue;
    rows += xs.length; issuers++;
    amend += xs.filter((s) => s.isAmendment).length;
    const hs = holdersOf(xs, builtAt);
    const sum = holderSummary(hs);
    holders += sum.holders; below += sum.below; on13D += sum.on13D;
    tableRows += sum.rows; multi += sum.multiClass; if (sum.multiClass) multiCos++;
    const notes = classNotes(xs, builtAt);
    changed += notes.changed; mistyped += notes.mistyped;
    if (hs.length > HOLDER_ROWS) capped++;
    if (hs.length > most) most = hs.length;
    for (const s of xs) { if ((s.shares ?? 0) > maxShares) maxShares = s.shares ?? 0; if (s.filedAt > newest) newest = s.filedAt; }
  }
  return `large holders (Schedules 13D and 13G): shown; ${rows} statements for ${issuers} companies on the site (${amend} amendments), newest ${newest || "none"}; ${holders} holders, ${tableRows} rows by newest statement and class (${multi} holders with more than one class, on ${multiCos} companies), ${below} rows under ${THRESHOLD_PERCENT}%, ${on13D} on Schedule 13D; most rows for one company ${most}; ${capped} companies with more than ${HOLDER_ROWS}; largest stated holding ${Math.round(maxShares)} shares; ${changed} holders with a number that changed, ${mistyped} with a mistyped number read as the right one`;
}

/** A second build-log line: the filer's side. `people` and `companies` = 10-digit CIKs of people and companies with a page. */
export function holdingsLog(d: Schedule13Data, builtAt: string, people: ReadonlySet<string>, companies: ReadonlySet<string>): string {
  if (!d.shown) return "large holdings by filer: not shown";
  const pairs = new Map<string, Set<string>>();
  const byFiler = new Map<string, Statement[]>();
  const end = builtAt.slice(0, 10);
  for (const [issuer, xs] of d.byCik) {
    if (!companies.has(issuer)) continue;
    for (const s of xs) {
      if (!s.filerCik || s.filerCik === issuer || s.filedAt > end || !(people.has(s.filerCik) || companies.has(s.filerCik))) continue;
      const set = pairs.get(s.filerCik); if (set) set.add(issuer); else pairs.set(s.filerCik, new Set([issuer]));
      const ys = byFiler.get(s.filerCik); if (ys) ys.push(s); else byFiler.set(s.filerCik, [s]);
    }
  }
  let rows = 0, most = 0, onPeople = 0, onCompanies = 0, tableRows = 0;
  for (const [f, set] of pairs) { rows += set.size; if (set.size > most) most = set.size; if (companies.has(f)) onCompanies++; if (people.has(f)) onPeople++; }
  for (const ys of byFiler.values()) tableRows += holdingsOf(ys, builtAt).length;
  return `large holdings by filer: ${rows} filer and company pairs (${tableRows} rows by class) on ${onPeople} insider pages and ${onCompanies} company pages; most on one page ${most}`;
}

// ── the filer's side: what one filer reports holding in other companies ─────────────────────
export interface Holding {
  /** The filer's newest statement on record about the company. */
  latest: Statement;
  /** Statements on record by this filer about the company, the newest included. */
  statements: number;
}

/**
 * One filer's newest statement about each company, from that filer's statements; a company in
 * which the filer reports on several classes of shares has a row per class (rowsByClass, the
 * rule of the company's own page, so both sides list the same statements). Statements dated
 * after the build day are left out. Order: largest stated percent first, no percent last; ties
 * by shares, then the company's number, then accession.
 */
export function holdingsOf(xs: readonly Statement[], builtAt: string): Holding[] {
  const end = String(builtAt).slice(0, 10);
  const by = new Map<string, Statement[]>();
  for (const s of sortStatements(xs)) {
    if (!isDate(s.filedAt) || (isDate(end) && s.filedAt > end)) continue;
    const ys = by.get(s.issuerCik);
    if (ys) ys.push(s); else by.set(s.issuerCik, [s]);
  }
  const rows: Holding[] = [];
  for (const ys of by.values()) rows.push(...rowsByClass(ys));
  const pct = (h: Holding) => percentStated(h.latest.percent) ?? -1;
  return rows.sort((a, b) =>
    pct(b) - pct(a) || (sharesStated(b.latest.shares) ?? -1) - (sharesStated(a.latest.shares) ?? -1)
    || a.latest.issuerCik.localeCompare(b.latest.issuerCik) || b.latest.accession.localeCompare(a.latest.accession));
}

const multiCompanies = (hs: readonly Holding[]): number => {
  const n = new Map<string, number>();
  for (const h of hs) n.set(h.latest.issuerCik, (n.get(h.latest.issuerCik) ?? 0) + 1);
  return [...n.values()].filter((x) => x > 1).length;
};

/** The sentence above the table on the filer's page. Counts companies and rows; nothing is added up. */
export function holdingsSentence(name: string, hs: readonly Holding[]): string {
  if (!hs.length) return "";
  const below = hs.filter((h) => belowThreshold(h.latest)).length;
  const noPercent = hs.filter((h) => percentStated(h.latest.percent) == null).length;
  const atOrAbove = hs.length - below - noPercent;
  const parts: string[] = [];
  if (atOrAbove) parts.push(`${nf(atOrAbove)} ${atOrAbove === 1 ? "reports" : "report"} ${THRESHOLD_PERCENT}% or more of a class of shares`);
  if (below) parts.push(`${nf(below)} ${below === 1 ? "reports" : "report"} less than ${THRESHOLD_PERCENT}%`);
  if (noPercent) parts.push(`${nf(noPercent)} ${noPercent === 1 ? "states" : "state"} no percentage`);
  const companies = new Set(hs.map((h) => h.latest.issuerCik)).size;
  const head = `${name} is the filer of an ownership statement (Schedule 13D or 13G) about ${many(companies, "company", "companies")} this site tracks, filed with the SEC since ${RECORD_START_LABEL}`;
  if (hs.length > companies) return `${head}, about more than one class of shares in ${nf(multiCompanies(hs))} of them, so the table has ${many(hs.length, "row", "rows")}. Of the newest statement in each row, ${parts.join(", ")}.`;
  return `${head}. Of the newest statement about each, ${parts.join(", ")}.`;
}

/** What the filer's-side section says under the summary. One wording, so the verifier can require it. */
export const HOLDINGS_CAVEAT =
  "Each row is the newest statement on record under this filer's SEC number about that company, or about one class of its shares, and gives what the filer says it owned on the event date. It is not a report of a trade, and the holding may have changed since. " +
  `A row under ${THRESHOLD_PERCENT}% is a notice that the filer is no longer above that mark. A statement can name several reporting persons, who each report the group's combined holding, so the rows are not to be added together. ` +
  `This is not a full list of what the filer owns: only holdings above ${THRESHOLD_PERCENT}% of a class are reported this way, and only companies this site tracks are listed. None of these figures is in any buy or sell total, chart or trade map on this site.`;
