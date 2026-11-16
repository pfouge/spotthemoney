// Synthetic market-scope Form 4 load of production-like size, for the build size test (stage 3b).
// NOT part of the default seed. Local databases only. Usage: DATABASE_URL=<local> node scripts/seed-market-synth.mjs
// Inserts ~4,800 companies (tracked=false, inactive securities), 37,000 people, 130,000 market-scope
// filings and ~285,000 transactions over the last 13 months with a realistic code mix (about 7% P,
// 19% S, 26% derivative, the rest A/M/F/G). Re-running adds nothing (guarded by the company slugs).
import postgres from "postgres";
const url = process.env.DATABASE_URL;
if (!url || /supabase\.(co|com)/.test(url) || !/(127\.0\.0\.1|localhost)/.test(url)) { console.error("a local DATABASE_URL is required (never production)"); process.exit(2); }
const sql = postgres(url, { max: 1, onnotice: () => {} });
const N_CO = 4800, N_P = 37000, N_F = 130000;
const [{ n }] = await sql`select count(*)::int n from companies where slug like 'syn-co-%'`;
if (n > 0) { console.log("synthetic market load already present"); await sql.end(); process.exit(0); }
const t0 = Date.now();
await sql.begin(async (tx) => {
  await tx`insert into companies (name, cik, primary_ticker, slug, tracked)
           select 'Synthetic Co ' || g, lpad((9000000 + g)::text, 10, '0'), 'Z' || g, 'syn-co-' || g, false from generate_series(1, ${N_CO}) g`;
  await tx`insert into securities (ticker, name, type, company_id, is_active)
           select c.primary_ticker, c.name, 'equity', c.id, false from companies c where c.slug like 'syn-co-%'`;
  await tx`insert into people (full_name, slug, cik) select 'Synthetic Person ' || g, 'syn-p-' || g, lpad((8000000 + g)::text, 10, '0') from generate_series(1, ${N_P}) g`;
  await tx`create temp table syn_c on commit drop as select row_number() over (order by id) k, id from companies where slug like 'syn-co-%'`;
  await tx`create temp table syn_p on commit drop as select row_number() over (order by id) k, id from people where slug like 'syn-p-%'`;
  await tx`insert into person_roles (person_id, role_kind, company_id, officer_title, is_director, valid_from)
           select p.id, 'insider', c.id, case when p.k % 3 = 0 then 'Director' when p.k % 3 = 1 then 'CFO' else 'CEO' end, p.k % 3 = 0, date '2025-01-01'
             from syn_p p join syn_c c on c.k = ((p.k - 1) % ${N_CO}) + 1`;
  // filings: the filer is skewed (power) so some companies attract clusters
  await tx`create temp table syn_f on commit drop as
           select g f, 1 + floor(power(random(), 2) * ${N_P})::int pk, (current_date - (random() * 395)::int)::date fd, 1 + (g % 5 = 0)::int + (g % 5 = 1)::int + (g % 7 = 0)::int k from generate_series(1, ${N_F}) g`;
  await tx`create temp table syn_t on commit drop as
           select f.f, f.pk, f.fd, i, r.r, (case when r.r < 0.07 then 'P' when r.r < 0.26 then 'S' when r.r < 0.52 then 'M' when r.r < 0.70 then 'A' when r.r < 0.88 then 'F' else 'G' end) code,
                  (r.r >= 0.26 and r.r < 0.52) deriv, floor(power(10, 1 + random() * 3.5))::numeric shares, ((f.pk - 1) % ${N_CO}) + 1 ck
             from (select f.*, i, random() r from syn_f f cross join lateral generate_series(1, f.k) i) f, lateral (select f.r r) r`;
  await tx`create index on syn_t (f)`;
  await tx`analyze syn_t`;
  await tx`insert into filings (source, external_id, filer_person_id, filed_at, source_url, confidence, review, is_published, scope, payload)
           select 'sec_form4', 'SYN-' || f.f, p.id, (f.fd::timestamp + interval '16 hours') at time zone 'UTC',
                  'https://www.sec.gov/Archives/edgar/data/9000000/SYN' || f.f || '-index.htm', 1, 'auto_approved', true, 'market',
                  jsonb_build_object('accession', 'SYN-' || f.f, 'footnotes', '[]'::jsonb, 'transactions',
                    (select jsonb_agg(jsonb_build_object('shares', t.shares::text, 'sharesOwnedAfter', (t.shares * (5 + f.f % 20))::text, 'isDerivative', t.deriv) order by t.i) from syn_t t where t.f = f.f))
             from syn_f f join syn_p p on p.k = f.pk`;
  await tx`insert into transactions (filing_id, person_id, security_id, side, txn_date, disclosed_at, shares, price, disclosure_lag_days, confidence, review, txn_code, is_derivative, owner_type, is_10b5_1)
           select fl.id, p.id, s.id, (case when t.code in ('P','A','M') then 'buy' else 'sell' end)::txn_side, t.fd - (1 + (t.f % 3)), t.fd, t.shares,
                  round(((20 + (t.ck % 100) * 2.2) * (0.9 + 0.2 * random()))::numeric, 2), 1 + (t.f % 3), 1, 'auto_approved', t.code, t.deriv, 'officer', t.r > 0.97
             from syn_t t join filings fl on fl.external_id = 'SYN-' || t.f and fl.scope = 'market'
             join syn_p p on p.k = t.pk join syn_c c on c.k = t.ck join securities s on s.company_id = c.id`;
});
const [c] = await sql`select (select count(*) from filings where external_id like 'SYN-%')::int f, (select count(*) from transactions t join filings f on f.id = t.filing_id where f.external_id like 'SYN-%')::int t,
  (select count(*) filter (where txn_code = 'P') from transactions t join filings f on f.id = t.filing_id where f.external_id like 'SYN-%')::int p`;
console.log(`inserted ${c.f} filings, ${c.t} transactions (${c.p} code P) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await sql.end();
