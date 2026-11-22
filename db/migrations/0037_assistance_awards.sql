-- Migration 0037: federal financial assistance awards (grants, direct payments, loans).
-- Stored by ingest/src/sources/usaspending_assistance.ts from the USAspending award search.
-- Stored, not shown: no page, file or feed reads this table yet.
-- A table of its own: contracts keeps its meaning (procurement) and its public read policy.
-- Closed to the API roles (0022/0023 rule); the build role may read it. Idempotent.

create table if not exists assistance_awards (
  id                  bigserial primary key,
  source_ref          text not null unique,          -- USAspending generated_internal_id
  award_id            text,                          -- the award's own id (FAIN / URI / loan number)
  kind                text not null check (kind in ('grant','direct_payment','loan','other')),
  award_type          text,                          -- as reported, e.g. "Project Grant"
  recipient           text not null,                 -- as returned; masked names are kept as returned
  recipient_uei       text,
  awarding_agency     text,
  awarding_sub_agency text,
  amount              numeric,                       -- Award Amount; for a loan, the Loan Value
  subsidy_cost        numeric,                       -- loans only
  start_date          date,                          -- a loan's issued date
  end_date            date,
  description         text,                          -- cut at 1,000 characters
  assistance_listing  text,                          -- assistance listing (CFDA) number and title, cut at 200
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists assistance_awards_start_idx on assistance_awards (start_date desc);
create index if not exists assistance_awards_recipient_idx on assistance_awards (lower(recipient));
create index if not exists assistance_awards_kind_start_idx on assistance_awards (kind, start_date desc);

alter table assistance_awards enable row level security;
revoke all on assistance_awards from anon, authenticated;
revoke all on sequence assistance_awards_id_seq from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on assistance_awards to site_build;
  end if;
end $$;
