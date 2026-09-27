-- 0006_flagship_public.sql
-- Flagship-public session (2026-09-27). Additive only; 0001–0005 untouched.
--
-- 1. companies.slug — profile URL key for /companies/<slug>/ (people already have one).
-- 2. transactions: owner_type / asset_type (PTR owner + asset class, contract §4.1 payload
--    fields promoted to columns) and is_10b5_1 (Form 4 Rule 10b5-1 checkbox, EDGAR 23.1+).
-- 3. raw_documents: archive-by-URL columns for the raw-filing archive (roadmap B.6).
--    Objects live in Supabase Storage (private bucket `raw-filings`; decision in docs/01 §6).
-- 4. social_posts — dedupe ledger for the daily X thread (roadmap B.4).
-- 5. metrics_citations / metrics_search — measurement tables (roadmap B.7).
-- 6. Row-level security on every public data table (open decision #19): read-only SELECT
--    policies for anon + authenticated; no write policies. Filings/transactions are visible
--    to API clients only once is_published is true — the web build reads as the table owner
--    and renders unreviewed rows with a visible "under review" note instead.
--    Ops tables get RLS with no policies (deny by default for API roles). The `postgres`
--    role owns every table and therefore bypasses RLS, so migrations, ingest jobs and the
--    site build are unaffected. Supabase's service_role bypasses RLS as well.

-- 1. companies.slug
alter table companies add column if not exists slug citext;
create unique index if not exists companies_slug_key on companies (slug) where slug is not null;

-- 2. transaction fields
alter table transactions
  add column if not exists owner_type text,      -- self | spouse | dependent | joint (PTR)
  add column if not exists asset_type text,      -- stock | etf | option | bond | fund | crypto | other
  add column if not exists is_10b5_1 boolean;    -- Form 4 aff10b5One checkbox

create index if not exists transactions_filing_idx on transactions (filing_id);
create index if not exists transactions_disclosed_idx on transactions (disclosed_at desc);

-- 3. raw-filing archive
alter table raw_documents
  add column if not exists source_url     text,
  add column if not exists byte_size      bigint,
  add column if not exists storage_bucket text,          -- null = hashed but not yet uploaded
  add column if not exists stored_at      timestamptz,
  add column if not exists filing_id      bigint references filings(id) on delete set null;
create unique index if not exists raw_documents_source_url_key
  on raw_documents (source_url) where source_url is not null;
create index if not exists raw_documents_pending_idx
  on raw_documents (fetched_at) where storage_bucket is null;

-- 4. X thread ledger
create table if not exists social_posts (
    id               bigint generated always as identity primary key,
    channel          text not null default 'x',
    post_date        date not null,
    thread_key       text not null,                -- e.g. 'x:2026-09-27' (one thread per day)
    seq              integer not null default 0,   -- position in the thread
    kind             text,                          -- largest | late_filer | first_time | cluster_buy | intro | outro
    filing_id        bigint references filings(id) on delete set null,
    entity_url       text,
    body             text not null,
    external_post_id text,
    status           text not null default 'dry_run' check (status in ('dry_run','posted','failed')),
    error            text,
    created_at       timestamptz not null default now(),
    unique (channel, thread_key, seq)
);
create index if not exists social_posts_filing_idx on social_posts (filing_id) where filing_id is not null;

-- 5. measurement
create table if not exists metrics_citations (
    id             bigint generated always as identity primary key,
    run_date       date not null,
    engine         text not null,                   -- openai | anthropic | perplexity | gemini | manual:<name>
    question_id    text not null,
    question       text not null,
    cited          boolean,                          -- spotthemoney.com named or linked in the answer
    cited_urls     jsonb,                            -- every URL the engine cited
    answer_excerpt text,                             -- first ~500 chars, for spot checks
    error          text,
    created_at     timestamptz not null default now(),
    unique (run_date, engine, question_id)
);

create table if not exists metrics_search (
    id          bigint generated always as identity primary key,
    week_start  date not null,                       -- Monday of the ISO week
    page_type   text not null,                       -- home | rates | insiders | companies | stocks | congress | donations | lobbying | contracts | disclosures | other
    impressions bigint not null default 0,
    clicks      bigint not null default 0,
    ctr         numeric(8,5),
    position    numeric(8,3),
    pages       integer not null default 0,          -- distinct URLs with ≥1 impression
    created_at  timestamptz not null default now(),
    unique (week_start, page_type)
);

-- 6. Row-level security (read-only public policies)
do $$
declare
  t text;
begin
  -- Public, fully readable reference + data tables.
  foreach t in array array[
    'companies','securities','people','person_roles',
    'rate_series','rate_observations','security_prices',
    'committees','donations','lobbying','contracts',
    'transaction_performance','leaderboard_snapshots'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy public_read on %I for select to anon, authenticated using (true)', t);
  end loop;

  -- Gated: only published filings (and their transactions) reach API clients.
  alter table filings enable row level security;
  create policy public_read on filings for select to anon, authenticated using (is_published);

  alter table transactions enable row level security;
  create policy public_read on transactions for select to anon, authenticated
    using (exists (select 1 from filings f where f.id = transactions.filing_id and f.is_published));

  -- Ops / internal tables: RLS on, no policies → API roles see nothing.
  foreach t in array array[
    'sources','ingest_runs','source_cursors','raw_documents','review_queue',
    'social_posts','metrics_citations','metrics_search'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
