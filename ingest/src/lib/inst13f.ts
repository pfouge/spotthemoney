// Pure rules for the SEC Form 13F Data Sets loader (no I/O). Used by sources/sec_13f_holdings.ts.
//
// Documented tables (SEC readme, form_13f_readme.pdf, read 2026-11-22): SUBMISSION, COVERPAGE,
// INFOTABLE (plus OTHERMANAGER, SIGNATURE, SUMMARYPAGE, OTHERMANAGER2, not used here). Dates are
// DD-MON-YYYY. VALUE is thousands of dollars before 2023-01-03 and whole dollars from that date.
// The readme does NOT list the literal AMENDMENTTYPE values; the page only says the field covers
// restatements and additions of new holdings entries.

export const REQUIRED = {
  SUBMISSION: ["ACCESSION_NUMBER", "FILING_DATE", "SUBMISSIONTYPE", "CIK", "PERIODOFREPORT"],
  COVERPAGE: ["ACCESSION_NUMBER", "ISAMENDMENT", "AMENDMENTTYPE", "FILINGMANAGER_NAME"],
  INFOTABLE: ["ACCESSION_NUMBER", "NAMEOFISSUER", "TITLEOFCLASS", "CUSIP", "VALUE", "SSHPRNAMT", "SSHPRNAMTTYPE"],
} as const;

export const OPTIONAL = {
  SUBMISSION: [],
  COVERPAGE: ["AMENDMENTNO", "REPORTTYPE", "REPORTCALENDARORQUARTER"],
  INFOTABLE: ["PUTCALL", "INFOTABLE_SK", "INVESTMENTDISCRETION"],
} as const;

export type TableName = keyof typeof REQUIRED;

/** The first date from which VALUE is whole dollars (before it: thousands). */
export const DOLLARS_FROM = "2023-01-03";

/** VALUE as filed -> US dollars. `filed` is the filing date (ISO). */
export function valueToDollars(value: number, filed: string): number {
  return filed < DOLLARS_FROM ? value * 1000 : value;
}

export function normPutCall(s: string | null | undefined): string {
  const v = (s ?? "").trim().toUpperCase();
  return v === "PUT" || v === "CALL" ? v : "";
}

export function normCusip(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

// ── CUSIP map ────────────────────────────────────────────────────────────────

export interface CusipMap {
  /** 9-character CUSIP -> issuer CIK (unique claims only). */
  full: Map<string, string>;
  /** First 8 characters -> issuer CIK (unique claims only), the fallback. */
  prefix: Map<string, string>;
  ambiguous: number;
}

export function buildCusipMap(rows: { cusip: string | null; cik: string | null }[]): CusipMap {
  const claims = new Map<string, Set<string>>();
  for (const r of rows) {
    const c = normCusip(r.cusip);
    if (c.length !== 9 || !/^[0-9A-Z]{9}$/.test(c) || !r.cik) continue;
    if (!claims.has(c)) claims.set(c, new Set());
    claims.get(c)!.add(r.cik);
  }
  const full = new Map<string, string>();
  let ambiguous = 0;
  for (const [c, ciks] of claims) {
    if (ciks.size === 1) full.set(c, [...ciks][0]!);
    else ambiguous++;
  }
  const p8 = new Map<string, Set<string>>();
  for (const [c, ciks] of claims) {
    const p = c.slice(0, 8);
    if (!p8.has(p)) p8.set(p, new Set());
    for (const k of ciks) p8.get(p)!.add(k);
  }
  const prefix = new Map<string, string>();
  for (const [p, ciks] of p8) if (ciks.size === 1) prefix.set(p, [...ciks][0]!);
  return { full, prefix, ambiguous };
}

export function lookupCusip(m: CusipMap, cusip: string): { cik: string; fallback: boolean } | null {
  const c = normCusip(cusip);
  const hit = m.full.get(c);
  if (hit) return { cik: hit, fallback: false };
  if (c.length >= 8) {
    // A 9-character CUSIP that is itself claimed by two issuers stays dropped.
    const p = m.prefix.get(c.slice(0, 8));
    if (p && !(c.length === 9 && m.full.has(c))) return { cik: p, fallback: true };
  }
  return null;
}

// ── Amendments and the winning filing ────────────────────────────────────────

export interface Sub {
  accession: string;
  filed: string; // ISO date
  type: string; // 13F-HR or 13F-HR/A
  managerCik: string;
  period: string; // ISO date
  isAmendment: boolean;
  amendType: string;
  managerName: string;
}

export type AmendKind = "base" | "add";

/** "NEW HOLDINGS" adds to the earlier filing; anything else (original, RESTATEMENT, unknown) replaces. */
export function amendKind(s: Pick<Sub, "isAmendment" | "amendType">): { kind: AmendKind; unknown: boolean } {
  if (!s.isAmendment) return { kind: "base", unknown: false };
  const t = s.amendType.toUpperCase();
  if (/NEW\s*HOLDING/.test(t)) return { kind: "add", unknown: false };
  return { kind: "base", unknown: !/RESTATE/.test(t) };
}

export interface Plan {
  key: string; // manager|period
  managerCik: string;
  period: string;
  managerName: string;
  base: Sub | null;
  adds: Sub[];
}

export function planFilings(subs: Sub[]): { plans: Plan[]; restated: number; added: number; unknownAmend: number } {
  const groups = new Map<string, Sub[]>();
  for (const s of subs) {
    if (s.type !== "13F-HR" && s.type !== "13F-HR/A") continue;
    const k = `${s.managerCik}|${s.period}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const plans: Plan[] = [];
  let restated = 0, added = 0, unknownAmend = 0;
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.filed === b.filed ? a.accession.localeCompare(b.accession) : a.filed.localeCompare(b.filed)));
    let baseIdx = -1;
    list.forEach((s, i) => { if (amendKind(s).kind === "base") baseIdx = i; });
    const base = baseIdx >= 0 ? list[baseIdx]! : null;
    const adds = list.filter((s, i) => amendKind(s).kind === "add" && i > baseIdx);
    if (base?.isAmendment) { restated++; if (amendKind(base).unknown) unknownAmend++; }
    added += adds.length;
    const last = list[list.length - 1]!;
    plans.push({ key, managerCik: last.managerCik, period: last.period, managerName: last.managerName, base, adds });
  }
  return { plans, restated, added, unknownAmend };
}

export interface Existing { filed: string; accession: string }

export type Decision = "replace" | "add" | "skip_older" | "skip_no_base" | "skip_loaded";

/** What to do with one planned manager-period given what the table already holds. */
export function decide(plan: Plan, existing: Existing | undefined, storedAccessions: Set<string>): { decision: Decision; adds: Sub[] } {
  if (plan.base) {
    const all = [plan.base, ...plan.adds];
    const newest = all.reduce((a, b) => (b.filed > a.filed || (b.filed === a.filed && b.accession > a.accession) ? b : a));
    if (!existing) return { decision: "replace", adds: plan.adds };
    const newer = newest.filed > existing.filed || (newest.filed === existing.filed && newest.accession >= existing.accession);
    return newer ? { decision: "replace", adds: plan.adds } : { decision: "skip_older", adds: [] };
  }
  if (!existing) return { decision: "skip_no_base", adds: [] };
  const fresh = plan.adds.filter((a) =>
    !storedAccessions.has(a.accession) &&
    (a.filed > existing.filed || (a.filed === existing.filed && a.accession > existing.accession)));
  return fresh.length ? { decision: "add", adds: fresh } : { decision: "skip_loaded", adds: [] };
}

/** Keep the newest `n` distinct periods (ISO strings). Returns the cut-off: periods below it are dropped. */
export function keepCutoff(periods: string[], n: number): string | null {
  const distinct = [...new Set(periods)].sort().reverse();
  return distinct.length > n ? distinct[n - 1]! : null;
}
