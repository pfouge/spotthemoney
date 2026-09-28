-- 0007_normalize_multi_class_tickers.sql
--
-- Data repair (idempotent). The first live sec_form4 run (2026-09-27/28) stored Form 4
-- issuerTradingSymbol values verbatim, so multi-class issuers produced securities rows such as
-- "LEN, LEN.B" (Lennar) and companies.primary_ticker with the same string. The ingest job now
-- keeps one clean symbol (sec_form4.ts primaryTicker); this migration folds the rows already
-- written into the single-symbol row: transactions and prices are re-pointed to the clean
-- security (created if missing), then the multi-symbol row is deleted.
--
-- Rule: a "dirty" ticker is one containing a comma, semicolon, slash or whitespace. The clean
-- symbol is the first token, upper-cased.

do $$
declare
  r record;
  clean_ticker text;
  keep_id bigint;
begin
  for r in
    select id, ticker, type, company_id, name, cusip
    from securities
    where ticker::text ~ '[,;/[:space:]]'
  loop
    clean_ticker := upper(split_part(regexp_replace(trim(r.ticker::text), '[;/[:space:]]+', ',', 'g'), ',', 1));
    if clean_ticker is null or clean_ticker = '' then
      continue;
    end if;

    select id into keep_id from securities where ticker = clean_ticker and type = r.type;
    if keep_id is null then
      -- No clean row yet: rename in place (unique (ticker, type) is satisfied).
      update securities set ticker = clean_ticker, updated_at = now() where id = r.id;
      continue;
    end if;

    -- Fold into the existing clean row.
    update transactions set security_id = keep_id where security_id = r.id;

    insert into security_prices (security_id, price_date, open, high, low, close, last, currency, source)
      select keep_id, price_date, open, high, low, close, last, currency, source
      from security_prices where security_id = r.id
      on conflict (security_id, price_date) do nothing;
    delete from security_prices where security_id = r.id;

    update securities
       set company_id = coalesce(company_id, r.company_id),
           name       = coalesce(name, r.name),
           cusip      = coalesce(cusip, r.cusip),
           updated_at = now()
     where id = keep_id;

    delete from securities where id = r.id;
  end loop;
end $$;

-- companies.primary_ticker carried the same verbatim string.
update companies
   set primary_ticker = upper(split_part(regexp_replace(trim(primary_ticker), '[;/[:space:]]+', ',', 'g'), ',', 1))
 where primary_ticker ~ '[,;/[:space:]]';
