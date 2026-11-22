// Reader for the LD-203 contribution reports of the Senate lobbying API
// (<base>/contributions/). Pure: one API filing in, one stored filing plus its items out.
// Layout seen on 2026-11-22 (see ingest/src/sources/senate_lda_contributions.ts for the URLs):
//   page    { count, next, previous, results: [filing] }
//   filing  { filing_uuid, filing_type, filing_year, filing_period, filer_type, dt_posted,
//             filing_document_url, url, registrant{id,name}, lobbyist{first_name,...}|null,
//             no_contributions, pacs[], contribution_items[] }
//   item    { contribution_type, contributor_name, payee_name, honoree_name, amount, date }

export const TEXT_MAX = 300;
export const NAME_MAX = 200;

export interface ContribFiling {
  filing_uuid: string;
  filing_type: string | null;
  filing_year: number | null;
  filing_period: string | null;
  filer_type: string | null;
  registrant_id: number | null;
  registrant_name: string | null;
  lobbyist_name: string | null;
  no_contributions: boolean;
  pacs: string[];
  posted_at: string | null;
  source_url: string | null;
  item_count: number;
}

export interface ContribItem {
  seq: number;
  contribution_type: string | null;
  contributor_name: string | null;
  payee_name: string | null;
  honoree_name: string | null;
  amount: number | null;
  contributed_at: string | null;
}

export interface ParsedContrib {
  filing: ContribFiling;
  items: ContribItem[];
  badAmounts: number;
  badDates: number;
}

/** Strip control characters, collapse white space, cut at `max`; null when nothing is left. */
export function cleanText(v: unknown, max = TEXT_MAX): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/** A plain decimal number (as the API prints "1000.00"); anything else, and absurd sizes, is null. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) < 1e12 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : null;
}

/** A real calendar date (YYYY-MM-DD) not after `today` (YYYY-MM-DD); otherwise null. */
export function parseDate(v: unknown, today: string): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return iso > today || y < 1990 ? null : iso;
}

function parsePosted(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}

function lobbyistName(l: unknown): string | null {
  if (!l || typeof l !== "object") return null;
  const o = l as Record<string, unknown>;
  const parts = [o.prefix, o.first_name, o.middle_name, o.last_name, o.suffix].map((p) => cleanText(p, 60)).filter(Boolean);
  return parts.length ? parts.join(" ").slice(0, NAME_MAX) : null;
}

/** True when `x` has the page layout this job reads. */
export function hasPageShape(x: unknown): x is { count?: number; next?: string | null; results: unknown[] } {
  return !!x && typeof x === "object" && Array.isArray((x as { results?: unknown }).results)
    && typeof (x as { count?: unknown }).count === "number";
}

/** True when a result looks like a contribution filing (has the uuid and the items list). */
export function looksLikeFiling(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.filing_uuid === "string" && o.filing_uuid.length > 0 && ("contribution_items" in o || "no_contributions" in o);
}

export function parseContribFiling(raw: unknown, today: string): ParsedContrib | null {
  if (!looksLikeFiling(raw)) return null;
  const o = raw as Record<string, unknown>;
  const reg = (o.registrant && typeof o.registrant === "object" ? o.registrant : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(o.contribution_items) ? o.contribution_items : [];
  let badAmounts = 0;
  let badDates = 0;
  const items: ContribItem[] = [];
  rawItems.forEach((it) => {
    if (!it || typeof it !== "object") return;
    const r = it as Record<string, unknown>;
    const amount = parseAmount(r.amount);
    if (r.amount != null && r.amount !== "" && amount == null) badAmounts++;
    const date = parseDate(r.date, today);
    if (r.date != null && r.date !== "" && date == null) badDates++;
    items.push({
      seq: items.length + 1,
      contribution_type: cleanText(r.contribution_type, 40),
      contributor_name: cleanText(r.contributor_name, NAME_MAX),
      payee_name: cleanText(r.payee_name, NAME_MAX),
      honoree_name: cleanText(r.honoree_name, NAME_MAX),
      amount,
      contributed_at: date,
    });
  });
  const year = Number(o.filing_year);
  const regId = Number(reg.id);
  const pacs = Array.isArray(o.pacs) ? o.pacs.map((p) => cleanText(p, NAME_MAX)).filter((p): p is string => !!p) : [];
  return {
    filing: {
      filing_uuid: String(o.filing_uuid).trim().slice(0, 64),
      filing_type: cleanText(o.filing_type, 20),
      filing_year: Number.isInteger(year) ? year : null,
      filing_period: cleanText(o.filing_period, 40),
      filer_type: cleanText(o.filer_type, 40),
      registrant_id: Number.isInteger(regId) ? regId : null,
      registrant_name: cleanText(reg.name, NAME_MAX),
      lobbyist_name: lobbyistName(o.lobbyist),
      no_contributions: o.no_contributions === true,
      pacs,
      posted_at: parsePosted(o.dt_posted),
      source_url: cleanText(o.filing_document_url, 500) ?? cleanText(o.url, 500),
      item_count: items.length,
    },
    items,
    badAmounts,
    badDates,
  };
}

/** Wall-clock time as lda.gov prints it, plus one second, for `filing_dt_posted_before`. */
export function beforeCursor(dtPosted: string): string {
  const naive = Date.parse(`${dtPosted.slice(0, 19)}Z`);
  if (!Number.isFinite(naive)) return dtPosted.slice(0, 10);
  return new Date(naive + 1000).toISOString().slice(0, 19);
}
