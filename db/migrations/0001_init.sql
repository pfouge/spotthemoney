-- Spot the Money — initial schema (Postgres / Supabase)
-- Migration 0001_init
-- Phase-1 focused, forward-looking tables for Congress + performance included.
-- Convention: snake_case, surrogate bigint PKs, created_at/updated_at on mutable rows,
-- natural keys carried as unique constraints. Raw source fidelity preserved separately.

begin;

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";      -- case-insensitive text (tickers, emails)

-- ──────────────────────────────────────────────────────────────────────────
-- Enums
-- ──────────────────────────────────────────────────────────────────────────
create type security_type   as enum ('equity','etf','adr','fund','bond','commodity','crypto','index','other');
create type chamber          as enum ('house','senate');
create type txn_side         as enum ('buy','sell','exchange','option','other');
create type review_status    as enum ('pending','approved','rejected','auto_approved');
create type filing_source    as enum ('sec_form4','house_ptr','senate_ptr','fec','usaspending','senate_lda','other');
create type run_status       as enum ('running','success','failed','partial');

-- ──────────────────────────────────────────────────────────────────────────
-- Reference / identity
-- ──────────────────────────────────────────────────────────────────────────
create table companies (
    id            bigint generated always as identity primary key,
    name          text        not null,
    legal_name    text,
    cik           text unique,                 -- SEC Central Index Key
    primary_ticker citext,
    sector        text,
    industry      text,
    country       text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create table securities (
    id            bigint generated always as identity primary key,
    ticker        citext      not null,
    cusip         text,
    name          text,
    type          security_type not null default 'equity',
    company_id    bigint references companies(id) on delete set null,
    is_active     boolean     not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (ticker, type)
);
create index securities_company_idx on securities(company_id);

create table people (
    id            bigint generated always as identity primary key,
    full_name     text        not null,
    first_name    text,
    last_name     text,
    slug          citext unique,               -- profile URL key
    bioguide_id   text unique,                 -- Congress member id (nullable)
    cik           text,                        -- insider CIK if applicable
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- A person can be a politician and/or a corporate insider; roles capture both.
create table person_roles (
    id            bigint generated always as identity primary key,
    person_id     bigint not null references people(id) on delete cascade,
    role_kind     text   not null check (role_kind in ('congress','insider')),
    -- congress fields
    chamber       chamber,
    state         text,
    district      text,
    party         text,
    -- insider fields
    company_id    bigint references companies(id) on delete set null,
    officer_title text,
    is_director   boolean,
    valid_from    date,
    valid_to      date,
    created_at    timestamptz not null default now()
);
create index person_roles_person_idx  on person_roles(person_id);
create index person_roles_company_idx on person_roles(company_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Market data: rates + prices
-- ──────────────────────────────────────────────────────────────────────────
create table rate_series (
    id            bigint generated always as identity primary key,
    code          text unique not null,        -- e.g. 'IBOND_COMPOSITE','TIPS_10Y','UST_10Y'
    label         text not null,
    source        text not null,               -- 'treasury_fiscaldata' | 'fred'
    source_ref    text,                        -- dataset/series id at source
    unit          text,                        -- 'percent', etc.
    frequency     text,                        -- 'daily','monthly','semiannual'
    created_at    timestamptz not null default now()
);

create table rate_observations (
    series_id     bigint not null references rate_series(id) on delete cascade,
    obs_date      date   not null,
    value         numeric(14,6),
    meta          jsonb,                        -- e.g. fixed/inflation components for I-Bonds
    primary key (series_id, obs_date)
);

create table security_prices (
    security_id   bigint not null references securities(id) on delete cascade,
    price_date    date   not null,
    open          numeric(18,6),
    high          numeric(18,6),
    low           numeric(18,6),
    close         numeric(18,6),
    last          numeric(18,6),
    currency      text default 'USD',
    source        text,
    primary key (security_id, price_date)
);

-- ──────────────────────────────────────────────────────────────────────────
-- Disclosures → transactions (the flagship spine)
-- ──────────────────────────────────────────────────────────────────────────
create table filings (
    id            bigint generated always as identity primary key,
    source        filing_source not null,
    external_id   text,                         -- accession no / doc id at source
    filer_person_id bigint references people(id) on delete set null,
    filer_company_id bigint references companies(id) on delete set null,
    filed_at      timestamptz,
    period_start  date,
    period_end    date,
    source_url    text,
    raw_document_id bigint,                      -- FK added after raw_documents (below)
    confidence    numeric(4,3) not null default 1.0,  -- 0..1
    review        review_status not null default 'auto_approved',
    is_published  boolean not null default false,
    payload       jsonb,                         -- structured source fields as-received
    created_at    timestamptz not null default now(),
    unique (source, external_id)
);
create index filings_filer_person_idx on filings(filer_person_id);
create index filings_filed_at_idx     on filings(filed_at desc);

create table transactions (
    id             bigint generated always as identity primary key,
    filing_id      bigint references filings(id) on delete cascade,
    person_id      bigint references people(id) on delete set null,
    security_id    bigint references securities(id) on delete set null,
    side           txn_side not null default 'other',
    txn_date       date,
    disclosed_at   date,
    amount_low     numeric(18,2),               -- disclosure ranges -> low/high
    amount_high    numeric(18,2),
    shares         numeric(20,4),
    price          numeric(18,6),
    disclosure_lag_days integer,                -- disclosed_at - txn_date
    confidence     numeric(4,3) not null default 1.0,
    review         review_status not null default 'auto_approved',
    created_at     timestamptz not null default now()
);
create index transactions_person_idx   on transactions(person_id);
create index transactions_security_idx on transactions(security_id);
create index transactions_date_idx     on transactions(txn_date desc);

-- ──────────────────────────────────────────────────────────────────────────
-- Money in politics
-- ──────────────────────────────────────────────────────────────────────────
create table committees (
    id            bigint generated always as identity primary key,
    fec_id        text unique,
    name          text not null,
    party         text,
    committee_type text,
    created_at    timestamptz not null default now()
);

create table donations (
    id            bigint generated always as identity primary key,
    committee_id  bigint references committees(id) on delete set null,
    donor_name    text,
    donor_employer text,
    donor_state   text,
    amount        numeric(16,2),
    donated_at    date,
    source_ref    text,
    created_at    timestamptz not null default now()
);
create index donations_committee_idx on donations(committee_id);
create index donations_date_idx      on donations(donated_at desc);

create table lobbying (
    id            bigint generated always as identity primary key,
    registrant    text,
    client        text,
    issue_area    text,
    amount        numeric(16,2),
    period_year   integer,
    period_quarter integer,
    source_ref    text,
    created_at    timestamptz not null default now()
);
create index lobbying_client_idx on lobbying(client);

create table contracts (
    id            bigint generated always as identity primary key,
    recipient     text,
    awarding_agency text,
    amount        numeric(18,2),
    action_date   date,
    naics         text,
    source_ref    text,
    created_at    timestamptz not null default now()
);
create index contracts_recipient_idx on contracts(recipient);
create index contracts_date_idx      on contracts(action_date desc);

-- ──────────────────────────────────────────────────────────────────────────
-- Performance / scoreboard (Phase 2 — precomputed, never live-aggregated on pageview)
-- ──────────────────────────────────────────────────────────────────────────
create table transaction_performance (
    transaction_id bigint primary key references transactions(id) on delete cascade,
    benchmark      text not null default 'SPY',
    ret_1m         numeric(10,4),
    ret_3m         numeric(10,4),
    ret_6m         numeric(10,4),
    ret_12m        numeric(10,4),
    excess_12m     numeric(10,4),               -- vs benchmark
    computed_at    timestamptz not null default now()
);

create table leaderboard_snapshots (
    id            bigint generated always as identity primary key,
    cohort        text not null,                -- 'congress','insiders','all'
    horizon       text not null,                -- '3m','12m', etc.
    person_id     bigint references people(id) on delete cascade,
    rank          integer,
    metric_value  numeric(12,4),
    sample_size   integer,
    snapshot_date date not null,
    created_at    timestamptz not null default now()
);
create index leaderboard_lookup_idx on leaderboard_snapshots(cohort, horizon, snapshot_date, rank);

-- ──────────────────────────────────────────────────────────────────────────
-- Ingestion / ops
-- ──────────────────────────────────────────────────────────────────────────
create table sources (
    id            bigint generated always as identity primary key,
    code          text unique not null,         -- 'sec_form4','fec','treasury_ibond',...
    label         text not null,
    cadence       text,                          -- 'hourly','daily','on_reset'
    is_enabled    boolean not null default true,
    created_at    timestamptz not null default now()
);

create table ingest_runs (
    id            bigint generated always as identity primary key,
    source_id     bigint references sources(id) on delete set null,
    started_at    timestamptz not null default now(),
    finished_at   timestamptz,
    status        run_status not null default 'running',
    rows_seen     integer default 0,
    rows_changed  integer default 0,
    error         text
);
create index ingest_runs_source_idx on ingest_runs(source_id, started_at desc);

create table source_cursors (
    source_id     bigint primary key references sources(id) on delete cascade,
    cursor_value  text,                          -- last accession / date / offset
    updated_at    timestamptz not null default now()
);

create table raw_documents (
    id            bigint generated always as identity primary key,
    source        filing_source,
    r2_key        text not null,                 -- object key in Cloudflare R2
    content_type  text,
    checksum      text,                          -- dedupe
    fetched_at    timestamptz not null default now(),
    unique (checksum)
);

alter table filings
    add constraint filings_raw_document_fk
    foreign key (raw_document_id) references raw_documents(id) on delete set null;

create table review_queue (
    id            bigint generated always as identity primary key,
    filing_id     bigint references filings(id) on delete cascade,
    transaction_id bigint references transactions(id) on delete cascade,
    reason        text,                          -- 'low_confidence_ocr', etc.
    confidence    numeric(4,3),
    status        review_status not null default 'pending',
    reviewed_by   text,
    reviewed_at   timestamptz,
    created_at    timestamptz not null default now()
);
create index review_queue_status_idx on review_queue(status, created_at);

commit;
