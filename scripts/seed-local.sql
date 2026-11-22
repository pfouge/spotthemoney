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
  ('LOCKHEED MARTIN CORP', '0000936468', 'LMT', 'lockheed-martin-corp'),
  -- Two companies with an industry code and no insider filings, for the industry pages
  -- (web/src/lib/industries.ts): Apple shares a division with NVIDIA under another code, AMD
  -- shares NVIDIA's code. Their stock is in congressional reports only.
  ('APPLE INC', '0000320193', 'AAPL', 'apple-inc'),
  ('ADVANCED MICRO DEVICES INC', '0000002488', 'AMD', 'advanced-micro-devices-inc');
-- Industry codes as the sec_company_sic job stores them (migration 0021). Lockheed has a row with
-- no code (the SEC lists none), Palantir has no row at all: neither page may show an industry.
truncate company_sic;
insert into company_sic (cik, sic, sic_description) values
  ('0001045810', '3674', 'Semiconductors & Related Devices'),
  ('0000789019', '7372', 'Services-Prepackaged Software'),
  ('0000320193', '3571', 'Electronic Computers'),
  ('0000002488', '3674', 'Semiconductors & Related Devices'),
  ('0000936468', null, null);
insert into securities (ticker, type, name, company_id) values
  ('NVDA', 'equity', 'NVIDIA Corp', (select id from companies where cik='0001045810')),
  ('MSFT', 'equity', 'Microsoft Corp', (select id from companies where cik='0000789019')),
  ('PLTR', 'equity', 'Palantir Technologies', (select id from companies where cik='0001321655')),
  ('LMT', 'equity', 'Lockheed Martin', (select id from companies where cik='0000936468')),
  ('SPY', 'etf', 'SPDR S&P 500 ETF', null), ('AAPL', 'equity', 'Apple Inc', (select id from companies where cik='0000320193')), ('AMD', 'equity', 'Advanced Micro Devices', (select id from companies where cik='0000002488')),
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

-- Members with no trades (for the member directory's filters): two senators, one of them an
-- independent, and a representative who has left office. Invented names.
insert into people (full_name, first_name, last_name, slug) values
  ('Priya Lindqvist', 'Priya', 'Lindqvist', 'priya-lindqvist'),
  ('Walter Abara Jr.', 'Walter', 'Abara', 'walter-abara-jr'),
  ('Marcus Delacroix', 'Marcus', 'Delacroix', 'marcus-delacroix');
insert into person_roles (person_id, role_kind, chamber, state, district, party, valid_from, valid_to) values
  ((select id from people where slug='priya-lindqvist'), 'congress', 'senate', 'TX', null, 'I', '2023-01-03', null),
  ((select id from people where slug='walter-abara-jr'), 'congress', 'senate', 'OH', null, 'R', '2025-01-03', null),
  ((select id from people where slug='marcus-delacroix'), 'congress', 'house', 'AK', '0', 'D', '2023-01-03', current_date - 200);

-- Committee seats (migration 0015), so member pages and the directory's committee filter have data.
delete from congress_committees;
insert into congress_committees (code, parent_code, chamber, name) values
  ('HSAG', null, 'house', 'House Committee on Agriculture'),
  ('HSAG15', 'HSAG', 'house', 'Livestock, Dairy, and Poultry'),
  ('HSBA', null, 'house', 'House Committee on Financial Services'),
  ('SSAF', null, 'senate', 'Senate Committee on Agriculture, Nutrition, and Forestry'),
  ('SSBK', null, 'senate', 'Senate Committee on Banking, Housing, and Urban Affairs');
insert into congress_committee_members (committee_code, person_id, side, rank, title) values
  ('HSAG', (select id from people where slug='jordan-whitfield'), 'majority', 1, 'Chair'),
  ('HSAG15', (select id from people where slug='jordan-whitfield'), 'majority', 2, null),
  ('HSBA', (select id from people where slug='elena-marsh'), 'minority', 3, null),
  ('HSAG', (select id from people where slug='samuel-okafor'), 'minority', 4, null),
  ('HSAG15', (select id from people where slug='samuel-okafor'), 'minority', 4, null),
  ('SSAF', (select id from people where slug='priya-lindqvist'), 'minority', 2, null),
  ('SSBK', (select id from people where slug='priya-lindqvist'), 'minority', 5, null),
  ('SSBK', (select id from people where slug='walter-abara-jr'), 'majority', 1, 'Chair');

-- ── Form 4 filings + transactions (a spread of dates, codes, a cluster buy on PLTR, a late one) ─
create temp table seed_f4 (accession text, person_cik text, ticker text, filed date, txn date, code text, shares numeric, price numeric, published boolean, aff boolean, after_shares numeric);
insert into seed_f4 values
  ('0001045810-26-000101', '0001100000', 'NVDA', current_date - 2,  current_date - 4,  'S', 120000, 176.42, false, true, 75100000),
  ('0001045810-26-000102', '0001100001', 'NVDA', current_date - 9,  current_date - 11, 'S', 30000,  171.10, false, true, 0),
  ('0001045810-26-000103', '0001100000', 'NVDA', current_date - 30, current_date - 32, 'S', 120000, 168.00, false, true, 75220000),
  ('0000789019-26-000201', '0001100002', 'MSFT', current_date - 5,  current_date - 7,  'S', 25000,  508.30, true,  true, 800000),
  ('0000789019-26-000202', '0001100002', 'MSFT', current_date - 60, current_date - 62, 'A', 40000,  0,      true,  null, 825000),
  ('0001321655-26-000301', '0001100003', 'PLTR', current_date - 3,  current_date - 4,  'P', 50000,  41.20,  false, false, 6400000),
  ('0001321655-26-000302', '0001100005', 'PLTR', current_date - 6,  current_date - 8,  'P', 12000,  40.10,  false, false, 12000),
  ('0001321655-26-000303', '0001100006', 'PLTR', current_date - 12, current_date - 13, 'P', 8000,   39.75,  false, false, null),
  ('0001321655-26-000304', '0001100003', 'PLTR', current_date - 45, current_date - 55, 'S', 200000, 44.00,  false, true, 6350000),
  -- Home feed (notable.ts): a large sale outside any plan, and a sale that cuts a holding by 75%.
  ('0000789019-26-000203', '0001100002', 'MSFT', current_date - 3,  current_date - 5,  'S', 20000,  508.30, false, false, 1000000),
  ('0001321655-26-000305', '0001100005', 'PLTR', current_date - 2,  current_date - 3,  'S', 30000,  40.00,  false, false, 10000),
  -- Home feed cluster sell (notable.ts): three PLTR insiders sell outside any plan, each $250,000+ and cutting their own holding 10%+ (Ortiz above, Karp and Chen here).
  ('0001321655-26-000306', '0001100003', 'PLTR', current_date - 1,  current_date - 2,  'S', 700000, 41.00,  false, false, 5700000),
  ('0001321655-26-000307', '0001100006', 'PLTR', current_date - 1,  current_date - 2,  'S', 8000,   40.00,  false, false, 2000),
  ('0000936468-26-000401', '0001100004', 'LMT',  current_date - 1,  current_date - 3,  'P', 3000,   462.15, false, false, 120000),
  ('0000936468-26-000402', '0001100004', 'LMT',  current_date - 90, current_date - 92, 'M', 10000,  0,      true,  null, 117000),
  -- Filed before the site's Form 4 record starts (shared/src/floor.ts): stored, never shown.
  -- verify-downloads fails if this row reaches a download.
  ('0001045810-19-000900', '0001100000', 'NVDA', date '2019-03-14', date '2019-03-12', 'P', 777, 33.33, true, false, 1234567);
insert into filings (source, external_id, filer_person_id, filer_company_id, filed_at, source_url, confidence, review, is_published, payload)
select 'sec_form4', f.accession, p.id, c.id, f.filed::timestamptz,
       'https://www.sec.gov/Archives/edgar/data/' || ltrim(c.cik, '0') || '/' || replace(f.accession, '-', '') || '/wk-form4_' || replace(f.accession, '-', '') || '.xml',
       1.0, 'auto_approved', f.published, jsonb_build_object('accession', f.accession, 'seed', true,
       'transactions', jsonb_build_array(jsonb_build_object('shares', f.shares, 'sharesOwnedAfter', f.after_shares)))
  from seed_f4 f join people p on p.cik = f.person_cik join companies c on c.primary_ticker = f.ticker;
-- Form 4 footnotes (web/src/lib/footnotes.ts): stored per filing, as the data jobs write them.
-- One filing with XML escapes and a repeated note, one with more notes than a table prints,
-- and the pre-floor filing, whose note must never reach a page.
update filings set payload = payload || jsonb_build_object('footnotes', jsonb_build_array(
    'The price reported is a weighted average. The shares were sold in multiple transactions at prices from $40.10 to $41.95.',
    'Held by the Karp &amp; Family Trust (the &quot;Trust&quot;), of which the reporting person is trustee.',
    'Held by the Karp &amp; Family Trust (the &quot;Trust&quot;), of which the reporting person is trustee.'))
 where source = 'sec_form4' and external_id = '0001321655-26-000306';
update filings set payload = payload || jsonb_build_object('footnotes', jsonb_build_array(
    'The purchase was made in the open market.'))
 where source = 'sec_form4' and external_id = '0001321655-26-000301';
update filings set payload = payload || jsonb_build_object('footnotes',
    (select jsonb_agg('Seed footnote number ' || n || ' of twelve, about one lot of the sale.' order by n) from generate_series(1, 12) n))
 where source = 'sec_form4' and external_id = '0000789019-26-000203';
update filings set payload = payload || jsonb_build_object('footnotes', jsonb_build_array('PRE-FLOOR NOTE: must not be shown.'))
 where source = 'sec_form4' and external_id = '0001045810-19-000900';
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
  ('20031005', 'elena-marsh',      current_date - 8,  null, null, null, null, null, null, null, 0.3, false), -- needs_ocr
  -- Ticker history flags (web/src/lib/tickerhistory.ts): AMD bought on four trade dates running (two
  -- lots on the third), then sold; and a day with a purchase and a sale both, which carries no run.
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 41, 'purchase', 'AMD', 1001, 15000, 'self', 'stock', 0.9, false),
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 34, 'purchase', 'AMD', 1001, 15000, 'self', 'stock', 0.9, false),
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 27, 'purchase', 'AMD', 15001, 50000, 'self', 'stock', 0.9, false),
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 27, 'purchase', 'AMD', 1001, 15000, 'spouse', 'stock', 0.9, false),
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 21, 'purchase', 'AMD', 1001, 15000, 'self', 'stock', 0.9, false),
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 12, 'sale_partial', 'AMD', 1001, 15000, 'self', 'stock', 0.9, false),
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 9,  'purchase', 'AMD', 1001, 15000, 'self', 'stock', 0.9, false),
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 9,  'sale',     'AMD', 1001, 15000, 'spouse', 'stock', 0.9, false),
  -- an exact amount on the report (stored low = high) and the open-topped spouse / dependent-child box
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 8,  'purchase', null, 319, 319, 'self', 'fund', 0.9, false),
  ('20031006', 'samuel-okafor',    current_date - 2,  current_date - 8,  'purchase', null, 1000000, null, 'spouse', 'bond', 0.9, false);
-- Generated rows for the Congress trade screener (/congress-trades/): enough rows to page through,
-- with every side, owner and amount step, late reports, an open-topped range and assets with no ticker.
insert into seed_ptr
select '2004' || lpad((g / 4)::text, 4, '0'),
       (array['jordan-whitfield','elena-marsh','samuel-okafor'])[1 + (g / 4) % 3],
       current_date - (3 + (g / 4) * 9),
       current_date - (3 + (g / 4) * 9) - (5 + (g * 7) % 60),
       (array['purchase','sale','sale_partial','purchase','exchange'])[1 + g % 5],
       (array['NVDA','AAPL','MSFT','PLTR','LMT', null])[1 + g % 6],
       (array[1001,15001,50001,100001,250001,1000001,5000001])[1 + g % 7],
       (array[15000,50000,100000,250000,500000,5000000,null])[1 + g % 7],
       (array['self','spouse','joint','dependent'])[1 + g % 4],
       case when g % 6 = 5 then (array['bond','other'])[1 + (g / 6) % 2] else 'stock' end,
       0.9, false
  from generate_series(0, 47) g;
insert into filings (source, external_id, filer_person_id, filed_at, source_url, confidence, review, is_published, payload)
select distinct on (s.doc) 'house_ptr', s.doc, p.id, s.filed::timestamptz,
       'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/' || extract(year from s.filed) || '/' || s.doc || '.pdf',
       s.conf, case when s.conf < 0.9 then 'pending' else 'auto_approved' end::review_status, s.published, jsonb_build_object('seed', true)
  from seed_ptr s join people p on p.slug = s.slug order by s.doc;
insert into transactions (filing_id, person_id, security_id, side, txn_code, txn_date, disclosed_at, amount_low, amount_high, disclosure_lag_days, confidence, review, owner_type, asset_type)
select fi.id, fi.filer_person_id, sec.id,
       case s.ttype when 'purchase' then 'buy' when 'sale' then 'sell' when 'sale_partial' then 'sell' when 'exchange' then 'exchange' else 'other' end::txn_side,
       s.ttype, s.txn, s.filed, s.lo, s.hi, s.filed - s.txn, s.conf, 'auto_approved', s.owner, s.atype
  from seed_ptr s join filings fi on fi.external_id = s.doc and fi.source = 'house_ptr'
  left join securities sec on sec.ticker = s.ticker and sec.type = case when s.atype = 'etf' then 'etf' else 'equity' end::security_type
 where s.ttype is not null;
insert into review_queue (filing_id, reason, confidence, status) select id, 'needs_ocr', 0.3, 'pending' from filings where external_id = '20031005';

-- One Senate report (Walter Abara Jr.), so the screener's chamber filter has Senate rows locally.
insert into filings (source, external_id, filer_person_id, filed_at, source_url, confidence, review, is_published, payload)
select 'senate_ptr', 'seed-senate-0001', p.id, (current_date - 6)::timestamptz,
       'https://efdsearch.senate.gov/search/view/ptr/seed-senate-0001/', 0.95, 'auto_approved', false, jsonb_build_object('seed', true)
  from people p where p.slug = 'walter-abara-jr';
insert into transactions (filing_id, person_id, security_id, side, txn_code, txn_date, disclosed_at, amount_low, amount_high, disclosure_lag_days, confidence, review, owner_type, asset_type)
select fi.id, fi.filer_person_id, sec.id, v.side::txn_side, v.code, current_date - 6 - v.lag, current_date - 6, v.lo, v.hi, v.lag, 0.95, 'auto_approved', v.owner, 'stock'
  from filings fi, (values ('buy', 'purchase', 'MSFT', 100001, 250000, 20, 'self'), ('sell', 'sale', 'NVDA', 15001, 50000, 52, 'spouse'), ('buy', 'purchase', 'LMT', 1001, 15000, 30, 'joint')) as v(side, code, ticker, lo, hi, lag, owner)
  join securities sec on sec.ticker = v.ticker and sec.type = 'equity'
 where fi.source = 'senate_ptr' and fi.external_id = 'seed-senate-0001';

-- ── lobbying / contracts / committees / donations ────────────────────────────────────────
insert into lobbying (registrant, client, issue_area, amount, period_year, period_quarter, filing_uuid, filing_type, issues, source_ref) values
  ('Akin Gump Strauss Hauer & Feld', 'Lockheed Martin Corp', 'DEF', 320000, 2026, 2, 'seed-l1', 'Q2', '[{"code":"DEF","display":"Defense"},{"code":"BUD","display":"Budget/Appropriations"}]', 'https://lda.senate.gov/filings/public/filing/seed-l1/'),
  ('Palantir Technologies Inc.', 'Palantir Technologies Inc.', 'DEF', 1490000, 2026, 2, 'seed-l2', 'Q2', '[{"code":"DEF","display":"Defense"},{"code":"HOM","display":"Homeland Security"},{"code":"CPT","display":"Copyright/Patent/Trademark"}]', 'https://lda.senate.gov/filings/public/filing/seed-l2/'),
  ('Microsoft Corp', 'Microsoft Corp', 'CPT', 2640000, 2026, 2, 'seed-l3', 'Q2', '[{"code":"CPT","display":"Copyright/Patent/Trademark"},{"code":"TAX","display":"Taxation/Internal Revenue Code"},{"code":"TRD","display":"Trade (domestic/foreign)"}]', 'https://lda.senate.gov/filings/public/filing/seed-l3/'),
  ('Brownstein Hyatt Farber Schreck', 'NVIDIA Corp', 'TRD', 150000, 2026, 2, 'seed-l4', 'Q2', '[{"code":"TRD","display":"Trade (domestic/foreign)"},{"code":"CPT","display":"Copyright/Patent/Trademark"}]', 'https://lda.senate.gov/filings/public/filing/seed-l4/'),
  ('Microsoft Corp', 'Microsoft Corp', 'CPT', 2510000, 2026, 1, 'seed-l5', 'Q1', '[{"code":"CPT","display":"Copyright/Patent/Trademark"},{"code":"TAX","display":"Taxation/Internal Revenue Code"}]', 'https://lda.senate.gov/filings/public/filing/seed-l5/'),
  -- one issue only, and a registration with no amount and no issue (lib/lobbyissues.ts)
  ('Invariant LLC', 'NVIDIA Corp', 'TAX', 90000, 2026, 2, 'seed-l6', 'Q2', '[{"code":"TAX","display":"Taxation/Internal Revenue Code"}]', 'https://lda.senate.gov/filings/public/filing/seed-l6/'),
  ('Invariant LLC', 'Lockheed Martin Corp', null, null, 2026, 3, 'seed-l7', 'RR', '[]', 'https://lda.senate.gov/filings/public/filing/seed-l7/');
-- details (migration 0027; lib/contracts.ts): a long description (cut in the table), a
-- sub-agency equal to its agency (not shown twice), one award with no details at all (not yet
-- re-read by the job), and two awards under one sub-agency.
insert into contracts (recipient, awarding_agency, amount, action_date, naics, source_ref, awarding_sub_agency, end_date, description) values
  ('LOCKHEED MARTIN CORP', 'Department of Defense', 1250000000, current_date - 12, '336411', 'CONT_AWD_SEED1', 'Department of the Navy', current_date + 900,
   'PROCUREMENT OF SPARE PARTS AND SUSTAINMENT ENGINEERING SERVICES FOR THE F-35 LIGHTNING II AIRFRAME, PROPULSION SYSTEM AND SUPPORT EQUIPMENT AT ALL OPERATING LOCATIONS WORLDWIDE, INCLUDING DEPOT ACTIVATION'),
  ('LOCKHEED MARTIN CORP', 'Department of Defense', 84000000, current_date - 40, '336414', 'CONT_AWD_SEED2', 'Department of the Navy', current_date + 300, 'TRIDENT II D5 MISSILE PRODUCTION & DEPLOYED SYSTEMS SUPPORT'),
  ('PALANTIR TECHNOLOGIES INC.', 'Department of Defense', 480000000, current_date - 5, '541511', 'CONT_AWD_SEED3', 'Department of the Army', current_date + 1400, 'ARMY DATA PLATFORM SOFTWARE LICENSES'),
  ('MICROSOFT CORP', 'General Services Administration', 21000000, current_date - 70, '511210', 'CONT_AWD_SEED4', 'GENERAL SERVICES ADMINISTRATION', null, 'ENTERPRISE SOFTWARE "E5" LICENSES <RENEWAL>'),
  ('ACME LOGISTICS LLC', 'Department of Veterans Affairs', 3200000, current_date - 2, '484121', 'CONT_AWD_SEED5', null, null, null),
  -- industry codes (lib/naics.ts): SEED4 above carries a code the 2022 edition retired (511210),
  -- SEED6 a code in no edition (shown without a title), SEED7 no code at all.
  ('ACME LOGISTICS LLC', 'Department of Veterans Affairs', 150000, current_date - 20, '999999', 'CONT_AWD_SEED6', null, null, null),
  ('ACME LOGISTICS LLC', 'Department of Veterans Affairs', 90000, current_date - 25, null, 'CONT_AWD_SEED7', null, null, null);
insert into committees (fec_id, name, party, committee_type) values
  ('C00SEED001', 'Whitfield for Congress', 'REP', 'H'), ('C00SEED002', 'Marsh for California', 'DEM', 'H'), ('C00SEED003', 'Freedom Forward PAC', null, 'PAC');
insert into donations (committee_id, donor_name, donor_employer, donor_state, amount, donated_at, source_ref)
select c.id, 'WITHHELD', e, st, a, current_date - d, 'seed-' || row_number() over ()
  from committees c, (values ('Self-employed','TX',2500,3),('Retired','CA',1000,10),('Microsoft','WA',3300,15),('Lockheed Martin','MD',2900,22),('Not employed','OH',250,40)) as t(e, st, a, d);

-- Stored, not shown (lib/coverage-stored.ts; /data/coverage.json key storedNotShown and the
-- methodology's coverage list). Form 144: three notices and one amendment in two months, the
-- newest a few days old, so that load reads as current. Schedules 13D and 13G: three statements
-- about companies with no page, and further down the rows the pages show (also current). One row of each is about a tracked
-- company (NVIDIA, cik 0001045810 in this seed if present; the count is whatever the join gives).
-- A second company that carries NVIDIA's ticker as its main ticker and issues no security. On
-- production 16 companies are like this (a fund whose insider filings name its sponsor's symbol:
-- three companies carry PRU). It has its own page with its own notices and holders; the NVDA
-- stock page shows NVIDIA's, and the verifiers must not mix the two. Inserted here, after the
-- Form 4 seed, which joins companies by ticker.
insert into companies (name, cik, primary_ticker, slug)
select 'SEED SPONSOR CREDIT FUND', '0009996601', 'NVDA', 'seed-sponsor-credit-fund'
 where not exists (select 1 from companies where cik = '0009996601');
delete from form144_notices where accession like 'seed-144-%';
insert into form144_notices (accession, form_type, filed_at, issuer_cik, issuer_name, seller_name, shares, market_value) values
  ('seed-144-1', '144',   current_date - 45, (select cik from companies where cik is not null order by id limit 1), 'Seed Issuer One', 'SEED SELLER A', 1000, 150000),
  ('seed-144-2', '144',   current_date - 44, '0009990001', 'Seed Issuer Two', 'SEED SELLER B', 2500, 90000),
  ('seed-144-3', '144/A', current_date - 6,  '0009990001', 'Seed Issuer Two', 'SEED SELLER B', 2500, 91000),
  ('seed-144-4', '144',   current_date - 4,  '0009990002', 'Seed Issuer Three', 'SEED SELLER C', 400, 12000);
-- Planned sales shown on pages (lib/form144.ts; scripts/verify-form144.mjs). The four rows above
-- stay as they are. These exercise the page section: a seller who is an insider with a page here
-- (filer_cik = people.cik), an amendment, a notice with a plan date, a figure of zero (a dash),
-- text with markup and stray white space, a notice older than the 12-month window, a company with
-- more notices than a page prints (Palantir, 30), and a company with one old notice only
-- (Lockheed Martin: in the file, no section).
insert into form144_notices (accession, form_type, filed_at, issuer_cik, issuer_name, filer_cik, seller_name, relationships, security_class, shares, market_value, shares_outstanding, approx_sale_date, broker, plan_adoption_date, notice_date, sold_3m_shares, sold_3m_proceeds, nothing_sold_3m, source_url) values
  ('seed-144-10', '144',   current_date - 3,  '0001045810', 'NVIDIA CORP', '0001100000', 'HUANG JEN HSUN', '{Officer,Director}', 'Common', 75000, 10650000, 24400000000, current_date - 3, 'Seed Brokerage LLC', current_date - 200, current_date - 3, 150000, 20400000.5, false, 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026000010/seed-144-10-index.htm'),
  ('seed-144-11', '144/A', current_date - 2,  '0001045810', 'NVIDIA CORP', '0001100000', 'HUANG JEN HSUN', '{Officer,Director}', 'Common', 75000, 10700000, 24400000000, current_date - 3, 'Seed Brokerage LLC', current_date - 200, current_date - 2, 150000, 20400000.5, false, 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026000011/seed-144-11-index.htm'),
  ('seed-144-12', '144',   current_date - 30, '0001045810', 'NVIDIA CORP', '0009998801', '  The <b>Seed</b> Family   Trust & Co ', '{"See Remarks",OFFICER,Officer}', 'Class A Common Stock', 1200, 0, null, current_date - 30, 'Other Broker & Sons', null, current_date - 30, null, null, true, 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026000012/seed-144-12-index.htm'),
  ('seed-144-13', '144',   current_date - 400, '0001045810', 'NVIDIA CORP', '0001100001', 'KRESS COLETTE', '{Officer}', 'Common', 5000, 600000, 24400000000, current_date - 400, 'Seed Brokerage LLC', null, current_date - 400, null, null, true, 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026000013/seed-144-13-index.htm'),
  ('seed-144-14', '144',   current_date - 380, '0000936468', 'LOCKHEED MARTIN CORP', '0001100004', 'TAICLET JAMES D JR', '{Officer}', 'Common', 3000, 1400000, 235000000, current_date - 380, 'Seed Brokerage LLC', null, current_date - 380, null, null, true, 'https://www.sec.gov/Archives/edgar/data/936468/000000000026000014/seed-144-14-index.htm'),
  ('seed-144-15', '144',   current_date - 12, '0000789019', 'MICROSOFT CORP', null, 'Seed Holder With No Number', '{}', null, null, 250000, null, null, null, null, null, null, null, null, null);
insert into form144_notices (accession, form_type, filed_at, issuer_cik, issuer_name, filer_cik, seller_name, relationships, security_class, shares, market_value, approx_sale_date, broker, notice_date, nothing_sold_3m, source_url)
select 'seed-144-p' || lpad(g::text, 2, '0'), case when g % 9 = 0 then '144/A' else '144' end, current_date - (g * 5 + 4), '0001321655', 'PALANTIR TECHNOLOGIES INC.',
       case when g % 3 = 0 then '0001100003' when g % 3 = 1 then '0001100005' else '0001100006' end,
       case when g % 3 = 0 then 'KARP ALEXANDER C' when g % 3 = 1 then 'ORTIZ MARIA' else 'CHEN WEI' end,
       case when g % 3 = 0 then '{Officer,Director}'::text[] else '{Director}'::text[] end, 'Class A Common Stock', 1000 * g, 41250.75 * g, current_date - (g * 5 + 4), 'Seed Brokerage LLC', current_date - (g * 5 + 4), true,
       'https://www.sec.gov/Archives/edgar/data/1321655/0000000000260001' || lpad(g::text, 2, '0') || '/seed-144-p' || lpad(g::text, 2, '0') || '-index.htm'
  from generate_series(1, 30) g;
insert into form144_notices (accession, form_type, filed_at, issuer_cik, issuer_name, filer_cik, seller_name, relationships, security_class, shares, market_value, approx_sale_date, notice_date)
values ('seed-144-90', '144', current_date - 12, '0009996601', 'SEED SPONSOR CREDIT FUND', '0009996611', 'Seed Fund Seller', '{Director}', 'Common Shares', 4000, 100000, current_date - 12, current_date - 12),
-- Stated values that cannot be right for the share count (over $1,000,000 a share): the page
-- prints "not shown", the CSV keeps the figure and marks the row. The third is a real-looking
-- high price just under the limit and stays shown.
       ('seed-144-91', '144', current_date - 9, '0001045810', 'NVIDIA CORP', '0001100001', 'KRESS COLETTE', '{Officer}', 'Common', 4000, 25240000000, current_date - 9, current_date - 9),
       ('seed-144-92', '144', current_date - 8, '0001321655', 'PALANTIR TECHNOLOGIES INC.', '0001100005', 'ORTIZ MARIA', '{Director}', 'Class A Common Stock', 860, 11724238884, current_date - 8, current_date - 8),
       ('seed-144-93', '144', current_date - 7, '0001045810', 'NVIDIA CORP', '0009998802', 'Seed High Price Holder', '{Director}', 'Class A', 10, 7600000, current_date - 7, current_date - 7);
delete from schedule13_filings where accession like 'seed-13-%';
insert into schedule13_filings (accession, form_type, schedule, is_amendment, filed_at, issuer_cik, issuer_name, reporter_name, reporter_count, shares_owned, percent_of_class) values
  ('seed-13-1', 'SCHEDULE 13D',   '13D', false, current_date - 80, '0009990003', 'Seed Issuer One', 'SEED HOLDER A', 1, 5000000, 6.1),
  ('seed-13-2', 'SCHEDULE 13G',   '13G', false, current_date - 75, '0009990001', 'Seed Issuer Two', 'SEED HOLDER B', 2, 800000, 5.3),
  ('seed-13-3', 'SCHEDULE 13G/A', '13G', true,  current_date - 40, '0009990001', 'Seed Issuer Two', 'SEED HOLDER B', 2, 700000, 4.6);
-- Large holders shown on pages (lib/schedule13.ts; scripts/verify-schedule13.mjs). The newest row
-- is a few days old, so the load reads as current and the sections are built. To exercise the
-- hidden state: copy the database, `update schedule13_filings set filed_at = filed_at - 30`, build.
-- NVIDIA: a holder with three statements (the newest wins, and it is not the largest), a holder
-- whose newest statement reports nothing left (below 5%), a group of four on Schedule 13D with a
-- purpose, a holder that is a company with a page here (Microsoft), a holder who is an insider
-- with a page (filer_cik = people.cik), a holder with no filer number and markup in its name, a
-- statement with no percent, two statements by one filer on one day (the later accession wins),
-- and fractional shares. Palantir: 28 holders, so the 25-row cap shows. Lockheed Martin: one
-- holder, one statement, under 5%. Microsoft, Apple, AMD: none (no section).
insert into schedule13_filings (accession, form_type, schedule, is_amendment, filed_at, issuer_cik, issuer_name, issuer_cusip, security_class, event_date, filer_cik, reporter_name, reporter_count, shares_owned, percent_of_class, rules, payload, source_url) values
  ('seed-13-10', 'SCHEDULE 13G',   '13G', false, current_date - 300, '0001045810', 'NVIDIA CORP', '67066G104', 'Common Stock', current_date - 320, '0009997701', 'Seed Index Group', 1, 2266625855, 9.32, '{"Rule 13d-1(b)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001310/seed-13-10-index.htm'),
  ('seed-13-11', 'SCHEDULE 13G/A', '13G', true,  current_date - 120, '0001045810', 'NVIDIA CORP', '67066G104', 'Common Stock', current_date - 140, '0009997701', 'Seed Index Group', 1, 2400000000, 9.9, '{"Rule 13d-1(b)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001311/seed-13-11-index.htm'),
  ('seed-13-12', 'SCHEDULE 13G/A', '13G', true,  current_date - 20,  '0001045810', 'NVIDIA CORP', null, 'COMMON STOCK', current_date - 50, '0009997701', 'SEED INDEX GROUP', 1, 1777408252, 7.31, '{"Rule 13d-1(b)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001312/seed-13-12-index.htm'),
  ('seed-13-13', 'SCHEDULE 13G',   '13G', false, current_date - 280, '0001045810', 'NVIDIA CORP', '67066G104', 'Common Stock', current_date - 300, '0009997702', 'Seed Asset Managers Inc.', 2, 1500000000, 6.2, '{"Rule 13d-1(b)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001313/seed-13-13-index.htm'),
  ('seed-13-14', 'SCHEDULE 13G/A', '13G', true,  current_date - 60,  '0001045810', 'NVIDIA CORP', null, 'Common Stock', current_date - 75, '0009997702', 'Seed Asset Managers Inc.', 2, 0, 0, '{"Rule 13d-1(b)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001314/seed-13-14-index.htm'),
  ('seed-13-15', 'SCHEDULE 13D',   '13D', false, current_date - 200, '0001045810', 'NVIDIA CORP', '67066G104', 'Common Stock, $0.001 par value per share', current_date - 204, '0009997703', 'Seed Partners Master Fund LP', 4, 1300000000.5, 5.4, '{}', '{"purpose": "The Reporting Persons acquired the Shares for investment purposes.   They may   engage in discussions with the Issuer''s management and board."}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001315/seed-13-15-index.htm'),
  ('seed-13-16', 'SCHEDULE 13G',   '13G', false, current_date - 90,  '0001045810', 'NVIDIA CORP', '67066G104', 'Common Stock', current_date - 100, '0000789019', 'Microsoft Corporation', 1, 1250000000, 5.1, '{"Rule 13d-1(c)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001316/seed-13-16-index.htm'),
  ('seed-13-17', 'SCHEDULE 13G/A', '13G', true,  current_date - 45,  '0001045810', 'NVIDIA CORP', '67066G104', 'Common Stock', current_date - 60, '0001100000', 'Huang Jen Hsun', 3, 860000000, 3.5, '{"Rule 13d-1(d)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001317/seed-13-17-index.htm'),
  ('seed-13-18', 'SCHEDULE 13G',   '13G', false, current_date - 30,  '0001045810', 'NVIDIA CORP', null, null, null, null, '  The <b>Seed</b> Family   Trust & Co ', 1, 1240000000, null, '{}', '{}', null),
  ('seed-13-19', 'SCHEDULE 13G',   '13G', false, current_date - 10,  '0001045810', 'NVIDIA CORP', null, 'Common Stock', current_date - 15, '0009997704', 'Seed Same Day LLC', 1, 1300000000, 5.3, '{"Rule 13d-1(c)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001319/seed-13-19-index.htm'),
  ('seed-13-20', 'SCHEDULE 13G/A', '13G', true,  current_date - 10,  '0001045810', 'NVIDIA CORP', null, 'Common Stock', current_date - 15, '0009997704', 'Seed Same Day LLC', 1, 1310000000, 5.35, '{"Rule 13d-1(c)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026001320/seed-13-20-index.htm'),
  ('seed-13-21', 'SCHEDULE 13G/A', '13G', true,  current_date - 3,   '0000936468', 'LOCKHEED MARTIN CORP', '539830109', 'Common Stock', current_date - 20, '0009997705', 'Seed Trust Bank', 1, 9000000, 3.8, '{"Rule 13d-1(b)"}', '{}', 'https://www.sec.gov/Archives/edgar/data/936468/000000000026001321/seed-13-21-index.htm');
insert into schedule13_filings (accession, form_type, schedule, is_amendment, filed_at, issuer_cik, issuer_name, security_class, event_date, filer_cik, reporter_name, reporter_count, shares_owned, percent_of_class, rules) values
  ('seed-13-90', 'SCHEDULE 13G',   '13G', false, current_date - 70, '0009996601', 'SEED SPONSOR CREDIT FUND', 'Common Shares', current_date - 80, '0009996621', 'Seed Fund Holder One', 1, 2000000, 22.5, '{"Rule 13d-1(c)"}'),
  ('seed-13-91', 'SCHEDULE 13G/A', '13G', true,  current_date - 25, '0009996601', 'SEED SPONSOR CREDIT FUND', 'Common Shares', current_date - 40, '0009996622', 'Seed Fund Holder Two', 1, 300000, 3.4, '{"Rule 13d-1(c)"}');
insert into schedule13_filings (accession, form_type, schedule, is_amendment, filed_at, issuer_cik, issuer_name, issuer_cusip, security_class, event_date, filer_cik, reporter_name, reporter_count, shares_owned, percent_of_class, rules, source_url)
select 'seed-13-p' || lpad(g::text, 2, '0'), case when g % 7 = 0 then 'SCHEDULE 13D/A' when g % 2 = 0 then 'SCHEDULE 13G/A' else 'SCHEDULE 13G' end, case when g % 7 = 0 then '13D' else '13G' end, (g % 7 = 0 or g % 2 = 0),
       current_date - (g * 9 + 5), '0001321655', 'PALANTIR TECHNOLOGIES INC.', '69608A108', 'Class A Common Stock', current_date - (g * 9 + 25), lpad((9997800 + g)::text, 10, '0'),
       'Seed Holder ' || lpad(g::text, 2, '0') || ' LP', 1 + (g % 3), 1000000 * (40 - g), case when g % 5 = 0 then 2.5 + g / 100.0 else 5 + (30 - g) / 4.0 end,
       case when g % 7 = 0 then '{}'::text[] else '{"Rule 13d-1(b)"}'::text[] end,
       'https://www.sec.gov/Archives/edgar/data/1321655/0000000000260014' || lpad(g::text, 2, '0') || '/seed-13-p' || lpad(g::text, 2, '0') || '-index.htm'
  from generate_series(1, 28) g;

-- ── Ticker owners (migration 0031, web/src/lib/issuer.ts) ────────────────────────────────
-- The SEC's ticker list for the seed's companies, and the two faults the repair and the build
-- rule put right:
--   SWAP  the security is with SEED SWAPPED TRUST, the SEC lists the ticker under SEED SWAPPED
--         PARENT CORP, and both carry it as main ticker (production: KKR, IVZ). After the
--         repair the security is the parent's, the trust has no main ticker, and the trust's
--         Form 4 rows are on the trust's company page, not on /stocks/swap/.
--   NVDA  SEED SPONSOR CREDIT FUND carries NVIDIA's ticker and its insider's row is stored on
--         the NVDA security (production: PGIM funds on PRU). After the repair the fund has no
--         main ticker and the row is on the fund's company page only.
delete from ticker_owner_changes;
delete from sec_tickers;
insert into sec_tickers (ticker, cik, title, rank) values
  ('NVDA', '0001045810', 'NVIDIA CORP', 0), ('MSFT', '0000789019', 'MICROSOFT CORP', 1),
  ('PLTR', '0001321655', 'Palantir Technologies Inc.', 2), ('LMT', '0000936468', 'LOCKHEED MARTIN CORP', 3),
  ('AAPL', '0000320193', 'Apple Inc.', 4), ('AMD', '0000002488', 'ADVANCED MICRO DEVICES INC', 5),
  ('SWAP', '0009996702', 'SEED SWAPPED PARENT CORP', 6);
insert into companies (name, cik, primary_ticker, slug) values
  ('SEED SWAPPED PARENT CORP', '0009996702', 'SWAP', 'seed-swapped-parent-corp'),
  ('SEED SWAPPED TRUST', '0009996703', 'SWAP', 'seed-swapped-trust');
insert into securities (ticker, type, name, company_id) values
  ('SWAP', 'equity', 'Seed Swapped', (select id from companies where cik = '0009996703'));
insert into people (full_name, slug, cik) values
  ('Seed Parent Officer', 'seed-parent-officer', '0001100101'),
  ('Seed Trust Trustee', 'seed-trust-trustee', '0001100102'),
  ('Seed Fund Director', 'seed-fund-director', '0001100103');
insert into person_roles (person_id, role_kind, company_id, officer_title, is_director) values
  ((select id from people where cik = '0001100101'), 'insider', (select id from companies where cik = '0009996702'), 'Chief Financial Officer', false),
  ((select id from people where cik = '0001100102'), 'insider', (select id from companies where cik = '0009996703'), null, true),
  ((select id from people where cik = '0001100103'), 'insider', (select id from companies where cik = '0009996601'), null, true);
create temp table seed_owner (accession text, person_cik text, company_cik text, ticker text, filed date, txn date, code text, shares numeric, price numeric);
insert into seed_owner values
  ('0009996702-26-000001', '0001100101', '0009996702', 'SWAP', current_date - 9,  current_date - 10, 'P', 1000, 20.00),
  ('0009996703-26-000001', '0001100102', '0009996703', 'SWAP', current_date - 8,  current_date - 9,  'S', 400,  25.00),
  ('0009996703-26-000002', '0001100102', '0009996703', 'SWAP', current_date - 20, current_date - 21, 'P', 600,  24.00),
  ('0009996601-26-000001', '0001100103', '0009996601', 'NVDA', current_date - 11, current_date - 12, 'P', 250,  10.00);
insert into filings (source, external_id, filer_person_id, filer_company_id, filed_at, source_url, confidence, review, is_published, payload)
select 'sec_form4', f.accession, p.id, c.id, f.filed::timestamptz,
       'https://www.sec.gov/Archives/edgar/data/' || ltrim(c.cik, '0') || '/' || replace(f.accession, '-', '') || '/wk-form4_' || replace(f.accession, '-', '') || '.xml',
       1.0, 'auto_approved', true, jsonb_build_object('accession', f.accession, 'seed', true,
       'issuer', jsonb_build_object('cik', c.cik, 'name', c.name, 'ticker', 'NONE'),
       'transactions', jsonb_build_array(jsonb_build_object('shares', f.shares)))
  from seed_owner f join people p on p.cik = f.person_cik join companies c on c.cik = f.company_cik;
insert into transactions (filing_id, person_id, security_id, side, txn_code, is_derivative, txn_date, disclosed_at, shares, price, disclosure_lag_days, confidence, review, is_10b5_1, owner_type, asset_type)
select fi.id, fi.filer_person_id, s.id, case f.code when 'P' then 'buy' else 'sell' end::txn_side,
       f.code, false, f.txn, f.filed, f.shares, f.price, f.filed - f.txn, 1.0, 'auto_approved', false, 'self', 'stock'
  from seed_owner f join filings fi on fi.external_id = f.accession join securities s on s.ticker = f.ticker and s.type = 'equity';
select repair_ticker_owners();

-- Publish the way production does: migration 0009's gates (house_ptr, sec_form4) are approved, and
-- every ingest run ends with publish_approved_filings(), which publishes auto_approved filings of
-- confidence >= 0.9. Without this call every seeded filing stayed under review, so charts, the
-- trade map and Share buttons had no published rows to draw. Filings that production would hold
-- stay held: the scanned PTR (confidence 0.3, needs_ocr).
select publish_approved_filings();

commit;
