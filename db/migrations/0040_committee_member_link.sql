-- 0040: link a member's campaign committee to the member.
--
-- The `fec_committees` job (ingest/src/sources/fec_committees.ts) already loads each sitting
-- member's principal campaign committee from OpenFEC /candidates/search/. That answer names the
-- FEC candidate id of the member, and this migration gives `committees` two columns to keep it:
-- `candidate_fec_id` (the FEC's id for the candidate, for example H4PA00001) and `person_id`
-- (the member's row in `people`).
--
-- The link is made only through ids. The unitedstates/congress-legislators roster lists each
-- member's FEC candidate ids and Bioguide ID; the job maps candidate id to Bioguide ID to
-- people.bioguide_id. Committee and candidate names are never compared, so a similar name can
-- never attach a committee to the wrong member. No match leaves both columns NULL, and a later
-- run never replaces a stored value with NULL. A committee that is not a member's principal
-- committee (a PAC) keeps both columns empty.
--
-- Access is unchanged: `committees` keeps its public read policy and its grants, and the new
-- columns carry public data only. Idempotent.

alter table committees
  add column if not exists candidate_fec_id text,
  add column if not exists person_id bigint references people(id) on delete set null;

create index if not exists committees_person_idx on committees (person_id) where person_id is not null;
