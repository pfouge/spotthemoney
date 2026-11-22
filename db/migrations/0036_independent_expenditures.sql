-- 0036: FEC independent expenditures (Schedule E), stored, not yet shown.
--
-- Source `fec_independent_expenditures` (ingest/src/sources/fec_independent_expenditures.ts) reads
-- OpenFEC GET /v1/schedules/schedule_e/ for the current two-year cycle: what a committee reports
-- spending, on its own and not coordinated with a campaign, to support or oppose a candidate. One
-- row is one reported expenditure (`sub_id` is the FEC's own line id). A 24- or 48-hour notice
-- (`is_notice`) and the later report that covers the same spending are separate lines at the FEC;
-- both are stored as filed and nothing here adds them together.
--
-- Everything is as filed: names are the committee's and candidate's as the FEC lists them, the
-- amount is the figure reported, `support_oppose` is the filer's S or O (NULL when the filing
-- gives none), `description` is the filer's text with white space collapsed and cut at 300
-- characters, `source_url` is the FEC's PDF address for the filing. A date that is not a real
-- calendar date, or lies in the future, is stored as NULL. Nothing is derived.
--
-- `person_id` links a candidate to a member of Congress only through the Bioguide ID: the
-- unitedstates/congress-legislators roster lists each member's FEC candidate ids, and the job maps
-- candidate id to Bioguide ID to people.bioguide_id. No match leaves NULL; names are never matched.
--
-- Access (rules of 0022 and 0023): row-level security on, no policy and no grant to anon or
-- authenticated, so the table is closed to the API. The read-only build role `site_build` may read
-- it (the data is public). Idempotent.

create table if not exists independent_expenditures (
  sub_id            text primary key,                       -- FEC line id
  committee_fec_id  text not null,
  committee_name    text,
  candidate_fec_id  text,
  candidate_name    text,
  candidate_office  text,                                   -- H, S or P as filed
  candidate_state   text,
  candidate_district text,
  candidate_party   text,
  person_id         bigint references people(id),           -- member of Congress, by Bioguide ID only
  support_oppose    text check (support_oppose in ('S', 'O')),
  amount            numeric,
  spent_at          date,                                   -- expenditure_date
  disseminated_at   date,                                   -- dissemination_date
  description       text,                                   -- cut at 300 characters
  payee_name        text,
  is_notice         boolean,
  source_url        text,                                   -- the FEC's pdf_url
  loaded_at         timestamptz not null default now()
);

create index if not exists independent_expenditures_candidate_idx
  on independent_expenditures (candidate_fec_id, spent_at desc);
create index if not exists independent_expenditures_person_idx
  on independent_expenditures (person_id, spent_at desc);
create index if not exists independent_expenditures_committee_idx
  on independent_expenditures (committee_fec_id);
create index if not exists independent_expenditures_spent_idx
  on independent_expenditures (spent_at desc);

alter table independent_expenditures enable row level security;

revoke all on independent_expenditures from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on independent_expenditures to site_build;
  end if;
end $$;
