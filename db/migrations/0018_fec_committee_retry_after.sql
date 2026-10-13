-- 0018 — set aside FEC committees whose Schedule A requests keep failing (2026-10-12).
--
-- The daily fec_schedule_a pass visits committees least-recently-checked first. A committee
-- whose request failed (the same few large committees answer HTTP 504 every day) was never
-- marked checked, so it stayed at the front of the queue and cost ~2.5 minutes of retries at
-- the start of every run — part of why the "money" ingest group hit its 55-minute limit on
-- 2026-10-09 and 10-10. Marking it checked instead would move its load-date floor forward and
-- skip the receipts in between, so a failure sets this column instead: the committee is left
-- out until then and keeps its donations_checked_at (and so its floor). Idempotent.
alter table committees add column if not exists donations_retry_after timestamptz;
