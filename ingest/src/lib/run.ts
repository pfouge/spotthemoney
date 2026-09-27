// Per-run bookkeeping shared by every ingest job (gratisglobal lessons, adopted
// 2026-07-06):
//
//   - ingest_runs is the DIAGNOSTIC OF RECORD: jobs accumulate rich stats here and
//     the runner persists them to ingest_runs.stats (jsonb, migration 0004). When a
//     scheduled job looks stuck, query the DB, not the logs.
//   - PER-ROW QUARANTINE BEATS FAIL-FAST: one bad row must not kill a run — record
//     it and continue. But keep a CIRCUIT BREAKER: past `quarantineLimit` failures
//     the problem is systemic and the run aborts.
//   - Every paged fetch keeps a SEEN-SET: unordered upstream pagination has returned
//     duplicate rows in production; always request an explicit stable ORDER BY *and*
//     dedupe on a natural key.
//   - Long/async external work: submit-and-exit — persist the external job id in
//     stats (recordExternalJob) the moment it exists, so a timed-out run is
//     resumable, not restartable.

export class SystemicFailureError extends Error {
  constructor(
    message: string,
    public readonly stats: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SystemicFailureError";
  }
}

export interface QuarantinedRow {
  ref: string;
  reason: string;
}

export interface RunContext {
  rowsSeen: number;
  rowsChanged: number;
  /** Free-form counters/details; merged into ingest_runs.stats. */
  extra: Record<string, unknown>;
  /** Record a bad row and keep going; throws SystemicFailureError past the limit. */
  quarantine(ref: string, reason: string): void;
  /** Record a non-fatal warning (e.g. unknown Treasury tenor created a new series). */
  warn(message: string): void;
  /** Persist an external/async job id immediately so a timed-out run is resumable. */
  recordExternalJob(id: string): void;
  /** Seen-set dedupe for paged fetches. Returns false if the key was already seen. */
  markSeen(key: string): boolean;
  /** Snapshot for ingest_runs.stats. */
  stats(): Record<string, unknown>;
  quarantined: QuarantinedRow[];
  warnings: string[];
}

const QUARANTINE_SAMPLE_LIMIT = 20; // keep stats jsonb small; count everything, sample details

export function createRunContext(source: string, quarantineLimit = 50): RunContext {
  const quarantined: QuarantinedRow[] = [];
  let quarantineCount = 0;
  const warnings: string[] = [];
  const externalJobs: string[] = [];
  const seen = new Set<string>();

  const ctx: RunContext = {
    rowsSeen: 0,
    rowsChanged: 0,
    extra: {},
    quarantined,
    warnings,
    quarantine(ref, reason) {
      quarantineCount++;
      if (quarantined.length < QUARANTINE_SAMPLE_LIMIT) quarantined.push({ ref, reason });
      if (quarantineCount > quarantineLimit) {
        throw new SystemicFailureError(
          `${source}: ${quarantineCount} rows quarantined (limit ${quarantineLimit}) — treating as systemic failure`,
          ctx.stats(),
        );
      }
    },
    warn(message) {
      warnings.push(message);
      console.warn(`⚠ ${source}: ${message}`);
    },
    recordExternalJob(id) {
      externalJobs.push(id);
    },
    markSeen(key) {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    stats() {
      return {
        rows_seen: ctx.rowsSeen,
        rows_changed: ctx.rowsChanged,
        quarantined_count: quarantineCount,
        quarantined_sample: quarantined,
        warnings,
        ...(externalJobs.length > 0 ? { external_job_ids: externalJobs } : {}),
        ...ctx.extra,
      };
    },
  };
  return ctx;
}
