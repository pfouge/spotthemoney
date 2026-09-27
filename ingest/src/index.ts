// Ingest runner. Dispatches one or more sources and records each run for observability.
//
//   npm run ingest -- ibonds      # run a specific source
//   npm run ingest                # run all registered sources
//
// New sources: add a module under src/sources/ and register it in REGISTRY below.
// Source codes follow the integration contract §3.4. NOTE: congress_ptr is NOT here —
// per the contract it runs as a separate Python job reusing IIF's parser (see
// ingest/py/README.md), never as a TypeScript port.

import { getDb, closeDb } from "./lib/db.js";
import { SystemicFailureError } from "./lib/run.js";
import { ingestIBonds } from "./sources/ibonds.js";
import { ingestTreasuryYieldCurve } from "./sources/treasury_yield_curve.js";
import { ingestSenateLda } from "./sources/senate_lda.js";
import { ingestUsaspending } from "./sources/usaspending.js";
import { ingestFecScheduleA } from "./sources/fec_schedule_a.js";
import { ingestSecForm4 } from "./sources/sec_form4.js";
import { ingestTwelvedataEod } from "./sources/twelvedata_eod.js";
import { ingestUniverse } from "./sources/universe.js";
import { ingestTreasuryRealYieldCurve } from "./sources/treasury_real_yield_curve.js";
import { ingestBlsCpi } from "./sources/bls_cpi.js";
import { ingestFecCommittees } from "./sources/fec_committees.js";
import { ingestCitationCount } from "./jobs/citation_count.js";
import { ingestSearchConsoleWeekly } from "./jobs/search_console_weekly.js";
import { runXDaily } from "./jobs/x_daily.js";
import { runArchiveBackfill } from "./jobs/archive_backfill.js";
import type { IngestRunResult } from "@stm/shared";

// `daily: true` jobs run when no source is named (the scheduled ingest.yml run), in this
// order. Everything else runs only when named explicitly — the measurement jobs cost money
// per run and the X job posts publicly, so neither may ride along with the daily batch.
const REGISTRY: Record<string, { label: string; cadence: string; daily: boolean; run: () => Promise<IngestRunResult> }> = {
  universe: { label: "Tracked-ticker universe (securities seed)", cadence: "daily", daily: true, run: ingestUniverse },
  ibonds: { label: "I-Bond Composite Rate", cadence: "on_reset", daily: true, run: ingestIBonds },
  treasury_yield_curve: { label: "Treasury Daily Par Yield Curve", cadence: "daily", daily: true, run: ingestTreasuryYieldCurve },
  treasury_real_yield_curve: { label: "Treasury Daily Real (TIPS) Yield Curve", cadence: "daily", daily: true, run: ingestTreasuryRealYieldCurve },
  bls_cpi: { label: "BLS CPI-U (I-Bond variable-rate input)", cadence: "daily", daily: true, run: ingestBlsCpi },
  senate_lda: { label: "Senate LDA Lobbying Filings", cadence: "daily", daily: true, run: ingestSenateLda },
  usaspending: { label: "USAspending Contract Awards", cadence: "daily", daily: true, run: ingestUsaspending },
  fec_committees: { label: "FEC committee universe (members + top PACs)", cadence: "weekly", daily: true, run: ingestFecCommittees },
  fec_schedule_a: { label: "FEC Schedule A Contributions", cadence: "daily", daily: true, run: ingestFecScheduleA },
  sec_form4: { label: "SEC EDGAR Form 3/4/5 (ticker-scoped)", cadence: "daily", daily: true, run: ingestSecForm4 },
  twelvedata_eod: { label: "Twelve Data EOD Prices", cadence: "daily", daily: true, run: ingestTwelvedataEod },
  x_daily: { label: "Daily X thread of notable filings", cadence: "daily", daily: false, run: runXDaily },
  archive_backfill: { label: "Raw-filing archive backfill (unstored rows)", cadence: "on_demand", daily: false, run: runArchiveBackfill },
  citation_count: { label: "AI answer-engine citation count", cadence: "monthly", daily: false, run: ingestCitationCount },
  search_console_weekly: { label: "Search Console weekly export", cadence: "weekly", daily: false, run: ingestSearchConsoleWeekly },
};

async function runSource(code: string): Promise<void> {
  const entry = REGISTRY[code];
  if (!entry) {
    console.error(`✗ unknown source "${code}". Known: ${Object.keys(REGISTRY).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const sql = getDb();

  // Register source + open a run row.
  const [src] = await sql`
    insert into sources (code, label, cadence)
    values (${code}, ${entry.label}, ${entry.cadence})
    on conflict (code) do update set label = excluded.label
    returning id
  `;
  const [run] = await sql`
    insert into ingest_runs (source_id, status) values (${src!.id}, 'running')
    returning id
  `;

  try {
    const result = await entry.run();
    await sql`
      update ingest_runs
        set finished_at = now(), status = ${result.status},
            rows_seen = ${result.rowsSeen}, rows_changed = ${result.rowsChanged},
            error = ${result.error ?? null},
            stats = ${result.stats ? sql.json(result.stats as never) : null}
        where id = ${run!.id}
    `;
    console.log(`✓ ${code}: ${result.rowsSeen} seen, ${result.rowsChanged} written (${result.status})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The circuit breaker carries partial stats — persist them so the failed run
    // is diagnosable from the DB alone (ingest_runs is the diagnostic of record).
    const stats = err instanceof SystemicFailureError ? err.stats : null;
    await sql`
      update ingest_runs
        set finished_at = now(), status = 'failed', error = ${message},
            stats = ${stats ? sql.json(stats as never) : null}
        where id = ${run!.id}
    `;
    console.error(`✗ ${code} failed:`, message);
    process.exitCode = 1;
  }
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const toRun = requested.length > 0
  ? requested
  : Object.entries(REGISTRY).filter(([, e]) => e.daily).map(([code]) => code);

for (const code of toRun) {
  await runSource(code);
}
await closeDb();
