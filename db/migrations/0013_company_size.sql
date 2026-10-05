-- 0013 — company size from SEC filings (2026-10-05). Peter asked for a market-cap filter.
-- Price data is not licensed for display (docs/04 #33), so size is estimated from filings
-- only: shares outstanding (cover page of the latest 10-Q/10-K) and public float (latest
-- 10-K), both from the SEC's XBRL "frames" API. The site multiplies shares by the most
-- recent price reported on a Form 4 at build time; nothing here is a market quote.
create table if not exists company_size (
    cik                text primary key,          -- 10 digits, zero-padded, as companies.cik
    shares_outstanding numeric(20,0),
    shares_as_of       date,
    public_float       numeric(20,2),             -- dollars, as stated on the 10-K cover
    float_as_of        date,
    updated_at         timestamptz not null default now()
);
-- Read at build time through DATABASE_URL only; no public policy.
alter table company_size enable row level security;
