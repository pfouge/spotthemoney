-- 0010 — FEC donations: pull by load date, rotate through committees, drop misdated rows
-- (2026-10-04). The first keyed run returned 16 receipts for 200 committees, most of them
-- typos dated 2035/2036: the job asked for receipts DATED in the last 30 days, and receipts
-- only reach the FEC when a committee files (quarterly for most), so the window was empty
-- apart from future-dated mistakes that sort first.

-- When each committee's receipts were last pulled. The job visits least-recently-checked
-- committees first and stops at its request budget, so ~735 committees fit inside the FEC's
-- 1,000-calls-an-hour key limit across runs instead of failing one run.
alter table committees add column if not exists donations_checked_at timestamptz;

-- Receipts dated in the future are filer typos; they made the page say "Last updated 2035".
delete from donations where donated_at > current_date;
