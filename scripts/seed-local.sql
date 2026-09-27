-- scripts/seed-local.sql — synthetic rows so the whole site builds OFFLINE against a throwaway
-- Postgres (the "local dev tip" from CLAUDE.md SESSION STATE 2026-09-06, scripted).
--
-- Usage (a fresh local Postgres 16, never Supabase):
--   createdb stm
--   psql -d stm -c "create schema auth; create table auth.users(id uuid primary key);
--                   create function auth.uid() returns uuid language sql stable as \$\$ select null::uuid \$\$;
--                   create role anon nologin; create role authenticated nologin;"
--   DATABASE_URL=postgresql://localhost/stm node db/migrate.mjs
--   psql -d stm -f scripts/seed-local.sql
--   DATABASE_URL=postgresql://localhost/stm npm run build
--
-- Every value below is invented (names, CIKs, accessions, amounts) — never load this into the
-- production database. Idempotent: re-running truncates the seeded tables first.

begin;

truncate transactions, filings, person_roles, people, securities, companies, lobbying, contracts,
         donations, committees, rate_observations, rate_series, raw_documents, social_posts,
         review_queue restart identity cascade;

-- ── rates ───────────────────────────────────────────────────────────────────────────────
insert into rate_series (code, label, source, source_ref, unit, frequency) values
  ('IBOND_COMPOSITE', 'I Bond Composite Rate', 'treasury_fiscaldata', 'v1/accounting/od/i_bonds_interest_rates', 'percent', 'semiannual'),
  ('CPI_U_NSA', 'CPI-U All Items, U.S. City Average, NSA (1982-84=100)', 'bls', 'CUUR0000SA0', 'index', 'monthly');
insert into rate_observations (series_id, obs_date, value, meta) values
  ((select id from rate_series where code='IBOND_COMPOSITE'), '2026-05-01', 4.26, '{"fixedRate": 1.10, "semiannualInflationRate": 1.56}'),
  ((select id from rate_series where code='IBOND_COMPOSITE'), '2025-11-01', 4.03, '{"fixedRate": 0.90, "semiannualInflationRate": 1.55}');
-- CPI: March→August 2026 published, September not yet (five of six months known)
insert into rate_observations (series_id, obs_date, value, meta)
select (select id from rate_series where code='CPI_U_NSA'), d, v, null from (values
  ('2025-09-01'::date, 324.800), ('2025-10-01', 325.100), ('2025-11-01', 325.500), ('2025-12-01', 325.900),
  ('2026-01-01', 326.700), ('2026-02-01', 327.500), ('2026-03-01', 328.400), ('2026-04-01', 329.300),
  ('2026-05-01', 330.000), ('2026-06-01', 330.600), ('2026-07-01', 331.100), ('2026-08-01', 331.700)) as t(d, v);
-- nominal + real curves for the last ~70 business days
insert into rate_series (code, label, source, source_ref, unit, frequency)
select 'UST_PAR_' || t, 'UST Par Yield ' || t, 'treasury', 'seed', 'percent', 'daily' from unnest(array['1M','3M','6M','1Y','2Y','3Y','5Y','7Y','10Y','20Y','30Y']) t
union all
select 'UST_REAL_' || t, 'TIPS Real Yield ' || t, 'treasury', 'seed', 'percent', 'daily' from unnest(array['5Y','7Y','10Y','20Y','30Y']) t;
insert into rate_observations (series_id, obs_date, value, meta)
select s.id, d::date,
       round((case s.code
         when 'UST_PAR_1M' then 4.30 when 'UST_PAR_3M' then 4.25 when 'UST_PAR_6M' then 4.15 when 'UST_PAR_1Y' then 3.95
         when 'UST_PAR_2Y' then 3.70 when 'UST_PAR_3Y' then 3.65 when 'UST_PAR_5Y' then 3.75 when 'UST_PAR_7Y' then 3.90
         when 'UST_PAR_10Y' then 4.10 when 'UST_PAR_20Y' then 4.60 when 'UST_PAR_30Y' then 4.70
         when 'UST_REAL_5Y' then 1.45 when 'UST_REAL_7Y' then 1.60 when 'UST_REAL_10Y' then 1.80 when 'UST_REAL_20Y' then 2.15 when 'UST_REAL_30Y' then 2.30 end
         + sin(extract(doy from d::date) / 9.0) * 0.12)::numeric, 2), null
  from rate_series s, generate_series(current_date - 100, current_date, '1 day') d
 where (s.code like 'UST_PAR_%' or s.code like 'UST_REAL_%') and extract(isodow from d::date) < 6;

-- ── companies / securities / insiders ───────────────────────────────────────────────────
insert into companies (name, cik, primary_ticker, slug) values
  ('NVIDIA CORP', '0001045810', 'NVDA', 'nvidia-corp'),
  ('MICROSOFT CORP', '0000789019', 'MSFT', 'microsoft-corp'),
  ('PALANTIR TECHNOLOGIES INC.', '0001321655', 'PLTR', 'palantir-technologies-inc'),
  ('LOCKHEED MARTIN CORP', '0000936468', 'LMT', 'lockheed-martin-corp');
insert into securities (ticker, type, name, company_id) values
  ('NVDA', 'equity', 'NVIDIA Corp', (select id from companies where cik='0001045810')),
  ('MSFT', 'equity', 'Microsoft Corp', (select id from companies where cik='0000789019')),
  ('PLTR', 'equity', 'Palantir Technologies', (select id from companies where cik='0001321655')),
  ('LMT', 'equity', 'Lockheed Martin', (select id from companies where cik='0000936468')),
  ('SPY', 'etf', 'SPDR S&P 500 ETF', null), ('AAPL', 'equity', 'Apple Inc', null), ('AMD', 'equity', 'Advanced Micro Devices', null),
  ('ABT', 'equity', 'Abbott Laboratories', null), ('ADBE', 'equity', 'Adobe Inc', null);

insert into people (full_name, slug, cik) values
  ('Huang Jen Hsun', 'huang-jen-hsun', '0001100000'),
  ('Kress Colette', 'kress-colette', '0001100001'),
  ('Nadella Satya', 'nadella-satya', '0001100002'),
  ('Karp Alexander C.', 'karp-alexander-c', '0001100003'),
  ('Taiclet James D. Jr.', 'taiclet-james-d-jr', '0001100004'),
  ('Ortiz Maria', 'ortiz-maria', '0001100005'),
  ('Chen Wei', 'chen-wei', '0001100006');
insert into person_roles (person_id, role_kind, company_id, officer_title, is_director) values
  ((select id from people where cik='0001100000'), 'insider', (select id from companies where cik='0001045810'), 'President and CEO', true),
  ((select id from people where cik='0001100001'), 'insider', (select id from companies where cik='0001045810'), 'EVP and Chief Financial Officer', false),
  ((select id from people where cik='0001100002'), 'insider', (select id from companies where cik='0000789019'), 'Chairman and CEO', true),
  ((select id from people where cik='0001100003'), 'insider', (select id from companies where cik='0001321655'), 'Chief Executive Officer', true),
  ((select id from people where cik='0001100004'), 'insider', (select id from companies where cik='0000936468'), 'Chairman, President and CEO', true),
  ((select id from people where cik='0001100005'), 'insider', (select id from companies where cik='0001321655'), 'Director', true),
  ((select id from people where cik='0001100006'), 'insider', (select id from companies where cik='0001321655'), null, true);

-- Congress members (House) — invented names
insert into people (full_name, first_name, last_name, slug) values
  ('Jordan Whitfield', 'Jordan', 'Whitfield', 'jordan-whitfield'),
  ('Elena Marsh', 'Elena', 'Marsh', 'elena-marsh'),
  ('Samuel Okafor', 'Samuel', 'Okafor', 'samuel-okafor');
insert into person_roles (person_id, role_kind, chamber, state, district, party, valid_from) values
  ((select id from people where slug='jordan-whitfield'), 'congress', 'house', 'TX', '21', 'R', '2025-01-03'),
  ((select id from people where slug='elena-marsh'), 'congress', 'house', 'CA', '17', 'D', '2025-01-03'),
  ((select id from people where slug='samuel-okafor'), 'congress', 'house', 'OH', '11', 'D', '2025-01-03');

-- ── Form 4 filings + transactions (a spread of dates, codes, a cluster buy on PLTR, a late one) ─
create temp table seed_f4 (accession text, person_cik text, ticker text, filed date, txn date, code text, shares numeric, price numeric, published boolean, aff boolean, after_shares numeric);
insert into seed_f4 values
  ('0001045810-26-000101', '0001100000', 'NVDA', current_date - 2,  current_date - 4,  'S', 120000, 176.42, false, true, 75100000),
  ('0001045810-26-000102', '0001100001', 'NVDA', current_date - 9,  current_date - 11, 'S', 30000,  171.10, false, true, 640000),
  ('0001045810-26-000103', '0001100000', 'NVDA', current_date - 30, current_date - 32, 'S', 120000, 168.00, false, true, 75220000),
  ('0000789019-26-000201', '0001100002', 'MSFT', current_date - 5,  current_date - 7,  'S', 25000,  508.30, true,  true, 800000),
  ('0000789019-26-000202', '0001100002', 'MSFT', current_date - 60, current_date - 62, 'A', 40000,  0,      true,  null, 825000),
  ('0001321655-26-000301', '0001100003', 'PLTR', current_date - 3,  current_date - 4,  'P', 50000,  41.20,  false, false, 6400000),
  ('0001321655-26-000302', '0001100005', 'PLTR', current_date - 6,  current_date - 8,  'P', 12000,  40.10,  false, false, 55000),
  ('0001321655-26-000303', '0001100006', 'PLTR', current_date - 12, current_date - 13, 'P', 8000,   39.75,  false, false, 20000),
  ('0001321655-26-000304', '0001100003', 'PLTR', current_date - 45, current_date - 55, 'S', 200000, 44.00,  false, true, 6350000),
  ('0000936468-26-000401', '0001100004', 'LMT',  current_date - 1,  current_date - 3,  'P', 3000,   462.15, false, false, 120000),
  ('0000936468-26-000402', '0001100004', 'LMT',  current_date - 90, current_date - 92, 'M', 10000,  0,      true,  null, 117000);
insert into filings (source, external_id, filer_person_id, filer_company_id, filed_at, source_url, confidence, review, is_published, payload)
select 'sec_form4', f.accession, p.id, c.id, f.filed::timestamptz,
       'https://www.sec.gov/Archives/edgar/data/' || ltrim(c.cik, '0') || '/' || replace(f.accession, '-', '') || '/wk-form4_' || replace(f.accession, '-', '') || '.xml',
       1.0, 'auto_approved', f.published, jsonb_build_object('accession', f.accession, 'seed', true)
  from seed_f4 f join people p on p.cik = f.person_cik join companies c on c.primary_ticker = f.ticker;
insert into transactions (filing_id, person_id, security_id, side, txn_code, is_derivative, txn_date, disclosed_at, shares, price, disclosure_lag_days, confidence, review, is_10b5_1, owner_type, asset_type)
select fi.id, fi.filer_person_id, s.id,
       case f.code when 'P' then 'buy' when 'S' then 'sell' when 'M' then 'option' else 'other' end::txn_side,
       f.code, f.code = 'M', f.txn, f.filed, f.shares, f.price, f.filed - f.txn, 1.0, 'auto_approved', f.aff, 'self', case when f.code='M' then 'derivative' else 'stock' end
  from seed_f4 f join filings fi on fi.external_id = f.accession join securities s on s.ticker = f.ticker and s.type = 'equity';

-- ── House PTR filings ────────────────────────────────────────────────────────────────────
create temp table seed_ptr (doc text, slug text, filed date, txn date, ttype text, ticker text, lo numeric, hi numeric, owner text, atype text, conf numeric, published boolean);
insert into seed_ptr values
  ('20031001', 'jordan-whitfield', current_date - 1,  current_date - 20, 'purchase', 'NVDA', 15001, 50000, 'self', 'stock', 0.9, false),
  ('20031001', 'jordan-whitfield', current_date - 1,  current_date - 18, 'sale',     'AAPL', 1001, 15000, 'spouse', 'stock', 0.9, false),
  ('20031002', 'elena-marsh',      current_date - 4,  current_date - 70, 'purchase', 'MSFT', 50001, 100000, 'joint', 'stock', 0.9, false),
  ('20031002', 'elena-marsh',      current_date - 4,  current_date - 68, 'purchase', 'PLTR', 1001, 15000, 'joint', 'stock', 0.9, false),
  ('20031003', 'samuel-okafor',    current_date - 15, current_date - 30, 'sale_partial', 'LMT', 15001, 50000, 'self', 'stock', 0.9, false),
  ('20031004', 'samuel-okafor',    current_date - 40, current_date - 44, 'purchase', 'SPY', 1001, 15000, 'self', 'etf', 0.9, false),
  ('20031005', 'elena-marsh',      current_date - 8,  null, null, null, null, null, null, null, 0.3, false); -- needs_ocr
insert into filings (source, external_id, filer_person_id, filed_at, source_url, confidence, review, is_published, payload)
select distinct on (s.doc) 'house_ptr', s.doc, p.id, s.filed::timestamptz,
       'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/' || extract(year from s.filed) || '/' || s.doc || '.pdf',
       s.conf, case when s.conf < 0.9 then 'pending' else 'auto_approved' end::review_status, s.published, jsonb_build_object('seed', true)
  from seed_ptr s join people p on p.slug = s.slug order by s.doc;
insert into transactions (filing_id, person_id, security_id, side, txn_code, txn_date, disclosed_at, amount_low, amount_high, disclosure_lag_days, confidence, review, owner_type, asset_type)
select fi.id, fi.filer_person_id, sec.id,
       case s.ttype when 'purchase' then 'buy' when 'sale' then 'sell' when 'sale_partial' then 'sell' else 'other' end::txn_side,
       s.ttype, s.txn, s.filed, s.lo, s.hi, s.filed - s.txn, s.conf, 'auto_approved', s.owner, s.atype
  from seed_ptr s join filings fi on fi.external_id = s.doc and fi.source = 'house_ptr'
  left join securities sec on sec.ticker = s.ticker and sec.type = case when s.atype = 'etf' then 'etf' else 'equity' end::security_type
 where s.ttype is not null;
insert into review_queue (filing_id, reason, confidence, status) select id, 'needs_ocr', 0.3, 'pending' from filings where external_id = '20031005';

-- ── lobbying / contracts / committees / donations ────────────────────────────────────────
insert into lobbying (registrant, client, issue_area, amount, period_year, period_quarter, filing_uuid, filing_type, issues, source_ref) values
  ('Akin Gump Strauss Hauer & Feld', 'Lockheed Martin Corp', 'DEF', 320000, 2026, 2, 'seed-l1', 'Q2', '["DEF","BUD"]', 'https://lda.senate.gov/filings/public/filing/seed-l1/'),
  ('Palantir Technologies Inc.', 'Palantir Technologies Inc.', 'DEF', 1490000, 2026, 2, 'seed-l2', 'Q2', '["DEF","HOM","CPT"]', 'https://lda.senate.gov/filings/public/filing/seed-l2/'),
  ('Microsoft Corp', 'Microsoft Corp', 'CPT', 2640000, 2026, 2, 'seed-l3', 'Q2', '["CPT","TAX","TRD"]', 'https://lda.senate.gov/filings/public/filing/seed-l3/'),
  ('Brownstein Hyatt Farber Schreck', 'NVIDIA Corp', 'TRD', 150000, 2026, 2, 'seed-l4', 'Q2', '["TRD","CPT"]', 'https://lda.senate.gov/filings/public/filing/seed-l4/'),
  ('Microsoft Corp', 'Microsoft Corp', 'CPT', 2510000, 2026, 1, 'seed-l5', 'Q1', '["CPT","TAX"]', 'https://lda.senate.gov/filings/public/filing/seed-l5/');
insert into contracts (recipient, awarding_agency, amount, action_date, naics, source_ref) values
  ('LOCKHEED MARTIN CORP', 'Department of Defense', 1250000000, current_date - 12, '336411', 'CONT_AWD_SEED1'),
  ('LOCKHEED MARTIN CORP', 'Department of Defense', 84000000, current_date - 40, '336414', 'CONT_AWD_SEED2'),
  ('PALANTIR TECHNOLOGIES INC.', 'Department of the Army', 480000000, current_date - 5, '541511', 'CONT_AWD_SEED3'),
  ('MICROSOFT CORP', 'General Services Administration', 21000000, current_date - 70, '511210', 'CONT_AWD_SEED4'),
  ('ACME LOGISTICS LLC', 'Department of Veterans Affairs', 3200000, current_date - 2, '484121', 'CONT_AWD_SEED5');
insert into committees (fec_id, name, party, committee_type) values
  ('C00SEED001', 'Whitfield for Congress', 'REP', 'H'), ('C00SEED002', 'Marsh for California', 'DEM', 'H'), ('C00SEED003', 'Freedom Forward PAC', null, 'PAC');
insert into donations (committee_id, donor_name, donor_employer, donor_state, amount, donated_at, source_ref)
select c.id, 'WITHHELD', e, st, a, current_date - d, 'seed-' || row_number() over ()
  from committees c, (values ('Self-employed','TX',2500,3),('Retired','CA',1000,10),('Microsoft','WA',3300,15),('Lockheed Martin','MD',2900,22),('Not employed','OH',250,40)) as t(e, st, a, d);

commit;
