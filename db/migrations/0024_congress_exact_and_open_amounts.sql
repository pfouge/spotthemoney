-- 0024_congress_exact_and_open_amounts.sql
--
-- Data repair (idempotent). Two amount shapes on House periodic transaction reports were stored
-- wrongly, because the vendored parser reads "any two dollar figures" out of the amount cell:
--
--   "$2,761.57"                 an exact amount with cents, stored as low 2761, high 57 (split at
--                               the decimal point). Shown on the site as "$2,761–$57".
--   "Spouse/DC Over $1,000,000" the form's open-topped box for an asset held only by a spouse or
--                               dependent child, stored as 1,000,000 to 1,000,000.
--
-- The job now puts both right when it writes a row (fix_amounts in ingest/py/congress_ptr_job.py).
-- This repairs the rows already stored, in place, so their ids (row anchors, feed ids) do not
-- change, which a --reprocess of the reports would have done. Each update is tied to the cell's
-- own text, kept in the filing's payload, and to the stored pair, so nothing else can match.
-- On production on 2026-11-18: 14 exact rows in 11 reports, 10 open-topped rows in 4 reports.
-- No schema change, so nothing to grant or revoke (see 0022, 0023).

-- Exact amount: low = high = the figure rounded to the dollar, half up.
-- The stored low is the whole dollars, the stored high is the cents (0 to 99).
update transactions t
   set amount_low  = t.amount_low + case when t.amount_high >= 50 then 1 else 0 end,
       amount_high = t.amount_low + case when t.amount_high >= 50 then 1 else 0 end
  from filings f
 where f.id = t.filing_id
   and f.source = 'house_ptr'
   and t.amount_high < t.amount_low
   and t.amount_high < 100
   and exists (
         select 1
           from jsonb_array_elements(case when jsonb_typeof(f.payload->'records') = 'array'
                                          then f.payload->'records' else '[]'::jsonb end) r
          where (r->>'amount_range_text') ~ '^\$[0-9,]*[0-9]\.[0-9]{2}$'
            and (r->>'amount_min')::numeric = t.amount_low
            and (r->>'amount_max')::numeric = t.amount_high);

-- Open-topped box: the low end stays, no top is stated.
update transactions t
   set amount_high = null
  from filings f
 where f.id = t.filing_id
   and f.source = 'house_ptr'
   and t.amount_high = t.amount_low
   and exists (
         select 1
           from jsonb_array_elements(case when jsonb_typeof(f.payload->'records') = 'array'
                                          then f.payload->'records' else '[]'::jsonb end) r
          where (r->>'amount_range_text') ~* 'over \$[0-9,]*[0-9]$'
            and (r->>'amount_range_text') !~ '-'
            and (r->>'amount_min')::numeric = t.amount_low
            and (r->>'amount_max')::numeric = t.amount_high);
