// Shared domain types used across ingest + web.

/** A rate series definition (e.g. I-Bond composite, TIPS 10y, UST 10y). */
export interface RateSeries {
  id: number;
  code: string;
  label: string;
  source: string;
  source_ref: string | null;
  unit: string | null;
  frequency: string | null;
}

/** A single dated observation for a rate series. */
export interface RateObservation {
  series_id: number;
  obs_date: string; // ISO yyyy-mm-dd
  value: number | null;
  meta: Record<string, unknown> | null;
}

/**
 * I-Bond composite rate period, as published semi-annually by Treasury.
 * composite = fixed + (2 * semi_inflation) + (fixed * semi_inflation)
 */
export interface IBondRatePeriod {
  /** Date the rate period takes effect (yyyy-mm-dd). */
  effectiveDate: string;
  /** Fixed rate for bonds issued in this period, as a decimal fraction (0.013 = 1.3%). */
  fixedRate: number;
  /** Semiannual inflation rate, decimal fraction. */
  semiannualInflationRate: number;
  /** Composite (total) annualized rate, decimal fraction. */
  compositeRate: number;
}

/** Result of an ingest run, recorded for observability. */
export interface IngestRunResult {
  source: string;
  rowsSeen: number;
  rowsChanged: number;
  status: "success" | "failed" | "partial";
  error?: string;
  /**
   * Rich per-run diagnostics, persisted to ingest_runs.stats (jsonb, migration
   * 0004). ingest_runs is the diagnostic of record: include pages fetched,
   * quarantined-row counts + samples, warnings, external job ids, per-table
   * row counts — enough to debug a stuck run from the DB alone.
   */
  stats?: Record<string, unknown>;
}
