-- 0025 — Email alerts, stage 1: the tables and the ways out (2026-11-18, parity queue item 7).
--
-- Nothing here sends an email and nothing on the site uses it yet. It is the ground the later
-- stages stand on, built first so that the ways OUT (turn it off, one-click unsubscribe, delete
-- the account) exist and are tested before there is any way in.
--
-- What an alert is, for now: a digest of newly published trades by the pages an account
-- follows (any of its watchlists), daily or weekly. It goes to the account's own address
-- (accounts.email, which the sign-in provider has verified); no second address is kept.
--
-- Switched off twice over. The site will have its own switch (stage 3). This file adds one in
-- the database: app_settings 'alerts_enabled', false. While it is false nobody can turn a
-- digest ON, whatever the site does; turning one OFF and unsubscribing always work.
--
-- Access. The three tables have row-level security on, NO policy and no grant to the API
-- roles: a signed-in visitor cannot read or write them directly, not even their own row (the
-- unsubscribe token and the outbox are not theirs to edit). Everything goes through three
-- definer-rights functions that take the caller from the WorkOS token (app_require_user):
--   alert_state()             authenticated   the caller's own setting
--   alert_save(p_digest)      authenticated   'off' | 'daily' | 'weekly'
--   alert_unsubscribe(token)  anon, authenticated   the link in every email; needs no sign-in
-- alert_unsubscribe returns {ok} only: no account id, no address. A token is 64 hex characters
-- from two random uuids (244 random bits), so it cannot be guessed.
--
-- Deleting an account (account_delete, 0017) deletes its setting and its outbox rows through
-- the foreign keys. The read-only build role site_build (0023) gets nothing on the two private
-- tables.
--
-- Stage 2 (a job that writes digests into alert_outbox and sends nothing) and stage 3 (the
-- controls on the site, behind a switch, privacy page first) are separate changes.

-- (db/migrate.mjs runs each file inside one transaction.)

-- ── the database-side switch ────────────────────────────────────────────────────────────────
create table app_settings (
    key        text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
    value      jsonb not null,
    updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
insert into app_settings (key, value) values ('alerts_enabled', 'false'::jsonb);

-- ── one row per account that ever chose a digest ────────────────────────────────────────────
create table alert_prefs (
    account_id      text primary key references accounts(id) on delete cascade,
    digest          text not null default 'off' check (digest in ('off', 'daily', 'weekly')),
    -- the link in every email; stays the same so an old email's link keeps working
    unsub_token     text not null unique
                    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
                    check (unsub_token ~ '^[0-9a-f]{64}$'),
    opted_in_at     timestamptz,                         -- when the digest was last turned on
    unsubscribed_at timestamptz,                         -- when it was last turned off
    last_digest_at  timestamptz not null default now(),  -- trades loaded up to here are covered
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
alter table alert_prefs enable row level security;

-- ── what would be sent (stage 2 writes it; a later stage sends it) ──────────────────────────
create table alert_outbox (
    id                  bigint generated always as identity primary key,
    account_id          text not null references accounts(id) on delete cascade,
    kind                text not null check (kind in ('digest_daily', 'digest_weekly')),
    period_start        timestamptz not null,
    period_end          timestamptz not null,
    to_email            text not null check (length(to_email) between 3 and 320),
    subject             text not null check (length(subject) between 1 and 200),
    body_text           text not null,
    body_html           text,
    item_count          int  not null check (item_count > 0),
    status              text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
    provider_message_id text,
    error               text,
    created_at          timestamptz not null default now(),
    sent_at             timestamptz,
    check (period_end > period_start),
    unique (account_id, kind, period_end)
);
create index alert_outbox_pending_idx on alert_outbox (created_at) where status = 'pending';
alter table alert_outbox enable row level security;

-- ── functions ───────────────────────────────────────────────────────────────────────────────
create function alerts_enabled() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = 'alerts_enabled'), false)
$$;

-- The caller's own setting. `available` is the database switch.
create function alert_state() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid text := app_require_user();
begin
  return jsonb_build_object(
    'available',       alerts_enabled(),
    'email',           (select a.email from accounts a where a.id = uid),
    'digest',          coalesce((select p.digest from alert_prefs p where p.account_id = uid), 'off'),
    'opted_in_at',     (select p.opted_in_at from alert_prefs p where p.account_id = uid),
    'unsubscribed_at', (select p.unsubscribed_at from alert_prefs p where p.account_id = uid),
    'last_digest_at',  (select p.last_digest_at from alert_prefs p where p.account_id = uid));
end $$;

-- Choose a digest. Turning it off always works; turning it on needs the switch and an address.
-- Turning it on starts the clock now: the first digest holds trades loaded from this moment.
create function alert_save(p_digest text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid text := app_require_user(); v text := lower(btrim(coalesce(p_digest, '')));
begin
  if v not in ('off', 'daily', 'weekly') then
    raise exception 'Choose off, daily or weekly.' using errcode = '22023';
  end if;
  if v = 'off' then
    update alert_prefs set
      unsubscribed_at = case when digest <> 'off' then now() else unsubscribed_at end,
      digest = 'off', updated_at = now()
    where account_id = uid;
    update alert_outbox set status = 'cancelled' where account_id = uid and status = 'pending';
    return alert_state();
  end if;
  if not alerts_enabled() then
    raise exception 'Email alerts are not available yet.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from accounts a where a.id = uid and nullif(btrim(a.email), '') is not null) then
    raise exception 'Your account has no email address on file.' using errcode = 'P0001';
  end if;
  insert into alert_prefs (account_id, digest, opted_in_at) values (uid, v, now())
  on conflict (account_id) do update set
    opted_in_at     = case when alert_prefs.digest = 'off' then now() else alert_prefs.opted_in_at end,
    last_digest_at  = case when alert_prefs.digest = 'off' then now() else alert_prefs.last_digest_at end,
    unsubscribed_at = null,
    digest          = excluded.digest,
    updated_at      = now();
  return alert_state();
end $$;

-- The link in every email. No sign-in. Says only whether the token was known; safe to repeat.
create function alert_unsubscribe(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare acct text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false);
  end if;
  update alert_prefs set
    unsubscribed_at = case when digest <> 'off' or unsubscribed_at is null then now() else unsubscribed_at end,
    digest = 'off', updated_at = now()
  where unsub_token = p_token
  returning account_id into acct;
  if acct is null then
    return jsonb_build_object('ok', false);
  end if;
  update alert_outbox set status = 'cancelled' where account_id = acct and status = 'pending';
  return jsonb_build_object('ok', true);
end $$;

-- ── who may do what (0022: nothing is open until granted by name) ───────────────────────────
revoke all on app_settings, alert_prefs, alert_outbox from public;
revoke execute on function alerts_enabled(), alert_state(), alert_save(text), alert_unsubscribe(text) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on app_settings, alert_prefs, alert_outbox from %I', r);
      execute format('revoke execute on function alerts_enabled(), alert_state(), alert_save(text), alert_unsubscribe(text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function alert_state(), alert_save(text), alert_unsubscribe(text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function alert_unsubscribe(text) to anon;
  end if;
  -- the build role bypasses row-level security: it must hold nothing on the private tables
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    revoke all on alert_prefs, alert_outbox from site_build;
  end if;
end $$;
