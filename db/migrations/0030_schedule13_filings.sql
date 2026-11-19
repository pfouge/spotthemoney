-- 0030: SEC Schedules 13D and 13G (queue item 8, "13D/13G", stage 1: stored, not yet shown).
--
-- A Schedule 13D or 13G is the statement a person or group files with the SEC after coming to
-- own more than 5% of a class of a company's voting shares. 13D is the long form (it states a
-- purpose); 13G is the short form for passive and institutional holders. Both are statements of
-- what the filer says it owned on a date, not reports of trades. Since December 2024 they are
-- filed on EDGAR as XML. The source `sec_schedule13` (ingest/src/sources/sec_schedule13.ts)
-- reads the EDGAR daily index, takes every submission of type SCHEDULE 13D, 13D/A, 13G or 13G/A,
-- and stores one row per submission here.
--
-- A table of its own, not `filings` (see 0029 for the reasons). One row is one submission
-- (accession). An amendment is its own row; the form does not say which earlier statement it
-- replaces, and nothing here links them.
--
-- A statement can name several reporting persons, and members of a group commonly each report
-- the same combined holding. So `shares_owned` and `percent_of_class` are the LARGEST figures
-- any one reporting person states on the cover pages, never a sum; every person's own figures
-- are in `payload.persons`. Addresses, phone numbers, signatures and the form's legal
-- proceedings answers are not stored. `parser_version` lets a later parser fix re-read old rows.
--
-- Access (rules of 0022 and 0023): row-level security on, no policy and no grant to anon or
-- authenticated, so the table is closed to the API. The read-only build role `site_build` may
-- read it (the data is public). Idempotent.

create table if not exists schedule13_filings (
  id                bigserial primary key,
  accession         text not null unique,
  form_type         text not null check (form_type in ('SCHEDULE 13D', 'SCHEDULE 13D/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A')),
  schedule          text not null check (schedule in ('13D', '13G')),
  is_amendment      boolean not null default false,
  filed_at          date not null,
  issuer_cik        text,            -- 10 digits, as companies.cik
  issuer_name       text,
  issuer_cusip      text,
  security_class    text,
  event_date        date,            -- "date of event which requires filing of this statement"
  filer_cik         text,            -- the submission's filer, 10 digits
  reporter_name     text,            -- first reporting person named on the cover pages
  reporter_count    integer not null default 0,
  shares_owned      numeric,         -- largest aggregate amount any one reporting person states
  percent_of_class  numeric,         -- largest percent of class any one reporting person states
  rules             text[] not null default '{}',   -- 13G: the rule(s) the schedule is filed under
  payload           jsonb not null default '{}'::jsonb,
  source_url        text,
  parser_version    integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists schedule13_filings_issuer_idx on schedule13_filings (issuer_cik, filed_at desc);
create index if not exists schedule13_filings_filed_idx on schedule13_filings (filed_at desc);

alter table schedule13_filings enable row level security;

revoke all on schedule13_filings from anon, authenticated;
revoke all on sequence schedule13_filings_id_seq from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on schedule13_filings to site_build;
  end if;
end $$;
