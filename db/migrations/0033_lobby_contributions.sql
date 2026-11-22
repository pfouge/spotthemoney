-- 0033: LD-203 lobbyist contribution reports from the Senate's lobbying disclosure API
-- (queue item 8, "lobbying contributions", stage 1: stored, not yet shown).
--
-- Source `senate_lda_contributions` (ingest/src/sources/senate_lda_contributions.ts) reads
-- https://lda.gov/api/v1/contributions/ newest first. A filing is one LD-203 report: either a
-- registered lobbyist's own report or an organization's, for a mid-year or year-end period. It
-- lists the contributions the filer made, or says there were none (`no_contributions`).
--
-- `lobby_contribution_filings`: one row per filing_uuid. `lobbyist_name` is the lobbyist's name as
-- the API prints it (NULL for an organization filing). `pacs` are the PAC names the filing lists.
-- `source_url` is the public filing document when the API gives one, else the API detail URL.
-- `item_count` is the number of items stored for the filing. An amendment is a new filing_uuid and
-- is NOT linked to the report it amends: both are stored as filed.
--
-- `lobby_contribution_items`: one row per contribution line (`seq` = position in the filing).
-- Names are stored as filed: the honoree and payee are NOT matched to members of Congress,
-- committees or candidates here. A filing's items are replaced in one transaction when it is read
-- again. `amount` is NULL when the filing's figure is not a number; `contributed_at` is NULL when
-- the date is missing, not a real calendar date, or in the future.
--
-- Both tables: row-level security on, no policy, no grant to the API roles; site_build may read.

create table if not exists lobby_contribution_filings (
  filing_uuid      text primary key,
  filing_type      text,
  filing_year      integer,
  filing_period    text,
  filer_type       text,
  registrant_id    bigint,
  registrant_name  text,
  lobbyist_name    text,
  no_contributions boolean not null default false,
  pacs             text[] not null default '{}',
  posted_at        timestamptz,
  source_url       text,
  item_count       integer not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists lobby_contribution_items (
  id                bigserial primary key,
  filing_uuid       text not null references lobby_contribution_filings(filing_uuid) on delete cascade,
  seq               integer not null,
  contribution_type text,
  contributor_name  text,
  payee_name        text,
  honoree_name      text,
  amount            numeric,
  contributed_at    date,
  unique (filing_uuid, seq)
);

create index if not exists lobby_contribution_filings_posted_idx on lobby_contribution_filings (posted_at desc);
create index if not exists lobby_contribution_filings_year_idx on lobby_contribution_filings (filing_year);
create index if not exists lobby_contribution_items_honoree_idx on lobby_contribution_items (lower(honoree_name));
create index if not exists lobby_contribution_items_payee_idx on lobby_contribution_items (lower(payee_name));
create index if not exists lobby_contribution_items_date_idx on lobby_contribution_items (contributed_at);

alter table lobby_contribution_filings enable row level security;
alter table lobby_contribution_items enable row level security;
revoke all on lobby_contribution_filings from anon, authenticated;
revoke all on lobby_contribution_items from anon, authenticated;
revoke all on sequence lobby_contribution_items_id_seq from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on lobby_contribution_filings to site_build;
    grant select on lobby_contribution_items to site_build;
  end if;
end $$;
