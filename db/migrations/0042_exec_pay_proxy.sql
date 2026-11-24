-- 0042: executive pay read from each company's own proxy statement (stage 1: stored, not shown).
--
-- WHY. exec_pay (0039) is filled from the SEC XBRL frames API, which serves only facts that carry
-- no dimension. On 2026-11-24 it held a figure for 394 of the 998 companies with a page here, and a
-- principal executive's pay for 256: many companies tag that pay with the person it belongs to
-- (ecd:IndividualAxis), and frames leave those facts out.
--
-- Source `sec_proxy_pay` (ingest/src/sources/sec_proxy_pay.ts) reads, for each TRACKED company, the
-- newest definitive proxy statement (form DEF 14A) named in its SEC submissions file, finds the
-- "extracted XBRL instance document" in the filing's folder (<name>_htm.xml) and reads the same
-- four ecd tags as 0039 from it, with or without that dimension (ingest/src/lib/proxypay.ts).
--
-- One row is one figure for one company, measure, fiscal year and `seq`.
--   * A figure filed without a person dimension: one row, seq 0, dimensioned false. `persons` is
--     how many different people the same tag was ALSO filed for (0 when none).
--   * A principal executive's figure filed only per person: one row per person, seq 0, 1, ...,
--     largest value first, dimensioned true, `persons` = how many people that year.
-- The person a figure belongs to is NOT stored: no name, no member name, no PeoName.
-- Values are US dollars as filed (a negative "compensation actually paid" is real).
--
-- `exec_pay_proxy_checked` records when each company was last asked and what was found, so a
-- company with no proxy statement is not asked every day.
--
-- Nothing on the site reads these tables yet. exec_pay (0039) is unchanged.
--
-- Access (rules of 0022 and 0023): row-level security on, no policy and no grant to anon or
-- authenticated, so both tables are closed to the API. The read-only build role `site_build` may
-- read them (the data is public). Idempotent.

create table if not exists exec_pay_proxy (
  cik             text     not null,   -- 10 digits, zero padded, as exec_pay.cik
  measure         text     not null check (measure in ('peo_total', 'peo_actually_paid', 'neo_avg_total', 'neo_avg_actually_paid')),
  fiscal_year_end date     not null,
  seq             smallint not null default 0 check (seq >= 0),
  tag             text     not null,   -- ecd tag as filed, e.g. PeoTotalCompAmt
  period_start    date,
  value           numeric  not null,   -- US dollars, as filed
  persons         smallint not null default 0 check (persons >= 0),
  dimensioned     boolean  not null default false,
  accession       text     not null,
  filed           date     not null,
  updated_at      timestamptz not null default now(),
  primary key (cik, measure, fiscal_year_end, seq)
);

create index if not exists exec_pay_proxy_cik_year_idx on exec_pay_proxy (cik, fiscal_year_end desc);

create table if not exists exec_pay_proxy_checked (
  cik        text primary key,
  checked_at timestamptz not null,
  status     text not null check (status in ('ok', 'no_proxy', 'no_instance', 'no_facts', 'not_found')),
  accession  text,                      -- the newest proxy statement looked at
  filed      date,
  rows       integer not null default 0
);

alter table exec_pay_proxy enable row level security;
alter table exec_pay_proxy_checked enable row level security;

revoke all on exec_pay_proxy from anon, authenticated;
revoke all on exec_pay_proxy_checked from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on exec_pay_proxy to site_build;
    grant select on exec_pay_proxy_checked to site_build;
  end if;
end $$;
