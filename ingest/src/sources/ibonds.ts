// Source: I-Bond composite rates (U.S. Treasury Fiscal Data — "I Bonds Interest Rates").
// No API key required. Updated semi-annually (new periods each May 1 and Nov 1).
//
// Verified 2026-09-06 against the live API:
//   endpoint  v1/accounting/od/i_bonds_interest_rates
//   fields    earning_period (YYYY-MM), earning_period_start, earning_period_end,
//             issue_year_month (YYYY-MM), fixed_rate, semi_annual_inflation_rate, combined_rate
//   shape     a full matrix — one row per (earning period × issue month), ~9.7k rows, oldest
//             first, no record_date field. The announcement for a period is the row whose
//             issue_year_month equals its earning_period: that carries the newly set fixed
//             rate and the composite rate for bonds bought in that period.
// We fetch the whole matrix in one page (API max page size 10,000) and keep those rows only.

import { fiscalData } from "../lib/fiscaldata.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const ENDPOINT = "v1/accounting/od/i_bonds_interest_rates";

interface Row {
  earning_period: string;
  earning_period_start: string;
  earning_period_end: string;
  issue_year_month: string;
  fixed_rate: string | null;
  semi_annual_inflation_rate: string | null;
  combined_rate: string | null;
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

export async function ingestIBonds(): Promise<IngestRunResult> {
  const sql = getDb();

  const resp = await fiscalData<Row>(ENDPOINT, { sort: "-earning_period_start", pageSize: 10000 });
  const all = resp.data ?? [];
  const totalPages = resp.meta["total-pages"] ?? 1;
  if (all.length === 0) {
    return { source: "ibonds", rowsSeen: 0, rowsChanged: 0, status: "partial",
      error: "endpoint returned no rows — verify path/fields" };
  }

  // Announcement rows only: the issue month that opens the earning period.
  const rows = all.filter((r) => r.issue_year_month === r.earning_period);
  if (rows.length === 0) {
    return { source: "ibonds", rowsSeen: all.length, rowsChanged: 0, status: "partial",
      error: "no rows with issue_year_month == earning_period — field names changed?" };
  }

  const [series] = await sql`
    insert into rate_series (code, label, source, source_ref, unit, frequency)
    values ('IBOND_COMPOSITE', 'I Bond Composite Rate', 'treasury_fiscaldata',
            ${ENDPOINT}, 'percent', 'semiannual')
    on conflict (code) do update
      set label = excluded.label, source_ref = excluded.source_ref
    returning id
  `;
  const seriesId = series!.id as number;

  let changed = 0;
  for (const row of rows) {
    const obsDate = row.earning_period_start;
    if (!obsDate) continue;

    const fixed = parseNum(row.fixed_rate);
    const inflation = parseNum(row.semi_annual_inflation_rate);
    let composite = parseNum(row.combined_rate);

    // composite = fixed + 2*infl + (fixed*infl/100), rates in percent (Treasury's formula).
    if (composite == null && fixed != null && inflation != null) {
      composite = fixed + 2 * inflation + (fixed * inflation) / 100;
    }

    const result = await sql`
      insert into rate_observations (series_id, obs_date, value, meta)
      values (${seriesId}, ${obsDate}, ${composite},
              ${sql.json({
                fixedRate: fixed,
                semiannualInflationRate: inflation,
                earningPeriod: row.earning_period,
                earningPeriodEnd: row.earning_period_end,
              })})
      on conflict (series_id, obs_date) do update
        set value = excluded.value, meta = excluded.meta
    `;
    changed += result.count ?? 0;
  }

  return {
    source: "ibonds",
    rowsSeen: rows.length,
    rowsChanged: changed,
    status: totalPages > 1 ? "partial" : "success",
    ...(totalPages > 1 ? { error: `dataset exceeds one page (${totalPages} pages) — raise pageSize` } : {}),
  };
}

// Allow running directly: `npm run ingest -- ibonds` or `tsx src/sources/ibonds.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestIBonds()
    .then((r) => {
      console.log(`✓ ibonds: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`);
      if (r.error) console.warn("  note:", r.error);
    })
    .catch((e) => {
      console.error("✗ ibonds failed:", e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
