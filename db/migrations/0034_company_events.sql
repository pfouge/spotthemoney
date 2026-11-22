-- 0034: company events, Form 8-K and 8-K/A filings with their item codes (stage 1: stored, not
-- yet shown).
--
-- Source `sec_company_events` (ingest/src/sources/sec_company_events.ts) makes one request per
-- TRACKED company to data.sec.gov/submissions/CIK<10 digits>.json, reads `filings.recent` only,
-- and keeps the filings whose form is exactly 8-K or 8-K/A and that were filed on or after
-- EVENTS_FLOOR (shared/src/events8k.ts).
--
-- One row is one filing, keyed by accession number. `items` are the SEC's item numbers as text
-- ("2.02", "9.01"); the official titles are in shared/src/events8k.ts. A later read updates
-- `items` when they changed; a row is never deleted. `source_url` points at the primary
-- document when the SEC names one, else at the filing folder.
--
-- `company_events_checked` records when each company was last asked, so a company with no 8-K
-- is not treated as never asked. status is ok or not_found (HTTP 404).
--
-- Access (rules of 0022 and 0023): row-level security on, no policy and no grant to anon or
-- authenticated, so both tables are closed to the API. The read-only build role `site_build`
-- may read them (the data is public). Idempotent.

create table if not exists company_events (
  accession        text primary key,
  cik              text not null,           -- 10 digits, zero padded, as company_sic.cik
  form             text not null,           -- 8-K or 8-K/A
  filed            date not null,
  report_date      date,
  accepted_at      timestamptz,
  items            text[] not null default '{}',
  primary_document text,
  source_url       text,
  created_at       timestamptz not null default now()
);

create index if not exists company_events_cik_filed_idx on company_events (cik, filed desc);
create index if not exists company_events_filed_idx on company_events (filed desc);
create index if not exists company_events_items_idx on company_events using gin (items);

create table if not exists company_events_checked (
  cik          text primary key,
  checked_at   timestamptz not null,
  status       text not null check (status in ('ok', 'not_found')),
  events       integer not null default 0,
  newest_filed date
);

alter table company_events enable row level security;
alter table company_events_checked enable row level security;

revoke all on company_events from anon, authenticated;
revoke all on company_events_checked from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on company_events to site_build;
    grant select on company_events_checked to site_build;
  end if;
end $$;
