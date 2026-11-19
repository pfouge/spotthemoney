-- 0027: three more facts about each federal contract award, as USAspending reports them.
--
-- The contracts job (ingest/src/sources/usaspending.ts) has asked the award search for
-- "Awarding Sub Agency", "End Date" and "Description" since it was written, and thrown the
-- answers away: the table had no column for them. This adds the columns. The job fills them on
-- its next full sweep of the window (it forces one the first time it runs with this code).
--
--   awarding_sub_agency  the part of the agency that made the award ("Department of the Navy"
--                        under the Department of Defense), in USAspending's wording
--   end_date             the date the work is currently due to end; it moves when a contract
--                        is extended or cut short
--   description          the award's description as the agency entered it (the job collapses
--                        white space and stores at most 1,000 characters)
--
-- All three are nullable and stay NULL for a row until the job has re-read that award.
-- `contracts` keeps its row-level security and its public read policy (0006); column grants
-- follow the table's, so nothing else changes for the API roles or for site_build.
-- Idempotent.

alter table contracts add column if not exists awarding_sub_agency text;
alter table contracts add column if not exists end_date date;
alter table contracts add column if not exists description text;
