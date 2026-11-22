-- 0031: who owns a ticker (2026-11-22, parity queue item h0).
--
-- THE FAULT. A security is found by its ticker alone (unique (ticker, type)), and the Form 4
-- write path points it at the company of whichever filing named that ticker last. A fund or
-- spin-off whose insider filings carry no trading symbol ("NONE", "N/A") falls back to the
-- symbol of the tracked company the filing was fetched for, so on 2026-11-20 thirteen tickers
-- were the main ticker of two or three companies with a page, and for two of them the security
-- itself belonged to the wrong company: KKR to "KKR Real Estate Select Trust Inc." in place of
-- KKR & Co. Inc., IVZ to "Invesco Real Estate Income Trust Inc." in place of Invesco Ltd.
--
-- THE REFERENCE. The SEC publishes which filer each exchange ticker belongs to
-- (www.sec.gov/files/company_tickers.json; the daily sec_form4 job already resolves its tickers
-- with it). Source `sec_company_tickers` stores that list here once a day.
--
-- THE REPAIR. repair_ticker_owners() puts two things right, and only for what the static site
-- shows (active securities, tracked companies):
--   1. an active equity security whose ticker the SEC lists under another company the site
--      tracks is pointed at that company;
--   2. a tracked company loses a main ticker that is another company's active security, unless the
--      SEC lists the ticker under this very company.
-- Every change is written to ticker_owner_changes first, with the old value, so it can be put
-- back by hand. It changes no filing and no transaction. Which rows a stock page shows is decided at build
-- time (web/src/lib/issuer.ts). The job runner calls it after every run, because the write
-- path (sec_form4.ts, not changed here) can undo either step with the next filing it stores.
-- Each step refuses to act when it would change more than 40 rows: the list is then not what
-- this function expects, and a person should look first.
--
-- Idempotent.

create table if not exists sec_tickers (
    ticker      text primary key,            -- upper case, as the SEC lists it (BRK-B, not BRK.B)
    cik         text not null,               -- 10 digits, zero-padded, as companies.cik
    title       text,                        -- the SEC's name for the filer
    rank        integer,                     -- position in the SEC's file (0 = first)
    origin      text not null default 'sec', -- 'sec' = from the file; 'seed' = written by a migration
    checked_at  timestamptz not null default now()
);
create index if not exists sec_tickers_cik_idx on sec_tickers (cik);

-- Read by the owner's connection (ingest) and the build role only; no public policy.
alter table sec_tickers enable row level security;
revoke all on sec_tickers from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on sec_tickers to site_build;
  end if;
end $$;

-- What the repair changed, and what was there before.
create table if not exists ticker_owner_changes (
    id             bigint generated always as identity primary key,
    changed_at     timestamptz not null default now(),
    kind           text not null check (kind in ('security_company', 'company_ticker')),
    ticker         text not null,
    security_id    bigint,
    company_id     bigint,                   -- company_ticker: the company that lost the main ticker
    old_company_id bigint,                   -- security_company: the company the security was with
    new_company_id bigint                    -- security_company: the company it is with now
);
alter table ticker_owner_changes enable row level security;
revoke all on ticker_owner_changes from anon, authenticated;
revoke all on sequence ticker_owner_changes_id_seq from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    revoke all on ticker_owner_changes from site_build;
  end if;
end $$;

create or replace function repair_ticker_owners() returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
    cap constant integer := 40;
    n_sec integer := 0;
    n_co  integer := 0;
    moved jsonb := '[]'::jsonb;
    cleared jsonb := '[]'::jsonb;
    skipped jsonb := '[]'::jsonb;
begin
    -- 1. Securities the SEC lists under another tracked company.
    create temp table _tk_move on commit drop as
    select s.id as security_id, upper(s.ticker::text) as ticker, s.company_id as old_company_id, c.id as new_company_id
      from securities s
      join sec_tickers st on st.ticker = replace(upper(s.ticker::text), '.', '-')
      join companies c on lpad(c.cik, 10, '0') = st.cik and c.tracked
     where s.type = 'equity' and s.is_active
       and s.company_id is distinct from c.id;
    select count(*) into n_sec from _tk_move;
    if n_sec > cap then
        skipped := skipped || jsonb_build_array(format('securities: %s would move, more than %s; nothing moved', n_sec, cap));
        n_sec := 0;
    elsif n_sec > 0 then
        select coalesce(jsonb_agg(ticker order by ticker), '[]'::jsonb) into moved from _tk_move;
        insert into ticker_owner_changes (kind, ticker, security_id, old_company_id, new_company_id)
        select 'security_company', ticker, security_id, old_company_id, new_company_id from _tk_move;
        update securities s set company_id = m.new_company_id, updated_at = now()
          from _tk_move m where s.id = m.security_id;
    end if;

    -- 2. Tracked companies whose main ticker is another company's security.
    create temp table _tk_clear on commit drop as
    select c.id as company_id, upper(c.primary_ticker::text) as ticker
      from companies c
     where c.tracked and c.primary_ticker is not null
       and exists (select 1 from securities s
                    where s.type = 'equity' and s.is_active and s.ticker = c.primary_ticker
                      and s.company_id is not null and s.company_id <> c.id)
       and not exists (select 1 from securities s2
                        where s2.company_id = c.id and s2.ticker = c.primary_ticker)
       and not exists (select 1 from sec_tickers st
                        where st.ticker = replace(upper(c.primary_ticker::text), '.', '-')
                          and st.cik = lpad(c.cik, 10, '0'));
    select count(*) into n_co from _tk_clear;
    if n_co > cap then
        skipped := skipped || jsonb_build_array(format('companies: %s would lose a main ticker, more than %s; nothing cleared', n_co, cap));
        n_co := 0;
    elsif n_co > 0 then
        select coalesce(jsonb_agg(ticker order by ticker), '[]'::jsonb) into cleared from _tk_clear;
        insert into ticker_owner_changes (kind, ticker, company_id)
        select 'company_ticker', ticker, company_id from _tk_clear;
        update companies c set primary_ticker = null, updated_at = now()
          from _tk_clear x where c.id = x.company_id;
    end if;

    drop table if exists _tk_move;
    drop table if exists _tk_clear;
    return jsonb_build_object('securities_moved', n_sec, 'moved', moved,
                              'tickers_cleared', n_co, 'cleared', cleared, 'skipped', skipped);
end;
$$;

revoke all on function repair_ticker_owners() from public;
revoke all on function repair_ticker_owners() from anon, authenticated;

-- The two securities known to be with the wrong company, so the first build after this
-- migration is right without waiting for the first run of the source. The SEC numbers are the
-- companies' own (KKR & Co. Inc. 1404912, Invesco Ltd. 914208), as stored in `companies`.
-- The source replaces these rows with the SEC's on its first run.
insert into sec_tickers (ticker, cik, title, origin)
select v.ticker, v.cik, v.title, 'seed'
  from (values ('KKR', '0001404912', 'KKR & Co. Inc.'), ('IVZ', '0000914208', 'Invesco Ltd.')) as v(ticker, cik, title)
 where exists (select 1 from companies c where lpad(c.cik, 10, '0') = v.cik)
on conflict (ticker) do nothing;

select repair_ticker_owners();
