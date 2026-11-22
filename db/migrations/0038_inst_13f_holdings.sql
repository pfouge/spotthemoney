-- Institutional holdings from the SEC "Form 13F Data Sets" (stage 1: stored, not shown).
--
-- A Form 13F-HR is the quarterly report in which an institutional investment manager lists the
-- securities it held on the last day of the quarter. These tables hold, per manager and quarter,
-- the holdings of the securities of companies the site tracks. Nothing on the site reads them yet.
--
-- Source: ingest/src/sources/sec_13f_holdings.ts (on demand, from the unzipped data sets).
--   inst_managers         one row per filing manager (CIK as the SEC writes it, 10 digits).
--   inst_holdings         one row per period, manager, CUSIP and put/call ('' for the shares
--                         themselves). `value` is US dollars as filed (the SEC reports whole
--                         dollars from 2023-01-03; older thousands are multiplied by 1000 at load).
--                         `rows` is the number of lines of the filing summed into the row.
--   inst_holdings_loaded  which data sets have been read, so a re-run skips them.
--
-- Row-level security on, no policy, no API grants; site_build may read (see 0022 and 0023).

create table if not exists inst_managers (
  cik         text primary key check (cik ~ '^[0-9]{10}$'),
  name        text,
  updated_at  timestamptz not null default now()
);

create table if not exists inst_holdings (
  period       date not null,                 -- the quarter-end the report is about
  manager_cik  text not null,
  issuer_cik   text not null,                 -- companies.cik of the issuer, from the CUSIP map
  cusip        text not null,
  class_title  text,
  put_call     text not null default '',      -- '', 'PUT' or 'CALL'
  amount_type  text,                          -- 'SH' (shares) or 'PRN' (principal amount)
  shares       numeric,
  value        numeric,                       -- US dollars as filed
  accession    text not null,
  filed        date,
  rows         integer not null default 1,
  primary key (period, manager_cik, cusip, put_call)
);

create index if not exists inst_holdings_issuer_idx on inst_holdings (issuer_cik, period desc, value desc);
create index if not exists inst_holdings_manager_idx on inst_holdings (manager_cik, period desc);

create table if not exists inst_holdings_loaded (
  set_name     text primary key,
  loaded_at    timestamptz not null default now(),
  submissions  integer not null default 0,
  rows_read    bigint not null default 0,
  rows_kept    integer not null default 0,
  periods      text
);

alter table inst_managers enable row level security;
alter table inst_holdings enable row level security;
alter table inst_holdings_loaded enable row level security;

revoke all on inst_managers from anon, authenticated;
revoke all on inst_holdings from anon, authenticated;
revoke all on inst_holdings_loaded from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on inst_managers to site_build;
    grant select on inst_holdings to site_build;
    grant select on inst_holdings_loaded to site_build;
  end if;
end $$;
