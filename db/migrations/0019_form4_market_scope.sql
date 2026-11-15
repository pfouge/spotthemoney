-- 0019 — market-wide Form 4: scope columns, promotion function, site-isolation views (2026-11-15).
--
-- Stage 1 of loading every Form 4 filed market-wide (SEC Insider Transactions Data Sets) WITHOUT
-- changing the built site. The site is near the Workers Free limit of 20,000 asset files, so no
-- market-wide row may reach the build until a later stage decides what gets a page.
--
--   filings.scope     'tracked' (the ~1,000 issuers the site follows, the default) or 'market'
--                     (filed for an issuer nobody tracks). Only sec_form4 rows are ever 'market'.
--   companies.tracked false for issuers created by the bulk load; true for everything else.
--   promote_market_scope()  a company with an active security becomes tracked, and its market
--                     filings become tracked. Run at the end of the bulk and daily sec_form4 jobs.
--   site_* views      THE ISOLATION RULE, in one place. Every build-time query reads these instead
--                     of the base tables. Stage 2 lifts the rule by redefining the five views as
--                     plain selects (see the end of this file); no page query needs to change.
--
-- Idempotent.

alter table filings   add column if not exists scope   text    not null default 'tracked';
alter table companies add column if not exists tracked boolean not null default true;

do $$ begin
  alter table filings add constraint filings_scope_check check (scope in ('tracked', 'market'));
exception when duplicate_object then null; end $$;

create index if not exists filings_source_scope_idx on filings (source, scope);

create or replace function promote_market_scope() returns integer
language plpgsql as $$
declare
    n integer;
begin
    update companies c
       set tracked = true
     where not c.tracked
       and exists (select 1 from securities s where s.company_id = c.id and s.is_active);
    update filings f
       set scope = 'tracked'
     where f.source = 'sec_form4' and f.scope = 'market'
       and exists (select 1 from companies c where c.id = f.filer_company_id and c.tracked)
       -- A filing that touches a security outside the active set (a second share class, say) stays
       -- market scope until that security is activated; site_securities hides it, and a visible
       -- transaction pointing at a hidden security would break the page build.
       and not exists (select 1 from transactions t join securities s on s.id = t.security_id
                        where t.filing_id = f.id and not s.is_active);
    get diagnostics n = row_count;
    return n;
end;
$$;

-- ── Isolation views ─────────────────────────────────────────────────────────────────────
-- security_invoker: the view runs with the caller's rights, so it cannot widen what the public
-- API role can read (views are otherwise owned by the migration role and skip row security).
-- Column lists are frozen at creation (select x.*); a column added to a base table later needs
-- a create or replace of the view.

create or replace view site_filings with (security_invoker = true) as
    select f.* from filings f
     where not (f.source = 'sec_form4' and f.scope = 'market');

create or replace view site_companies with (security_invoker = true) as
    select c.* from companies c where c.tracked;

-- A person is hidden when every filing they made is market scope. People with no filings at all
-- (roster rows) stay visible, as they always were.
create or replace view site_people with (security_invoker = true) as
    select p.* from people p
     where not (
         exists (select 1 from filings f where f.filer_person_id = p.id and f.source = 'sec_form4' and f.scope = 'market')
         and not exists (select 1 from filings f where f.filer_person_id = p.id and not (f.source = 'sec_form4' and f.scope = 'market'))
     );

-- A role at an untracked issuer is hidden (a tracked person can also file for a market issuer).
create or replace view site_person_roles with (security_invoker = true) as
    select r.* from person_roles r
     where r.company_id is null
        or exists (select 1 from companies c where c.id = r.company_id and c.tracked);

-- The site builds pages for active securities only. A security the bulk load creates is inactive
-- until it is promoted, which is what keeps market-only securities out.
create or replace view site_securities with (security_invoker = true) as
    select s.* from securities s where s.is_active;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on site_filings, site_companies, site_people, site_person_roles, site_securities from anon;
    revoke execute on function promote_market_scope() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on site_filings, site_companies, site_people, site_person_roles, site_securities from authenticated;
    revoke execute on function promote_market_scope() from authenticated;
  end if;
end $$;

-- To lift the rule in stage 2, a new migration redefines each view as `select x.* from <table> x`
-- (site_securities may keep its is_active filter) and drops the 'market' / tracked=false special cases.
