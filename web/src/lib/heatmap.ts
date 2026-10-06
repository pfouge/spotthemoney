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
import { sizeByTicker } from "./capband";
import { pack, type Packed } from "./heatmap-pack";

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
  /** ticker → size band (mega/large/mid/small/micro) for tickers in `rows` with a size on file. */
  caps: Record<string, string>;
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
    if (t.isDerivative === true) continue;
    if (t.jointOf != null) continue;                      // a joint filer repeating a transaction already on the map                // the map is dollars of stock; option and warrant rows are in the tables
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

export function heatmapFile<R extends { t: string }>(kind: "congress" | "insiders", m: Flagship, rows: R[]): HeatmapFile<R> {
  const sizes = sizeByTicker(m);
  const caps: Record<string, string> = {};
  for (const r of rows) { const e = sizes.get(r.t.toUpperCase()); if (e) caps[r.t] = e.band; }
  return { kind, builtAt: m.builtAt, windowDays: HEATMAP_WINDOW_DAYS, caps, rows };
}

// ── the insiders files ─────────────────────────────────────────────────────────────────────
// A year of Form 4 rows is too much for one file: as plain objects it was 41 MiB (Cloudflare
// refuses assets over 25 MiB — every deploy failed on 2026-10-06) and no phone should download
// it to draw a 30-day map. So the rows are packed (lib/heatmap-pack.ts) and split by age:
//   /data/heatmap-insiders.json        the last RECENT_DAYS — all the 7D/30D/90D views need
//   /data/heatmap-insiders-older.json  the rest of the year, fetched when 1Y is chosen
// If the older file would still be too big to deploy, its far end is cut a month at a time
// until it fits — a shorter map beats a failed deploy — and `windowDays` says what was kept.

export const RECENT_DAYS = 90;
/** Cloudflare's ceiling for one static asset is 25 MiB; stay well under it. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const OLDER_PATH = "/data/heatmap-insiders-older.json";

const daysBefore = (iso: string, days: number): string => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };

export interface InsidersFiles { recent: string; older: string; windowDays: number; counts: { recent: number; older: number }; bytes: { recent: number; older: number } }

export function splitInsiders(rows: InsiderRow[], builtAt: string, head: Omit<HeatmapFile<InsiderRow>, "rows">, maxBytes = MAX_FILE_BYTES): InsidersFiles {
  const recentCut = daysBefore(builtAt, RECENT_DAYS);
  const recentRows = rows.filter((r) => r.d >= recentCut);
  const capsFor = (rs: InsiderRow[]) => { const c: Record<string, string> = {}; for (const r of rs) { const b = head.caps[r.t]; if (b) c[r.t] = b; } return c; };
  let days = head.windowDays, olderRows: InsiderRow[] = [], older = "";
  for (;; days -= 30) {
    const cut = daysBefore(builtAt, days);
    olderRows = rows.filter((r) => r.d < recentCut && r.d >= cut);
    older = JSON.stringify({ ...head, windowDays: days, caps: capsFor(olderRows), part: "older", ...pack(olderRows) });
    if (Buffer.byteLength(older) <= maxBytes || days - 30 <= RECENT_DAYS) break;
  }
  const recent = JSON.stringify({ ...head, windowDays: days, recentDays: RECENT_DAYS, older: olderRows.length ? OLDER_PATH : null, caps: capsFor(recentRows), ...pack(recentRows) });
  return { recent, older, windowDays: days, counts: { recent: recentRows.length, older: olderRows.length }, bytes: { recent: Buffer.byteLength(recent), older: Buffer.byteLength(older) } };
}

let insidersMemo: { builtAt: string; files: InsidersFiles } | null = null;
/** Both insiders files for this build (computed once; the two /data routes each take one). */
export function insidersFiles(m: Flagship): InsidersFiles {
  if (insidersMemo?.builtAt === m.builtAt) return insidersMemo.files;
  const rows = insiderRows(m);
  const { rows: _rows, ...head } = heatmapFile("insiders", m, rows);
  const files = splitInsiders(rows, m.builtAt, head);
  const mib = (n: number) => (n / 1048576).toFixed(1);
  console.log(`heatmap-insiders: ${files.counts.recent} rows in the last ${RECENT_DAYS} days (${mib(files.bytes.recent)} MiB), ${files.counts.older} older rows back to ${files.windowDays} days (${mib(files.bytes.older)} MiB)`);
  if (files.windowDays < HEATMAP_WINDOW_DAYS) console.warn(`heatmap-insiders: the year did not fit in ${mib(MAX_FILE_BYTES)} MiB — older file cut to ${files.windowDays} days`);
  insidersMemo = { builtAt: m.builtAt, files };
  return files;
}
