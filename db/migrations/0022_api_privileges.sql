-- 0022 — API privileges tightened (security audit, 2026-11-17).
--
-- What the audit found, and what this file does about each. Idempotent; safe to run twice.
--
-- 1. anon and authenticated held TRUNCATE, REFERENCES, TRIGGER (and MAINTAIN on Postgres 17) on
--    every table in public, schema_migrations included. Row-level security does not apply to
--    TRUNCATE: as `authenticated`, `truncate watchlist_items` succeeded in a rolled-back test.
--    PostgREST has no TRUNCATE verb, so nothing reached it through the API, but the only thing
--    in the way was the API's vocabulary. Revoked.
-- 2. The cause: this role's default privileges in public still granted those four to anon and
--    authenticated on every NEW table (the earlier clean-up removed only select/insert/update/
--    delete), and functions were executable by PUBLIC by default (how promote_market_scope()
--    was callable by anon between 0019 and 0020). Both defaults are removed here, so a new
--    table or function is closed to the API roles until a migration grants something by name.
-- 3. The two trigger functions were executable by PUBLIC. Triggers do not need that. Revoked.
-- 4. app_user_id() now answers only for a WorkOS user id ("user_…"). A token from any other
--    issuer the project might accept (Supabase's own sign-up, an anonymous sign-in) carries a
--    uuid as its subject; before this it was stopped only by the format check on accounts.id.
-- 5. The functions the API roles can call run with a fixed search_path (advisor lint 0011).
--    od_vis() and od_person_visible() are left as they are on purpose: they are not executable
--    by any API role, they only run inside the od_* functions (which pin the path), and a SET
--    clause would stop the planner inlining them on every row.
--
-- Not changed here, because this role cannot: default privileges of the platform role
-- supabase_admin in public still grant everything to anon and authenticated. Nothing in this
-- project creates objects as that role (migrations and the dashboard's SQL editor run as
-- postgres), and the ensure_rls event trigger turns row-level security on for any new table.

-- ── 2. defaults for objects this role creates from now on ───────────────────────────────────
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    alter default privileges in schema public revoke all on tables    from anon;
    alter default privileges in schema public revoke all on sequences from anon;
    alter default privileges in schema public revoke all on functions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public revoke all on tables    from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;
    alter default privileges in schema public revoke all on functions from authenticated;
  end if;
end $$;
-- New functions are no longer executable by everyone; a migration grants execute by name.
alter default privileges revoke execute on functions from public;

-- ── 1. existing tables and views ────────────────────────────────────────────────────────────
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke truncate, references, trigger on all tables in schema public from %I', r);
      if current_setting('server_version_num')::int >= 170000 then
        execute format('revoke maintain on all tables in schema public from %I', r);
      end if;
    end if;
  end loop;
end $$;

-- ── 3. trigger functions ────────────────────────────────────────────────────────────────────
do $$
declare f text; r text;
begin
  foreach f in array array['public.watchlist_limits()', 'public.rls_auto_enable()'] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public', f);
      foreach r in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('revoke execute on function %s from %I', f, r);
        end if;
      end loop;
    end if;
  end loop;
end $$;

-- ── 4. who is asking: a WorkOS user id or nobody ────────────────────────────────────────────
create or replace function app_user_id() returns text
language sql stable set search_path = public, pg_temp as $$
  select case when j.sub ~ '^user_[A-Za-z0-9_]{6,58}$' then j.sub end
  from (select auth.jwt() ->> 'sub' as sub) j
$$;

-- ── 5. fixed search_path ────────────────────────────────────────────────────────────────────
alter function app_require_user()                              set search_path = public, pg_temp;
alter function account_touch(text)                             set search_path = public, pg_temp;
alter function follow(text, text, text, boolean, uuid)         set search_path = public, pg_temp;
alter function list_save(uuid, text, boolean, boolean)         set search_path = public, pg_temp;
alter function item_move(text, text, uuid, uuid)               set search_path = public, pg_temp;
alter function watch_feed_rows(int)                            set search_path = public, pg_temp;
alter function watch_feed(int)                                 set search_path = public, pg_temp;
alter function my_state()                                      set search_path = public, pg_temp;
alter function mark_feed_seen()                                set search_path = public, pg_temp;
alter function account_delete()                                set search_path = public, pg_temp;
alter function watchlist_limits()                              set search_path = public, pg_temp;
alter function promote_market_scope()                          set search_path = public, pg_temp;
alter function publish_approved_filings()                      set search_path = public, pg_temp;

-- create or replace keeps a function's grants, but state them so this file stands alone.
do $$ begin
  revoke execute on function app_user_id() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function app_user_id() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function app_user_id() to authenticated;
  end if;
end $$;
