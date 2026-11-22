// Pure helpers for the FEC Schedule E (independent expenditures) source. No network, no database.
// Field names are those of the OpenFEC swagger definition ScheduleE, read 2026-11-22.

export const DESCRIPTION_MAX = 300;
export const NAME_MAX = 200;

/** One row as OpenFEC returns it (only the fields this source reads). */
export interface RawIe {
  sub_id?: unknown;
  committee_id?: unknown;
  committee?: { name?: unknown; committee_id?: unknown } | null;
  candidate_id?: unknown;
  candidate_name?: unknown;
  candidate_office?: unknown;
  candidate_office_state?: unknown;
  candidate_office_district?: unknown;
  candidate_party?: unknown;
  support_oppose_indicator?: unknown;
  expenditure_amount?: unknown;
  expenditure_date?: unknown;
  dissemination_date?: unknown;
  expenditure_description?: unknown;
  payee_name?: unknown;
  is_notice?: unknown;
  pdf_url?: unknown;
}

export interface IeRow {
  sub_id: string;
  committee_fec_id: string;
  committee_name: string | null;
  candidate_fec_id: string | null;
  candidate_name: string | null;
  candidate_office: string | null;
  candidate_state: string | null;
  candidate_district: string | null;
  candidate_party: string | null;
  support_oppose: "S" | "O" | null;
  amount: number;
  spent_at: string | null;
  disseminated_at: string | null;
  description: string | null;
  payee_name: string | null;
  is_notice: boolean | null;
  source_url: string | null;
}

export interface ParseNotes {
  futureDate: number;
  badDate: number;
}

/** Collapse white space, drop control and direction characters, cut at `max`; empty becomes null. */
export function cleanText(v: unknown, max = NAME_MAX): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** A real calendar date as YYYY-MM-DD (the first ten characters of a timestamp are accepted), else null. */
export function dateOnly(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function stateOrNull(v: unknown): string | null {
  const t = cleanText(v, 8);
  return t ? t.toUpperCase() : null;
}

function committeeIdOf(r: RawIe): string | null {
  const direct = cleanText(r.committee_id, 20);
  if (direct) return direct;
  return cleanText(r.committee && typeof r.committee === "object" ? r.committee.committee_id : null, 20);
}

/** Does a row have the three fields the shape guard needs? */
export function hasIeShape(r: unknown): boolean {
  if (!r || typeof r !== "object") return false;
  const x = r as RawIe;
  const sub = typeof x.sub_id === "string" ? x.sub_id.trim() : typeof x.sub_id === "number" ? String(x.sub_id) : "";
  return sub !== "" && committeeIdOf(x) !== null && x.expenditure_amount !== undefined && x.expenditure_amount !== null && Number.isFinite(Number(x.expenditure_amount));
}

/**
 * Clean one raw row. Returns the row, or a reason string when it cannot be stored.
 * A date that is not a calendar date, or is after `today`, is stored as null and counted in `notes`.
 */
export function parseIeRow(raw: unknown, today: string, notes: ParseNotes): IeRow | string {
  if (!raw || typeof raw !== "object") return "row is not an object";
  const r = raw as RawIe;
  const sub = typeof r.sub_id === "string" ? r.sub_id.trim() : typeof r.sub_id === "number" ? String(r.sub_id) : "";
  if (!sub) return "no sub_id";
  const cid = committeeIdOf(r);
  if (!cid) return "no committee_id";
  const amount = r.expenditure_amount === null || r.expenditure_amount === undefined || r.expenditure_amount === "" ? NaN : Number(r.expenditure_amount);
  if (!Number.isFinite(amount)) return "no usable expenditure_amount";

  const day = (v: unknown): string | null => {
    if (v === null || v === undefined || v === "") return null;
    const d = dateOnly(v);
    if (!d) { notes.badDate++; return null; }
    if (d > today) { notes.futureDate++; return null; }
    return d;
  };

  const so = typeof r.support_oppose_indicator === "string" ? r.support_oppose_indicator.trim().toUpperCase() : "";
  const office = typeof r.candidate_office === "string" ? r.candidate_office.trim().toUpperCase() : "";
  const url = typeof r.pdf_url === "string" ? r.pdf_url.trim() : "";

  return {
    sub_id: sub,
    committee_fec_id: cid,
    committee_name: cleanText(r.committee && typeof r.committee === "object" ? r.committee.name : null),
    candidate_fec_id: cleanText(r.candidate_id, 20),
    candidate_name: cleanText(r.candidate_name),
    candidate_office: office === "H" || office === "S" || office === "P" ? office : null,
    candidate_state: stateOrNull(r.candidate_office_state),
    candidate_district: cleanText(r.candidate_office_district, 8),
    candidate_party: cleanText(r.candidate_party, 20),
    support_oppose: so === "S" || so === "O" ? so : null,
    amount,
    spent_at: day(r.expenditure_date),
    disseminated_at: day(r.dissemination_date),
    description: cleanText(r.expenditure_description, DESCRIPTION_MAX),
    payee_name: cleanText(r.payee_name),
    is_notice: typeof r.is_notice === "boolean" ? r.is_notice : null,
    source_url: /^https?:\/\//i.test(url) ? url.slice(0, 500) : null,
  };
}

export interface Legislator { id?: { bioguide?: string; fec?: string[] } }

/** FEC candidate id to Bioguide ID, from the congress-legislators roster. */
export function fecToBioguide(legislators: Legislator[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of legislators) {
    const bio = l?.id?.bioguide;
    if (!bio || !Array.isArray(l.id?.fec)) continue;
    for (const f of l.id!.fec!) if (typeof f === "string" && f) m.set(f.trim().toUpperCase(), bio);
  }
  return m;
}

export interface IePage {
  pagination?: { last_indexes?: Record<string, unknown> | null; pages?: number; count?: number } | null;
  results?: unknown;
}

/** The cursor parameters OpenFEC wants back: every non-null entry of pagination.last_indexes, as strings. */
export function nextCursor(page: IePage): Record<string, string> | null {
  const li = page.pagination?.last_indexes;
  if (!li || typeof li !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(li)) if (v !== null && v !== undefined && v !== "") out[k] = String(v);
  return out.last_index ? out : null;
}

export interface IeUrlOptions {
  base: string;
  key: string;
  cycle: number;
  perPage: number;
  minDate?: string | null;
  cursor?: Record<string, string> | null;
}

export function ieUrl(o: IeUrlOptions): URL {
  const u = new URL(`${o.base}/schedules/schedule_e/`);
  u.searchParams.set("api_key", o.key);
  u.searchParams.append("cycle", String(o.cycle));
  u.searchParams.set("most_recent", "true");
  u.searchParams.append("is_notice", "true");
  u.searchParams.append("is_notice", "false");
  u.searchParams.set("per_page", String(o.perPage));
  u.searchParams.set("sort", "-expenditure_date");
  if (o.minDate) u.searchParams.set("min_date", o.minDate);
  for (const [k, v] of Object.entries(o.cursor ?? {})) u.searchParams.set(k, v);
  return u;
}

/** Subtract days from a YYYY-MM-DD date. */
export function minusDays(d: string, n: number): string {
  const t = Date.parse(`${d}T00:00:00Z`) - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
