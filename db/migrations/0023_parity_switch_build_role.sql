-- 0023 — the parity switch is closed to the API, and a read-only role for site builds
-- (security audit follow-ups, 2026-11-17).
--
-- 1. od_insider, od_stock and od_company take p_any, the parity test's switch: with it a call
--    returns a TRACKED entity with the static build's visibility (approved rows whether or not
--    is_published). The Worker never sends it in production, but anyone holding the publishable
--    key could call the functions directly and send it. Each function now drops the switch when
--    the call arrives through the API (PostgREST connects as `authenticator`); a direct database
--    connection, which is what the parity test's local stand-in uses, keeps it. The bodies are
--    0020's with that one line added after `begin`; a later migration that rewrites one of these
--    functions must keep the line. p_floor is left alone: it only widens the date range of
--    published Form 4 filings, which are public records.
-- 2. site_build: a role that can read every table in public and write nothing, for the site
--    build (deploy, qa, publish). The build used the owner's connection string, so a pull
--    request built on QA ran with full rights to the database. The role is created without a
--    password and cannot log in until the owner gives it one:
--        alter role site_build with login password '...';
--    It is not a member of `authenticator`, so the API can never act as it. It bypasses
--    row-level security because the build reads tables that have no policy on purpose. It has
--    no grant on accounts, watchlists or watchlist_items. A table added later is readable by it
--    by default: a migration that adds a private table must revoke that.
--
-- Idempotent.

-- ── 1. the three entry points ────────────────────────────────────────────────────────────────
create or replace function od_insider(p_slug text, p_any boolean default false, p_floor date default '2025-10-01')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_p people%rowtype; v_static boolean; v_ids bigint[]; v_peer bigint[]; v_total int; v_stats jsonb; v_roles jsonb; v_colleagues jsonb; v_cids bigint[];
begin
  p_any := p_any and session_user <> 'authenticator';
  select * into v_p from people where slug = p_slug::citext;
  if not found then return null; end if;
  if exists (select 1 from person_roles r where r.person_id = v_p.id and r.role_kind = 'congress') then return null; end if;
  -- the static build makes a page for a person who is in site_people and holds an insider role in site_person_roles
  v_static := od_person_visible(v_p.id) and exists (
    select 1 from person_roles r where r.person_id = v_p.id and r.role_kind = 'insider'
       and (r.company_id is null or exists (select 1 from companies c where c.id = r.company_id and c.tracked)));
  if p_any <> v_static then return null; end if;
  if not p_any and not exists (select 1 from filings f where f.filer_person_id = v_p.id and f.source = 'sec_form4') then return null; end if;

  select count(*)::int into v_total from transactions t join filings f on f.id = t.filing_id
   where t.person_id = v_p.id and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor);
  select coalesce(array_agg(id order by ord), '{}') into v_ids from (
    select t.id, row_number() over (order by coalesce(t.disclosed_at, (f.filed_at at time zone 'UTC')::date) desc, t.id desc) as ord
      from transactions t join filings f on f.id = t.filing_id
     where t.person_id = v_p.id and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor)
     order by 2 limit 400) x;
  -- other filers' rows that could repeat one of these (same security, date, code and share count)
  select coalesce(array_agg(x.id), '{}') into v_peer from (
    select distinct t2.id
      from (select t.security_id, t.txn_date, t.txn_code, t.shares from transactions t where t.id = any (v_ids)) k
      join transactions t2 on t2.security_id = k.security_id and t2.txn_date = k.txn_date and t2.txn_code is not distinct from k.txn_code and t2.shares = k.shares
      join filings f2 on f2.id = t2.filing_id
     where t2.person_id is distinct from v_p.id
       and od_vis(t2.review, t2.confidence, f2.source, f2.review, f2.confidence, f2.filed_at, f2.is_published, f2.scope, p_any, p_floor)
     limit 2000) x;

  select jsonb_build_object(
      'rowCount', v_total,
      'filingCount', count(*), 'firstFiledAt', min(f.filed_at)::text, 'lastFiledAt', max(f.filed_at)::text,
      'newestUrl', (array_agg(f.source_url order by f.filed_at desc, f.id desc))[1])
    into v_stats
    from filings f where f.filer_person_id = v_p.id
     and od_vis('auto_approved', 1, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor);

  -- insider roles, in role order (the first is the one the page names)
  select coalesce(jsonb_agg(jsonb_build_object('companyId', r.company_id, 'title', r.officer_title, 'isDirector', r.is_director,
           'company', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug::text, 'ticker', c.primary_ticker::text, 'cik', c.cik) end) order by r.id), '[]'::jsonb),
         coalesce(array_agg(r.company_id) filter (where r.company_id is not null), '{}')
    into v_roles, v_cids
    from person_roles r left join companies c on c.id = r.company_id
   where r.person_id = v_p.id and r.role_kind = 'insider'
     and (not p_any or r.company_id is null or c.tracked);

  -- other insiders at the same companies, most rows first
  select coalesce(jsonb_agg(jsonb_build_array(c.id, c.full_name, c.slug::text, c.title, c.dir, c.n) order by c.n desc, c.full_name), '[]'::jsonb) into v_colleagues from (
    select o.id, o.full_name, o.slug, x.n, r1.officer_title as title, r1.is_director as dir
      from (select distinct r.person_id as id from person_roles r where r.company_id = any (v_cids) and r.role_kind = 'insider' and r.person_id <> v_p.id) k
      join people o on o.id = k.id
      cross join lateral (select count(*)::int as n from transactions t join filings f on f.id = t.filing_id
                           where t.person_id = o.id and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor)) x
      left join lateral (select pr.officer_title, pr.is_director from person_roles pr where pr.person_id = o.id and pr.role_kind = 'insider'
                          and (not p_any or pr.company_id is null or exists (select 1 from companies c2 where c2.id = pr.company_id and c2.tracked)) order by pr.id limit 1) r1 on true
     where x.n > 0 and o.slug is not null and (not p_any or od_person_visible(o.id))
     order by x.n desc, o.full_name limit 60) c;

  return od_pack(v_ids, v_peer, 150, p_any, p_floor) || jsonb_build_object(
    'kind', 'insider', 'entity', jsonb_build_object('id', v_p.id, 'name', v_p.full_name, 'slug', v_p.slug::text, 'cik', v_p.cik),
    'roles', v_roles, 'stats', v_stats, 'truncated', v_total > 400, 'colleagues', v_colleagues);
end $$;

create or replace function od_stock(p_ticker text, p_any boolean default false, p_floor date default '2025-10-01')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_secs bigint[]; v_active boolean; v_ids bigint[]; v_total int; v_stats jsonb; v_list jsonb; v_comp jsonb; v_main securities%rowtype;
begin
  p_any := p_any and session_user <> 'authenticator';
  select exists (select 1 from securities where lower(ticker::text) = lower(p_ticker) and is_active) into v_active;
  if p_any <> v_active then return null; end if;
  select coalesce(array_agg(s.id order by (s.type = 'equity') desc, s.id), '{}') into v_secs
    from securities s where lower(s.ticker::text) = lower(p_ticker) and (not p_any or s.is_active);
  if coalesce(array_length(v_secs, 1), 0) = 0 then return null; end if;
  select * into v_main from securities where id = v_secs[1];

  select count(*)::int into v_total from transactions t join filings f on f.id = t.filing_id
   where t.security_id = any (v_secs) and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor);
  select coalesce(array_agg(id order by ord), '{}') into v_ids from (
    select t.id, row_number() over (order by coalesce(t.disclosed_at, (f.filed_at at time zone 'UTC')::date) desc, t.id desc) as ord
      from transactions t join filings f on f.id = t.filing_id
     where t.security_id = any (v_secs) and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor)
     order by 2 limit 2500) x;

  select jsonb_build_object('rowCount', v_total, 'filingCount', count(distinct t.filing_id), 'firstFiledAt', min(f.filed_at)::text, 'lastFiledAt', max(f.filed_at)::text,
         'newestUrl', (array_agg(f.source_url order by f.filed_at desc, f.id desc))[1])
    into v_stats from transactions t join filings f on f.id = t.filing_id
   where t.security_id = any (v_secs) and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ticker', s.ticker::text, 'type', s.type::text, 'name', s.name)), '[]'::jsonb) into v_list from securities s where s.id = any (v_secs);
  select jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug::text, 'cik', c.cik, 'ticker', c.primary_ticker::text) into v_comp from companies c where c.id = v_main.company_id;

  return od_pack(v_ids, '{}', 150, p_any, p_floor) || jsonb_build_object(
    'kind', 'stock', 'entity', jsonb_build_object('ticker', v_main.ticker::text, 'type', v_main.type::text, 'name', v_main.name),
    'siblings', v_list, 'company', v_comp, 'stats', v_stats, 'truncated', v_total > 2500);
end $$;

create or replace function od_company(p_slug text, p_any boolean default false, p_floor date default '2025-10-01')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_c companies%rowtype; v_secs bigint[]; v_ids bigint[]; v_total int; v_stats jsonb; v_list jsonb; v_insiders int;
begin
  p_any := p_any and session_user <> 'authenticator';
  select * into v_c from companies where slug = p_slug::citext;
  if not found then return null; end if;
  if p_any <> v_c.tracked then return null; end if;
  select coalesce(array_agg(s.id order by s.id), '{}') into v_secs from securities s where s.company_id = v_c.id and (not p_any or s.is_active);

  select count(*)::int into v_total from transactions t join filings f on f.id = t.filing_id
   where t.security_id = any (v_secs) and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor);
  select coalesce(array_agg(id order by ord), '{}') into v_ids from (
    select t.id, row_number() over (order by coalesce(t.disclosed_at, (f.filed_at at time zone 'UTC')::date) desc, t.id desc) as ord
      from transactions t join filings f on f.id = t.filing_id
     where t.security_id = any (v_secs) and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor)
     order by 2 limit 2500) x;

  select jsonb_build_object('rowCount', v_total, 'filingCount', count(distinct t.filing_id), 'firstFiledAt', min(f.filed_at)::text, 'lastFiledAt', max(f.filed_at)::text,
         'newestUrl', (array_agg(f.source_url order by f.filed_at desc, f.id desc))[1])
    into v_stats from transactions t join filings f on f.id = t.filing_id
   where t.security_id = any (v_secs) and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ticker', s.ticker::text, 'type', s.type::text, 'name', s.name) order by s.id), '[]'::jsonb) into v_list from securities s where s.id = any (v_secs);
  -- people holding an insider role here (static: role holders who are in site_people)
  select count(distinct r.person_id)::int into v_insiders from person_roles r
   where r.company_id = v_c.id and r.role_kind = 'insider' and (not p_any or od_person_visible(r.person_id));

  return od_pack(v_ids, '{}', 150, p_any, p_floor) || jsonb_build_object(
    'kind', 'company', 'entity', jsonb_build_object('id', v_c.id, 'name', v_c.name, 'slug', v_c.slug::text, 'cik', v_c.cik, 'ticker', v_c.primary_ticker::text),
    'siblings', v_list, 'insiderCount', v_insiders, 'stats', v_stats, 'truncated', v_total > 2500);
end $$;

-- create or replace keeps grants; stated so the file stands alone.
revoke execute on function od_insider(text, boolean, date), od_stock(text, boolean, date), od_company(text, boolean, date) from public;

-- ── 2. read-only role for site builds ───────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'site_build') then
    create role site_build nologin bypassrls;
  end if;
end $$;
grant usage on schema public to site_build;
grant select on all tables in schema public to site_build;
alter default privileges in schema public grant select on tables to site_build;
-- The build reads public records only: never the account tables (the role bypasses row-level
-- security, so a grant there would expose every visitor's lists).
revoke all on accounts, watchlists, watchlist_items from site_build;
