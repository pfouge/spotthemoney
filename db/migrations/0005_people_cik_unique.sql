-- 0005_people_cik_unique.sql
-- Contract §3.1 upserts insider people rows on owner CIK, but 0001 declared
-- people.cik as plain text with no uniqueness. Additive fix: partial unique
-- index (politicians have NULL cik and are unaffected). Partial per the 0003
-- convention so legacy/manual rows never block.
--
-- NOTE: the integration contract §5 (IIF repo) should list this migration at the
-- next IIF session — recorded in CLAUDE.md SESSION STATE 2026-07-06.

create unique index if not exists people_cik_key
  on people (cik) where cik is not null;
