// SEC Form 144 notices on stock and company pages (stage 2 of queue item "Form 144").
//
// A Form 144 is the notice a holder files when they PROPOSE to sell restricted or control
// securities under Rule 144. It is a notice of a planned sale, not a report of a sale: the sale
// may happen later, in part, or not at all. Rules that follow from that:
//   - A notice is never added to any buy or sell total, trade map, feed of trades or cluster.
//   - Its figures are shown as filed: shares, the aggregate market value the filer states, the
//     approximate sale date, the relationship in the filer's own words.
//   - An amendment (144/A) is its own row. The form does not say which notice it replaces, so
//     nothing links them and no figure is added up across notices (an amendment would be
//     counted twice). The summary counts notices and sellers only.
//   - Nothing is derived from a notice: no flag, score or label.
//   - The section is shown only once the load has reached today (caughtUp in
//     lib/coverage-stored.ts); until then no page, file or sentence claims to show notices.
//
// Pure: lib/flagship.ts runs the query and passes rows in. Tests: scripts/form144.test.ts.

export interface Notice {
  accession: string;
  formType: string;                 // "144" or "144/A"
  filedAt: string;                  // YYYY-MM-DD
  issuerCik: string;                // 10 digits
  filerCik: string | null;          // the submission's filer, 10 digits
  sellerName: string | null;
  relationships: string[];
  securityClass: string | null;
  shares: number | null;
  marketValue: number | null;
  sharesOutstanding: number | null;
  approxSaleDate: string | null;
  broker: string | null;
  planAdoptionDate: string | null;
  noticeDate: string | null;
  sold3mShares: number | null;
  sold3mProceeds: number | null;
  nothingSold3m: boolean | null;
  sourceUrl: string | null;
}

export interface Form144Data {
  /** True once the load has caught up with today; only then are notices loaded and shown. */
  shown: boolean;
  /** Newest filing date in the whole table (every issuer), or null. */
  lastFiled: string | null;
  /** 10-digit issuer CIK → that company's notices, newest filed first. Empty unless shown. */
  byCik: Map<string, Notice[]>;
}
export const emptyForm144 = (): Form144Data => ({ shown: false, lastFiled: null, byCik: new Map() });

/** Notices printed in a page's table; the rest are counted and are in the CSV file. */
export const NOTICE_ROWS = 25;
/** Days back from the build day that a page's table and summary cover, by filing date. */
export const NOTICE_WINDOW_DAYS = 365;

const DAY = 86_400_000;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const t0 = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");

/** White space collapsed, control characters out, cut at max; null when nothing is left. */
export function cleanText(s: unknown, max = 120): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

/** A stated figure that can be shown: a finite number above zero. Zero or less is a blank on the form. */
export const stated = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);

/** The relationships as filed, in the form's order, repeats dropped whatever their capitals. Null when none. */
export function relationshipLabel(rels: readonly string[] | null | undefined): string | null {
  const seen = new Set<string>(), out: string[] = [];
  for (const r of rels ?? []) {
    const c = cleanText(r, 80);
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase()); out.push(c);
  }
  return out.length ? out.join(", ") : null;
}

export const isAmendment = (n: Notice) => n.formType === "144/A";

/** A stated market value above this many dollars a share is not shown on a page. No listed
 *  share has traded above it, so a figure like that is a mistake on the form (on production,
 *  2026-11-20: $25.24 billion stated for 4,000 shares, $11.7 billion for 860). */
export const VALUE_MAX_PER_SHARE = 1_000_000;

/** True when the stated market value cannot be right for the number of shares: more than
 *  VALUE_MAX_PER_SHARE dollars a share. Only that one test, on purpose: a comparison with the
 *  company's other notices would flag stock splits, warrants and preferred shares, and the
 *  form's "shares outstanding" box is itself mistyped too often to lean on. A value that is
 *  too LOW is left as filed. The CSV file keeps the figure as filed and marks the row. */
export function valueOutOfRange(n: Pick<Notice, "shares" | "marketValue">): boolean {
  const v = stated(n.marketValue), sh = stated(n.shares);
  return v != null && sh != null && v / sh > VALUE_MAX_PER_SHARE;
}

/** The stated market value a page prints: null for a blank and for a figure out of range. */
export const shownValue = (n: Pick<Notice, "shares" | "marketValue">): number | null => (valueOutOfRange(n) ? null : stated(n.marketValue));

/** The sentence under a table that holds back one or more stated values. */
export function heldNote(count: number): string {
  if (count <= 0) return "";
  return `${count === 1 ? "One stated market value in this table is" : `${count.toLocaleString("en-US")} stated market values in this table are`} not shown: ` +
    `the figure on the form works out to more than $${VALUE_MAX_PER_SHARE.toLocaleString("en-US")} a share, which cannot be right for the number of shares. ` +
    "The figure as filed is in the CSV file, marked, and on the notice at the SEC.";
}

/** Newest filed first; ties by accession, newest first, so the order is the same in every build. */
export function sortNotices(xs: readonly Notice[]): Notice[] {
  return [...xs].sort((a, b) => b.filedAt.localeCompare(a.filedAt) || b.accession.localeCompare(a.accession));
}

/** A company's notices filed in the window ending on the build day (never after it), newest first. */
export function noticesInWindow(xs: readonly Notice[], builtAt: string, days = NOTICE_WINDOW_DAYS): Notice[] {
  const end = t0(builtAt);
  if (Number.isNaN(end)) return [];
  const start = end - days * DAY;
  return sortNotices(xs.filter((n) => isDate(n.filedAt) && t0(n.filedAt) <= end && t0(n.filedAt) >= start));
}

/** One seller is one filer number, or, with no number, one name whatever its capitals. */
export const sellerKey = (n: Notice): string => (n.filerCik ? `c:${n.filerCik}` : `n:${(cleanText(n.sellerName, 200) ?? "").toLowerCase()}`);

export interface NoticeSummary { notices: number; amendments: number; sellers: number; withPlan: number; newest: string | null; oldest: string | null }

/** Counts over the notices given (the window's). No shares or dollars are added up: an amendment repeats its notice. */
export function noticeSummary(xs: readonly Notice[]): NoticeSummary {
  const sellers = new Set(xs.map(sellerKey));
  const dates = xs.map((n) => n.filedAt).sort();
  return {
    notices: xs.length, amendments: xs.filter(isAmendment).length, sellers: sellers.size,
    withPlan: xs.filter((n) => isDate(n.planAdoptionDate)).length,
    newest: dates[dates.length - 1] ?? null, oldest: dates[0] ?? null,
  };
}

const nf = (x: number) => x.toLocaleString("en-US");
const many = (x: number, one: string, more: string) => `${nf(x)} ${x === 1 ? one : more}`;

/** The sentence above a page's table. `name` is the company as the page names it. */
export function summarySentence(name: string, s: NoticeSummary): string {
  if (!s.notices) return "";
  const plan = s.withPlan ? ` ${many(s.withPlan, "notice states", "notices state")} the date a Rule 10b5-1 trading plan was adopted.` : "";
  const amend = s.amendments ? `, ${many(s.amendments, "of them an amendment", "of them amendments")}` : "";
  return `${many(s.notices, "Form 144 notice", "Form 144 notices")} about ${name} ${s.notices === 1 ? "was" : "were"} filed with the SEC in the last 12 months by ${many(s.sellers, "seller", "sellers")}${amend}.${plan}`;
}

/** What every section says under the summary. One wording, so the verifier can require it. */
export const NOTICE_CAVEAT =
  "A Form 144 is a notice that a holder plans to sell restricted or control shares. It is not a report of a sale: the sale may happen later, in part or not at all. " +
  "The figures are the filer's own, as filed, and none of them is in any buy or sell total, chart or trade map on this site. " +
  "An amended notice (144/A) is listed as its own row and repeats the notice it corrects, so the rows are not to be added together.";

/** One build-log line to compare with SQL. */
export function form144Log(d: Form144Data, builtAt: string, companyCiks: ReadonlySet<string>): string {
  if (!d.shown) return `planned sales (Form 144): not shown (newest filing on file ${d.lastFiled ?? "none"}; the load has not reached the build day ${builtAt.slice(0, 10)})`;
  let rows = 0, amend = 0, inWindow = 0, issuers = 0, issuersInWindow = 0, capped = 0, maxValue = 0, held = 0, newest = "";
  for (const [cik, xs] of d.byCik) {
    if (!companyCiks.has(cik)) continue;
    rows += xs.length; issuers++;
    amend += xs.filter(isAmendment).length;
    const w = noticesInWindow(xs, builtAt);
    inWindow += w.length;
    if (w.length) issuersInWindow++;
    if (w.length > NOTICE_ROWS) capped++;
    for (const n of xs) {
      if (valueOutOfRange(n)) held++;
      else if ((n.marketValue ?? 0) > maxValue) maxValue = n.marketValue ?? 0;
      if (n.filedAt > newest) newest = n.filedAt;
    }
  }
  return `planned sales (Form 144): shown; ${rows} notices for ${issuers} companies on the site (${amend} amendments), newest ${newest || "none"}; ${inWindow} filed in the last ${NOTICE_WINDOW_DAYS} days for ${issuersInWindow} companies; ${capped} companies with more than ${NOTICE_ROWS}; largest stated value ${Math.round(maxValue)}; ${held} stated values not shown (over ${VALUE_MAX_PER_SHARE} dollars a share)`;
}

/** A second build-log line: the filer's side (insider pages). `people` = 10-digit CIK of each person with a page; `issuers` = companies with a page. */
export function filerLog(d: Form144Data, builtAt: string, people: ReadonlySet<string>, issuers: ReadonlySet<string>): string {
  if (!d.shown) return "planned sales by filer: not shown";
  const by = new Map<string, number>();
  let rows = 0;
  for (const [cik, xs] of d.byCik) {
    if (!issuers.has(cik)) continue;
    for (const n of noticesInWindow(xs, builtAt)) { if (!n.filerCik || !people.has(n.filerCik)) continue; rows++; by.set(n.filerCik, (by.get(n.filerCik) ?? 0) + 1); }
  }
  let most = 0, capped = 0;
  for (const v of by.values()) { if (v > most) most = v; if (v > NOTICE_ROWS) capped++; }
  return `planned sales by filer: ${rows} notices in the last ${NOTICE_WINDOW_DAYS} days on ${by.size} insider pages; most on one page ${most}; ${capped} pages with more than ${NOTICE_ROWS}`;
}

// ── the filer's side: notices one person filed (insider pages) ──────────────────────────────
export interface FilerSummary { notices: number; amendments: number; companies: number; withPlan: number }

/** Counts over the notices one filer filed (the window's). Nothing is added up across notices. */
export function filerSummary(xs: readonly Notice[]): FilerSummary {
  return {
    notices: xs.length, amendments: xs.filter(isAmendment).length,
    companies: new Set(xs.map((n) => n.issuerCik)).size, withPlan: xs.filter((n) => isDate(n.planAdoptionDate)).length,
  };
}

/** The sentence above the table on a filer's page. `name` is the person as the page names them. */
export function filerSentence(name: string, s: FilerSummary): string {
  if (!s.notices) return "";
  const plan = s.withPlan ? ` ${many(s.withPlan, "notice states", "notices state")} the date a Rule 10b5-1 trading plan was adopted.` : "";
  const amend = s.amendments ? `, ${many(s.amendments, "of them an amendment", "of them amendments")}` : "";
  return `${name} is the filer of ${many(s.notices, "Form 144 notice", "Form 144 notices")} submitted to the SEC in the last 12 months about ${many(s.companies, "company", "companies")} this site tracks${amend}.${plan}`;
}

/** Said under the summary on a filer's page, after NOTICE_CAVEAT. */
export const FILER_NOTE = "The person named as seller on a notice can be a trust or a family entity; the notices listed are those submitted under this filer's SEC number.";
