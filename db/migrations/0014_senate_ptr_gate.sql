-- 0014 — publish gate for Senate periodic transaction reports (Peter, 2026-10-06).
--
-- senate_ptr was the one filing source without a gate row (0009): nothing from it could go
-- public until a person approved the source. The first Senate import (177 reports received
-- since 2025-10-01, read from efdsearch.senate.gov in a browser session and loaded from
-- ingest/data/senate_ptr/) was checked against the Senate's own pages before this was written:
-- every electronic report's row count matches its table, and every amendment was matched to
-- the report it replaces. Pushing this migration is the approval.
--
-- As with the House: paper filings (needs_ocr, confidence 0.3, review pending) and reports
-- replaced by an amendment (no rows) are not affected — the function publishes only filings
-- with review auto_approved/approved and confidence >= 0.9.

insert into publish_gates (source, note) values
    ('senate_ptr', 'first import verified against eFD pages 2026-10-06; approved by Peter by pushing 0014')
on conflict (source) do nothing;

select publish_approved_filings();
