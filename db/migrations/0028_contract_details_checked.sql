-- 0028: remember when an award's details were last asked for by award id.
--
-- The contracts job stores description, sub-agency and end date for the awards its searches
-- return (0027). Awards stored by earlier runs that the searches no longer return never got
-- them. The source `usaspending_details` (ingest/src/sources/usaspending_details.ts) asks
-- USAspending for each such award by its id and fills the blanks. This column records that an
-- award was asked for, so an award USAspending has no description for (or no longer knows) is
-- not asked for again every day.
--
-- NULL = never asked by id. `contracts` keeps its row-level security and its read policy;
-- column grants follow the table's. Idempotent.

alter table contracts add column if not exists details_checked_at timestamptz;
