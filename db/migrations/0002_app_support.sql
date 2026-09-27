-- Spot the Money — app-support schema (Supabase / Postgres)
-- Migration 0002_app_support
-- Identity + engagement tables for the iOS/Android apps and logged-in web.
-- Hangs off Supabase's managed auth.users; every row is user-scoped and RLS-protected.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- Enums
-- ──────────────────────────────────────────────────────────────────────────
create type device_platform as enum ('ios','android','web');
create type watch_entity    as enum ('person','company','security');
create type alert_trigger   as enum ('new_disclosure','rate_reset','price_threshold','scoreboard_move');
create type alert_channel   as enum ('push','email');
create type notify_status   as enum ('queued','sent','failed','read');

-- ──────────────────────────────────────────────────────────────────────────
-- Profile (1:1 with the Supabase auth user)
-- ──────────────────────────────────────────────────────────────────────────
create table profiles (
    id           uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at   timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- Devices (push tokens, one row per install)
-- ──────────────────────────────────────────────────────────────────────────
create table devices (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users(id) on delete cascade,
    platform   device_platform not null,
    push_token text not null,            -- APNs/FCM, or Expo push token
    app_version text,
    last_seen  timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (user_id, push_token)
);
create index devices_user_idx on devices(user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Watchlists (user follows people / companies / securities from the core schema)
-- ──────────────────────────────────────────────────────────────────────────
create table watchlists (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users(id) on delete cascade,
    name       text not null default 'My watchlist',
    created_at timestamptz not null default now()
);
create index watchlists_user_idx on watchlists(user_id);

create table watchlist_items (
    id           bigint generated always as identity primary key,
    watchlist_id bigint not null references watchlists(id) on delete cascade,
    entity_type  watch_entity not null,
    entity_id    bigint not null,        -- FK by convention into people/companies/securities
    created_at   timestamptz not null default now(),
    unique (watchlist_id, entity_type, entity_id)
);
create index watchlist_items_list_idx on watchlist_items(watchlist_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Alert subscriptions + delivered notifications
-- ──────────────────────────────────────────────────────────────────────────
create table alert_subscriptions (
    id          bigint generated always as identity primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    trigger     alert_trigger not null,
    entity_type watch_entity,            -- null = global (e.g. any new I-Bond reset)
    entity_id   bigint,
    params      jsonb,                   -- e.g. {"threshold_pct": 5}
    channel     alert_channel not null default 'push',
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);
create index alert_subs_user_idx on alert_subscriptions(user_id);
create index alert_subs_match_idx on alert_subscriptions(trigger, entity_type, entity_id) where is_active;

create table notifications (
    id              bigint generated always as identity primary key,
    user_id         uuid not null references auth.users(id) on delete cascade,
    subscription_id bigint references alert_subscriptions(id) on delete set null,
    title           text not null,
    body            text,
    payload         jsonb,               -- deep-link target, entity ids, etc.
    status          notify_status not null default 'queued',
    created_at      timestamptz not null default now(),
    sent_at         timestamptz
);
create index notifications_user_idx on notifications(user_id, created_at desc);
create index notifications_status_idx on notifications(status) where status = 'queued';

-- ──────────────────────────────────────────────────────────────────────────
-- Per-user preferences
-- ──────────────────────────────────────────────────────────────────────────
create table user_preferences (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    theme      text not null default 'system',   -- 'light' | 'dark' | 'system'
    prefs      jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- Row-level security: each user can only read/write their own rows.
-- ──────────────────────────────────────────────────────────────────────────
alter table profiles            enable row level security;
alter table devices             enable row level security;
alter table watchlists          enable row level security;
alter table watchlist_items     enable row level security;
alter table alert_subscriptions enable row level security;
alter table notifications       enable row level security;
alter table user_preferences    enable row level security;

create policy own_profile on profiles
    for all using (id = auth.uid()) with check (id = auth.uid());
create policy own_devices on devices
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_watchlists on watchlists
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_watchlist_items on watchlist_items
    for all using (watchlist_id in (select id from watchlists where user_id = auth.uid()))
    with check (watchlist_id in (select id from watchlists where user_id = auth.uid()));
create policy own_alert_subs on alert_subscriptions
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_notifications on notifications
    for select using (user_id = auth.uid());
create policy own_preferences on user_preferences
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;
