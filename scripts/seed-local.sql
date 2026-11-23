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
--         Form 4 row that states no symbol is on the trust's company page, not on /stocks/swap/.
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
-- `stated` is the trading symbol the filing itself gives for its issuer. The trust's second
-- filing states SWAP (an earlier registrant of the same listed stock: production has SUPN and
-- SATS), so its row stays on /stocks/swap/; the ones that state no symbol come off.
create temp table seed_owner (accession text, person_cik text, company_cik text, ticker text, filed date, txn date, code text, shares numeric, price numeric, stated text);
insert into seed_owner values
  ('0009996702-26-000001', '0001100101', '0009996702', 'SWAP', current_date - 9,  current_date - 10, 'P', 1000, 20.00, 'SWAP'),
  ('0009996703-26-000001', '0001100102', '0009996703', 'SWAP', current_date - 8,  current_date - 9,  'S', 400,  25.00, 'NONE'),
  ('0009996703-26-000002', '0001100102', '0009996703', 'SWAP', current_date - 20, current_date - 21, 'P', 600,  24.00, 'SWAP'),
  ('0009996601-26-000001', '0001100103', '0009996601', 'NVDA', current_date - 11, current_date - 12, 'P', 250,  10.00, 'N/A');
insert into filings (source, external_id, filer_person_id, filer_company_id, filed_at, source_url, confidence, review, is_published, payload)
select 'sec_form4', f.accession, p.id, c.id, f.filed::timestamptz,
       'https://www.sec.gov/Archives/edgar/data/' || ltrim(c.cik, '0') || '/' || replace(f.accession, '-', '') || '/wk-form4_' || replace(f.accession, '-', '') || '.xml',
       1.0, 'auto_approved', true, jsonb_build_object('accession', f.accession, 'seed', true,
       'issuer', jsonb_build_object('cik', c.cik, 'name', c.name, 'ticker', f.stated),
       'transactions', jsonb_build_array(jsonb_build_object('shares', f.shares)))
  from seed_owner f join people p on p.cik = f.person_cik join companies c on c.cik = f.company_cik;
insert into transactions (filing_id, person_id, security_id, side, txn_code, is_derivative, txn_date, disclosed_at, shares, price, disclosure_lag_days, confidence, review, is_10b5_1, owner_type, asset_type)
select fi.id, fi.filer_person_id, s.id, case f.code when 'P' then 'buy' else 'sell' end::txn_side,
       f.code, false, f.txn, f.filed, f.shares, f.price, f.filed - f.txn, 1.0, 'auto_approved', false, 'self', 'stock'
  from seed_owner f join filings fi on fi.external_id = f.accession join securities s on s.ticker = f.ticker and s.type = 'equity';
select repair_ticker_owners();

-- Company financials as the sec_company_financials job stores them (migration 0032), for the
-- "Financials, as filed" section (web/src/lib/financials.ts; scripts/verify-financials.mjs). NVIDIA:
-- four fiscal years (three on the page), five quarters (four on the page), revenue under an older
-- tag in one year (marked), a year with no total liabilities (a dash), a loss, and earnings per
-- share with a scale mistake (not shown). Microsoft reports in CNY here, with older dollar rows
-- that are left out. Palantir: assets that do not equal liabilities and equity, and cash above
-- assets (both not shown). Lockheed has balance-sheet dates only and Apple one quarter. Long-term
-- debt and year-to-date rows are stored and never shown.
truncate company_financials, company_financials_checked;
insert into company_financials (cik, concept, tag, unit, period_start, period_end, value, form, filed, accession) values
  ('0001045810', 'revenue', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', '2025-01-27', '2026-01-25', 216000000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2025-01-27', '2026-01-25', 120100000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2025-01-27', '2026-01-25', 4.9, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'operating_cash_flow', 'us-gaap:NetCashProvidedByUsedInOperatingActivities', 'USD', '2025-01-27', '2026-01-25', 118000000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'capex', 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 'USD', '2025-01-27', '2026-01-25', 6100000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2026-01-25', 11500000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'assets', 'us-gaap:Assets', 'USD', null, '2026-01-25', 180300000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'liabilities', 'us-gaap:Liabilities', 'USD', null, '2026-01-25', 51200000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2026-01-25', 180300000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2026-01-25', 129100000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'long_term_debt', 'us-gaap:LongTermDebt', 'USD', null, '2026-01-25', 8400000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'revenue', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', '2024-01-29', '2025-01-26', 130497000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2024-01-29', '2025-01-26', 72880000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2024-01-29', '2025-01-26', 2.94, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'operating_cash_flow', 'us-gaap:NetCashProvidedByUsedInOperatingActivities', 'USD', '2024-01-29', '2025-01-26', 64089000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'capex', 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 'USD', '2024-01-29', '2025-01-26', 3236000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2025-01-26', 8589000000, '10-K', '2025-02-26', '0001045810-25-000023'),
  ('0001045810', 'assets', 'us-gaap:Assets', 'USD', null, '2025-01-26', 111601000000, '10-K', '2025-02-26', '0001045810-25-000023'),
  ('0001045810', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2025-01-26', 111601000000, '10-K', '2025-02-26', '0001045810-25-000023'),
  ('0001045810', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2025-01-26', 79327000000, '10-K', '2025-02-26', '0001045810-25-000023'),
  ('0001045810', 'revenue', 'us-gaap:Revenues', 'USD', '2023-01-30', '2024-01-28', 60922000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2023-01-30', '2024-01-28', 29760000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2023-01-30', '2024-01-28', 1.19, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'operating_cash_flow', 'us-gaap:NetCashProvidedByUsedInOperatingActivities', 'USD', '2023-01-30', '2024-01-28', 28090000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'capex', 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 'USD', '2023-01-30', '2024-01-28', 1069000000, '10-K', '2026-02-25', '0001045810-26-000021'),
  ('0001045810', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2024-01-28', 7280000000, '10-K', '2024-02-21', '0001045810-24-000029'),
  ('0001045810', 'assets', 'us-gaap:Assets', 'USD', null, '2024-01-28', 65728000000, '10-K', '2024-02-21', '0001045810-24-000029'),
  ('0001045810', 'liabilities', 'us-gaap:Liabilities', 'USD', null, '2024-01-28', 22750000000, '10-K', '2024-02-21', '0001045810-24-000029'),
  ('0001045810', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2024-01-28', 65728000000, '10-K', '2024-02-21', '0001045810-24-000029'),
  ('0001045810', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2024-01-28', 42978000000, '10-K', '2024-02-21', '0001045810-24-000029'),
  ('0001045810', 'revenue', 'us-gaap:Revenues', 'USD', '2022-01-31', '2023-01-29', 26974000000, '10-K', '2024-02-21', '0001045810-24-000029'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2022-01-31', '2023-01-29', 4368000000, '10-K', '2024-02-21', '0001045810-24-000029'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2022-01-31', '2023-01-29', 0.17, '10-K', '2024-02-21', '0001045810-24-000029'),
  ('0001045810', 'revenue', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', '2026-07-27', '2026-10-25', 57000000000, '10-Q', '2026-11-18', '0001045810-26-000180'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2026-07-27', '2026-10-25', 31900000000, '10-Q', '2026-11-18', '0001045810-26-000180'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2026-07-27', '2026-10-25', 1.3, '10-Q', '2026-11-18', '0001045810-26-000180'),
  ('0001045810', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2026-10-25', 12000000000, '10-Q', '2026-11-18', '0001045810-26-000180'),
  ('0001045810', 'assets', 'us-gaap:Assets', 'USD', null, '2026-10-25', 190000000000, '10-Q', '2026-11-18', '0001045810-26-000180'),
  ('0001045810', 'liabilities', 'us-gaap:Liabilities', 'USD', null, '2026-10-25', 55000000000, '10-Q', '2026-11-18', '0001045810-26-000180'),
  ('0001045810', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2026-10-25', 190000000000, '10-Q', '2026-11-18', '0001045810-26-000180'),
  ('0001045810', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2026-10-25', 135000000000, '10-Q', '2026-11-18', '0001045810-26-000180'),
  ('0001045810', 'revenue', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', '2026-04-27', '2026-07-26', 52000000000, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2026-04-27', '2026-07-26', 28000000000, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2026-04-27', '2026-07-26', 1140000.0, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2026-07-26', 12000000000, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'assets', 'us-gaap:Assets', 'USD', null, '2026-07-26', 190000000000, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'liabilities', 'us-gaap:Liabilities', 'USD', null, '2026-07-26', 55000000000, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2026-07-26', 190000000000, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2026-07-26', 135000000000, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'revenue', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', '2026-01-26', '2026-04-26', 46700000000, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2026-01-26', '2026-04-26', -1200000000, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2026-01-26', '2026-04-26', -0.05, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0001045810', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2026-04-26', 12000000000, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0001045810', 'assets', 'us-gaap:Assets', 'USD', null, '2026-04-26', 190000000000, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0001045810', 'liabilities', 'us-gaap:Liabilities', 'USD', null, '2026-04-26', 55000000000, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0001045810', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2026-04-26', 190000000000, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0001045810', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2026-04-26', 135000000000, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0001045810', 'revenue', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', '2025-07-28', '2025-10-26', 40000000000, '10-Q', '2025-11-19', '0001045810-25-000170'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2025-07-28', '2025-10-26', 22000000000, '10-Q', '2025-11-19', '0001045810-25-000170'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2025-07-28', '2025-10-26', 0.89, '10-Q', '2025-11-19', '0001045810-25-000170'),
  ('0001045810', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2025-10-26', 12000000000, '10-Q', '2025-11-19', '0001045810-25-000170'),
  ('0001045810', 'assets', 'us-gaap:Assets', 'USD', null, '2025-10-26', 190000000000, '10-Q', '2025-11-19', '0001045810-25-000170'),
  ('0001045810', 'liabilities', 'us-gaap:Liabilities', 'USD', null, '2025-10-26', 55000000000, '10-Q', '2025-11-19', '0001045810-25-000170'),
  ('0001045810', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2025-10-26', 190000000000, '10-Q', '2025-11-19', '0001045810-25-000170'),
  ('0001045810', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2025-10-26', 135000000000, '10-Q', '2025-11-19', '0001045810-25-000170'),
  ('0001045810', 'revenue', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', '2025-04-28', '2025-07-27', 35000000000, '10-Q', '2025-08-27', '0001045810-25-000130'),
  ('0001045810', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2025-04-28', '2025-07-27', 19000000000, '10-Q', '2025-08-27', '0001045810-25-000130'),
  ('0001045810', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2025-04-28', '2025-07-27', 0.77, '10-Q', '2025-08-27', '0001045810-25-000130'),
  ('0001045810', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2025-07-27', 12000000000, '10-Q', '2025-08-27', '0001045810-25-000130'),
  ('0001045810', 'assets', 'us-gaap:Assets', 'USD', null, '2025-07-27', 190000000000, '10-Q', '2025-08-27', '0001045810-25-000130'),
  ('0001045810', 'liabilities', 'us-gaap:Liabilities', 'USD', null, '2025-07-27', 55000000000, '10-Q', '2025-08-27', '0001045810-25-000130'),
  ('0001045810', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2025-07-27', 190000000000, '10-Q', '2025-08-27', '0001045810-25-000130'),
  ('0001045810', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2025-07-27', 135000000000, '10-Q', '2025-08-27', '0001045810-25-000130'),
  ('0001045810', 'revenue', 'us-gaap:Revenues', 'USD', '2026-01-26', '2026-07-26', 98700000000, '10-Q', '2026-08-26', '0001045810-26-000140'),
  ('0001045810', 'operating_cash_flow', 'us-gaap:NetCashProvidedByUsedInOperatingActivities', 'USD', '2026-01-26', '2026-04-26', 27400000000, '10-Q', '2026-05-27', '0001045810-26-000090'),
  ('0000789019', 'revenue', 'ifrs-full:Revenue', 'CNY', '2025-01-01', '2025-12-31', 5600000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'net_income', 'us-gaap:NetIncomeLoss', 'CNY', '2025-01-01', '2025-12-31', -310000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'CNY/shares', '2025-01-01', '2025-12-31', -1.24, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'operating_cash_flow', 'us-gaap:NetCashProvidedByUsedInOperatingActivities', 'CNY', '2025-01-01', '2025-12-31', 420000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'capex', 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 'CNY', '2025-01-01', '2025-12-31', 150000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'CNY', null, '2025-12-31', 900000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'assets', 'ifrs-full:Assets', 'CNY', null, '2025-12-31', 9000000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'liabilities', 'us-gaap:Liabilities', 'CNY', null, '2025-12-31', 6100000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'CNY', null, '2025-12-31', 9000000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'equity', 'us-gaap:StockholdersEquity', 'CNY', null, '2025-12-31', 2900000000, '20-F', '2026-04-20', '0000789019-26-000004'),
  ('0000789019', 'revenue', 'us-gaap:Revenues', 'USD', '2023-01-01', '2023-12-31', 700000000, '20-F', '2024-04-18', '0000789019-24-000003'),
  ('0000789019', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2023-01-01', '2023-12-31', 0.5, '20-F', '2024-04-18', '0000789019-24-000003'),
  ('0001321655', 'revenue', 'us-gaap:Revenues', 'USD', '2025-01-01', '2025-12-31', 4100000000, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2025-01-01', '2025-12-31', 1500000000, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2025-01-01', '2025-12-31', 0.61, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'operating_cash_flow', 'us-gaap:NetCashProvidedByUsedInOperatingActivities', 'USD', '2025-01-01', '2025-12-31', 1900000000, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'capex', 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 'USD', '2025-01-01', '2025-12-31', 0, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2025-12-31', 2100000000, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'assets', 'us-gaap:Assets', 'USD', null, '2025-12-31', 7100000000, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'liabilities', 'us-gaap:Liabilities', 'USD', null, '2025-12-31', 1300000000, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2025-12-31', 7400000000, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2025-12-31', 6100000000, '10-K', '2026-02-18', '0001321655-26-000011'),
  ('0001321655', 'revenue', 'us-gaap:Revenues', 'USD', '2024-01-01', '2024-12-31', 2866000000, '10-K', '2025-02-18', '0001321655-25-000012'),
  ('0001321655', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2024-01-01', '2024-12-31', 462000000, '10-K', '2025-02-18', '0001321655-25-000012'),
  ('0001321655', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2024-01-01', '2024-12-31', 0.19, '10-K', '2025-02-18', '0001321655-25-000012'),
  ('0001321655', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2024-12-31', 5230000000, '10-K', '2025-02-18', '0001321655-25-000012'),
  ('0001321655', 'assets', 'us-gaap:Assets', 'USD', null, '2024-12-31', 1000, '10-K', '2025-02-18', '0001321655-25-000012'),
  ('0001321655', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2024-12-31', 1000, '10-K', '2025-02-18', '0001321655-25-000012'),
  ('0001321655', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2024-12-31', 5003000000, '10-K', '2025-02-18', '0001321655-25-000012'),
  ('0001321655', 'revenue', 'us-gaap:Revenues', 'USD', '2026-07-01', '2026-09-30', 1400000000, '10-Q', '2026-11-03', '0001321655-26-000060'),
  ('0001321655', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2026-07-01', '2026-09-30', 247000, '10-Q', '2026-11-03', '0001321655-26-000060'),
  ('0001321655', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2026-07-01', '2026-09-30', 0.0, '10-Q', '2026-11-03', '0001321655-26-000060'),
  ('0001321655', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2026-09-30', 2300000000, '10-Q', '2026-11-03', '0001321655-26-000060'),
  ('0001321655', 'assets', 'us-gaap:Assets', 'USD', null, '2026-09-30', 7900000000, '10-Q', '2026-11-03', '0001321655-26-000060'),
  ('0001321655', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2026-09-30', 7900000000, '10-Q', '2026-11-03', '0001321655-26-000060'),
  ('0001321655', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2026-09-30', 6600000000, '10-Q', '2026-11-03', '0001321655-26-000060'),
  ('0000936468', 'assets', 'us-gaap:Assets', 'USD', null, '2025-12-31', 55617000000, '10-K', '2026-01-28', '0000936468-26-000007'),
  ('0000936468', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2025-12-31', 2483000000, '10-K', '2026-01-28', '0000936468-26-000007'),
  ('0000320193', 'revenue', 'us-gaap:Revenues', 'USD', '2026-03-29', '2026-06-27', 109417000000, '10-Q', '2026-07-31', '0000320193-26-000081'),
  ('0000320193', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2026-03-29', '2026-06-27', 27100000000, '10-Q', '2026-07-31', '0000320193-26-000081'),
  ('0000320193', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2026-03-29', '2026-06-27', 1.85, '10-Q', '2026-07-31', '0000320193-26-000081'),
  ('0009996703', 'revenue', 'us-gaap:Revenues', 'USD', '2025-01-01', '2025-12-31', 12000000, '10-K', '2026-03-02', '0009996703-26-000002'),
  ('0009996703', 'net_income', 'us-gaap:NetIncomeLoss', 'USD', '2025-01-01', '2025-12-31', 3000000, '10-K', '2026-03-02', '0009996703-26-000002'),
  ('0009996703', 'eps_diluted', 'us-gaap:EarningsPerShareDiluted', 'USD/shares', '2025-01-01', '2025-12-31', 0.3, '10-K', '2026-03-02', '0009996703-26-000002'),
  ('0009996703', 'cash', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'USD', null, '2025-12-31', 1500000, '10-K', '2026-03-02', '0009996703-26-000002'),
  ('0009996703', 'assets', 'us-gaap:Assets', 'USD', null, '2025-12-31', 48000000, '10-K', '2026-03-02', '0009996703-26-000002'),
  ('0009996703', 'liabilities_and_equity', 'us-gaap:LiabilitiesAndStockholdersEquity', 'USD', null, '2025-12-31', 48000000, '10-K', '2026-03-02', '0009996703-26-000002'),
  ('0009996703', 'equity', 'us-gaap:StockholdersEquity', 'USD', null, '2025-12-31', 20000000, '10-K', '2026-03-02', '0009996703-26-000002');
insert into company_financials_checked (cik, checked_at, status, rows, newest_filed)
select cik, now(), 'ok', count(*), max(filed) from company_financials group by cik;

-- Company events (Form 8-K, company_events): dates are relative to today so the 12-month window and the
-- 15-row cap behave the same whenever the seed is loaded. NVIDIA: 20 reports across 14 months with varied
-- items (2.02 + 9.01, 5.02, 8.01 alone, 1.01 + 2.03 + 9.01, an amendment, two on one day, one older than 12
-- months). Palantir: 3. Microsoft: 1, older than 12 months only (no section, still in the CSV file).
-- One report is by a CIK with no company (never shown). A few source addresses are not the standard
-- folder shape, so the packed hub file's full-address branch runs.
delete from company_events;
insert into company_events (accession, cik, form, filed, report_date, items, primary_document, source_url) values
  ('0001045810-26-000001', '0001045810', '8-K',   current_date - 5,   current_date - 6,   '{2.02,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/doc.htm'),
  ('0001045810-26-000002', '0001045810', '8-K',   current_date - 12,  current_date - 14,  '{5.02}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000002/doc.htm'),
  ('0001045810-26-000003', '0001045810', '8-K',   current_date - 20,  current_date - 20,  '{8.01}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000003/doc.htm'),
  ('0001045810-26-000004', '0001045810', '8-K',   current_date - 30,  current_date - 31,  '{9.01,1.01,2.03}', 'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000004/doc.htm'),
  ('0001045810-26-000005', '0001045810', '8-K/A', current_date - 33,  null,               '{5.02}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000005/doc.htm'),
  ('0001045810-26-000006', '0001045810', '8-K',   current_date - 45,  current_date - 45,  '{7.01,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000006/doc.htm'),
  ('0001045810-26-000007', '0001045810', '8-K',   current_date - 45,  current_date - 46,  '{8.01}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000007/doc.htm'),
  ('0001045810-26-000008', '0001045810', '8-K',   current_date - 60,  current_date - 61,  '{5.07}',           null,      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1045810&type=8-K'),
  ('0001045810-26-000009', '0001045810', '8-K',   current_date - 75,  current_date - 76,  '{2.02,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000009/doc.htm'),
  ('0001045810-26-000010', '0001045810', '8-K',   current_date - 90,  current_date - 92,  '{5.02,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/doc.htm'),
  ('0001045810-26-000011', '0001045810', '8-K',   current_date - 110, current_date - 111, '{8.01}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000011/doc.htm'),
  ('0001045810-26-000012', '0001045810', '8-K',   current_date - 130, current_date - 131, '{7.01}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000012/doc.htm'),
  ('0001045810-26-000013', '0001045810', '8-K',   current_date - 150, current_date - 151, '{2.02,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000013/doc.htm'),
  ('0001045810-26-000014', '0001045810', '8-K',   current_date - 180, current_date - 181, '{5.02}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000014/doc.htm'),
  ('0001045810-26-000015', '0001045810', '8-K',   current_date - 210, current_date - 211, '{1.01,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000015/doc.htm'),
  ('0001045810-26-000016', '0001045810', '8-K',   current_date - 250, current_date - 251, '{8.01,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000016/doc.htm'),
  ('0001045810-26-000017', '0001045810', '8-K',   current_date - 290, current_date - 291, '{2.02,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000017/doc.htm'),
  ('0001045810-26-000018', '0001045810', '8-K',   current_date - 330, current_date - 331, '{5.02}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000018/doc.htm'),
  ('0001045810-26-000019', '0001045810', '8-K',   current_date - 360, current_date - 361, '{7.01,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000019/doc.htm'),
  ('0001045810-25-000020', '0001045810', '8-K',   current_date - 420, current_date - 421, '{2.02,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581025000020/doc.htm'),
  ('0001321655-26-000001', '0001321655', '8-K',   current_date - 3,   current_date - 4,   '{2.02,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1321655/000132165526000001/doc.htm'),
  ('0001321655-26-000002', '0001321655', '8-K',   current_date - 40,  current_date - 41,  '{5.02}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1321655/000132165526000002/doc.htm'),
  ('0001321655-26-000003', '0001321655', '8-K',   current_date - 200, current_date - 201, '{1.01,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/1321655/000132165526000003/doc.htm'),
  ('0000789019-25-000001', '0000789019', '8-K',   current_date - 500, current_date - 501, '{2.02,9.01}',      'doc.htm', 'https://www.sec.gov/Archives/edgar/data/789019/000078901925000001/doc.htm'),
  ('0009999001-26-000001', '0009999001', '8-K',   current_date - 10,  current_date - 11,  '{8.01}',           'doc.htm', 'https://www.sec.gov/Archives/edgar/data/9999001/000999900126000001/doc.htm');

-- Executive pay (exec_pay, Pay Versus Performance). NVIDIA: five fiscal years, so the cap of four shows,
-- with a negative compensation actually paid and one missing measure. Palantir: one year with a total of $1
-- and an actually-paid figure of $2.4 billion (both marked). Lockheed: other named officers only (the
-- section shows, the glance tile does not). One CIK has no company (never shown). Microsoft has none.
delete from exec_pay;
insert into exec_pay (cik, measure, tag, fiscal_year_end, value, accession, frame) values
  ('0001045810', 'peo_total',              'PeoTotalCompAmt',                 '2026-01-25', 49866000,  '0001045810-26-000045', 'CY2025'),
  ('0001045810', 'peo_actually_paid',      'PeoActuallyPaidCompAmt',          '2026-01-25', 112400000, '0001045810-26-000045', 'CY2025'),
  ('0001045810', 'neo_avg_total',          'NonPeoNeoAvgTotalCompAmt',        '2026-01-25', 13900000,  '0001045810-26-000045', 'CY2025'),
  ('0001045810', 'neo_avg_actually_paid',  'NonPeoNeoAvgCompActuallyPaidAmt', '2026-01-25', 31200000,  '0001045810-26-000045', 'CY2025'),
  ('0001045810', 'peo_total',              'PeoTotalCompAmt',                 '2025-01-26', 34200000,  '0001045810-25-000040', 'CY2024'),
  ('0001045810', 'peo_actually_paid',      'PeoActuallyPaidCompAmt',          '2025-01-26', 189000000, '0001045810-25-000040', 'CY2024'),
  ('0001045810', 'neo_avg_total',          'NonPeoNeoAvgTotalCompAmt',        '2025-01-26', 9800000,   '0001045810-25-000040', 'CY2024'),
  ('0001045810', 'neo_avg_actually_paid',  'NonPeoNeoAvgCompActuallyPaidAmt', '2025-01-26', 61000000,  '0001045810-25-000040', 'CY2024'),
  ('0001045810', 'peo_total',              'PeoTotalCompAmt',                 '2024-01-28', 21300000,  '0001045810-24-000036', 'CY2023'),
  ('0001045810', 'peo_actually_paid',      'PeoActuallyPaidCompAmt',          '2024-01-28', 210500000, '0001045810-24-000036', 'CY2023'),
  ('0001045810', 'neo_avg_total',          'NonPeoNeoAvgTotalCompAmt',        '2024-01-28', 6600000,   '0001045810-24-000036', 'CY2023'),
  ('0001045810', 'peo_total',              'PeoTotalCompAmt',                 '2023-01-29', 24400000,  '0001045810-23-000030', 'CY2022'),
  ('0001045810', 'peo_actually_paid',      'PeoActuallyPaidCompAmt',          '2023-01-29', -3100000,  '0001045810-23-000030', 'CY2022'),
  ('0001045810', 'neo_avg_total',          'NonPeoNeoAvgTotalCompAmt',        '2023-01-29', 7000000,   '0001045810-23-000030', 'CY2022'),
  ('0001045810', 'neo_avg_actually_paid',  'NonPeoNeoAvgCompActuallyPaidAmt', '2023-01-29', -1200000,  '0001045810-23-000030', 'CY2022'),
  ('0001045810', 'peo_total',              'PeoTotalCompAmt',                 '2022-01-30', 19000000,  '0001045810-22-000028', 'CY2021'),
  ('0001321655', 'peo_total',              'PeoTotalCompAmt',                 '2025-12-31', 1,          '0001321655-26-000010', 'CY2025'),
  ('0001321655', 'peo_actually_paid',      'PeoActuallyPaidCompAmt',          '2025-12-31', 2400000000, '0001321655-26-000010', 'CY2025'),
  ('0000936468', 'neo_avg_total',          'NonPeoNeoAvgTotalCompAmt',        '2025-12-31', 8000000,   '0000936468-26-000011', 'CY2025'),
  ('0000936468', 'neo_avg_actually_paid',  'NonPeoNeoAvgCompActuallyPaidAmt', '2025-12-31', 9100000,   '0000936468-26-000011', 'CY2025'),
  ('0009999001', 'peo_total',              'PeoTotalCompAmt',                 '2025-12-31', 10000000,  '0009999001-26-000001', 'CY2025');
-- Form 13F institutional holdings (inst_managers, inst_holdings). Newer quarter 2026-09-30 has 1,201
-- managers, the older quarter 2026-06-30 has 1,010, so both clear the 1,000-manager test.
-- NVIDIA: 1,150 managers newer, 1,000 older. Palantir: 30 newer. Microsoft: 3 newer (managers 1-3),
-- 3 older (1, 2 and 9, so manager 3 has no older row and manager 9 only an older one).
-- Manager 1 also has a second NVIDIA class, Put and Call rows, a bond (PRN) row and a row for an
-- issuer that is not on the site. Manager 0001100000 is the CIK of a seed person with a page.
insert into inst_managers (cik, name)
select '0002' || lpad(n::text, 6, '0'), 'Seed Capital Manager ' || n || case when n % 97 = 0 then ' & Co <LP>' else '' end
from generate_series(1, 1200) n
on conflict (cik) do nothing;
insert into inst_managers (cik, name) values ('0001100000', 'Seed Huang Family Office')
on conflict (cik) do nothing;

-- NVIDIA, newer quarter (1..1150) and older quarter (1..1000)
insert into inst_holdings (period, manager_cik, issuer_cik, cusip, class_title, put_call, amount_type, shares, value, accession, filed)
select '2026-09-30', '0002' || lpad(n::text, 6, '0'), '0001045810', '67066G104', 'COM', '', 'SH',
       1000000 + n * 1500, (1000000 + n * 1500) * 180.5,
       '0001000000-26-' || lpad(n::text, 6, '0'), date '2026-11-03' + (n % 12)
from generate_series(1, 1150) n;
insert into inst_holdings (period, manager_cik, issuer_cik, cusip, class_title, put_call, amount_type, shares, value, accession, filed)
select '2026-06-30', '0002' || lpad(n::text, 6, '0'), '0001045810', '67066G104', 'COM', '', 'SH',
       900000 + n * 1400, (900000 + n * 1400) * 150.25,
       '0001000000-26-' || lpad((n + 5000)::text, 6, '0'), date '2026-08-05' + (n % 12)
from generate_series(1, 1000) n;
-- Palantir newer (1..30), older (1001..1010 only, so the older quarter has 1,010 managers)
insert into inst_holdings (period, manager_cik, issuer_cik, cusip, class_title, put_call, amount_type, shares, value, accession, filed)
select '2026-09-30', '0002' || lpad(n::text, 6, '0'), '0001321655', '69608A108', 'CL A', '', 'SH',
       200000 + n * 900, (200000 + n * 900) * 42.1,
       '0001000000-26-' || lpad(n::text, 6, '0'), date '2026-11-03' + (n % 12)
from generate_series(1, 30) n;
insert into inst_holdings (period, manager_cik, issuer_cik, cusip, class_title, put_call, amount_type, shares, value, accession, filed)
select '2026-06-30', '0002' || lpad(n::text, 6, '0'), '0001321655', '69608A108', 'CL A', '', 'SH',
       150000 + n * 100, (150000 + n * 100) * 30.0,
       '0001000000-26-' || lpad((n + 5000)::text, 6, '0'), date '2026-08-05' + (n % 12)
from generate_series(1001, 1010) n;
-- Microsoft
insert into inst_holdings (period, manager_cik, issuer_cik, cusip, class_title, put_call, amount_type, shares, value, accession, filed) values
  ('2026-09-30', '0002000001', '0000789019', '594918104', 'COM', '', 'SH', 500000, 500000 * 410.0, '0001000000-26-000001', '2026-11-05'),
  ('2026-09-30', '0002000002', '0000789019', '594918104', 'COM', '', 'SH', 750000, 750000 * 410.0, '0001000000-26-000002', '2026-11-06'),
  ('2026-09-30', '0002000003', '0000789019', '594918104', 'COM', '', 'SH', 250000, 250000 * 410.0, '0001000000-26-000003', '2026-11-07'),
  ('2026-06-30', '0002000001', '0000789019', '594918104', 'COM', '', 'SH', 480000, 480000 * 400.0, '0001000000-26-005001', '2026-08-06'),
  ('2026-06-30', '0002000002', '0000789019', '594918104', 'COM', '', 'SH', 700000, 700000 * 400.0, '0001000000-26-005002', '2026-08-07'),
  ('2026-06-30', '0002000009', '0000789019', '594918104', 'COM', '', 'SH', 100000, 100000 * 400.0, '0001000000-26-005009', '2026-08-08');
-- Manager 1 special rows: a second NVIDIA class, Put and Call rows, a bond row, an issuer not on the site
insert into inst_holdings (period, manager_cik, issuer_cik, cusip, class_title, put_call, amount_type, shares, value, accession, filed) values
  ('2026-09-30', '0002000001', '0001045810', '67066G999', 'CL B', '', 'SH', 40000, 40000 * 180.5, '0001000000-26-000001', '2026-11-05'),
  ('2026-09-30', '0002000001', '0001045810', '67066G104', 'COM', 'Put', 'SH', 90000, 90000 * 180.5, '0001000000-26-000001', '2026-11-05'),
  ('2026-09-30', '0002000001', '0001045810', '67066G104', 'COM', 'Call', 'SH', 70000, 70000 * 180.5, '0001000000-26-000001', '2026-11-05'),
  ('2026-09-30', '0002000002', '0001045810', '67066G104', 'COM', 'Put', 'SH', 10000, 10000 * 180.5, '0001000000-26-000002', '2026-11-06'),
  ('2026-09-30', '0002000001', '0001045810', '67066GAA1', 'NOTE', '', 'PRN', 3000000, 3000000, '0001000000-26-000001', '2026-11-05'),
  ('2026-09-30', '0002000001', '0009999999', '99999X999', 'COM', '', 'SH', 123456, 123456 * 10, '0001000000-26-000001', '2026-11-05');
-- A manager that is also a person with a page (CIK of a seed insider)
insert into inst_holdings (period, manager_cik, issuer_cik, cusip, class_title, put_call, amount_type, shares, value, accession, filed) values
  ('2026-09-30', '0001100000', '0001045810', '67066G104', 'COM', '', 'SH', 12345, 12345 * 180.5, '0001000000-26-009999', '2026-11-09');
-- Roll-call votes (migration 0035). 30 House and 14 Senate roll calls over the last 15 months, in
-- two sessions so that numbering restarts; positions for every seeded member of Congress, with
-- person_id set, plus six position rows with no person; every position value is used. One House
-- roll call has no bill, one has a 400-character question, the oldest ones are more than 12
-- months old. Dates are relative to the day the seed is loaded, so the 12-month window is exercised
-- whenever it runs.
insert into congress_votes (chamber, congress, session, roll_number, voted_at, vote_time, question, vote_type, result, bill, description, source_url)
select c.chamber, 119, c.session, row_number() over (partition by c.chamber, c.session order by c.d, c.i), c.d, to_char(time '09:30' + (c.i * 7) * interval '1 minute', 'HH24:MI'),
       case when c.chamber = 'house' and c.i = 9 then 'On Agreeing to the Amendment: ' || repeat('an amendment to the bill that changes the schedule of payments ', 7)
            when c.i % 5 = 0 then 'On Motion to Recommit' when c.i % 4 = 0 then 'On the Nomination' when c.i % 3 = 0 then 'On the Cloture Motion' else 'On Passage' end,
       case when c.i % 3 = 0 then 'RECORDED VOTE' else 'YEA-AND-NAY' end,
       case when c.i % 5 = 0 then 'Failed' when c.i % 4 = 0 then 'Confirmed' else 'Passed' end,
       case when c.chamber = 'house' and c.i = 7 then null when c.chamber = 'house' then 'H R ' || (100 + c.i) else 'S. ' || (200 + c.i) end,
       'Seeded roll call ' || c.i,
       case when c.chamber = 'senate' and c.i = 3 then null
            when c.chamber = 'house' then 'https://clerk.house.gov/Votes/seed' || c.i else 'https://www.senate.gov/legislative/seed' || c.i end
  from (
    select 'house' as chamber, i, (current_date - (i * 15)) as d, case when extract(year from current_date - (i * 15)) = extract(year from current_date) then 2 else 1 end as session from generate_series(1, 30) i
    union all
    select 'senate', i, (current_date - (i * 31) - 4), case when extract(year from current_date - (i * 31) - 4) = extract(year from current_date) then 2 else 1 end from generate_series(1, 14) i
  ) c;

insert into congress_vote_positions (vote_id, member_key, person_id, name, party, state, position)
select v.id, m.key, p.id, m.name, m.party, m.state,
       (array['yea', 'nay', 'present', 'not_voting'])[1 + ((v.id + m.k) % 4)::int]
  from congress_votes v
  join (values ('house', 'W000001', 'Whitfield, Jordan', 'R', 'TX', 'Jordan Whitfield', 0), ('house', 'M000001', 'Marsh, Elena', 'D', 'CA', 'Elena Marsh', 1),
               ('house', 'O000001', 'Okafor, Samuel', 'D', 'OH', 'Samuel Okafor', 2), ('house', 'D000001', 'Delacroix, Marcus', 'D', 'AK', 'Marcus Delacroix', 3),
               ('senate', 'S0001', 'Lindqvist (I-TX)', 'I', 'TX', 'Priya Lindqvist', 1), ('senate', 'S0002', 'Abara (R-OH)', 'R', 'OH', 'Walter Abara Jr.', 2)) as m(chamber, key, name, party, state, fullname, k)
    on m.chamber = v.chamber
  left join people p on p.full_name = m.fullname;
-- Six members with no match to a person (no page): a few House roll calls.
insert into congress_vote_positions (vote_id, member_key, person_id, name, party, state, position)
select v.id, x.key, null, x.name, x.party, x.state, x.pos
  from (select id from congress_votes where chamber = 'house' order by voted_at desc limit 2) v
  cross join (values ('X000001', 'Unmatched, Alex', 'R', 'FL', 'yea'), ('X000002', 'Unmatched, Bea', 'D', 'WA', 'nay'), ('X000003', 'Unmatched, Cal', 'R', 'KS', 'not_voting')) as x(key, name, party, state, pos);
update congress_votes v set
  yeas = (select count(*) from congress_vote_positions p where p.vote_id = v.id and p.position = 'yea'),
  nays = (select count(*) from congress_vote_positions p where p.vote_id = v.id and p.position = 'nay'),
  present = (select count(*) from congress_vote_positions p where p.vote_id = v.id and p.position = 'present'),
  not_voting = (select count(*) from congress_vote_positions p where p.vote_id = v.id and p.position = 'not_voting');

-- Independent expenditures (migration 0036): 60 rows in the current cycle. Committee A has regular
-- rows and later notices (the later ones count); B has notices only; C has notices that are all
-- older than its regular rows (none counts). Rows name two seeded members, a candidate with no
-- person, a presidential candidate, a null amount, a null side and one dated in the future (the
-- ingest stores such a date as null); descriptions carry quotes and angle brackets.
insert into independent_expenditures (sub_id, committee_fec_id, committee_name, candidate_fec_id, candidate_name, candidate_office, candidate_state, candidate_district, candidate_party, person_id, support_oppose, amount, spent_at, disseminated_at, description, payee_name, is_notice, source_url)
select 'SEED-IE-' || lpad(n::text, 3, '0'), c.id, c.name, k.id, k.name, k.office, k.state, k.district, k.party,
       (select p.id from people p where p.full_name = k.person), s.side, s.amount, s.d, s.d,
       case n % 4 when 0 then 'Television ad "Plain Talk" <30 sec>' when 1 then 'Digital advertising' when 2 then 'Mailers & door hangers' else 'Radio ad, 60 seconds' end,
       'Seed payee ' || n, s.notice, 'https://docquery.fec.gov/pdf/seed/' || n || '.pdf'
  from (
    -- committee A, regular reports: support Marsh
    select n, 'A' as cm, 'M' as cand, 'S' as side, (5000 * (n))::numeric as amount, date '2026-03-01' + n as d, false as notice from generate_series(1, 14) n
    union all select 14 + n, 'A', 'M', 'S', 1000 * n, d, true from (values (1, date '2026-03-05'), (2, date '2026-03-15'), (3, date '2026-03-21'), (4, date '2026-04-02')) t(n, d)
    union all select 18 + n, 'B', 'M', 'O', 2000, date '2026-05-01' + n, true from generate_series(1, 8) n
    union all select 26 + n, 'C', 'W', 'O', 3000, date '2026-07-01' + n, false from generate_series(1, 5) n
    union all select 31 + n, 'C', 'W', 'S', 4000, date '2026-06-01' + n, true from generate_series(1, 4) n
    union all select 35 + n, 'D', 'Z', 'S', 750, date '2026-08-01' + n, false from generate_series(1, 12) n
    union all select 47 + n, 'A', 'P', 'O', 12000, date '2026-09-01' + n, false from generate_series(1, 9) n
    union all select 57, 'A', 'M', 'S', null, date '2026-04-10', false
    union all select 58, 'D', 'M', null, 900, date '2026-04-11', false
    union all select 59, 'D', 'W', 'S', 1500, null, false
    union all select 60, 'D', 'Z', 'O', 640, date '2026-08-20', false
  ) s
  join (values ('A', 'C00000001', 'ALPHA VICTORY PAC'), ('B', 'C00000002', 'BETA NOTICE FUND'), ('C', 'C00000003', 'GAMMA "EARLY" NOTICES'), ('D', 'C00000004', 'DELTA PRIORITIES <PAC>')) c(key, id, name) on c.key = s.cm
  join (values ('M', 'H0CA00001', 'MARSH, ELENA', 'H', 'CA', '09', 'DEM', 'Elena Marsh'), ('W', 'H0TX00002', 'WHITFIELD, JORDAN', 'H', 'TX', '14', 'REP', 'Jordan Whitfield'),
               ('Z', 'H0NY00003', 'ZETA, CANDIDATE', 'H', 'NY', '03', 'IND', null), ('P', 'P00000001', 'PRESIDENT, PERSON', 'P', 'US', null, 'NPA', null)) k(key, id, name, office, state, district, party, person) on k.key = s.cand;

-- Publish the way production does: migration 0009's gates (house_ptr, sec_form4) are approved, and
-- every ingest run ends with publish_approved_filings(), which publishes auto_approved filings of
-- confidence >= 0.9. Without this call every seeded filing stayed under review, so charts, the
-- trade map and Share buttons had no published rows to draw. Filings that production would hold
-- stay held: the scanned PTR (confidence 0.3, needs_ocr).
select publish_approved_filings();

commit;
