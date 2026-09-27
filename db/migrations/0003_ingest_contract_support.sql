-- 0003_ingest_contract_support.sql
-- Additive support for the IIF ingestion contract
-- (see docs/06-ingestion-contract.md → canonical contract in the IIF repo).
-- Safe on Postgres >= 12 inside the migration transaction: the new enum value
-- is added but not used within this migration.

-- 1. PTR option positions are securities with the underlying ticker and type 'option'.
alter type security_type add value if not exists 'option';

-- 2. Preserve the source's literal transaction token (Form 4 code letter such as 'P'/'S'/'M',
--    or PTR type 'purchase'/'sale'/'sale_partial'/'exchange'). transactions.side stays
--    directional; txn_code is what makes code-P (open-market purchase) filters and, together
--    with is_derivative, call-option analytics possible in SQL.
alter table transactions
  add column if not exists txn_code text,
  add column if not exists is_derivative boolean;

-- 3. Lobbying: LDA filing identity + full issue list; filing_uuid is the upsert key.
alter table lobbying
  add column if not exists filing_uuid text,
  add column if not exists filing_type text,
  add column if not exists issues jsonb;

create unique index if not exists lobbying_filing_uuid_key
  on lobbying (filing_uuid) where filing_uuid is not null;

-- 4. Contracts: USAspending generated_internal_id in source_ref is the upsert key.
create unique index if not exists contracts_source_ref_key
  on contracts (source_ref) where source_ref is not null;

-- 5. Donations: FEC schedule_a sub_id in source_ref is the dedupe key.
create unique index if not exists donations_source_ref_key
  on donations (source_ref) where source_ref is not null;
