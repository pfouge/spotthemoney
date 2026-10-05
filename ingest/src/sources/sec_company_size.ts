// Source: SEC XBRL "frames" API (data.sec.gov) — company size from filings. Keyless.
//
// WHY: the site filters trades by company size, and price feeds are not licensed for
// display (docs/04 #33). Two cover-page facts every filer reports give a filings-only
// estimate:
//   dei:EntityCommonStockSharesOutstanding  shares, on each 10-Q / 10-K
//   dei:EntityPublicFloat                   dollars held by non-affiliates, on each 10-K
// A frame returns that fact for EVERY filer for one period in a single request
// (`/api/xbrl/frames/dei/<tag>/<unit>/CY2026Q2I.json`, ~4,400 rows; checked 2026-10-05), so
// the whole job is about a dozen requests. For each tracked company we keep the newest
// value of each fact across the last several quarters.
//
// KNOWN GAPS (by design, stated on the methodology page): companies that report shares per
// share class (Alphabet, Meta, Berkshire, Visa…) have no single shares figure in frames —
// they fall back to public float, which is annual. Funds and ETFs report neither.
//
// The site turns these into a size band at build time (web/src/lib/capband.ts).

import { fetchJson } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "sec_company_size";
const BASE = "https://data.sec.gov/api/xbrl/frames";
const DEFAULT_USER_AGENT = "spotthemoney.com ingest (Peter Fougerousse <pfouge@gmail.com>)";

interface FrameRow { cik: number; end: string; val: number }
interface Frame { data?: FrameRow[] }

/** The last `n` calendar-quarter frame names up to and including the quarter of `today`. */
export function recentQuarterFrames(today: Date, n: number): string[] {
  let y = today.getUTCFullYear();
  let q = Math.floor(today.getUTCMonth() / 3) + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`CY${y}Q${q}I`);
    q--; if (q === 0) { q = 4; y--; }
  }
  return out;
}

/** Keep, per CIK, the row with the latest period end. */
export function newestPerCik(frames: FrameRow[][]): Map<string, { val: number; end: string }> {
  const out = new Map<string, { val: number; end: string }>();
  for (const rows of frames) {
    for (const r of rows) {
      if (!(r.val > 0) || !r.end) continue;
      const cik = String(r.cik).padStart(10, "0");
      const cur = out.get(cik);
      if (!cur || r.end > cur.end) out.set(cik, { val: r.val, end: r.end });
    }
  }
  return out;
}

export async function ingestSecCompanySize(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const opts = { userAgent: process.env.SEC_EDGAR_USER_AGENT ?? DEFAULT_USER_AGENT, minGapMs: 250 };

  async function frames(tag: string, unit: string, quarters: number): Promise<FrameRow[][]> {
    const out: FrameRow[][] = [];
    for (const name of recentQuarterFrames(new Date(), quarters)) {
      try {
        const f = await fetchJson<Frame>(`${BASE}/dei/${tag}/${unit}/${name}.json`, opts);
        out.push(f.data ?? []);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        // The current quarter's frame does not exist until filings for it arrive.
        if (m.includes("HTTP 404")) continue;
        throw err;
      }
    }
    return out;
  }

  const shareFrames = await frames("EntityCommonStockSharesOutstanding", "shares", 6);
  const floatFrames = await frames("EntityPublicFloat", "USD", 8);
  if (shareFrames.length === 0 && floatFrames.length === 0) {
    throw new Error("sec_company_size: no frames returned");
  }
  const shares = newestPerCik(shareFrames);
  const floats = newestPerCik(floatFrames);

  const tracked = await sql<{ cik: string }[]>`select distinct cik from companies where cik is not null`;
  const rows: { cik: string; shares_outstanding: number | null; shares_as_of: string | null; public_float: number | null; float_as_of: string | null }[] = [];
  for (const t of tracked) {
    const cik = String(t.cik).padStart(10, "0");
    const s = shares.get(cik);
    const f = floats.get(cik);
    if (!s && !f) continue;
    ctx.rowsSeen++;
    rows.push({ cik, shares_outstanding: s?.val ?? null, shares_as_of: s?.end ?? null, public_float: f?.val ?? null, float_as_of: f?.end ?? null });
  }

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const res = await sql`
      insert into company_size ${sql(batch, "cik", "shares_outstanding", "shares_as_of", "public_float", "float_as_of")}
      on conflict (cik) do update
        set shares_outstanding = coalesce(excluded.shares_outstanding, company_size.shares_outstanding),
            shares_as_of = coalesce(excluded.shares_as_of, company_size.shares_as_of),
            public_float = coalesce(excluded.public_float, company_size.public_float),
            float_as_of = coalesce(excluded.float_as_of, company_size.float_as_of),
            updated_at = now()
    `;
    ctx.rowsChanged += res.count ?? 0;
  }

  ctx.extra["share_frames"] = shareFrames.length;
  ctx.extra["float_frames"] = floatFrames.length;
  ctx.extra["filers_with_shares"] = shares.size;
  ctx.extra["filers_with_float"] = floats.size;
  ctx.extra["tracked_companies"] = tracked.length;
  ctx.extra["tracked_with_size"] = rows.length;
  ctx.extra["tracked_with_shares"] = rows.filter((r) => r.shares_outstanding != null).length;
  ctx.extra["tracked_float_only"] = rows.filter((r) => r.shares_outstanding == null).length;
  console.log(`${SOURCE}: ${rows.length} of ${tracked.length} tracked companies have a size (${ctx.extra["tracked_with_shares"]} with shares, ${ctx.extra["tracked_float_only"]} float only)`);

  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}
