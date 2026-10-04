// Source: FEC OpenFEC — Schedule A (itemized receipts / donations).
// Contract: integration contract §4.5 (donations; sub_id is the dedupe key).
//
// SCOPE (staging-safe — schedule_a is a firehose, never ingest it unbounded):
// committee scope = env FEC_COMMITTEE_IDS (comma-separated fec_id values) UNION
// every fec_id already present in the committees table. Empty scope = no-op success.
//
// WINDOW (rewritten 2026-10-04): receipts reach the FEC only when a committee FILES — most
// file quarterly — so "receipts dated in the last 30 days" is nearly empty and what it does
// return is mostly typos dated years ahead (they sort first). The job now asks for receipts
// the FEC LOADED recently (min_load_date) and never dated after today (max_date):
//   first visit to a committee: loaded in the last FEC_LOOKBACK_DAYS (default 100) days
//   later visits:               loaded since the last visit, minus 2 days of overlap
// Newest receipt date first; paging stops at FEC_MAX_PAGES (default 10 = 1,000 receipts),
// when a page adds nothing new, or when receipts are older than the site's display window.
// So for very large committees (conduits such as ActBlue or WinRed) the table holds a
// recent SAMPLE, not every receipt — the page says so and never calls the sum a total.
//
// BUDGET: a standard key allows 1,000 calls an hour. Committees are visited least-recently-
// checked first (committees.donations_checked_at, migration 0010) and the run stops at
// FEC_MAX_REQUESTS (default 850); the rest are picked up by the next run. A 429 ends the
// run "partial" the same way.
//
// PAGINATION: schedule_a paginates by CURSOR, not by page number. Each response's
// pagination.last_indexes gives { last_index, last_contribution_receipt_date };
// repeat the same request with those two params added to get the next page.
// sort=-contribution_receipt_date with sort_hide_null=true (undated receipts are useless
// to a dated window and break the date cursor).
//
// AUTH: FEC_API_KEY, sent as the required `api_key` query param. Falls back to
// "DEMO_KEY" (heavily throttled, dev-only) with a warning. The key itself must
// NEVER appear in an error message, log line, or stats value — errors thrown by
// lib/http.ts already only include host+path, and we never echo the full request
// URL anywhere else.
//
// DEDUPE: sub_id is FEC's stable unique id per itemized receipt — the only safe
// natural key (contributor_name/date/amount are not unique: repeat donors donate
// repeatedly). Missing sub_id rows are quarantined and skipped, never guessed at.
//
// WRITE SHAPE: committees are upserted on fec_id first (lazily, cached per run in
// a Map) so every donation row has a committee_id FK. donations then upsert on
// source_ref (= sub_id) with "do nothing" on conflict: receipts are immutable at
// the source, so once we have a sub_id there is nothing to refresh.

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "fec_schedule_a";
// FEC_API_BASE exists for the local mock test only; production never sets it.
const BASE_URL = `${process.env.FEC_API_BASE ?? "https://api.open.fec.gov/v1"}/schedules/schedule_a/`;
const PER_PAGE = 100; // API max

interface CommitteeRef {
  name?: string | null;
}

interface ScheduleAResult {
  sub_id?: string | number | null;
  contributor_name?: string | null;
  contributor_employer?: string | null;
  contributor_state?: string | null;
  contribution_receipt_amount?: string | number | null;
  contribution_receipt_date?: string | null;
  committee_id?: string | null;
  committee?: CommitteeRef | null;
}

interface LastIndexes {
  last_index?: string | number | null;
  last_contribution_receipt_date?: string | null;
}

interface SchedulePagination {
  count?: number;
  pages?: number;
  per_page?: number;
  last_indexes?: LastIndexes | null;
}

interface ScheduleAPage {
  pagination?: SchedulePagination;
  results?: ScheduleAResult[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Date part only, tolerant of a full timestamp (contribution_receipt_date is date-only anyway). */
function dateOnly(raw: string): string {
  return raw.slice(0, 10);
}

function scheduleAUrl(
  apiKey: string,
  committeeId: string,
  minLoadDate: string,
  maxDate: string,
  cursor?: LastIndexes,
): string {
  const u = new URL(BASE_URL);
  u.searchParams.set("api_key", apiKey);
  u.searchParams.set("committee_id", committeeId);
  u.searchParams.set("min_load_date", minLoadDate);
  u.searchParams.set("max_date", maxDate);
  u.searchParams.set("per_page", String(PER_PAGE));
  u.searchParams.set("sort", "-contribution_receipt_date");
  u.searchParams.set("sort_hide_null", "true");
  if (cursor?.last_index != null) {
    u.searchParams.set("last_index", String(cursor.last_index));
  }
  if (cursor?.last_contribution_receipt_date != null) {
    u.searchParams.set("last_contribution_receipt_date", cursor.last_contribution_receipt_date);
  }
  return u.toString();
}

export async function ingestFecScheduleA(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const apiKey = process.env.FEC_API_KEY;
  const demoKey = !apiKey;
  if (demoKey) {
    ctx.warn("FEC_API_KEY not set — skipped (no-op). Free key: https://api.data.gov/signup/");
    ctx.extra["skipped"] = "FEC_API_KEY not set";
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }
  const key = apiKey ?? "DEMO_KEY";

  const lookbackDays = Number(process.env.FEC_LOOKBACK_DAYS ?? 100);
  const firstVisitLoadDate = isoDaysAgo(Number.isFinite(lookbackDays) ? lookbackDays : 100);
  const today = isoDaysAgo(0);
  const maxPages = Number(process.env.FEC_MAX_PAGES ?? 10);
  const maxRequests = Number(process.env.FEC_MAX_REQUESTS ?? 850);
  // The site shows a 90-day window; receipts older than this are not worth a request.
  const oldestUseful = isoDaysAgo(120);

  const envCommitteeIds = (process.env.FEC_COMMITTEE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Least-recently-checked first, so a run that stops at its request budget resumes where
  // it left off next time instead of always serving the same committees.
  const dbCommitteeRows = await sql<{ fec_id: string; checked: string | null }[]>`
    select fec_id, (donations_checked_at at time zone 'utc')::date::text as checked
      from committees where fec_id is not null
     order by donations_checked_at asc nulls first, id
  `;
  const lastChecked = new Map(dbCommitteeRows.map((r) => [r.fec_id, r.checked]));
  const dbCommitteeIds = dbCommitteeRows.map((r) => r.fec_id);

  const committeeScope = Array.from(new Set([...envCommitteeIds, ...dbCommitteeIds]));

  if (committeeScope.length === 0) {
    ctx.warn("no committee scope configured (FEC_COMMITTEE_IDS empty, committees table empty) — no-op");
    return {
      source: SOURCE,
      rowsSeen: 0,
      rowsChanged: 0,
      status: "success",
      stats: ctx.stats(),
    };
  }

  // fec_id -> internal committees.id, resolved lazily and cached for the run.
  const committeeInternalIds = new Map<string, number>();

  async function resolveCommitteeId(fecId: string, name: string | null): Promise<number> {
    const cached = committeeInternalIds.get(fecId);
    if (cached != null) return cached;
    const row = scrubDeep({ fec_id: fecId, name });
    // committees.name is not-null; schedule_a's committee.name can be absent, so
    // fall back to the fec_id as a placeholder label (never an empty string) —
    // the coalesce on conflict still lets a later real name win.
    const [committee] = await sql`
      insert into committees (fec_id, name)
      values (${row.fec_id}, ${row.name ?? row.fec_id})
      on conflict (fec_id) do update
        set name = coalesce(excluded.name, committees.name)
      returning id
    `;
    const id = committee!.id as number;
    committeeInternalIds.set(fecId, id);
    return id;
  }

  const pagesPerCommittee: Record<string, number> = {};
  let requests = 0;
  let committeesDone = 0;
  let stoppedReason: string | null = null;
  let futureDated = 0;

  for (const committeeId of committeeScope) {
    if (requests >= maxRequests) { stoppedReason = "request budget reached"; break; }

    // Load-date floor: since the last visit (2 days of overlap), never further back than
    // the first-visit window.
    const checked = lastChecked.get(committeeId) ?? null;
    let minLoadDate = firstVisitLoadDate;
    if (checked) {
      const d = new Date(`${checked}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 2);
      const floor = d.toISOString().slice(0, 10);
      if (floor > minLoadDate) minLoadDate = floor;
    }

    let cursor: LastIndexes | undefined = undefined;
    let pages = 0;
    let failed = false;

    while (pages < maxPages && requests < maxRequests) {
      const url = scheduleAUrl(key, committeeId, minLoadDate, today, cursor);
      let data: ScheduleAPage;
      try {
        requests++;
        data = await fetchJson<ScheduleAPage>(url);
      } catch (err) {
        // lib/http errors carry host+path only — never the query string or the key.
        const message = err instanceof Error ? err.message : String(err);
        ctx.quarantine(`${SOURCE}:${committeeId}`, message);
        failed = true;
        if (message.includes("429")) stoppedReason = "rate limited (429)";
        break;
      }
      pages++;
      let newOnPage = 0;
      let oldestOnPage: string | null = null;

      for (const result of data.results ?? []) {
        const subId = result.sub_id;
        const ref = `${SOURCE}:${committeeId}:${subId ?? `page${pages}:unknown`}`;

        if (subId == null || subId === "") {
          ctx.quarantine(ref, "missing sub_id — cannot dedupe");
          continue;
        }
        const subIdStr = String(subId);
        if (!ctx.markSeen(subIdStr)) continue;
        ctx.rowsSeen++;

        const receiptDate = result.contribution_receipt_date
          ? dateOnly(result.contribution_receipt_date)
          : null;
        // Belt and braces with max_date: a receipt dated after today is a filer typo.
        if (receiptDate == null || receiptDate > today) { futureDated++; continue; }
        if (oldestOnPage == null || receiptDate < oldestOnPage) oldestOnPage = receiptDate;
        const committeeFecId = result.committee_id ?? committeeId;
        const committeeName = result.committee?.name ?? null;

        const row = scrubDeep({
          sub_id: subIdStr,
          contributor_name: result.contributor_name ?? null,
          contributor_employer: result.contributor_employer ?? null,
          contributor_state: result.contributor_state ?? null,
          amount:
            result.contribution_receipt_amount == null
              ? null
              : Number(result.contribution_receipt_amount),
          donated_at: receiptDate,
          committee_fec_id: committeeFecId,
          committee_name: committeeName,
        });

        const internalCommitteeId = await resolveCommitteeId(row.committee_fec_id, row.committee_name);

        const result_ = await sql`
          insert into donations (
            committee_id, donor_name, donor_employer, donor_state,
            amount, donated_at, source_ref
          )
          values (
            ${internalCommitteeId}, ${row.contributor_name}, ${row.contributor_employer}, ${row.contributor_state},
            ${row.amount}, ${row.donated_at}, ${row.sub_id}
          )
          on conflict (source_ref) where source_ref is not null do nothing
        `;
        ctx.rowsChanged += result_.count ?? 0;
        newOnPage += result_.count ?? 0;
      }

      const lastIndexes = data.pagination?.last_indexes;
      if (lastIndexes == null || lastIndexes.last_index == null) break;
      if ((data.results ?? []).length > 0 && newOnPage === 0) break; // caught up
      if (oldestOnPage != null && oldestOnPage < oldestUseful) break; // past the display window
      cursor = lastIndexes;
    }

    if (pages > 0) pagesPerCommittee[committeeId] = pages;
    if (stoppedReason) break;
    if (!failed) {
      await sql`update committees set donations_checked_at = now() where fec_id = ${committeeId}`;
      committeesDone++;
    }
  }

  ctx.extra["committees_in_scope"] = committeeScope.length;
  ctx.extra["committees_done"] = committeesDone;
  ctx.extra["committees_deferred"] = committeeScope.length - committeesDone;
  ctx.extra["requests"] = requests;
  ctx.extra["max_requests"] = maxRequests;
  ctx.extra["stopped"] = stoppedReason;
  ctx.extra["future_or_undated_skipped"] = futureDated;
  ctx.extra["multi_page_committees"] = Object.values(pagesPerCommittee).filter((n) => n > 1).length;
  ctx.extra["first_visit_min_load_date"] = firstVisitLoadDate;
  ctx.extra["max_pages"] = maxPages;

  if (stoppedReason) ctx.warn(`stopped early: ${stoppedReason} — ${committeeScope.length - committeesDone} committee(s) carry over to the next run`);

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    // Deferring committees to the next run is the design, not a fault: only a 429 is partial.
    status: stoppedReason === "rate limited (429)" ? "partial" : "success",
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- fec_schedule_a`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestFecScheduleA()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
