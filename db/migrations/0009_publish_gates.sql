-- 0009 — publish on autopilot (Peter, 2026-10-04).
--
-- Until now every filing landed is_published = false and waited for a manual
-- `node scripts/sample-source.mjs <source> --approve`. That was right for a NEW source (the
-- sample review is where the two house_ptr mapping defects and the sec_form4 multi-class
-- ticker defect were caught), but it also meant nothing filed after the review date could
-- reach the heatmaps, the API or the X thread without a person running a script.
--
-- New rule: the sample review approves the SOURCE, once. `publish_gates` records that
-- approval; `publish_approved_filings()` publishes any filing from an approved source that
-- meets the same bar the approve script always used (review auto_approved/approved and
-- confidence >= 0.9). Both ingest runners call it at the end of every run. What still waits
-- for a person: sources with no gate row (senate_ptr), and low-confidence rows (scanned PTRs
-- that need OCR land at confidence 0.3 / review pending).

create table if not exists publish_gates (
    source       filing_source primary key,
    approved_at  timestamptz not null default now(),
    approved_by  text not null default 'peter',
    note         text
);

-- Ops table: RLS on, no policies (same treatment as sources / ingest_runs in 0006).
alter table publish_gates enable row level security;

-- Both gates were passed on 2026-09-28 (docs/04 #27, docs/reference/samples/*-2026-09-28.md).
insert into publish_gates (source, approved_at, note) values
    ('house_ptr', '2026-09-28T00:00:00Z', 'sample reviewed against source PDFs; approved after --reprocess'),
    ('sec_form4', '2026-09-28T00:00:00Z', 'sample reviewed against EDGAR; approved after migration 0007')
on conflict (source) do nothing;

create or replace function publish_approved_filings() returns integer
language plpgsql as $$
declare
    n integer;
begin
    update filings f
       set is_published = true
      from publish_gates g
     where g.source = f.source
       and not f.is_published
       and f.review in ('auto_approved', 'approved')
       and f.confidence >= 0.9;
    get diagnostics n = row_count;
    return n;
end $$;

-- Publish the backlog that accumulated since 2026-09-28.
select publish_approved_filings();

-- Lobbying: keep the Senate's posting timestamp so "newest" and the freshness check have a
-- date to stand on (the job used to page oldest-first and re-read January every day).
alter table lobbying add column if not exists posted_at timestamptz;
create index if not exists lobbying_posted_at_idx on lobbying (posted_at desc nulls last);
