-- 0039: executive pay from the SEC "Pay Versus Performance" tables (stage 1: stored, not yet shown).
--
-- Source `sec_exec_pay` (ingest/src/sources/sec_exec_pay.ts) reads four numeric tags of the `ecd`
-- (Executive Compensation Disclosure) taxonomy from the SEC XBRL frames API,
--   data.sec.gov/api/xbrl/frames/ecd/<Tag>/USD/CY<year>.json
-- one request per tag and calendar year, which returns the fact of every filer at once
-- (shared/src/execpay.ts holds the list):
--   peo_total             PeoTotalCompAmt                     principal executive officer, total pay
--   peo_actually_paid     PeoActuallyPaidCompAmt              principal executive officer, compensation actually paid
--   neo_avg_total         NonPeoNeoAvgTotalCompAmt            other named executives, average total pay
--   neo_avg_actually_paid NonPeoNeoAvgCompActuallyPaidAmt     other named executives, average compensation actually paid
--
-- One row is one figure for one company, measure and fiscal year. `fiscal_year_end` is the end of the
-- period the fact states; `frame` is the calendar frame the SEC placed it in (a fiscal year ending in
-- January sits in the previous calendar year's frame). Values are as filed: a negative "actually
-- paid" is kept. Rows are upserted by key, so a later run replaces the value and accession of a
-- restated figure. Only companies already in `companies` are stored.
--
-- A company with two principal executives in one year reports one fact per person under the same tag
-- with a dimension; frames do not serve dimensional facts, so those years have no figure here.
-- The executive's name (PeoName) is not stored.
--
-- Access (rules of 0022 and 0023): row-level security on, no policy and no grant to anon or
-- authenticated, so the table is closed to the API. The read-only build role `site_build` may read
-- it (the data is public). Idempotent.

create table if not exists exec_pay (
  cik             text    not null,     -- 10 digits, zero padded, as company_financials.cik
  measure         text    not null check (measure in ('peo_total', 'peo_actually_paid', 'neo_avg_total', 'neo_avg_actually_paid')),
  tag             text    not null,     -- ecd tag as filed, e.g. PeoTotalCompAmt
  fiscal_year_end date    not null,
  period_start    date,
  value           numeric not null,     -- US dollars, as filed
  accession       text    not null,
  frame           text    not null,     -- e.g. CY2024
  updated_at      timestamptz not null default now(),
  primary key (cik, measure, fiscal_year_end)
);

create index if not exists exec_pay_cik_year_idx on exec_pay (cik, fiscal_year_end desc);

alter table exec_pay enable row level security;

revoke all on exec_pay from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on exec_pay to site_build;
  end if;
end $$;
