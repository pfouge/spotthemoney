// Campaign committees on member pages. Pure rules; the database read is in campaign-build.ts.
//
// A member's principal campaign committee is linked by ids only: the FEC candidate id on the
// committee is mapped to a Bioguide id through the congress-legislators roster (ingest job
// fec_committees, migration 0040). No name is ever matched.
//
// What the numbers are: itemized receipts this site has loaded from FEC filings. For a large
// committee that is a sample of what it received, so nothing here is a total, and the FEC's own
// page holds the totals. No donor names are kept. A receipt is not tied to any trade or vote.
import { normalizeOrgName } from "@stm/shared";

export const EMPLOYER_ROWS = 10;
export const STATE_ROWS = 10;
export const MAX_COMMITTEES_PER_MEMBER = 3;
export const RECENT_DAYS = 90;

export const CAMPAIGN_CAVEAT =
  "These are itemized receipts that this site has loaded from the committee's FEC filings. For a large committee that is a sample, not everything it received, so the sums here are not totals; the FEC page linked above has the committee's reported totals. Employer and state are as the donor stated them. Nothing here ties a receipt to a trade, a vote or any other action by the member.";

/** Employer values that say nothing about an employer. Compared after upper-casing and trimming punctuation. */
const UNINFORMATIVE = new Set([
  "", "N/A", "NA", "NONE", "NONE.", "NOT EMPLOYED", "UNEMPLOYED", "RETIRED", "SELF", "SELF EMPLOYED", "SELF-EMPLOYED", "SELFEMPLOYED", "SELF EMPLOYED.",
  "HOMEMAKER", "NOT APPLICABLE", "REFUSED", "INFORMATION REQUESTED", "INFO REQUESTED", "REQUESTED", "STUDENT", "NONE GIVEN", "UNKNOWN", "N.A.", "N A",
]);
export function usableEmployer(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const k = s.toUpperCase().replace(/[.,]+$/g, "");
  if (UNINFORMATIVE.has(k) || UNINFORMATIVE.has(k.replace(/-/g, " "))) return null;
  return s;
}

export interface TopRow { key: string; sum: number; count: number }
export interface CampaignCommittee {
  id: number; fecId: string; name: string; slug: string; memberName: string; personId: number;
  held: number; sum: number; held90: number; sum90: number; first: string | null; newest: string | null;
  note: string | null;
  employers: TopRow[]; states: TopRow[];
  /** Receipts whose employer was blank or uninformative, left out of the employer table. */
  employerOmitted: number;
}
export interface CampaignData {
  /** Every committee linked to a member, with or without receipts. */
  committees: CampaignCommittee[];
  byPerson: Map<number, CampaignCommittee[]>;
  bySlug: Map<string, CampaignCommittee[]>;
  /** normalised committee name to member slug; a name two members share maps to nobody. */
  payeeMap: Map<string, string>;
  shown: boolean;
}
export const emptyCampaign = (): CampaignData => ({ committees: [], byPerson: new Map(), bySlug: new Map(), payeeMap: new Map(), shown: false });

/** Fold raw (employer, sum, count) rows into the top rows, leaving uninformative employers out. Same spelling after trimming and capitals is one employer. */
export function topEmployers(rows: { key: string | null; sum: number; count: number }[], n = EMPLOYER_ROWS): { rows: TopRow[]; omitted: number } {
  const m = new Map<string, TopRow & { names: Map<string, number> }>();
  let omitted = 0;
  for (const r of rows) {
    const e = usableEmployer(r.key);
    if (!e) { omitted += r.count; continue; }
    const k = e.toUpperCase();
    const x = m.get(k) ?? { key: e, sum: 0, count: 0, names: new Map() }; m.set(k, x);
    x.sum += r.sum; x.count += r.count; x.names.set(e, (x.names.get(e) ?? 0) + r.count);
    x.key = [...x.names.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  }
  const out = [...m.values()].map(({ key, sum, count }) => ({ key, sum, count }))
    .sort((a, b) => b.sum - a.sum || b.count - a.count || (a.key < b.key ? -1 : 1)).slice(0, n);
  return { rows: out, omitted };
}
export function topStates(rows: { key: string | null; sum: number; count: number }[], n = STATE_ROWS): TopRow[] {
  const m = new Map<string, TopRow>();
  for (const r of rows) {
    const k = (r.key ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(k)) continue;
    const x = m.get(k) ?? { key: k, sum: 0, count: 0 }; m.set(k, x);
    x.sum += r.sum; x.count += r.count;
  }
  return [...m.values()].sort((a, b) => b.sum - a.sum || b.count - a.count || (a.key < b.key ? -1 : 1)).slice(0, n);
}

/** Committee name (normalised) to member slug. A name that two different members' committees share maps to nobody. */
export function payeeMap(cs: { name: string; slug: string }[]): Map<string, string> {
  const m = new Map<string, string>(); const twice = new Set<string>();
  for (const c of cs) {
    const k = normalizeOrgName(c.name); if (!k) continue;
    const have = m.get(k);
    if (have === undefined) m.set(k, c.slug); else if (have !== c.slug) twice.add(k);
  }
  for (const k of twice) m.delete(k);
  return m;
}

export function indexCampaign(committees: CampaignCommittee[]): CampaignData {
  const byPerson = new Map<number, CampaignCommittee[]>(); const bySlug = new Map<string, CampaignCommittee[]>();
  for (const c of committees) {
    const a = byPerson.get(c.personId) ?? []; a.push(c); byPerson.set(c.personId, a);
    const b = bySlug.get(c.slug) ?? []; b.push(c); bySlug.set(c.slug, b);
  }
  for (const l of byPerson.values()) l.sort((a, b) => b.held - a.held || (a.fecId < b.fecId ? -1 : 1));
  return { committees, byPerson, bySlug, payeeMap: payeeMap(committees), shown: committees.length > 0 };
}

/** The committees a member page shows: those with receipts, at most MAX_COMMITTEES_PER_MEMBER, the largest first. */
export function shownFor(d: CampaignData, slug: string | null | undefined): CampaignCommittee[] {
  if (!slug) return [];
  return (d.bySlug.get(slug) ?? []).filter((c) => c.held > 0).sort((a, b) => b.held - a.held || (a.fecId < b.fecId ? -1 : 1)).slice(0, MAX_COMMITTEES_PER_MEMBER);
}

export const fecCommitteeUrl = (fecId: string) => `https://www.fec.gov/data/committee/${encodeURIComponent(fecId)}/`;

export function campaignLog(d: CampaignData): string {
  const members = new Set(d.committees.map((c) => c.personId));
  const sections = new Set<string>();
  for (const s of d.bySlug.keys()) if (shownFor(d, s).length) sections.add(s);
  const r = d.committees.reduce((a, c) => a + c.held, 0), w = d.committees.reduce((a, c) => a + c.held90, 0);
  return `campaign committees: ${d.committees.length} linked to ${members.size} members; ${r} receipts on file, ${w} in the last ${RECENT_DAYS} days; ${sections.size} members with a section`;
}
