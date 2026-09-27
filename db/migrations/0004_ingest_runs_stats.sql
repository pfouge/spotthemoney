-- 0004_ingest_runs_stats.sql
-- ingest_runs is the diagnostic of record (gratisglobal lesson, adopted 2026-07-06):
-- when a scheduled job looks stuck, query the DB, not the logs. Every job persists
-- rich run stats here — pages fetched, quarantined-row samples, warnings, external
-- job ids the moment they exist (so a timed-out run is resumable, not restartable),
-- and per-table row counts.
--
-- Additive only; 0001/0002/0003 untouched. NOTE: the integration contract §3.4
-- (IIF repo) should be updated to mention this column at the next IIF session —
-- recorded in CLAUDE.md SESSION STATE 2026-07-06.

alter table ingest_runs
  add column if not exists stats jsonb;
