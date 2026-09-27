// Source: BLS CPI-U, all items, U.S. city average, not seasonally adjusted (series CUUR0000SA0).
// Keyless BLS Public Data API v2 (25 queries/day unregistered; BLS_API_KEY raises the limit).
//
// Why: the I-Bond variable component is set from this exact series — the semiannual change
// from March to September fixes the 1 November rate, September to March fixes 1 May. Storing
// the monthly index as rate_series CPI_U_NSA lets the I-Bond page state what is already known
// about the next reset (roadmap B.5) as each month's CPI lands, with no FRED dependency.
//
// Stored as one observation per month (obs_date = first of the month, value = index level).
// Annual-average rows (period M13) are dropped. Re-ingests overwrite (BLS revises rarely,
// but the NSA index is final on release, so this is a safety net).

import { fetchJson } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "bls_cpi";
const SERIES_ID = "CUUR0000SA0";
const CODE = "CPI_U_NSA";

interface BlsResponse {
  status: string;
  message?: string[];
  Results?: { series?: { seriesID: string; data?: { year: string; period: string; value: string; latest?: string }[] }[] };
}

export async function ingestBlsCpi(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const endYear = new Date().getUTCFullYear();
  const startYear = Number(process.env.BLS_CPI_START_YEAR ?? endYear - 2);
  const key = process.env.BLS_API_KEY;
  const url = new URL(`https://api.bls.gov/publicAPI/v2/timeseries/data/${SERIES_ID}`);
  url.searchParams.set("startyear", String(startYear));
  url.searchParams.set("endyear", String(endYear));
  if (key) url.searchParams.set("registrationkey", key);

  const resp = await fetchJson<BlsResponse>(url);
  if (resp.status !== "REQUEST_SUCCEEDED") {
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "failed",
      error: `BLS status ${resp.status}: ${(resp.message ?? []).join("; ")}`, stats: ctx.stats() };
  }
  const data = resp.Results?.series?.[0]?.data ?? [];
  ctx.extra["api_rows"] = data.length;
  ctx.extra["years"] = [startYear, endYear];

  const [series] = await sql`
    insert into rate_series (code, label, source, source_ref, unit, frequency)
    values (${CODE}, 'CPI-U All Items, U.S. City Average, NSA (1982-84=100)', 'bls', ${SERIES_ID}, 'index', 'monthly')
    on conflict (code) do update set label = excluded.label, source_ref = excluded.source_ref
    returning id
  `;
  const seriesId = series!.id as number;

  for (const row of data) {
    const m = row.period.match(/^M(\d{2})$/);
    if (!m || m[1] === "13") continue; // annual average
    const obsDate = `${row.year}-${m[1]}-01`;
    if (!ctx.markSeen(obsDate)) continue;
    ctx.rowsSeen++;
    const value = Number(row.value);
    if (!Number.isFinite(value)) { ctx.quarantine(obsDate, `non-numeric value "${row.value}"`); continue; }
    const res = await sql`
      insert into rate_observations (series_id, obs_date, value, meta)
      values (${seriesId}, ${obsDate}, ${value}, ${sql.json({ latest: row.latest === "true" })})
      on conflict (series_id, obs_date) do update set value = excluded.value, meta = excluded.meta
    `;
    ctx.rowsChanged += res.count ?? 0;
  }

  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestBlsCpi()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
