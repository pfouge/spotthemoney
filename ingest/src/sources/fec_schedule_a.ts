// Source: FEC OpenFEC — Schedule A (itemized receipts / donations).
// Contract: integration contract §4.5 (donations; sub_id is the dedupe key).
//
// SCOPE (staging-safe — schedule_a is a firehose, never ingest it unbounded):
// committee scope = env FEC_COMMITTEE_IDS (comma-separated fec_id values) UNION
// every fec_id already present in the committees table. If that combined scope
// is empty, this is a no-op success (rowsSeen 0) — there is nothing to be
// staging-safe about but also nothing to fetch.
//
// WINDOW: min_date = today - FEC_LOOKBACK_DAYS (default 30). No max_date is sent
// (defaults to "up to now" on the API side).
//
// PAGINATION: schedule_a paginates by CURSOR, not by page number. Each response's
// pagination.last_indexes gives { last_index, last_contribution_receipt_date };
// repeat the same request with those two params added to get the next page.
// last_indexes is null/absent once the result set is exhausted. We always send
// sort=-contribution_receipt_date explicitly for a stable order (never rely on
// an implicit default), and cap pages per committee at FEC_MAX_PAGES (default 10).
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
const BASE_URL = "https://api.open.fec.gov/v1/schedules/schedule_a/";
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
  minDate: string,
  cursor?: LastIndexes,
): string {
  const u = new URL(BASE_URL);
  u.searchParams.set("api_key", apiKey);
  u.searchParams.set("committee_id", committeeId);
  u.searchParams.set("min_date", minDate);
  u.searchParams.set("per_page", String(PER_PAGE));
  u.searchParams.set("sort", "-contribution_receipt_date");
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

  const lookbackDays = Number(process.env.FEC_LOOKBACK_DAYS ?? 30);
  const minDate = isoDaysAgo(Number.isFinite(lookbackDays) ? lookbackDays : 30);
  const maxPages = Number(process.env.FEC_MAX_PAGES ?? 10);

  const envCommitteeIds = (process.env.FEC_COMMITTEE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const dbCommitteeRows = await sql`
    select fec_id from committees where fec_id is not null
  `;
  const dbCommitteeIds = dbCommitteeRows.map((r) => r.fec_id as string);

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

  for (const committeeId of committeeScope) {
    let cursor: LastIndexes | undefined = undefined;
    let pages = 0;

    while (pages < maxPages) {
      const url = scheduleAUrl(key, committeeId, minDate, cursor);
      const data = await fetchJson<ScheduleAPage>(url);
      pages++;

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
      }

      const lastIndexes = data.pagination?.last_indexes;
      if (lastIndexes == null || lastIndexes.last_index == null) break;
      cursor = lastIndexes;
    }

    pagesPerCommittee[committeeId] = pages;
  }

  ctx.extra["committees_queried"] = committeeScope.length;
  ctx.extra["pages_per_committee"] = pagesPerCommittee;
  ctx.extra["total_pages"] = Object.values(pagesPerCommittee).reduce((a, b) => a + b, 0);
  ctx.extra["lookback_days"] = lookbackDays;
  ctx.extra["min_date"] = minDate;
  ctx.extra["max_pages"] = maxPages;
  ctx.extra["demo_key"] = demoKey;

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: "success",
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
