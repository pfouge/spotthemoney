// Source: Treasury Daily Real Yield Curve — the TIPS curve (home.treasury.gov CSV). Keyless.
// Resolves open decision #4 without a FRED key: Treasury publishes the real (inflation-
// indexed) par yields for the 5-, 7-, 10-, 20- and 30-year TIPS tenors every business day,
// same CSV mechanics as the nominal curve. Series codes: UST_REAL_<tenor> (UST_REAL_10Y …),
// so the web layer can treat nominal minus real as the market breakeven inflation rate.
//
// Same unknown-tenor rule as treasury_yield_curve.ts (new column → new series + warning,
// never dropped). Backfill with TREASURY_YC_YEARS, shared with the nominal job.

import { fetchText } from "../lib/http.js";
import { parseCsv } from "../lib/csv.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { tenorLabelToCode, toIsoDate } from "./treasury_yield_curve.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "treasury_real_yield_curve";
const PREFIX = "UST_REAL";

const csvUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all` +
  `?type=daily_treasury_real_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
const textViewUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView` +
  `?type=daily_treasury_real_yield_curve&field_tdr_date_value=${year}`;

function parseRate(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "" || t.toUpperCase() === "N/A") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export async function ingestTreasuryRealYieldCurve(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const years = (process.env.TREASURY_YC_YEARS ?? String(new Date().getFullYear()))
    .split(",").map((y) => Number(y.trim())).filter((y) => Number.isInteger(y) && y >= 2003 && y <= 2100);
  if (years.length === 0) {
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "failed", error: "TREASURY_YC_YEARS parsed to no valid years", stats: ctx.stats() };
  }

  const seriesIds = new Map<string, number>();
  const newSeries: string[] = [];

  for (const year of years) {
    const raw = await fetchText(csvUrl(year));
    const rows = parseCsv(raw);
    ctx.extra[`csv_rows_${year}`] = rows.length;
    if (rows.length < 2) { ctx.warn(`year ${year}: CSV had ${rows.length} row(s) — no data`); continue; }

    const header = rows[0]!.map((h) => h.trim());
    const tenorLabels = header.slice(1);
    for (const label of tenorLabels) {
      const { code, recognized } = tenorLabelToCode(label, PREFIX);
      if (seriesIds.has(code)) continue;
      if (!recognized) ctx.warn(`unrecognized tenor label "${label}" → new series ${code} (never dropped)`);
      const [series] = await sql`
        insert into rate_series (code, label, source, source_ref, unit, frequency)
        values (${code}, ${scrubDeep(`TIPS Real Yield ${label}`)}, 'treasury', ${textViewUrl(year)}, 'percent', 'daily')
        on conflict (code) do update set label = excluded.label, source_ref = excluded.source_ref
        returning id, (xmax = 0) as inserted
      `;
      seriesIds.set(code, series!.id as number);
      if (series!.inserted) newSeries.push(code);
    }

    for (const row of rows.slice(1)) {
      const obsDate = toIsoDate(row[0] ?? "");
      if (!obsDate) { ctx.quarantine(`year ${year} row "${(row[0] ?? "").slice(0, 30)}"`, "unparseable date"); continue; }
      if (!ctx.markSeen(obsDate)) continue;
      ctx.rowsSeen++;
      for (let i = 0; i < tenorLabels.length; i++) {
        const { code } = tenorLabelToCode(tenorLabels[i]!, PREFIX);
        const value = parseRate(row[i + 1]);
        if (value == null) continue;
        const result = await sql`
          insert into rate_observations (series_id, obs_date, value, meta)
          values (${seriesIds.get(code)!}, ${obsDate}, ${value}, null)
          on conflict (series_id, obs_date) do update set value = excluded.value
        `;
        ctx.rowsChanged += result.count ?? 0;
      }
    }
  }

  ctx.extra["years"] = years;
  ctx.extra["series_count"] = seriesIds.size;
  ctx.extra["new_series"] = newSeries;
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestTreasuryRealYieldCurve()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
