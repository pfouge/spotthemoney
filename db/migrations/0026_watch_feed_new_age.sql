-- 0026: a trade on the watchlist counts as "new" only when it was disclosed in the last 30 days.
--
-- watch_feed_rows (0017) marked a row new when its filing was LOADED after the visitor last opened
-- the watchlist page. A backfill loads old filings as new (about 130,000 in one week of November
-- 2026), so the badge in the header and the "New since your last visit" table filled with trades
-- disclosed months ago. The email digest builder (ingest/src/jobs/alerts_digest.ts, MAX_AGE_DAYS)
-- already has this rule; the watchlist page now has the same one.
--
-- Only is_new changes. The feed still lists every trade disclosed in the last 365 days: an old
-- filing loaded late is in "Earlier trades", not gone. The number of days is
-- FEED_NEW_MAX_AGE_DAYS in web/src/lib/account.ts (a unit test reads this file and compares).
--
-- Same name, arguments and return type as 0017, so the grants made there and in 0022 stand
-- (create or replace keeps ownership and privileges). It does NOT keep the function's settings,
-- so the search_path that 0022 pinned is stated here again. Idempotent.

create or replace function watch_feed_rows(p_limit int default 200)
returns table (txn_id bigint, kind text, key text, is_new boolean, disclosed_at date, txn_date date,
               side text, txn_code text, is_derivative boolean, amount_low numeric, amount_high numeric,
               shares numeric, price numeric, owner_type text, person_name text, person_slug text,
               ticker text, security_name text, source text, source_url text, loaded_at timestamptz)
language sql stable
set search_path = public, pg_temp
as $$
  with mine as (
    select distinct i.kind, i.key from watchlist_items i
    join watchlists w on w.id = i.watchlist_id where w.account_id = app_user_id()
  ),
  seen as (select coalesce((select last_seen_feed_at from accounts where id = app_user_id()), now()) as at),
  hits as (
    select t.id, m.kind, m.key from mine m
    join people p on m.kind in ('member', 'insider') and p.slug = m.key
    join transactions t on t.person_id = p.id
    union all
    select t.id, m.kind, m.key from mine m
    join securities s on m.kind = 'stock' and lower(s.ticker::text) = m.key
    join transactions t on t.security_id = s.id
    union all
    select t.id, m.kind, m.key from mine m
    join companies c on m.kind = 'company' and c.slug = m.key
    join securities s on s.company_id = c.id
    join transactions t on t.security_id = s.id
  )
  select distinct on (t.id)
         t.id, h.kind, h.key,
         f.created_at > (select at from seen) and t.disclosed_at >= current_date - 30,
         t.disclosed_at, t.txn_date,
         t.side::text, t.txn_code, t.is_derivative, t.amount_low, t.amount_high, t.shares, t.price, t.owner_type,
         p.full_name, p.slug::text, s.ticker::text, s.name, f.source::text, f.source_url, f.created_at
  from hits h
  join transactions t on t.id = h.id
  join filings f on f.id = t.filing_id and f.is_published
  left join people p on p.id = t.person_id
  left join securities s on s.id = t.security_id
  where t.disclosed_at >= current_date - 365
  order by t.id
$$;
