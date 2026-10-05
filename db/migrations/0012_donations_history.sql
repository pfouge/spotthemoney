-- 0012 — FEC donations history pass (2026-10-05). Peter: take donations back to
-- 2025-10-01. `fec_schedule_a_history` visits each committee once per floor date and records
-- here that it has done so, and whether it stored every receipt or a per-month sample
-- (committees with more receipts than the cap — conduits such as ActBlue hold tens of
-- millions — are sampled, never pulled whole).
alter table committees add column if not exists donations_history_floor date;
alter table committees add column if not exists donations_history_note text;
