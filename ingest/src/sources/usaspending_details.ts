// Source: USAspending.gov award detail (api.usaspending.gov), one award at a time. Keyless.
//
// WHY. The contracts job (usaspending.ts) stores description, sub-agency and end date for the
// awards its searches return (migration 0027). Its searches read the 300 largest awards of each
// 30-day slice plus tracked companies, and the slices move every day, so thousands of awards
// stored by earlier runs are never returned again and never got the three details (2,506 of the
// 5,921 awards in the site's 180-day window and 10,299 of 17,907 in the table on 2026-11-19).
// This job asks for each such award by its id and fills the blanks.
//
// ENDPOINT: GET /api/v2/awards/<generated_internal_id>/ (the id the search returns and
// contracts.source_ref holds). Fields read:
//   description                              → contracts.description
//   awarding_agency.subtier_agency.name      → contracts.awarding_sub_agency
//   period_of_performance.end_date           → contracts.end_date
// THE SHAPE WAS WRITTEN FROM MEMORY OF THE API (it is not reachable from the sandbox this was
// built in). So the job checks it: if the first SHAPE_CHECK_AFTER answers carry none of the
// keys `description`, `awarding_agency`, `period_of_performance`, it ends as "failed" and
// marks nothing as checked.
//
// WHAT IT WRITES. Only blanks are filled (a value the search stored is kept), cleaned exactly
// as the search job cleans them (cleanText, dateOnly). Every award answered gets
// details_checked_at (migration 0028), also when the answer has nothing to add or the API
// answers 404, so it is not asked for again. An award whose request fails keeps
// details_checked_at NULL and is asked for again next run.
//
// ORDER AND STOPPING. Newest start date first, so the awards the site shows are filled first.
// USASPENDING_DETAILS_MAX_MINUTES (default 40) ends a run as "partial" with `remaining` in the
// stats; the next run carries on. Five failures in a row end the run as "failed": the API is
// down. Requests go through lib/http (1.5 s apart: about 1,500 awards a run).
//
// Env: USASPENDING_API_BASE (tests only: scripts/fake-usaspending.mjs),
// USASPENDING_DETAILS_MAX_MINUTES, USASPENDING_DETAILS_MAX_AWARDS (0 = no cap),
// USASPENDING_DETAILS_MAX_CONSECUTIVE_FAILURES, USASPENDING_DETAILS_RETRIES (tests only),
// USASPENDING_DETAILS_SHAPE_CHECK_AFTER (tests only).

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";
import { cleanText, dateOnly } from "./usaspending.js";

const SOURCE = "usaspending_details";
const API_BASE = (process.env.USASPENDING_API_BASE ?? "https://api.usaspending.gov").replace(/\/$/, "");
/** After this many answers, at least one must have carried one of the expected keys. */
export const SHAPE_CHECK_AFTER = 20;
const SHAPE_KEYS = ["description", "awarding_agency", "period_of_performance"] as const;

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (tested in usaspending_details.test.ts)
// ──────────────────────────────────────────────────────────────────────────

export interface AwardDetails {
  description: string | null;
  subAgency: string | null;
  endDate: string | null;
  /** False when the answer has none of the keys this job reads (not the expected shape). */
  hasShape: boolean;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Read the three details out of one award answer. Never throws. */
export function parseAwardDetails(json: unknown): AwardDetails {
  const o = obj(json);
  if (!o) return { description: null, subAgency: null, endDate: null, hasShape: false };
  const hasShape = SHAPE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(o, k));
  const subtier = obj(obj(o["awarding_agency"])?.["subtier_agency"]);
  const period = obj(o["period_of_performance"]);
  return {
    description: cleanText(o["description"]),
    subAgency: cleanText(subtier?.["name"], 200),
    endDate: dateOnly(period?.["end_date"]),
    hasShape,
  };
}

export function awardUrl(base: string, sourceRef: string): string {
  return `${base}/api/v2/awards/${encodeURIComponent(sourceRef)}/`;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /HTTP 404\b/.test(err.message);
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ──────────────────────────────────────────────────────────────────────────
// The job
// ──────────────────────────────────────────────────────────────────────────

export async function ingestUsaspendingDetails(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();

  const budgetMin = envNumber("USASPENDING_DETAILS_MAX_MINUTES", 40);
  const overBudget = () => budgetMin > 0 && Date.now() - startedAt > budgetMin * 60_000;
  const maxAwards = Math.max(0, Math.floor(envNumber("USASPENDING_DETAILS_MAX_AWARDS", 0)));
  const failureLimit = Math.max(1, Math.floor(envNumber("USASPENDING_DETAILS_MAX_CONSECUTIVE_FAILURES", 5)));
  const shapeCheckAfter = Math.max(1, Math.floor(envNumber("USASPENDING_DETAILS_SHAPE_CHECK_AFTER", SHAPE_CHECK_AFTER)));
  const retriesEnv = process.env.USASPENDING_DETAILS_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : 1;

  // Awards with a blank that were never asked for by id; the ones the site shows first.
  const queue = await sql<{ id: string; source_ref: string }[]>`
    select id::text as id, source_ref
      from contracts
     where details_checked_at is null and source_ref is not null
       and (description is null or awarding_sub_agency is null or end_date is null)
     order by (action_date <= current_date) desc, action_date desc nulls last, id desc`;

  const c = {
    to_check: queue.length, requests: 0, checked: 0, filled_description: 0, filled_sub_agency: 0,
    filled_end_date: 0, nothing_to_add: 0, not_found: 0, odd_answers: 0, failures: 0, remaining: 0,
  };
  let stoppedOnBudget = false;
  let stoppedOnCap = false;
  let fatal: string | null = null;
  let lastFailure = "";
  let failuresInARow = 0;
  let sawShape = false;
  let answers = 0;
  // Until the shape is proven, nothing is marked as checked: a wrong shape must not close awards.
  const held: { id: string; d: AwardDetails }[] = [];

  async function write(id: string, d: AwardDetails): Promise<void> {
    const [before] = await sql<{ d: boolean; s: boolean; e: boolean }[]>`
      select description is null as d, awarding_sub_agency is null as s, end_date is null as e
        from contracts where id = ${id}`;
    const res = await sql`
      update contracts
         set description = coalesce(description, ${d.description}),
             awarding_sub_agency = coalesce(awarding_sub_agency, ${d.subAgency}),
             end_date = coalesce(end_date, ${d.endDate}::date),
             details_checked_at = now()
       where id = ${id}`;
    ctx.rowsChanged += res.count ?? 0;
    c.checked++;
    let added = 0;
    if (before?.d && d.description) { c.filled_description++; added++; }
    if (before?.s && d.subAgency) { c.filled_sub_agency++; added++; }
    if (before?.e && d.endDate) { c.filled_end_date++; added++; }
    if (added === 0) c.nothing_to_add++;
  }

  let done = 0;
  for (const row of queue) {
    if (failuresInARow >= failureLimit) break;
    if (overBudget()) { stoppedOnBudget = true; break; }
    if (maxAwards > 0 && c.requests >= maxAwards) { stoppedOnCap = true; break; }
    if (!ctx.markSeen(row.source_ref)) { done++; continue; }
    ctx.rowsSeen++;

    let d: AwardDetails;
    let notFound = false;
    try {
      c.requests++;
      d = parseAwardDetails(scrubDeep(await fetchJson<unknown>(awardUrl(API_BASE, row.source_ref), { retries })));
      failuresInARow = 0;
    } catch (err) {
      if (isNotFound(err)) {
        // USAspending no longer knows this award id. Record that, so it is not asked for daily.
        notFound = true;
        c.not_found++;
        failuresInARow = 0;
        d = { description: null, subAgency: null, endDate: null, hasShape: true };
      } else {
        failuresInARow++;
        c.failures++;
        lastFailure = err instanceof Error ? err.message : String(err);
        continue; // not marked: asked for again next run
      }
    }
    if (!notFound) {
      answers++;
      if (d.hasShape) sawShape = true; else c.odd_answers++;
    }
    if (!sawShape) {
      if (answers >= shapeCheckAfter) {
        fatal = `the first ${shapeCheckAfter} answers held none of the keys ${SHAPE_KEYS.join(", ")}: the award data is not in the shape this job expects`;
        break;
      }
      if (!notFound) held.push({ id: row.id, d }); // a 404 before the shape is proven is asked again
      continue;
    }
    for (const h of held.splice(0)) { if (h.d.hasShape) { await write(h.id, h.d); done++; } }
    if (!d.hasShape) continue; // an odd answer among good ones: leave the award for another run
    await write(row.id, d);
    done++;
    if (c.checked % 250 === 0) console.log(`${SOURCE}: ${c.checked} of ${queue.length} checked, ${c.filled_description} descriptions filled`);
  }
  c.remaining = queue.length - done;

  const [tot] = await sql<{ rows: number; with_description: number; win: number; win_with: number }[]>`
    select count(*)::int as rows, count(description)::int as with_description,
           count(*) filter (where action_date between current_date - 180 and current_date)::int as win,
           count(description) filter (where action_date between current_date - 180 and current_date)::int as win_with
      from contracts`;
  Object.assign(ctx.extra, c);
  ctx.extra["stopped_on_budget"] = stoppedOnBudget;
  ctx.extra["stopped_on_cap"] = stoppedOnCap;
  ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
  ctx.extra["table_rows"] = tot?.rows ?? 0;
  ctx.extra["table_with_description"] = tot?.with_description ?? 0;
  ctx.extra["window_180_rows"] = tot?.win ?? 0;
  ctx.extra["window_180_with_description"] = tot?.win_with ?? 0;
  console.log(`${SOURCE}: checked ${c.checked} of ${queue.length} (descriptions ${c.filled_description}, sub-agencies ${c.filled_sub_agency}, end dates ${c.filled_end_date} filled; ${c.nothing_to_add} with nothing to add, ${c.not_found} unknown to USAspending, ${c.failures} failed, ${c.remaining} left); last 180 days: ${tot?.win_with ?? 0} of ${tot?.win ?? 0} awards carry a description; table ${tot?.with_description ?? 0} of ${tot?.rows ?? 0}`);

  if (fatal || failuresInARow >= failureLimit) {
    const error = fatal ?? `${failuresInARow} requests in a row failed (last: ${lastFailure.slice(0, 160)})`;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() };
  }
  // Anything left (budget, cap, a failed request, an answer in an odd shape) is "partial".
  const status = c.remaining > 0 ? "partial" : "success";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}
