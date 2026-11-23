-- 0041 — one page per company, outside the tracked set too (stage 2d of "one page per company").
--
-- A company outside the tracked set can have several tickers on file: a symbol that changed, a
-- second share class, a unit or warrant, a typing mistake in a filing (158 companies on production,
-- 2026-11-23). Each ticker had its own on-demand page and the company had a third. Now:
--   * od_home_ticker(company): the one ticker whose page is the company's. The first of the
--     company's tickers in the SEC's list (sec_tickers, by rank) that is one of its securities;
--     with none, its main ticker; then an equity; then the oldest security. Null for a tracked
--     company (the static build decides those, lib/onepage.ts) and for a ticker that has an
--     active (static) page.
--   * od_stock_page(ticker): the ticker whose page shows a ticker (lower case). Itself, unless
--     the ticker's company has another home ticker whose page is that same company's.
--   * od_stock: a ticker that is not its own page answers as before plus "movedTo" (the Worker
--     redirects); the home ticker's page also lists the rows of the company's other securities,
--     and says "home": true. "siblings" now come in a fixed order, the page's own ticker first.
--   * od_company: "homeTicker", the page the Worker redirects /companies/<slug>/ to.
-- Nothing changes for the parity switch (p_any) or for tracked entities. No table changes.
-- The two entry points keep 0023's first line (the switch is closed to the API) and their settings.
--
-- Idempotent.

create or replace function od_home_ticker(p_company bigint) returns text
language sql stable set search_path = public, pg_temp as $$
  select s.ticker::text
    from securities s join companies c on c.id = s.company_id
    left join sec_tickers st on st.ticker = replace(upper(s.ticker::text), '.', '-') and st.cik = lpad(c.cik, 10, '0')
   where s.company_id = p_company and not c.tracked
     and not exists (select 1 from securities a where lower(a.ticker::text) = lower(s.ticker::text) and a.is_active)
   order by (st.rank is null), st.rank, (lower(s.ticker::text) = lower(c.primary_ticker::text)) desc, (s.type = 'equity') desc, s.id
   limit 1
$$;

create or replace function od_stock_page(p_ticker text) returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare v_co bigint; v_home text; v_home_co bigint;
begin
  if exists (select 1 from securities where lower(ticker::text) = lower(p_ticker) and is_active) then return lower(p_ticker); end if;
  select company_id into v_co from securities where lower(ticker::text) = lower(p_ticker) order by (type = 'equity') desc, id limit 1;
  if v_co is null then return lower(p_ticker); end if;
  v_home := od_home_ticker(v_co);
  if v_home is null or lower(v_home) = lower(p_ticker) then return lower(p_ticker); end if;
  -- the home ticker's page must be this same company's, or two pages could point at each other
  select company_id into v_home_co from securities where lower(ticker::text) = lower(v_home) order by (type = 'equity') desc, id limit 1;
  if v_home_co is distinct from v_co then return lower(p_ticker); end if;
  return lower(v_home);
end $$;

create or replace function od_stock(p_ticker text, p_any boolean default false, p_floor date default '2025-10-01')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_secs bigint[]; v_active boolean; v_ids bigint[]; v_total int; v_stats jsonb; v_list jsonb; v_comp jsonb; v_main securities%rowtype; v_page text; v_moved text; v_home boolean := false;
begin
  p_any := p_any and session_user <> 'authenticator';
  select exists (select 1 from securities where lower(ticker::text) = lower(p_ticker) and is_active) into v_active;
  if p_any <> v_active then return null; end if;
  select coalesce(array_agg(s.id order by (s.type = 'equity') desc, s.id), '{}') into v_secs
    from securities s where lower(s.ticker::text) = lower(p_ticker) and (not p_any or s.is_active);
  if coalesce(array_length(v_secs, 1), 0) = 0 then return null; end if;
  select * into v_main from securities where id = v_secs[1];
  -- One page per company (0041): outside the tracked set, a company's tickers share the page of its
  -- home ticker. Another ticker of the company answers with movedTo; the home ticker's page also
  -- lists the rows of the company's other securities.
  if not p_any then
    v_page := od_stock_page(p_ticker);
    if v_page <> lower(p_ticker) then
      v_moved := v_page;
    elsif v_main.company_id is not null then
      v_home := lower(coalesce(od_home_ticker(v_main.company_id), '')) = lower(p_ticker);
      select v_secs || coalesce(array_agg(s.id order by s.id), '{}') into v_secs from securities s
       where s.company_id = v_main.company_id and not (s.id = any (v_secs)) and od_stock_page(s.ticker::text) = v_page;
    end if;
  end if;

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
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ticker', s.ticker::text, 'type', s.type::text, 'name', s.name) order by array_position(v_secs, s.id)), '[]'::jsonb) into v_list from securities s where s.id = any (v_secs);
  select jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug::text, 'cik', c.cik, 'ticker', c.primary_ticker::text) into v_comp from companies c where c.id = v_main.company_id;

  return od_pack(v_ids, '{}', 150, p_any, p_floor) || jsonb_build_object(
    'kind', 'stock', 'entity', jsonb_build_object('ticker', v_main.ticker::text, 'type', v_main.type::text, 'name', v_main.name),
    'siblings', v_list, 'company', v_comp, 'stats', v_stats, 'truncated', v_total > 2500, 'movedTo', v_moved, 'home', v_home);
end $$;

create or replace function od_company(p_slug text, p_any boolean default false, p_floor date default '2025-10-01')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_c companies%rowtype; v_secs bigint[]; v_ids bigint[]; v_total int; v_stats jsonb; v_list jsonb; v_insiders int; v_home text;
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

  -- One page per company (0041): the ticker page that shows this company, when its home ticker's
  -- page is this company's (the Worker answers 301 to it).
  if not p_any then
    v_home := od_home_ticker(v_c.id);
    if v_home is not null and (select s.company_id from securities s where lower(s.ticker::text) = lower(v_home) order by (s.type = 'equity') desc, s.id limit 1) is distinct from v_c.id then v_home := null; end if;
  end if;

  return od_pack(v_ids, '{}', 150, p_any, p_floor) || jsonb_build_object(
    'kind', 'company', 'entity', jsonb_build_object('id', v_c.id, 'name', v_c.name, 'slug', v_c.slug::text, 'cik', v_c.cik, 'ticker', v_c.primary_ticker::text),
    'siblings', v_list, 'insiderCount', v_insiders, 'stats', v_stats, 'truncated', v_total > 2500, 'homeTicker', lower(v_home));
end $$;

-- New functions are closed to the API roles by default (0022). The two helpers are called by the
-- definer functions above and by the site build (the market sitemaps), never through the API.
revoke execute on function od_home_ticker(bigint), od_stock_page(text) from public, anon, authenticated;
revoke execute on function od_stock(text, boolean, date), od_company(text, boolean, date) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant execute on function od_home_ticker(bigint), od_stock_page(text) to site_build;
  end if;
end $$;
