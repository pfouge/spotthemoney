-- 0021 — each company's SEC industry code (2026-11-17, parity queue item 3: "sector from SIC").
--
-- The SEC assigns every filer a four-digit Standard Industrial Classification code and a short
-- description. Source `sec_company_sic` reads both from the SEC's submissions data
-- (data.sec.gov/submissions/CIK##########.json), one request per company, and stores them here
-- as stated. The division a code falls in is not stored: it is a lookup on the code's first two
-- digits (shared/src/sic.ts).
--
-- A table of its own, keyed by CIK like company_size (0013), so `companies` and the frozen
-- site_* views of 0019 are not touched. `companies.sector` stays unused.
--
-- A row with sic NULL means "asked, and the SEC lists no code" (or has no such filer), so the
-- job does not ask again every day. checked_at is when the SEC was last asked.
create table if not exists company_sic (
    cik             text primary key,          -- 10 digits, zero-padded, as companies.cik
    sic             text,                      -- 4 digits, as the SEC states it; NULL = none listed
    sic_description text,                      -- the SEC's wording
    checked_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
-- Read at build time through DATABASE_URL only; no public policy.
alter table company_sic enable row level security;
