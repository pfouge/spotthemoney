// Source: Treasury Daily Par Yield Curve (home.treasury.gov CSV feed). Keyless.
// Contract: integration contract §4.6 (rate_series + rate_observations reuse).
//
// UNKNOWN-TENOR RULE (contract §4.6, binding): Treasury adds/drops tenor columns
// over time ("1.5 Month" proves it). Tenor labels are mapped to UST_PAR_<slug>
// codes PROGRAMMATICALLY from the CSV header — never a hard-coded column list.
// A new column creates a new rate_series and logs a warning; it is never
// silently dropped.
//
// Backfill: set TREASURY_YC_YEARS="2024,2025,2026" to ingest multiple years;
// default is the current year (the feed is one CSV per calendar year).
//
// WAF note: IIF's Python connector calls this feed with Chrome-TLS impersonation
// "defensively". Policy here is an honest descriptive UA; if home.treasury.gov
// ever 403s it, re-route this source rather than spoofing (see lib/http.ts).

import { fetchText } from "../lib/http.js";
import { parseCsv } from "../lib/csv.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "treasury_yield_curve";

const csvUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all` +
  `?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

// Human-readable source page (what IIF emits as source_url; goes in rate_series.source_ref).
const textViewUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView` +
  `?type=daily_treasury_yield_curve&field_tdr_date_value=${year}`;

/**
 * Map a Treasury tenor label to a series code. Known labels produce the contract's
 * canonical codes ("1 Mo"→UST_PAR_1M, "1.5 Month"→UST_PAR_1_5M, "10 Yr"→UST_PAR_10Y);
 * anything unrecognized still gets a deterministic slug (never dropped).
 */
export function tenorLabelToCode(label: string, prefix = "UST_PAR"): { code: string; recognized: boolean } {
  const m = label.trim().match(/^([\d.]+)\s*(mo|month|months|yr|year|years)\.?$/i);
  if (m) {
    const num = m[1]!.replace(/\.$/, "").replace(/\./g, "_");
    const unit = m[2]![0]!.toLowerCase() === "m" ? "M" : "Y";
    return { code: `${prefix}_${num}${unit}`, recognized: true };
  }
  const slug = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return { code: `${prefix}_${slug}`, recognized: false };
}

/** Parse Treasury's date column (M/D/YYYY, M/D/YY, or ISO) to ISO yyyy-mm-dd. */
export function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

function parseRate(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "" || t.toUpperCase() === "N/A") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export async function ingestTreasuryYieldCurve(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const years = (process.env.TREASURY_YC_YEARS ?? String(new Date().getFullYear()))
    .split(",")
    .map((y) => Number(y.trim()))
    .filter((y) => Number.isInteger(y) && y >= 1990 && y <= 2100);
  if (years.length === 0) {
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "failed",
      error: "TREASURY_YC_YEARS parsed to no valid years", stats: ctx.stats() };
  }

  // code → rate_series id, resolved lazily per tenor (one upsert per series per run).
  const seriesIds = new Map<string, number>();
  const newSeries: string[] = [];

  for (const year of years) {
    const raw = await fetchText(csvUrl(year));
    const rows = parseCsv(raw);
    ctx.extra[`csv_rows_${year}`] = rows.length;
    if (rows.length < 2) {
      ctx.warn(`year ${year}: CSV had ${rows.length} row(s) — no data`);
      continue;
    }

    const header = rows[0]!.map((h) => h.trim());
    const tenorLabels = header.slice(1);

    // Resolve every tenor in this year's header to a rate_series row.
    for (const label of tenorLabels) {
      const { code, recognized } = tenorLabelToCode(label);
      if (seriesIds.has(code)) continue;
      if (!recognized) {
        ctx.warn(`unrecognized tenor label "${label}" → new series ${code} (never dropped, per contract §4.6)`);
      }
      const [series] = await sql`
        insert into rate_series (code, label, source, source_ref, unit, frequency)
        values (${code}, ${scrubDeep(`UST Par Yield ${label}`)}, 'treasury',
                ${textViewUrl(year)}, 'percent', 'daily')
        on conflict (code) do update
          set label = excluded.label, source_ref = excluded.source_ref
        returning id, (xmax = 0) as inserted
      `;
      seriesIds.set(code, series!.id as number);
      if (series!.inserted) newSeries.push(code);
    }

    for (const row of rows.slice(1)) {
      const obsDate = toIsoDate(row[0] ?? "");
      if (!obsDate) {
        ctx.quarantine(`year ${year} row "${(row[0] ?? "").slice(0, 30)}"`, "unparseable date");
        continue;
      }
      // Seen-set dedupe: the feed has no guaranteed ordering contract.
      if (!ctx.markSeen(obsDate)) continue;
      ctx.rowsSeen++;

      for (let i = 0; i < tenorLabels.length; i++) {
        const { code } = tenorLabelToCode(tenorLabels[i]!);
        const seriesId = seriesIds.get(code)!;
        const value = parseRate(row[i + 1]);
        if (value == null) continue; // tenor not offered on this date (e.g. 1.5 Month gaps)
        const result = await sql`
          insert into rate_observations (series_id, obs_date, value, meta)
          values (${seriesId}, ${obsDate}, ${value}, null)
          on conflict (series_id, obs_date) do update
            set value = excluded.value
        `;
        ctx.rowsChanged += result.count ?? 0;
      }
    }
  }

  ctx.extra["years"] = years;
  ctx.extra["series_count"] = seriesIds.size;
  ctx.extra["new_series"] = newSeries;

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: "success",
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- treasury_yield_curve`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestTreasuryYieldCurve()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
