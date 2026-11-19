-- 0029: SEC Form 144 notices (queue item 8, "Form 144", stage 1: stored, not yet shown).
--
-- A Form 144 is the notice a holder files with the SEC when they PROPOSE to sell restricted or
-- control securities under Rule 144. It is a notice of a planned sale, not a report of a sale:
-- the sale may happen later, in part, or not at all. Since April 2023 the form is filed on EDGAR
-- as XML. The source `sec_form144` (ingest/src/sources/sec_form144.ts) reads the EDGAR daily
-- index, takes every submission of type 144 or 144/A, and stores one row per submission here.
--
-- A table of its own, not `filings`: `filings.source` is an enum the site's five `site_*` views
-- and the on-demand functions are built on, and a notice has no transactions. One row is one
-- submission (accession). An amendment (144/A) is its own row; nothing here says which earlier
-- notice it replaces, because the form does not.
--
-- Columns hold the figures as filed. `shares` and `market_value` are the sums over the form's
-- "securities information" lines; the lines themselves are in `payload`. Addresses and phone
-- numbers on the form are not stored. `parser_version` lets a later parser fix re-read old rows
-- in place (the source re-fetches rows stored by an older version).
--
-- Access (rules of 0022 and 0023): row-level security on, no policy and no grant to anon or
-- authenticated, so the table is closed to the API. The read-only build role `site_build` may
-- read it (the data is public). Idempotent.

create table if not exists form144_notices (
  id                  bigserial primary key,
  accession           text not null unique,
  form_type           text not null check (form_type in ('144', '144/A')),
  filed_at            date not null,
  issuer_cik          text,            -- 10 digits, as companies.cik
  issuer_name         text,
  filer_cik           text,            -- the submission's filer, 10 digits (often the seller)
  seller_name         text,            -- "person for whose account the securities are to be sold"
  relationships       text[] not null default '{}',   -- as stated: Officer, Director, ...
  security_class      text,
  shares              numeric,         -- units to be sold, summed over the form's lines
  market_value        numeric,         -- aggregate market value as stated, summed
  shares_outstanding  numeric,
  approx_sale_date    date,            -- earliest approximate sale date on the form
  exchange            text,
  broker              text,
  plan_adoption_date  date,            -- earliest Rule 10b5-1 plan adoption date stated, if any
  notice_date         date,
  sold_3m_shares      numeric,         -- "securities sold during the past 3 months", summed
  sold_3m_proceeds    numeric,
  nothing_sold_3m     boolean,
  payload             jsonb not null default '{}'::jsonb,
  source_url          text,
  parser_version      integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists form144_notices_issuer_idx on form144_notices (issuer_cik, filed_at desc);
create index if not exists form144_notices_filed_idx on form144_notices (filed_at desc);

alter table form144_notices enable row level security;

revoke all on form144_notices from anon, authenticated;
revoke all on sequence form144_notices_id_seq from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_build') then
    grant select on form144_notices to site_build;
  end if;
end $$;
