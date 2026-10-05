// Source: FEC OpenFEC — Schedule A, HISTORY PASS (`fec_schedule_a_history`, run by name).
//
// The daily job (fec_schedule_a.ts) keeps a recent sample per committee. This pass takes
// each committee back to FEC_HISTORY_SINCE (default 2025-10-01, Peter 2026-10-05), once:
//
//   1. One request for the whole window, newest receipt first. The response carries the
//      committee's receipt COUNT for the window.
//   2. count <= FEC_HISTORY_FULL_CAP (default 3,000): page through and store every receipt.
//   3. count  > cap: store a spread instead — the newest FEC_HISTORY_SLICE_PAGES (default 2)
//      pages of 100 from each 30-day slice of the window. The big committees are conduits
//      and party committees with up to tens of millions of receipts (ActBlue: 47 million in
//      this window, seen 2026-10-05); they are sampled, never pulled whole.
//   4. Mark the committee (committees.donations_history_floor / _note, migration 0012) so
//      it is not visited again for this floor. A committee cut short by the budget is left
//      unmarked and redone next run (stored receipts are skipped by sub_id).
//
// Only sort=-contribution_receipt_date is used: sorting by amount timed out at the FEC
// even for a single member committee (HTTP 504, 2026-10-05).
//
// BUDGET: the key allows 1,000 calls an hour and the daily job uses some of them, so a run
// stops at FEC_HISTORY_MAX_REQUESTS (default 600) or FEC_HISTORY_MAX_MINUTES (default 30)
// and reports "partial"; re-run (at most hourly) until it reports success. A 429 stops it
// the same way.
//
// DATABASE GUARD: receipts are the one table here that can outgrow the database plan. The
// pass refuses to start, and stops between committees, once pg_database_size exceeds
// FEC_HISTORY_MAX_DB_MB (default 400). It then reports success with stats.stopped set, so
// an automated chain does not keep calling it — raise the limit deliberately or not at all.
//
// The key must never appear in a log line, error or stat (lib/http errors carry host+path).

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "fec_schedule_a_history";
const BASE_URL = `${process.env.FEC_API_BASE ?? "https://api.open.fec.gov/v1"}/schedules/schedule_a/`;
const PER_PAGE = 100;
export const FEC_HISTORY_FLOOR = "2025-10-01";

interface Cursor { last_index?: string | number | null; last_contribution_receipt_date?: string | null }
interface Receipt {
  sub_id?: string | number | null;
  contributor_name?: string | null;
  contributor_employer?: string | null;
  contributor_state?: string | null;
  contribution_receipt_amount?: string | number | null;
  contribution_receipt_date?: string | null;
}
interface Page { pagination?: { count?: number; last_indexes?: Cursor | null }; results?: Receipt[] }

/** 30-day slices from `today` back to `floor` (both YYYY-MM-DD), newest first, no overlap. */
export function slicesBackTo(today: string, floor: string, sliceDays = 30): { start: string; end: string }[] {
  const day = 86_400_000;
  const out: { start: string; end: string }[] = [];
  let end = Date.parse(`${today}T00:00:00Z`);
  const stop = Date.parse(`${floor}T00:00:00Z`);
  while (end >= stop) {
    const start = Math.max(stop, end - (sliceDays - 1) * day);
    out.push({ start: new Date(start).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) });
    end = start - day;
  }
  return out;
}

function url(key: string, committee: string, minDate: string, maxDate: string, cursor?: Cursor): string {
  const u = new URL(BASE_URL);
  u.searchParams.set("api_key", key);
  u.searchParams.set("committee_id", committee);
  u.searchParams.set("min_date", minDate);
  u.searchParams.set("max_date", maxDate);
  u.searchParams.set("per_page", String(PER_PAGE));
  u.searchParams.set("sort", "-contribution_receipt_date");
  u.searchParams.set("sort_hide_null", "true");
  if (cursor?.last_index != null) u.searchParams.set("last_index", String(cursor.last_index));
  if (cursor?.last_contribution_receipt_date != null) u.searchParams.set("last_contribution_receipt_date", cursor.last_contribution_receipt_date);
  return u.toString();
}

export async function ingestFecScheduleAHistory(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();

  const key = process.env.FEC_API_KEY;
  const floor = process.env.FEC_HISTORY_SINCE ?? FEC_HISTORY_FLOOR;
  const fullCap = Number(process.env.FEC_HISTORY_FULL_CAP ?? 3000);
  const slicePages = Number(process.env.FEC_HISTORY_SLICE_PAGES ?? 2);
  const maxRequests = Number(process.env.FEC_HISTORY_MAX_REQUESTS ?? 600);
  const maxMinutes = Number(process.env.FEC_HISTORY_MAX_MINUTES ?? 30);
  const maxDbMb = Number(process.env.FEC_HISTORY_MAX_DB_MB ?? 400);
  const today = new Date().toISOString().slice(0, 10);

  if (!key) {
    ctx.extra["skipped"] = "FEC_API_KEY not set";
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }

  const dbMb = async (): Promise<number> => {
    const [r] = await sql<{ mb: number }[]>`select round(pg_database_size(current_database()) / 1048576.0)::int as mb`;
    return r?.mb ?? 0;
  };

  const todo = await sql<{ id: number; fec_id: string }[]>`
    select id, fec_id from committees
     where fec_id is not null and (donations_history_floor is null or donations_history_floor > ${floor})
     order by id
  `;
  const totalCommittees = (await sql<{ n: number }[]>`select count(*)::int as n from committees where fec_id is not null`)[0]?.n ?? 0;

  let requests = 0;
  let stopped: string | null = null;
  let done = 0;
  let full = 0;
  let sampled = 0;
  let failedCommittees = 0;
  let sizeMb = await dbMb();
  const sizeAtStart = sizeMb;
  const outOfBudget = () => requests >= maxRequests || Date.now() - startedAt > maxMinutes * 60_000;

  if (sizeMb > maxDbMb) stopped = `database size guard (${sizeMb} MB > ${maxDbMb} MB)`;

  /** Fetch one page and store it. Returns the page, or null when the run must stop. */
  async function pull(committee: { id: number; fec_id: string }, minDate: string, maxDate: string, cursor?: Cursor): Promise<Page | "failed" | null> {
    if (outOfBudget()) { stopped = "budget reached"; return null; }
    let data: Page;
    try {
      requests++;
      data = await fetchJson<Page>(url(key!, committee.fec_id, minDate, maxDate, cursor));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("429")) { stopped = "rate limited (429)"; return null; }
      ctx.quarantine(`${SOURCE}:${committee.fec_id}`, message);
      return "failed";
    }
    const batch: { committee_id: number; donor_name: string | null; donor_employer: string | null; donor_state: string | null; amount: number | null; donated_at: string; source_ref: string }[] = [];
    for (const r of data.results ?? []) {
      if (r.sub_id == null || r.sub_id === "") continue;
      const sub = String(r.sub_id);
      const date = r.contribution_receipt_date ? r.contribution_receipt_date.slice(0, 10) : null;
      if (!date || date > today || date < floor) continue;
      if (!ctx.markSeen(sub)) continue;
      ctx.rowsSeen++;
      const row = scrubDeep({
        donor_name: r.contributor_name ?? null,
        donor_employer: r.contributor_employer ?? null,
        donor_state: r.contributor_state ?? null,
      });
      batch.push({
        committee_id: committee.id,
        donor_name: row.donor_name, donor_employer: row.donor_employer, donor_state: row.donor_state,
        amount: r.contribution_receipt_amount == null ? null : Number(r.contribution_receipt_amount),
        donated_at: date, source_ref: sub,
      });
    }
    if (batch.length > 0) {
      const res = await sql`
        insert into donations ${sql(batch, "committee_id", "donor_name", "donor_employer", "donor_state", "amount", "donated_at", "source_ref")}
        on conflict (source_ref) where source_ref is not null do nothing
      `;
      ctx.rowsChanged += res.count ?? 0;
    }
    return data;
  }

  /** Page newest-first through one date range, at most `maxPages` pages. false = stop/fail. */
  async function walk(committee: { id: number; fec_id: string }, minDate: string, maxDate: string, maxPages: number, first?: Page): Promise<boolean> {
    let page: Page | "failed" | null = first ?? (await pull(committee, minDate, maxDate));
    let pages = 1;
    for (;;) {
      if (page === null || page === "failed") return false;
      const next = page.pagination?.last_indexes;
      if ((page.results ?? []).length < PER_PAGE || !next || next.last_index == null) return true;
      if (pages >= maxPages) return true;
      page = await pull(committee, minDate, maxDate, next);
      pages++;
    }
  }

  for (const committee of stopped ? [] : todo) {
    if (outOfBudget()) { stopped = "budget reached"; break; }
    if (done > 0 && done % 20 === 0) {
      sizeMb = await dbMb();
      if (sizeMb > maxDbMb) { stopped = `database size guard (${sizeMb} MB > ${maxDbMb} MB)`; break; }
    }

    const first = await pull(committee, floor, today);
    if (first === null) break;
    if (first === "failed") { failedCommittees++; continue; }
    const count = first.pagination?.count ?? (first.results ?? []).length;

    let ok: boolean;
    let note: string;
    if (count <= fullCap) {
      ok = await walk(committee, floor, today, Math.ceil(fullCap / PER_PAGE) + 1, first);
      note = `complete:${count}`;
    } else {
      ok = true;
      for (const s of slicesBackTo(today, floor)) {
        ok = await walk(committee, s.start, s.end, slicePages);
        if (!ok) break;
      }
      note = `sampled:${count}`;
    }
    if (stopped) break;
    if (!ok) { failedCommittees++; continue; }

    await sql`update committees set donations_history_floor = ${floor}, donations_history_note = ${note} where id = ${committee.id}`;
    done++;
    if (note.startsWith("complete")) full++; else sampled++;
  }

  sizeMb = await dbMb();
  const remaining = todo.length - done;
  console.log(`${SOURCE}: ${done} committee(s) done this run (${full} in full, ${sampled} sampled), ${remaining} of ${totalCommittees} still to do, ` +
    `${requests} requests, ${stopped ? `stopped: ${stopped}` : "finished"}; database ${sizeMb} MB`);

  ctx.extra["history_since"] = floor;
  ctx.extra["committees_total"] = totalCommittees;
  ctx.extra["committees_done_this_run"] = done;
  ctx.extra["committees_full"] = full;
  ctx.extra["committees_sampled"] = sampled;
  ctx.extra["committees_failed"] = failedCommittees;
  ctx.extra["committees_remaining"] = remaining;
  ctx.extra["requests"] = requests;
  ctx.extra["stopped"] = stopped;
  ctx.extra["db_size_mb_start"] = sizeAtStart;
  ctx.extra["db_size_mb"] = sizeMb;
  ctx.extra["elapsed_seconds"] = Math.round((Date.now() - startedAt) / 1000);
  if (stopped) ctx.warn(`stopped: ${stopped}`);

  // The guard is a deliberate stop, not work left for the next run: report success so an
  // automated chain ends. Budget and 429 stops are "partial" — run it again.
  const guard = stopped?.startsWith("database size guard") ?? false;
  const more = remaining > 0 && !guard && (stopped != null || failedCommittees === 0);
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: more ? "partial" : "success", stats: ctx.stats() };
}
