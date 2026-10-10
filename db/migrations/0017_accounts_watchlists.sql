-- 0017 — Accounts and watchlists, signed in through WorkOS AuthKit (2026-10-10, item 4).
--
-- Who a request is: the WorkOS access token, verified by Supabase through its third-party auth
-- integration (Authentication → Third-party auth → WorkOS). The token's `sub` is the WorkOS
-- user id ("user_01H…"), a string, not a Supabase auth.users uuid — so nothing here uses
-- auth.uid(); app_user_id() reads `sub` from auth.jwt(). The token's template adds
-- "role": "authenticated", which is what lets PostgREST switch to that role.
--
-- The site's Worker never touches these tables directly: it calls the functions below through
-- /rest/v1/rpc/ with the visitor's own token, so row-level security decides what each call can
-- see. Only public_watchlist() runs with definer rights, and it returns no account ids.
--
-- Replaces the account tables of 0002 (profiles, devices, watchlists, watchlist_items,
-- alert_subscriptions, notifications, user_preferences). They were drawn up for Supabase Auth,
-- keyed to auth.users, and never used: the migration refuses to run if any of them has a row.

begin;

do $$
begin
  if exists (select 1 from watchlists) or exists (select 1 from watchlist_items)
     or exists (select 1 from profiles) or exists (select 1 from devices)
     or exists (select 1 from alert_subscriptions) or exists (select 1 from notifications)
     or exists (select 1 from user_preferences) then
    raise exception '0017: the 0002 account tables hold rows; refusing to replace them';
  end if;
end $$;

drop table notifications, alert_subscriptions, watchlist_items, watchlists, user_preferences, devices, profiles;
drop type if exists notify_status, alert_channel, alert_trigger, watch_entity, device_platform;

-- ── who is asking ───────────────────────────────────────────────────────────────────────────
create or replace function app_user_id() returns text
language sql stable as $$
  select nullif(coalesce(auth.jwt() ->> 'sub', ''), '')
$$;

create or replace function app_require_user() returns text
language plpgsql stable as $$
declare uid text := app_user_id();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return uid;
end $$;

-- ── tables ──────────────────────────────────────────────────────────────────────────────────
create table accounts (
    id                text primary key check (id ~ '^[A-Za-z0-9_]{3,64}$'),  -- WorkOS user id
    email             text check (email is null or length(email) <= 320),
    created_at        timestamptz not null default now(),
    last_seen_feed_at timestamptz not null default now()   -- "new since your last visit"
);

create table watchlists (
    id          uuid primary key default gen_random_uuid(),
    account_id  text not null references accounts(id) on delete cascade,
    name        text not null default 'My watchlist' check (length(btrim(name)) between 1 and 80),
    is_default  boolean not null default false,
    is_public   boolean not null default false,
    share_slug  text unique check (share_slug ~ '^[a-z0-9]{12}$'),       -- set while shared
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index watchlists_account_idx on watchlists(account_id);
create unique index watchlists_one_default on watchlists(account_id) where is_default;

-- kind + key name the page being followed: member and insider → people.slug,
-- stock → ticker (lower case), company → companies.slug. Same keys as the page URLs.
create table watchlist_items (
    watchlist_id uuid not null references watchlists(id) on delete cascade,
    kind         text not null check (kind in ('member', 'insider', 'stock', 'company')),
    key          text not null check (key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
    label        text check (label is null or length(label) <= 160),
    created_at   timestamptz not null default now(),
    primary key (watchlist_id, kind, key)
);

alter table accounts        enable row level security;
alter table watchlists      enable row level security;
alter table watchlist_items enable row level security;

create policy own_account on accounts
    for all to authenticated using (id = app_user_id()) with check (id = app_user_id());
create policy own_watchlists on watchlists
    for all to authenticated using (account_id = app_user_id()) with check (account_id = app_user_id());
create policy own_watchlist_items on watchlist_items
    for all to authenticated
    using (watchlist_id in (select id from watchlists where account_id = app_user_id()))
    with check (watchlist_id in (select id from watchlists where account_id = app_user_id()));

revoke all on accounts, watchlists, watchlist_items from anon;
grant select, insert, update, delete on accounts, watchlists, watchlist_items to authenticated;
-- The feed reads the public record tables as the signed-in visitor. Supabase grants these by
-- default; stated here so the functions do not depend on it. Their public_read policies still
-- limit filings and transactions to published rows.
grant usage on schema public to anon, authenticated;
grant select on people, securities, companies, filings, transactions to authenticated;

-- ── limits ──────────────────────────────────────────────────────────────────────────────────
create or replace function watchlist_limits() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'watchlists' then
    if (select count(*) from watchlists where account_id = new.account_id) >= 20 then
      raise exception 'You can have up to 20 watchlists.' using errcode = 'P0001';
    end if;
  else
    if (select count(*) from watchlist_items where watchlist_id = new.watchlist_id) >= 500 then
      raise exception 'A watchlist can hold up to 500 items.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger watchlists_limit before insert on watchlists for each row execute function watchlist_limits();
create trigger watchlist_items_limit before insert on watchlist_items for each row execute function watchlist_limits();

-- ── the API (called by the site's Worker through /rest/v1/rpc/) ─────────────────────────────

-- First call after sign-in: create the account row and the default list if missing.
create or replace function account_touch(p_email text default null) returns jsonb
language plpgsql as $$
declare uid text := app_require_user();
begin
  insert into accounts (id, email) values (uid, nullif(btrim(p_email), ''))
  on conflict (id) do update set email = coalesce(excluded.email, accounts.email);
  if not exists (select 1 from watchlists where account_id = uid and is_default) then
    insert into watchlists (account_id, name, is_default) values (uid, 'My watchlist', true);
  end if;
  return my_state();
end $$;

-- Follow or unfollow a page. Without p_list, the default list.
create or replace function follow(p_kind text, p_key text, p_label text default null, p_on boolean default true,
                                  p_list uuid default null) returns jsonb
language plpgsql as $$
declare uid text := app_require_user(); lid uuid;
begin
  perform account_touch(null);
  lid := coalesce(p_list, (select id from watchlists where account_id = uid and is_default));
  if not exists (select 1 from watchlists where id = lid and account_id = uid) then
    raise exception 'No such watchlist.' using errcode = 'P0002';
  end if;
  if p_on then
    insert into watchlist_items (watchlist_id, kind, key, label)
    values (lid, p_kind, lower(btrim(p_key)), left(btrim(p_label), 160))
    on conflict (watchlist_id, kind, key) do update set label = coalesce(excluded.label, watchlist_items.label);
  else
    delete from watchlist_items where watchlist_id = lid and kind = p_kind and key = lower(btrim(p_key));
  end if;
  return my_state();
end $$;

-- Create, rename, share or unshare, delete a list. Sharing makes a fresh slug; unsharing drops it,
-- so a link that was handed out stops working.
create or replace function list_save(p_id uuid default null, p_name text default null, p_public boolean default null,
                                     p_delete boolean default false) returns jsonb
language plpgsql as $$
declare uid text := app_require_user(); w watchlists;
begin
  perform account_touch(null);
  if p_id is null then
    insert into watchlists (account_id, name) values (uid, coalesce(nullif(btrim(p_name), ''), 'New watchlist'));
    return my_state();
  end if;
  select * into w from watchlists where id = p_id and account_id = uid;
  if not found then raise exception 'No such watchlist.' using errcode = 'P0002'; end if;
  if p_delete then
    if w.is_default then raise exception 'Your first watchlist cannot be deleted.' using errcode = 'P0001'; end if;
    delete from watchlists where id = p_id;
    return my_state();
  end if;
  update watchlists set
    name = coalesce(nullif(btrim(p_name), ''), name),
    is_public = coalesce(p_public, is_public),
    share_slug = case when p_public is true and share_slug is null
                        then substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12)
                      when p_public is false then null else share_slug end,
    updated_at = now()
  where id = p_id;
  return my_state();
end $$;

-- Move an item from one of your lists to another.
create or replace function item_move(p_kind text, p_key text, p_from uuid, p_to uuid) returns jsonb
language plpgsql as $$
declare uid text := app_require_user();
begin
  if not exists (select 1 from watchlists where id = p_to and account_id = uid) then
    raise exception 'No such watchlist.' using errcode = 'P0002';
  end if;
  insert into watchlist_items (watchlist_id, kind, key, label)
  select p_to, kind, key, label from watchlist_items where watchlist_id = p_from and kind = p_kind and key = p_key
  on conflict do nothing;
  delete from watchlist_items where watchlist_id = p_from and kind = p_kind and key = p_key and p_from <> p_to;
  return my_state();
end $$;

-- Recent published trades by what the visitor follows (any of their lists), newest first.
-- is_new: loaded after the visitor last opened their watchlist page.
create or replace function watch_feed_rows(p_limit int default 200)
returns table (txn_id bigint, kind text, key text, is_new boolean, disclosed_at date, txn_date date,
               side text, txn_code text, is_derivative boolean, amount_low numeric, amount_high numeric,
               shares numeric, price numeric, owner_type text, person_name text, person_slug text,
               ticker text, security_name text, source text, source_url text, loaded_at timestamptz)
language sql stable as $$
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
         t.id, h.kind, h.key, f.created_at > (select at from seen), t.disclosed_at, t.txn_date,
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

-- The signed-in visitor's whole state: lists with their items, and how many new trades.
create or replace function my_state() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'account', (select jsonb_build_object('email', a.email, 'created_at', a.created_at, 'last_seen_feed_at', a.last_seen_feed_at)
                from accounts a where a.id = app_user_id()),
    'lists', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'is_default', w.is_default, 'is_public', w.is_public,
               'share_slug', w.share_slug,
               'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'key', i.key, 'label', i.label)
                                                   order by i.created_at desc)
                                  from watchlist_items i where i.watchlist_id = w.id), '[]'::jsonb))
             order by w.is_default desc, w.created_at)
      from watchlists w where w.account_id = app_user_id()), '[]'::jsonb),
    'new_count', (select count(*) from watch_feed_rows(500) r where r.is_new)
  )
$$;

create or replace function watch_feed(p_limit int default 200) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.loaded_at desc, r.disclosed_at desc, r.txn_id desc), '[]'::jsonb)
  from (select * from watch_feed_rows(500) order by loaded_at desc, disclosed_at desc, txn_id desc
        limit least(greatest(coalesce(p_limit, 200), 1), 500)) r
$$;

create or replace function mark_feed_seen() returns jsonb
language plpgsql as $$
declare uid text := app_require_user();
begin
  update accounts set last_seen_feed_at = now() where id = uid;
  return my_state();
end $$;

-- Copy a shared list into a new list of your own.
create or replace function list_copy(p_slug text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid text := app_require_user(); src watchlists; nid uuid;
begin
  select * into src from watchlists where share_slug = p_slug and is_public;
  if not found then raise exception 'That shared watchlist no longer exists.' using errcode = 'P0002'; end if;
  perform account_touch(null);
  insert into watchlists (account_id, name) values (uid, left('Copy of ' || src.name, 80)) returning id into nid;
  insert into watchlist_items (watchlist_id, kind, key, label)
  select nid, kind, key, label from watchlist_items where watchlist_id = src.id;
  return my_state();
end $$;

-- Delete the account and everything tied to it (the WorkOS user is deleted by the Worker).
create or replace function account_delete() returns jsonb
language plpgsql as $$
declare uid text := app_require_user();
begin
  delete from accounts where id = uid;
  return jsonb_build_object('deleted', true);
end $$;

-- A shared list as anyone may see it: name, items and recent trades. No account id, no email.
create or replace function public_watchlist(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with w as (select id, name, updated_at from watchlists where share_slug = p_slug and is_public),
  items as (select i.kind, i.key, i.label, i.created_at from watchlist_items i join w on w.id = i.watchlist_id),
  hits as (
    select t.id from items m join people p on m.kind in ('member', 'insider') and p.slug = m.key
    join transactions t on t.person_id = p.id
    union
    select t.id from items m join securities s on m.kind = 'stock' and lower(s.ticker::text) = m.key
    join transactions t on t.security_id = s.id
    union
    select t.id from items m join companies c on m.kind = 'company' and c.slug = m.key
    join securities s on s.company_id = c.id join transactions t on t.security_id = s.id
  ),
  recent as (
    select t.id as txn_id, t.disclosed_at, t.txn_date, t.side::text as side, t.txn_code, t.is_derivative,
           t.amount_low, t.amount_high, t.shares, t.price, t.owner_type, p.full_name as person_name,
           p.slug::text as person_slug, s.ticker::text as ticker, s.name as security_name,
           f.source::text as source, f.source_url
    from hits h join transactions t on t.id = h.id
    join filings f on f.id = t.filing_id and f.is_published
    left join people p on p.id = t.person_id left join securities s on s.id = t.security_id
    where t.disclosed_at >= current_date - 90
    order by t.disclosed_at desc, t.id desc limit 100
  )
  select case when not exists (select 1 from w) then null else jsonb_build_object(
    'name', (select name from w),
    'updated_at', (select updated_at from w),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'key', key, 'label', label) order by created_at desc) from items), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(r)) from recent r), '[]'::jsonb)
  ) end
$$;

-- Who may call what: everything but public_watchlist needs a signed-in visitor.
revoke execute on function app_user_id(), app_require_user(), my_state(), account_touch(text),
  follow(text, text, text, boolean, uuid), list_save(uuid, text, boolean, boolean), item_move(text, text, uuid, uuid),
  watch_feed_rows(int), watch_feed(int), mark_feed_seen(), list_copy(text), account_delete(), public_watchlist(text)
  from public, anon;
grant execute on function app_user_id(), app_require_user(), my_state(), account_touch(text),
  follow(text, text, text, boolean, uuid), list_save(uuid, text, boolean, boolean), item_move(text, text, uuid, uuid),
  watch_feed_rows(int), watch_feed(int), mark_feed_seen(), list_copy(text), account_delete(), public_watchlist(text)
  to authenticated;
grant execute on function public_watchlist(text) to anon;

commit;
