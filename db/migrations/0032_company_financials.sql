-- 0032: company financial-statement figures from the SEC XBRL "companyfacts" API (queue item 8,
-- "financials", stage 1: stored, not yet shown).
--
-- Source `sec_company_financials` (ingest/src/sources/sec_company_financials.ts) makes one request
-- per TRACKED company to data.sec.gov/api/xbrl/companyfacts/CIK<10 digits>.json and keeps a fixed
-- set of figures (shared/src/fundamentals.ts: revenue, net income, diluted EPS, cash from
-- operations, capital expenditure, total assets, liabilities, equity, cash, long-term debt) for
-- periods ending on or after FIN_FLOOR, from annual and quarterly reports (10-K, 10-Q, 20-F, 40-F
-- and their amendments).
--
-- One row is one figure for one concept, unit and period. `tag` is the taxonomy and tag the figure
-- was filed under (for example us-gaap:Revenues); a company that changed tags over the years has
-- rows with different tags for the same concept. `period_start` is NULL for a point-in-time
-- (balance sheet) figure. `form`, `fy`, `fp`, `filed` and `accession` describe the filing the value
-- was taken from: the newest filing that states the period, so a restated figure replaces the
-- original. `fy` and `fp` describe that filing, not the period.
--
-- `company_financials_checked` records when each company was last asked and what came back, so a
-- company with no facts is not asked again every day. A company's rows are replaced whole, in one
-- transaction, each time it is refreshed.
--
-- Access (rules of 0022 and 0023): row-level security on, no policy and no grant to anon or
-- authenticated, so both tables are closed to the API. The read-only build role `site_build` may
-- read them (the data is public). Idempotent.

create table if not exists company_financials (
  cik          text not null,           -- 10 digits, zero padded, as company_sic.cik
  concept      text not null,           -- key in shared/src/fundamentals.ts (revenue, net_income, ...)
  tag          text not null,           -- taxonomy:Tag as filed, e.g. us-gaap:Revenues, ifrs-full:Revenue
  unit         text not null,           -- USD, USD/shares, CNY, ...
  period_start date,                    -- NULL for an instant (balance sheet) figure
  period_end   date not null,
  value        numeric not null,
  form         text not null,           -- 10-K, 10-Q, 20-F, 40-F, with /A for amendments
  fy           integer,
  fp           text,
  filed        date not null,
  accession    text not null,
  updated_at   timestamptz not null default now()
);

create unique index if not exists company_financials_period_uq
  on company_financials (cik, concept, unit, coalesce(period_start, date '0001-01-01'), period_end);
create index if not exists company_financials_cik_concept_idx
  on company_financials (cik, concept, period_end desc);

create table if not exists company_financials_checked (
  cik          text primary key,
  checked_at   timestamptz not null,
  status       text not null check (status in ('ok', 'not_found', 'no_facts')),
  rows         integer not null default 0,
  newest_filed date
);

alter table company_financials enable row level security;
alter table company_financials_checked enable row level security;

revoke all on company_financials from anon, authenticated;
revoke all on company_financials_checked from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on company_financials to site_build;
    grant select on company_financials_checked to site_build;
  end if;
end $$;
