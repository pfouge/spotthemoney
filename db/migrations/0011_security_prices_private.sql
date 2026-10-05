-- 0011: stored stock prices are no longer publicly readable.
--
-- 0006 gave `security_prices` the same read-everything policy as the public reference tables.
-- The rows come from Twelve Data on an individual plan, whose terms allow internal use only, and
-- the site shows no prices (docs/04 #33, decided 2026-10-04: filings-only charts). Dropping the
-- policy leaves row-level security on with no policy, so the anon and authenticated API roles
-- read nothing; the build and ingest connect as the table owner and are unaffected.
-- The stored rows are kept. To undo: recreate the policy as written in 0006.
drop policy if exists public_read on security_prices;
