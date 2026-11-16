-- 0020 — pages on demand for entities outside the tracked set (stage 3a, 2026-11-16).
--
-- The Worker renders /insiders/<slug>/, /stocks/<ticker>/ and /companies/<slug>/ when one is
-- requested and no prerendered file exists (the tracked set is still built as static pages). It
-- reads Supabase with the publishable key only, and the anon role has no SELECT on the record
-- tables, so the Worker calls ONE definer-rights function per page that returns everything the
-- page needs as a single json document. Same shape as public_watchlist (0017).
--
--   od_insider(slug), od_stock(ticker), od_company(slug)   public entry points (anon may call)
--   od_pack(...), od_vis(...), od_person_visible(...)       private helpers (no public execute)
--
-- Rules the functions apply are the site's own, so a page built here shows what the same entity
-- would show on a static page: Form 4 filings only, review approved or auto-approved with
-- confidence >= 0.9 (row and filing), filed on or after the Form 4 floor, and (outside the
-- parity switch) is_published, which is what row-level security says anon may read.
--
-- A function returns NULL for an entity that does not exist or that is in the tracked set. A tracked
-- entity is a static page; the Worker must never render one in production. The one exception is
-- p_any = true, used only by the parity test (scripts/verify-od.mjs): it returns a TRACKED entity,
-- with exactly the visibility the static build has (site_* views: no market-scope filings, no
-- untracked companies), so the on-demand rendering can be compared with the static page. The Worker
-- sends p_any only when OD_PARITY=1 AND the request is addressed to a loopback host (see
-- web/src/lib/server/odsource.ts); production sets neither.
--
-- Row caps: an insider's newest 400 rows, a stock's or company's newest 2,500, with the true totals
-- alongside ("stats"). Rows are packed as arrays (column names in "columns") to keep the document
-- small: the Worker's CPU budget is 10 ms a request on the free plan.
--
-- Also here: execute on promote_market_scope() and publish_approved_filings() was granted to PUBLIC
-- by default (0019 revoked only anon and authenticated by name, which PUBLIC still covers). The
-- ingest and Python jobs connect as the database owner and keep access.
--
-- Idempotent. Session time zone is pinned to UTC inside the functions: filed_at is a timestamptz
-- and the site renders its text form in UTC (Supabase's default).

-- The four heavy functions run with hash and merge joins off: every query in them is a short list of ids
-- joined to filings by primary key, and on a million-row table the planner's hash join (a scan of ALL
-- filings) cost 3 to 4 times what the index probes do (measured, see the stage 3a report).

-- ── helpers ─────────────────────────────────────────────────────────────────────────────────
create index if not exists transactions_security_disclosed_idx on transactions (security_id, disclosed_at desc);
create index if not exists transactions_person_disclosed_idx   on transactions (person_id, disclosed_at desc);
create index if not exists transactions_security_txn_date_idx  on transactions (security_id, txn_date);
create index if not exists filings_filer_company_idx           on filings (filer_company_id);
create index if not exists person_roles_company_kind_idx       on person_roles (company_id, role_kind);
create index if not exists securities_lower_ticker_idx         on securities (lower(ticker::text));

-- The site's publishing bar for one Form 4 row (flagship.ts), as one expression.
create or replace function od_vis(t_review review_status, t_conf numeric, f_source filing_source, f_review review_status, f_conf numeric,
                                  f_filed timestamptz, f_pub boolean, f_scope text, p_any boolean, p_floor date)
returns boolean language sql immutable as $$
  select f_source = 'sec_form4'
     and t_review in ('auto_approved', 'approved') and t_conf >= 0.9
     and f_review in ('auto_approved', 'approved') and f_conf >= 0.9
     and f_filed is not null and (f_filed at time zone 'UTC')::date >= p_floor
     and case when p_any then f_scope <> 'market' else f_pub end
$$;

-- site_people: a person is hidden when every filing they made is market scope.
create or replace function od_person_visible(p_id bigint) returns boolean language sql stable as $$
  select not (
    exists (select 1 from filings f where f.filer_person_id = p_id and f.source = 'sec_form4' and f.scope = 'market')
    and not exists (select 1 from filings f where f.filer_person_id = p_id and not (f.source = 'sec_form4' and f.scope = 'market'))
  )
$$;

-- Packs the rows of one page: p_ids are transaction ids in display order, p_peer_ids are other filers'
-- rows that may repeat one of them (the joint-filing rule), p_foot_n is how many of the first rows get
-- their filing's footnotes. Everything is read through the same visibility rule as the id lists.
create or replace function od_pack(p_ids bigint[], p_peer_ids bigint[], p_foot_n int, p_any boolean, p_floor date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_rows jsonb; v_peers jsonb; v_filings jsonb; v_people jsonb; v_secs jsonb; v_ref jsonb; v_foot jsonb;
  v_all bigint[] := p_ids || p_peer_ids;
  v_n int := coalesce(array_length(p_ids, 1), 0);
  v_fids bigint[]; v_pids bigint[]; v_sids bigint[];
begin
  -- one row per transaction: [id, filing_id, person_id, security_id, side, code, is_derivative, txn_date, disclosed_at,
  --   amount_low, amount_high, shares, price, lag_days, is_10b5_1, owner_type, asset_type, owned_after]
  select coalesce(jsonb_agg(x.row order by x.ord) filter (where x.ord <= v_n), '[]'::jsonb),
         coalesce(jsonb_agg(x.row order by x.ord) filter (where x.ord > v_n), '[]'::jsonb)
    into v_rows, v_peers
    from (
      with o as (
        select y.id, (row_number() over (partition by y.filing_id order by y.id) - 1)::int as n
          from transactions y where y.filing_id in (select filing_id from transactions where id = any (v_all))
      )
      select u.ord::int as ord, jsonb_build_array(
          t.id, t.filing_id, t.person_id, t.security_id, t.side::text, t.txn_code, t.is_derivative, t.txn_date::text, t.disclosed_at::text,
          t.amount_low::float8, t.amount_high::float8, t.shares::float8, t.price::float8, t.disclosure_lag_days, t.is_10b5_1, t.owner_type, t.asset_type,
          case when (f.payload->'transactions'->o.n->>'shares') ~ '^[0-9]+(\.[0-9]+)?$'
                and (f.payload->'transactions'->o.n->>'shares')::float8 = t.shares::float8
                and (f.payload->'transactions'->o.n->>'sharesOwnedAfter') ~ '^[0-9]+(\.[0-9]+)?$'
               then (f.payload->'transactions'->o.n->>'sharesOwnedAfter')::float8 end) as row
        from unnest(v_all) with ordinality u(id, ord)
        join transactions t on t.id = u.id join filings f on f.id = t.filing_id join o on o.id = t.id
    ) x;

  -- id lists as arrays: with a subquery the planner cannot know how few ids there are and scans whole tables
  select array(select distinct (e->>1)::bigint from jsonb_array_elements(v_rows || v_peers) e),
         array(select distinct (e->>2)::bigint from jsonb_array_elements(v_rows) e where e->>2 is not null),
         array(select distinct (e->>3)::bigint from jsonb_array_elements(v_rows) e where e->>3 is not null)
    into v_fids, v_pids, v_sids;

  -- filings: id -> [source_url, filed_at, is_published, accession]
  select coalesce(jsonb_object_agg(f.id::text, jsonb_build_array(f.source_url, f.filed_at::text, f.is_published, f.external_id)), '{}'::jsonb) into v_filings
    from filings f where f.id = any (v_fids);

  -- filers on the page: id -> [name, slug, officer title, is_director] (first insider role)
  select coalesce(jsonb_object_agg(p.id::text, jsonb_build_array(p.full_name, p.slug::text, r.officer_title, r.is_director)), '{}'::jsonb) into v_people
    from people p left join lateral (
      select pr.officer_title, pr.is_director from person_roles pr
       where pr.person_id = p.id and pr.role_kind = 'insider'
         and (not p_any or pr.company_id is null or exists (select 1 from companies c where c.id = pr.company_id and c.tracked))
       order by pr.id limit 1) r on true
   where p.id = any (v_pids);

  -- securities: id -> [ticker, type, name, company_id, is_active]
  select coalesce(jsonb_object_agg(s.id::text, jsonb_build_array(s.ticker::text, s.type::text, s.name, s.company_id, s.is_active)), '{}'::jsonb) into v_secs
    from securities s where s.id = any (v_sids);

  -- typical price per security: median of its open-market non-derivative Form 4 prices (flagship.ts refPrice)
  select coalesce(jsonb_object_agg(sid::text, (a[(n + 1) / 2] + a[(n + 2) / 2]) / 2), '{}'::jsonb) into v_ref
    from (select t.security_id as sid, array_agg(t.price::float8 order by t.price::float8) as a, count(*)::int as n
            from transactions t join filings f on f.id = t.filing_id
           where t.security_id = any (v_sids)
             and t.txn_code in ('P', 'S') and t.is_derivative is not true and t.price > 0
             and od_vis(t.review, t.confidence, f.source, f.review, f.confidence, f.filed_at, f.is_published, f.scope, p_any, p_floor)
           group by 1) m;

  -- footnotes of the filings behind the first p_foot_n rows: filing id -> raw footnote array
  select coalesce(jsonb_object_agg(f.id::text, f.payload->'footnotes'), '{}'::jsonb) into v_foot
    from filings f
   where f.id in (select (e.v->>1)::bigint from jsonb_array_elements(v_rows) with ordinality e(v, n) where e.n <= p_foot_n)
     and jsonb_typeof(f.payload->'footnotes') = 'array' and jsonb_array_length(f.payload->'footnotes') > 0;

  return jsonb_build_object(
    'columns', jsonb_build_array('id','filing_id','person_id','security_id','side','txn_code','is_derivative','txn_date','disclosed_at',
      'amount_low','amount_high','shares','price','disclosure_lag_days','is_10b5_1','owner_type','asset_type','owned_after'),
    'rows', v_rows, 'peers', v_peers, 'filings', v_filings, 'people', v_people, 'securities', v_secs, 'refPrices', v_ref, 'footnotes', v_foot);
end $$;

-- ── insider ─────────────────────────────────────────────────────────────────────────────────
create or replace function od_insider(p_slug text, p_any boolean default false, p_floor date default '2025-10-01')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_p people%rowtype; v_static boolean; v_ids bigint[]; v_peer bigint[]; v_total int; v_stats jsonb; v_roles jsonb; v_colleagues jsonb; v_cids bigint[];
begin
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

-- ── stock ───────────────────────────────────────────────────────────────────────────────────
create or replace function od_stock(p_ticker text, p_any boolean default false, p_floor date default '2025-10-01')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_secs bigint[]; v_active boolean; v_ids bigint[]; v_total int; v_stats jsonb; v_list jsonb; v_comp jsonb; v_main securities%rowtype;
begin
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

-- ── company ─────────────────────────────────────────────────────────────────────────────────
create or replace function od_company(p_slug text, p_any boolean default false, p_floor date default '2025-10-01')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' set enable_hashjoin = off set enable_mergejoin = off as $$
declare
  v_c companies%rowtype; v_secs bigint[]; v_ids bigint[]; v_total int; v_stats jsonb; v_list jsonb; v_insiders int;
begin
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

-- ── who may call what ───────────────────────────────────────────────────────────────────────
revoke execute on function od_vis(review_status, numeric, filing_source, review_status, numeric, timestamptz, boolean, text, boolean, date) from public, anon, authenticated;
revoke execute on function od_person_visible(bigint) from public, anon, authenticated;
revoke execute on function od_pack(bigint[], bigint[], int, boolean, date) from public, anon, authenticated;
revoke execute on function od_insider(text, boolean, date), od_stock(text, boolean, date), od_company(text, boolean, date) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function od_insider(text, boolean, date), od_stock(text, boolean, date), od_company(text, boolean, date) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function od_insider(text, boolean, date), od_stock(text, boolean, date), od_company(text, boolean, date) to authenticated;
  end if;
end $$;

-- 0009 and 0019 left these callable by PUBLIC (default). They write; only the owner (ingest) may run them.
revoke execute on function promote_market_scope() from public, anon, authenticated;
revoke execute on function publish_approved_filings() from public, anon, authenticated;
