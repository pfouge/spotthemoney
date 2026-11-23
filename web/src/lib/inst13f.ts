// Institutional holdings from SEC Form 13F: the pure rules (lib/inst13f-build.ts reads the database).
// A 13F-HR lists the long positions an institutional manager held on the last day of a quarter.
// What is shown is what each manager reported, as filed. Nothing is turned into a share of the
// company, a score or a ranking of managers, and the sums can count the same shares twice.
import { caughtUp } from "./coverage-stored";

/** Managers listed in a company's table; the rest are counted. */
export const INST_TOP = 25;
/** A quarter counts as loaded when at least this many distinct managers report in it. */
export const INST_MIN_MANAGERS = 1000;
/** The section is shown only while the newest filing of the newest quarter is at most this old. */
export const INST_SHOWN_DAYS = 150;
/** Managers listed on the hub page. */
export const INST_HUB_MANAGERS = 200;

export interface InstManagerRow {
  cik: string;            // the manager's SEC number, 10 digits
  name: string;           // as filed, cleaned
  shares: number;         // summed over the manager's share rows in the quarter (all classes)
  value: number;          // summed reported value, US dollars as filed
  prevShares: number | null; // the same manager's summed shares in the prior quarter, null when none on file
  accession: string;      // the manager's newest filing for the quarter
  filed: string | null;
}

export interface InstCompany {
  cik: string;            // the issuer, 10 digits
  managers: number;       // distinct managers reporting shares in the newer quarter
  shares: number;         // summed shares
  value: number;          // summed reported value, US dollars as filed
  options: number;        // distinct managers with a Put or Call row in the newer quarter
  prevManagers: number | null; // distinct managers in the prior quarter, null when that quarter is not loaded
  top: InstManagerRow[];  // the INST_TOP largest by summed value
}

export interface InstManager { cik: string; name: string; issuers: number; value: number }

export interface InstData {
  shown: boolean;
  lastFiled: string | null;     // newest filing date in the newer quarter
  period: string | null;        // P1: the newer quarter end
  prior: string | null;         // P0: the quarter end before it, when loaded
  managersInPeriod: number;     // distinct managers in P1, all companies
  byCik: Map<string, InstCompany>;
  managers: InstManager[];      // the largest by reported value across the companies on the site
}

export const emptyInst = (): InstData => ({ shown: false, lastFiled: null, period: null, prior: null, managersInPeriod: 0, byCik: new Map(), managers: [] });

/** Calendar quarter ends are the last day of March, June, September and December. */
export function isQuarterEnd(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  const next = new Date(d.getTime() + 86400000);
  return [2, 5, 8, 11].includes(d.getUTCMonth()) && next.getUTCDate() === 1;
}

/** The quarter end before the one given. */
export function quarterBefore(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 2, 5, 8 or 11
  const pm = m - 3;
  const py = pm < 0 ? y - 1 : y;
  const pmm = (pm + 12) % 12;
  const last = new Date(Date.UTC(py, pmm + 1, 0));
  return last.toISOString().slice(0, 10);
}

export interface PeriodRow { period: string; managers: number; lastFiled: string | null }

/**
 * P1 is the newest calendar quarter end that is not after the build day and has at least
 * INST_MIN_MANAGERS distinct managers; P0 is the quarter end before it when it meets the same test.
 */
export function pickPeriods(rows: readonly PeriodRow[], builtAt: string): { p1: PeriodRow | null; p0: PeriodRow | null } {
  const today = String(builtAt).slice(0, 10);
  const ok = (r: PeriodRow) => isQuarterEnd(r.period) && r.period <= today && r.managers >= INST_MIN_MANAGERS;
  const p1 = rows.filter(ok).sort((a, b) => (a.period < b.period ? 1 : -1))[0] ?? null;
  if (!p1) return { p1: null, p0: null };
  const before = quarterBefore(p1.period);
  const p0 = rows.find((r) => r.period === before && ok(r)) ?? null;
  return { p1, p0 };
}

/** Shown only while the newer quarter's newest filing is within INST_SHOWN_DAYS of the build. */
export function instShown(period: string | null, lastFiled: string | null, builtAt: string): boolean {
  if (!period || !lastFiled || !/^\d{4}-\d{2}-\d{2}$/.test(lastFiled)) return false;
  const built = Date.parse(String(builtAt).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(built)) return false;
  const age = (built - Date.parse(lastFiled + "T00:00:00Z")) / 86400000;
  return age <= INST_SHOWN_DAYS;
}
// Keeps the shared 10-day test importable from here for callers that want the Form 144 rule.
export { caughtUp };

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-09-30" as "September 30, 2026". */
export function quarterDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH[(m ?? 1) - 1]} ${d}, ${y}`;
}
/** "2026-09-30" as "Q3 2026". */
export function quarterName(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `Q${Math.floor(((m ?? 1) - 1) / 3) + 1} ${y}`;
}

export const nf = (n: number): string => Math.round(n).toLocaleString("en-US");

/** A value in dollars as "$1.23B", "$456M", "$12,345"; as filed, never converted. */
export function valueLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "not stated";
  const a = Math.abs(n);
  const s = (x: number, u: string) => `$${(x >= 100 ? Math.round(x) : x >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100).toLocaleString("en-US")}${u}`;
  if (a >= 1e12) return s(n / 1e12, "T");
  if (a >= 1e9) return s(n / 1e9, "B");
  if (a >= 1e6) return s(n / 1e6, "M");
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Change in shares between the two quarters, only when both are on file. */
export function changeShares(m: Pick<InstManagerRow, "shares" | "prevShares">, hasPrior: boolean): number | null {
  if (!hasPrior || m.prevShares == null) return null;
  return m.shares - m.prevShares;
}
/** A signed number with a real minus sign and a plus for an increase; zero is "0". */
export function signed(n: number): string {
  if (n === 0) return "0";
  return (n > 0 ? "+" : "−") + nf(Math.abs(n));
}

/** The SEC filing folder of a manager's filing: manager's number without leading zeros, accession without dashes. */
export function filingFolderUrl(managerCik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${managerCik.replace(/^0+/, "") || "0"}/${accession.replaceAll("-", "")}/`;
}
/** The SEC's list of a manager's 13F filings. */
export const managerBrowseUrl = (managerCik: string): string =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${managerCik}&type=13F-HR`;

/** A manager's name as filed, cleaned for display: control characters out, white space collapsed. */
export function cleanName(s: string | null | undefined, max = 120): string {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

export const INST_CAVEAT =
  "A Form 13F is filed by an institutional investment manager that oversees at least $100 million in covered securities, up to 45 days after the quarter ends, and lists long positions on the last day of that quarter only, so it shows nothing about trades during the quarter or about short positions. Two managers can report the same shares, for example an adviser and the fund it runs, so the sums on this page can count shares twice and are not a share of the company.";

export interface InstSummary { managers: number; shares: number; value: number; options: number; prevManagers: number | null; listed: number }
export function instSummaryOf(c: InstCompany): InstSummary {
  return { managers: c.managers, shares: c.shares, value: c.value, options: c.options, prevManagers: c.prevManagers, listed: c.top.length };
}

/** One sentence: how many managers reported, the summed reported value, and the prior quarter's count when loaded. */
export function instSentence(name: string, period: string, prior: string | null, s: InstSummary): string {
  const plural = (n: number, w: string) => `${nf(n)} ${w}${n === 1 ? "" : "s"}`;
  let t = `${plural(s.managers, "institutional manager")} reported holding ${name} shares for ${quarterDate(period)}, with a summed reported value of ${valueLabel(s.value)}`;
  if (prior && s.prevManagers != null) t += `; ${nf(s.prevManagers)} reported for ${quarterDate(prior)}`;
  t += ".";
  if (s.options > 0) t += ` ${plural(s.options, "manager")} also report${s.options === 1 ? "s" : ""} put or call options, which are not counted in these figures.`;
  return t;
}

/** The text of the "Change" column cell, never "new": a manager with no earlier row is "not reported for <quarter>". */
export function priorCell(m: InstManagerRow, prior: string | null): string {
  if (!prior) return "not on file";
  if (m.prevShares == null) return `not reported for ${quarterDate(prior)}`;
  return nf(m.prevShares);
}

export function instLog(d: InstData, builtAt: string, companyCount: number): string {
  if (!d.shown) {
    return `institutional holders (Form 13F): not shown (newer quarter ${d.period ?? "none"}, newest filing ${d.lastFiled ?? "none"}, ${d.managersInPeriod} managers; rule: a quarter with ${INST_MIN_MANAGERS}+ managers filed within ${INST_SHOWN_DAYS} days of ${String(builtAt).slice(0, 10)})`;
  }
  let withPrior = 0, mgrSum = 0, optSum = 0, top = 0, most = 0;
  for (const c of d.byCik.values()) { if (c.prevManagers != null) withPrior++; mgrSum += c.managers; optSum += c.options; top += c.top.length; most = Math.max(most, c.managers); }
  return `institutional holders (Form 13F): shown; newer quarter ${d.period}, prior ${d.prior ?? "not loaded"}, ${d.managersInPeriod} managers, newest filing ${d.lastFiled}; ${d.byCik.size} of ${companyCount} companies on the site with a figure (${withPrior} with a prior quarter), ${top} listed manager rows, most managers for one company ${most}, manager-company pairs ${mgrSum}, with options ${optSum}; ${d.managers.length} managers in the hub table`;
}
