// Heatmap data — the compact per-transaction rows the client-side treemap filters and
// aggregates (web/src/components/Heatmap.astro). Built once per deploy from the flagship graph
// and served as static JSON at /data/heatmap-congress.json and /data/heatmap-insiders.json.
//
// Rules (decided with Peter 2026-09-28):
//   - published filings only (the JSON is a public data file; "under review" rows stay out)
//   - last 365 days by trade date (filed date when the trade date is missing)
//   - congress tile dollars = the TOP of the reported range (Txn.value), insiders = shares × price
//   - keys are short on purpose: the insiders file is thousands of rows
import type { Flagship, Txn, Person } from "./flagship";

export const HEATMAP_WINDOW_DAYS = 365;

export interface CongressRow {
  t: string;          // ticker
  n: string | null;   // security / company name
  p: string;          // member name
  ps: string | null;  // member slug (link)
  ch: "house" | "senate" | null;
  pa: string | null;  // party as recorded (Democrat / Republican / Independent) or null
  st: string | null;  // state
  s: "buy" | "sell" | "other";
  v: number;          // dollars (top of range)
  lo: number | null; hi: number | null;
  o: string | null;   // owner: self / spouse / dependent / joint
  d: string;          // trade date
  f: string | null;   // filed date
  u: string | null;   // source url
}

export interface InsiderRow {
  t: string;
  n: string | null;
  p: string;
  ps: string | null;
  r: "officer" | "director" | "owner"; // role at this issuer
  ti: string | null;  // officer title
  c: string | null;   // Form 4 code
  s: "buy" | "sell" | "other";
  v: number;          // shares × price
  sh: number | null; pr: number | null;
  pl: boolean;        // Rule 10b5-1 plan
  o: string | null;   // direct / indirect
  d: string;
  f: string | null;
  u: string | null;
}

export interface HeatmapFile<R> {
  kind: "congress" | "insiders";
  builtAt: string;
  windowDays: number;
  rows: R[];
}

function sideOf(t: Txn): "buy" | "sell" | "other" {
  return t.side === "buy" ? "buy" : t.side === "sell" ? "sell" : "other";
}
function cutoffIso(days: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function tradeDate(t: Txn): string | null { return t.txnDate ?? t.filedAt?.slice(0, 10) ?? null; }

function personName(m: Flagship, id: number | null): { name: string; slug: string | null; person: Person | null } {
  const p = id != null ? m.people.get(id) ?? null : null;
  return { name: p?.name ?? "Unknown filer", slug: p?.slug ?? null, person: p };
}

export function congressRows(m: Flagship): CongressRow[] {
  const cutoff = cutoffIso(HEATMAP_WINDOW_DAYS);
  const out: CongressRow[] = [];
  for (const t of m.txns) {
    if (t.source !== "house_ptr" && t.source !== "senate_ptr") continue;
    if (!t.isPublished) continue;
    const d = tradeDate(t); if (!d || d < cutoff) continue;
    if (t.securityId == null) continue;                  // tiles are tickers; unticketed assets are not on the map
    const s = m.securities.get(t.securityId); if (!s) continue;
    const v = t.value ?? t.amountHigh ?? 0; if (!(v > 0)) continue;
    const { name, slug, person } = personName(m, t.personId);
    const role = person?.roles.find((r) => r.kind === "congress") ?? null;
    out.push({
      t: s.ticker, n: s.name ?? (s.companyId != null ? m.companies.get(s.companyId)?.name ?? null : null),
      p: name, ps: slug,
      ch: role?.chamber ?? (t.source === "senate_ptr" ? "senate" : "house"),
      pa: role?.party ?? null, st: role?.state ?? null,
      s: sideOf(t), v, lo: t.amountLow, hi: t.amountHigh, o: t.ownerType,
      d, f: t.filedAt?.slice(0, 10) ?? null, u: t.sourceUrl,
    });
  }
  return out;
}

export function insiderRows(m: Flagship): InsiderRow[] {
  const cutoff = cutoffIso(HEATMAP_WINDOW_DAYS);
  const out: InsiderRow[] = [];
  for (const t of m.txns) {
    if (t.source !== "sec_form4") continue;
    if (!t.isPublished) continue;
    const d = tradeDate(t); if (!d || d < cutoff) continue;
    if (t.securityId == null) continue;
    const s = m.securities.get(t.securityId); if (!s) continue;
    const v = t.value ?? 0;                                // rows with no price (footnoted) carry 0 and are kept for counts
    const { name, slug, person } = personName(m, t.personId);
    const role = person?.roles.find((r) => r.kind === "insider" && r.companyId != null && r.companyId === s.companyId)
      ?? person?.roles.find((r) => r.kind === "insider") ?? null;
    const r: InsiderRow["r"] = role?.officerTitle ? "officer" : role?.isDirector ? "director" : "owner";
    out.push({
      t: s.ticker, n: s.name ?? (s.companyId != null ? m.companies.get(s.companyId)?.name ?? null : null),
      p: name, ps: slug, r, ti: role?.officerTitle ?? null,
      c: t.code, s: sideOf(t), v, sh: t.shares, pr: t.price, pl: t.is10b51 === true, o: t.ownerType,
      d, f: t.filedAt?.slice(0, 10) ?? null, u: t.sourceUrl,
    });
  }
  return out;
}

export function heatmapFile<R>(kind: "congress" | "insiders", m: Flagship, rows: R[]): HeatmapFile<R> {
  return { kind, builtAt: m.builtAt, windowDays: HEATMAP_WINDOW_DAYS, rows };
}
