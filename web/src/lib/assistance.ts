// Federal assistance awards from USAspending: grants, direct payments and loans (migration 0037).
// Pure functions, no database: /grants/, the company section, the CSV, the build log and
// scripts/assistance.test.ts use them.
//
// Rules:
//  - The three kinds are NEVER added together. A grant's amount is the award value; a loan's
//    amount is the face value of the loan or guarantee (money lent or guaranteed, not granted),
//    and its subsidy cost is the government's own estimate of what the loan costs, which can be
//    negative. Every sentence and table keeps the kinds apart.
//  - A recipient USAspending masks (individuals) is shown as returned, counted, and never linked
//    or matched to a company.
//  - Everything is shown as reported. Nothing is derived from a description or a program title.
import { normalizeOrgName } from "@stm/shared";

export type AssistanceKind = "grant" | "direct_payment" | "loan" | "other";
export interface AssistanceRow {
  id: number; sourceRef: string; awardId: string | null; kind: AssistanceKind; awardType: string | null;
  recipient: string; recipientUei: string | null; agency: string | null; subAgency: string | null;
  amount: number | null; subsidyCost: number | null; startDate: string | null; endDate: string | null;
  description: string | null; listing: string | null;
}
export interface AssistanceData {
  /** Awards that started in the last 180 days, largest first. */
  rows: AssistanceRow[];
  /** Company id to the awards whose recipient name matches that company exactly, newest first. */
  byCompany: Map<number, AssistanceRow[]>;
}
export const emptyAssistance = (): AssistanceData => ({ rows: [], byCompany: new Map() });

/** Same window as /contracts/: awards that started in the last 180 days, never after the build day. */
export const ASSISTANCE_WINDOW_DAYS = 180;
export const GRANT_ROWS = 25;
export const LOAN_ROWS = 25;
export const PAYMENT_ROWS = 15;
export const GROUP_ROWS = 25;
export const COMPANY_ROWS = 25;
export const DESCRIPTION_SHOWN = 140;

export const ASSISTANCE_CAVEAT =
  "This is not every federal award. It holds the largest grants, loans and direct payments that started in each 30-day period, plus awards to companies followed here whose recipient name matches exactly. A loan's amount is the face value of the loan or guarantee, not money granted, and its subsidy cost is the government's own estimate of what the loan costs. Amounts are obligations reported by the agencies and can be revised.";

export const KINDS: AssistanceKind[] = ["grant", "loan", "direct_payment", "other"];
const KIND_SINGLE: Record<AssistanceKind, string> = { grant: "grant", loan: "loan or guarantee", direct_payment: "direct payment", other: "other award" };
const KIND_PLURAL: Record<AssistanceKind, string> = { grant: "grants", loan: "loans and guarantees", direct_payment: "direct payments", other: "other awards" };
export const kindName = (k: AssistanceKind, n = 2) => (n === 1 ? KIND_SINGLE[k] : KIND_PLURAL[k]);
/** What an amount is called for each kind. */
export const AMOUNT_NAME: Record<AssistanceKind, string> = { grant: "award value", loan: "face value", direct_payment: "award value", other: "award value" };

const MASK = /MULTIPLE RECIPIENTS|REDACTED/i;
/** True when USAspending masks the recipient (individuals). */
export function isMasked(recipient: string | null | undefined): boolean { return !recipient || MASK.test(recipient); }

/** White space collapsed, control and direction characters out; null when nothing is left. */
export function cleanText(s: string | null | undefined, max = 1000): string | null {
  if (typeof s !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}
export function shortDescription(s: string | null | undefined, max = DESCRIPTION_SHOWN): string | null {
  const t = cleanText(s);
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at >= max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:.\-]+$/, "")}…`;
}

/** "93.778 GRANTS TO STATES FOR MEDICAID" to { number: "93.778", title: "GRANTS TO STATES FOR MEDICAID" }, as returned. */
export function splitListing(listing: string | null | undefined): { number: string | null; title: string | null } {
  const t = cleanText(listing, 200);
  if (!t) return { number: null, title: null };
  const at = t.indexOf(" ");
  if (at < 0) return /^\d/.test(t) ? { number: t, title: null } : { number: null, title: t };
  const head = t.slice(0, at);
  return /^\d[\d.]*$/.test(head) ? { number: head, title: t.slice(at + 1).trim() || null } : { number: null, title: t };
}
export const programLabel = (listing: string | null | undefined): string | null => {
  const { number, title } = splitListing(listing);
  return number && title ? `${number} ${title}` : (title ?? number);
};

const key = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const kindOf = (r: AssistanceRow) => r.kind;

export interface KindTotal { awards: number; value: number }
export type KindTotals = Record<AssistanceKind, KindTotal>;
export function kindTotals(rows: AssistanceRow[]): KindTotals {
  const t: KindTotals = { grant: { awards: 0, value: 0 }, loan: { awards: 0, value: 0 }, direct_payment: { awards: 0, value: 0 }, other: { awards: 0, value: 0 } };
  for (const r of rows) { const e = t[kindOf(r)]; e.awards++; e.value += r.amount ?? 0; }
  return t;
}
export const maskedCount = (rows: AssistanceRow[]) => rows.filter((r) => isMasked(r.recipient)).length;

/** Largest awards of one kind: amount, then newest start, then id. */
export function largest(rows: AssistanceRow[], kind: AssistanceKind, n: number): AssistanceRow[] {
  return rows.filter((r) => r.kind === kind)
    .sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity) || (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.id - b.id).slice(0, n);
}

export interface GroupRow { label: string; number?: string | null; kinds: KindTotals }
function group(rows: AssistanceRow[], keyOf: (r: AssistanceRow) => { k: string; label: string; number?: string | null } | null): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const r of rows) {
    const g = keyOf(r); if (!g) continue;
    let e = m.get(g.k);
    if (!e) { e = { label: g.label, number: g.number, kinds: kindTotals([]) }; m.set(g.k, e); }
    const t = e.kinds[r.kind]; t.awards++; t.value += r.amount ?? 0;
  }
  return [...m.values()];
}
const byGrant = (a: GroupRow, b: GroupRow) => b.kinds.grant.value - a.kinds.grant.value || b.kinds.grant.awards - a.kinds.grant.awards
  || (b.kinds.loan.value + b.kinds.direct_payment.value) - (a.kinds.loan.value + a.kinds.direct_payment.value) || a.label.localeCompare(b.label);
/** Per agency, with each kind's awards and value in its own columns; grant value first. */
export const agencyRows = (rows: AssistanceRow[]): GroupRow[] =>
  group(rows, (r) => { const a = cleanText(r.agency, 200); return a ? { k: key(a), label: a } : null; }).sort(byGrant);
/** Per assistance listing (program), the same way. */
export const programRows = (rows: AssistanceRow[]): GroupRow[] =>
  group(rows, (r) => { const p = splitListing(r.listing); const label = p.title ?? p.number; return label ? { k: p.number ?? key(label), label, number: p.number } : null; }).sort(byGrant);

/** "N grants with an award value of X; M loans and guarantees with a face value of Y". Kinds are never added together. */
export function kindSentence(rows: AssistanceRow[], fmt: (n: number) => string): string {
  const t = kindTotals(rows);
  const parts: string[] = [];
  for (const k of KINDS) {
    const e = t[k]; if (!e.awards) continue;
    parts.push(`${e.awards.toLocaleString("en-US")} ${kindName(k, e.awards)} with ${k === "loan" ? "a face value" : "an award value"} of ${fmt(e.value)}`);
  }
  return parts.join("; ");
}
export function maskedSentence(n: number): string {
  return n === 0 ? "" : `${n.toLocaleString("en-US")} ${n === 1 ? "award names" : "awards name"} no single recipient: USAspending masks individuals.`;
}

/** Awards to companies by exact normalised name; a name two companies share matches neither; masked recipients match nothing. */
export function matchCompanies(rows: AssistanceRow[], companies: { id: number; name: string; slug: string | null }[]): Map<number, AssistanceRow[]> {
  const map = new Map<string, number>(); const twice = new Set<string>();
  for (const c of companies) {
    const k = normalizeOrgName(c.name); if (!k || !c.slug) continue;
    if (map.has(k)) twice.add(k); else map.set(k, c.id);
  }
  for (const k of twice) map.delete(k);
  const out = new Map<number, AssistanceRow[]>();
  for (const r of rows) {
    if (isMasked(r.recipient)) continue;
    const id = map.get(normalizeOrgName(r.recipient)); if (id == null) continue;
    const xs = out.get(id); if (xs) xs.push(r); else out.set(id, [r]);
  }
  for (const [id, xs] of out) out.set(id, xs.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.id - b.id));
  return out;
}

/** One line for the build log, to compare with SQL on production. */
export function assistanceLog(d: AssistanceData): string {
  const t = kindTotals(d.rows);
  const dates = d.rows.map((r) => r.startDate).filter(Boolean).sort() as string[];
  const matched = [...d.byCompany.values()].reduce((a, x) => a + x.length, 0);
  return `[web] federal assistance: ${d.rows.length} awards that started in the last ${ASSISTANCE_WINDOW_DAYS} days; grants ${t.grant.awards}/${Math.round(t.grant.value)}, loans ${t.loan.awards}/${Math.round(t.loan.value)}, direct payments ${t.direct_payment.awards}/${Math.round(t.direct_payment.value)}, other ${t.other.awards}; ${maskedCount(d.rows)} masked recipients; ${agencyRows(d.rows).length} agencies, ${programRows(d.rows).length} programs; ${matched} awards matched to ${d.byCompany.size} companies; started ${dates[0] ?? "-"} to ${dates.at(-1) ?? "-"}`;
}
