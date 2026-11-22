// Source: USAspending.gov award search, FINANCIAL ASSISTANCE awards (grants, direct payments,
// loans). Keyless. Stored in assistance_awards (migration 0037); stored, not shown.
//
// Sibling of usaspending.ts (contracts), same endpoint (POST /api/v2/search/spending_by_award/),
// and it reuses that job's helpers. What differs:
//   - The search rejects a request that mixes award-type groups, so every group is asked on its
//     own: grants (02-05), direct payments (06, 10), loans (07, 08), other (09, 11, -1).
//   - Loans use other field names ("Loan Value", "Subsidy Cost", "Issued Date"); see
//     lib/assistance.ts. A loan's issued date is stored as start_date.
//
// WHAT THIS STORES
//   1. LARGEST NEW AWARDS: for grants, direct payments and loans separately, the largest awards
//      that started in each 30-day slice of the last ASSISTANCE_WINDOW_DAYS (default 400), by
//      amount, ASSISTANCE_PAGES_PER_SLICE pages of 100 (default 2).
//   2. TRACKED COMPANIES: awards of any kind to companies with a tracked ticker, over the whole
//      window; only rows whose recipient normalises to exactly the company's name are kept
//      (the contracts job's rule, normalizeOrgName in @stm/shared).
//   Recipients USAspending masks ("MULTIPLE RECIPIENTS", "REDACTED DUE TO PII") are stored as
//   returned and counted in stats.masked_recipients. Nothing is unmasked.
//
// CADENCE: the daily run covers the newest ASSISTANCE_RECENT_DAYS (60); a FULL sweep of the whole
// window runs when the last complete one is over ASSISTANCE_FULL_EVERY_DAYS (7) days old. The run
// ends as "partial" at ASSISTANCE_MAX_MINUTES (30). An unfinished FULL sweep is resumed by the
// next run at the slice (or company) where it stopped (stats.next_slice / next_company).
//
// REQUEST SHAPE IS NEGOTIATED, NEVER ASSUMED. Written from the API contract; the F-prefixed
// award type codes, date_type and the optional fields could not be confirmed against the live
// service. Per kind, on HTTP 400/422 before the first accepted request, one optional piece is
// dropped at a time (extra F codes, then date_type "new_awards_only", then optional fields in
// order) until the request is accepted; stats.accepted_* says what survived. A rejection of a
// required field is a real failure.
//
// SHAPE GUARD: if the first answer is not {results: [objects with generated_internal_id]} the run
// ends "failed" with nothing written.
//
// TEST HOOK: USASPENDING_API_BASE (shared with the contracts job) points at a local fake.

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext, SystemicFailureError } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { optionalEnv, normalizeOrgName } from "@stm/shared";
import type { IngestRunResult } from "@stm/shared";
import { windowSlices, startDateVerdict, recipientSearchText, isShapeRejection } from "./usaspending.js";
import type { Slice } from "./usaspending.js";
import {
  ALL_KINDS,
  KIND_SPECS,
  SLICED_KINDS,
  looksLikeSearchAnswer,
  parseAssistanceRow,
} from "../lib/assistance.js";
import type { AssistanceKind, AssistanceRecord } from "../lib/assistance.js";

const SOURCE = "usaspending_assistance";
const SEARCH_URL = `${process.env.USASPENDING_API_BASE ?? "https://api.usaspending.gov"}/api/v2/search/spending_by_award/`;
const PAGE_LIMIT = 100;
const SLICE_DAYS = 30;
const COMPANY_PAGES = 3;
const MAX_CONSECUTIVE_FAILURES = 5;

interface SearchResponse {
  results: Record<string, unknown>[];
  page_metadata?: { hasNext?: boolean };
}

interface Negotiation {
  useExtraCodes: boolean;
  useDateType: boolean;
  dropped: Set<string>;
  settled: boolean;
}

class ShapeError extends Error {}

function num(name: string, dflt: number): number {
  const n = Number(optionalEnv(name) ?? dflt);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export async function ingestUsaspendingAssistance(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const fullWindowDays = num("ASSISTANCE_WINDOW_DAYS", 400);
  const recentDays = num("ASSISTANCE_RECENT_DAYS", 60);
  const fullEveryDays = num("ASSISTANCE_FULL_EVERY_DAYS", 7);
  const maxMinutes = num("ASSISTANCE_MAX_MINUTES", 30);
  const pagesPerSlice = num("ASSISTANCE_PAGES_PER_SLICE", 2);
  const companyCap = num("ASSISTANCE_MAX_COMPANIES", 400);

  // Mode: a forced mode, else resume an unfinished full sweep, else full when due, else recent.
  const forcedMode = optionalEnv("ASSISTANCE_MODE");
  const [lastFull] = await sql<{ finished_at: Date | null }[]>`
    select r.finished_at from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.stats->>'full_sweep_complete' = 'true'
     order by r.id desc limit 1`;
  const [lastRun] = await sql<{ status: string; finished_at: Date | null; stats: Record<string, unknown> | null }[]>`
    select r.status, r.finished_at, r.stats from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.status <> 'running'
     order by r.id desc limit 1`;
  const lastFullAt = lastFull?.finished_at ? new Date(lastFull.finished_at) : null;
  const fullDue = !lastFullAt || Date.now() - lastFullAt.getTime() > fullEveryDays * 86_400_000;
  const resumable =
    lastRun?.status === "partial" &&
    lastRun.stats?.["mode"] === "full" &&
    lastRun.finished_at != null &&
    Date.now() - new Date(lastRun.finished_at).getTime() < 2 * 86_400_000;
  const mode: "full" | "recent" =
    forcedMode === "full" || forcedMode === "recent" ? forcedMode : resumable || fullDue ? "full" : "recent";
  const resume = mode === "full" && resumable && forcedMode !== "recent";
  const startSlice = resume ? Math.max(0, Number(lastRun!.stats?.["next_slice"] ?? 0) || 0) : 0;
  const startCompany = resume ? Math.max(0, Number(lastRun!.stats?.["next_company"] ?? 0) || 0) : 0;

  const windowDays = mode === "full" ? fullWindowDays : Math.min(recentDays, fullWindowDays);
  const startedAt = Date.now();
  const outOfTime = (): boolean => Date.now() - startedAt > maxMinutes * 60_000;
  let stopped: string | null = null;

  const slices = windowSlices(new Date(), windowDays, SLICE_DAYS);
  const windowStart = slices[slices.length - 1]!.start;
  const windowEnd = slices[0]!.end;

  const neg: Record<AssistanceKind, Negotiation> = {
    grant: { useExtraCodes: true, useDateType: true, dropped: new Set(), settled: false },
    direct_payment: { useExtraCodes: true, useDateType: true, dropped: new Set(), settled: false },
    loan: { useExtraCodes: true, useDateType: true, dropped: new Set(), settled: false },
    other: { useExtraCodes: true, useDateType: true, dropped: new Set(), settled: false },
  };
  let shapeProven = false;
  let requests = 0;
  let consecutiveFailures = 0;
  let outsideWindow = 0;
  let futureStartDates = 0;
  let masked = 0;
  const seenByKind: Record<string, number> = {};
  const keptByKind: Record<string, number> = {};
  for (const k of ALL_KINDS) { seenByKind[k] = 0; keptByKind[k] = 0; }

  async function search(kind: AssistanceKind, slice: Slice, page: number, recipientText?: string): Promise<SearchResponse> {
    const spec = KIND_SPECS[kind];
    const n = neg[kind];
    for (;;) {
      const codes = n.useExtraCodes ? [...spec.codes, ...spec.extraCodes] : spec.codes;
      const fields = [...spec.required, ...spec.optional.filter((f) => !n.dropped.has(f))];
      const period: Record<string, string> = { start_date: slice.start, end_date: slice.end };
      if (n.useDateType) period["date_type"] = "new_awards_only";
      const filters: Record<string, unknown> = { award_type_codes: codes, time_period: [period] };
      if (recipientText) filters["recipient_search_text"] = [recipientText];
      try {
        requests++;
        const resp = await fetchJson<SearchResponse>(SEARCH_URL, {
          method: "POST",
          body: { filters, fields, limit: PAGE_LIMIT, page, order: "desc", sort: spec.amountField },
        });
        if (!shapeProven) {
          if (!looksLikeSearchAnswer(resp)) throw new ShapeError("first answer is not {results: [objects with generated_internal_id]}");
          shapeProven = true;
        }
        n.settled = true;
        consecutiveFailures = 0;
        return resp;
      } catch (err) {
        if (err instanceof ShapeError) throw err;
        if (n.settled || !isShapeRejection(err)) {
          consecutiveFailures++;
          throw err;
        }
        // Drop one optional piece at a time and try again; give up when none are left.
        const msg = (err as Error).message;
        if (n.useExtraCodes && spec.extraCodes.length) {
          n.useExtraCodes = false;
          ctx.warn(`${kind}: extra award type codes ${spec.extraCodes.join(",")} rejected (${msg}) - continuing without them.`);
        } else if (n.useDateType) {
          n.useDateType = false;
          ctx.warn(`${kind}: date_type "new_awards_only" rejected (${msg}) - falling back to any activity in the slice, filtered by start date here.`);
        } else {
          const next = spec.optional.find((f) => !n.dropped.has(f));
          if (!next) { consecutiveFailures++; throw err; }
          n.dropped.add(next);
          ctx.warn(`${kind}: field "${next}" rejected (${msg}) - continuing without it.`);
        }
      }
    }
  }

  /** Count and store one API row if its start date is inside the window. True when written. */
  async function store(row: Record<string, unknown>, kind: AssistanceKind, where: string): Promise<boolean> {
    seenByKind[kind] = (seenByKind[kind] ?? 0) + 1;
    const clean = scrubDeep(row) as Record<string, unknown>;
    const parsed = parseAssistanceRow(clean, kind);
    if (!parsed.ok) {
      ctx.quarantine(`${where} row "${String(clean["Award ID"] ?? "unknown").slice(0, 40)}"`, parsed.reason);
      return false;
    }
    const rec: AssistanceRecord = parsed.rec;
    const verdict = startDateVerdict(rec.startDate, windowStart, windowEnd);
    if (verdict !== "ok") {
      if (verdict === "future") futureStartDates++;
      outsideWindow++;
      return false;
    }
    if (!ctx.markSeen(rec.sourceRef)) return false;
    ctx.rowsSeen++;
    if (rec.masked) masked++;
    const result = await sql`
      insert into assistance_awards (source_ref, award_id, kind, award_type, recipient, recipient_uei,
                                     awarding_agency, awarding_sub_agency, amount, subsidy_cost,
                                     start_date, end_date, description, assistance_listing)
      values (${rec.sourceRef}, ${rec.awardId}, ${rec.kind}, ${rec.awardType}, ${rec.recipient}, ${rec.recipientUei},
              ${rec.awardingAgency}, ${rec.awardingSubAgency}, ${rec.amount}, ${rec.subsidyCost},
              ${rec.startDate}, ${rec.endDate}, ${rec.description}, ${rec.assistanceListing})
      on conflict (source_ref) do update
        set award_id = coalesce(excluded.award_id, assistance_awards.award_id),
            kind = excluded.kind,
            award_type = coalesce(excluded.award_type, assistance_awards.award_type),
            recipient = excluded.recipient,
            recipient_uei = coalesce(excluded.recipient_uei, assistance_awards.recipient_uei),
            awarding_agency = coalesce(excluded.awarding_agency, assistance_awards.awarding_agency),
            awarding_sub_agency = coalesce(excluded.awarding_sub_agency, assistance_awards.awarding_sub_agency),
            amount = coalesce(excluded.amount, assistance_awards.amount),
            subsidy_cost = coalesce(excluded.subsidy_cost, assistance_awards.subsidy_cost),
            start_date = coalesce(excluded.start_date, assistance_awards.start_date),
            end_date = coalesce(excluded.end_date, assistance_awards.end_date),
            description = coalesce(excluded.description, assistance_awards.description),
            assistance_listing = coalesce(excluded.assistance_listing, assistance_awards.assistance_listing),
            updated_at = now()
    `;
    ctx.rowsChanged += result.count ?? 0;
    keptByKind[kind] = (keptByKind[kind] ?? 0) + 1;
    return true;
  }

  let nextSlice = startSlice;
  let nextCompany = startCompany;
  let companiesSearched = 0;
  let companiesWithAwards = 0;
  let companyKept = 0;
  let companyFailures = 0;
  let companyTotal = 0;
  let failedMessage: string | null = null;

  try {
    // 1. Largest new awards per kind, slice by slice (newest slice first).
    for (let si = startSlice; si < slices.length; si++) {
      if (stopped) break;
      const slice = slices[si]!;
      for (const kind of SLICED_KINDS) {
        let page = 1;
        let hasNext = true;
        while (hasNext && page <= pagesPerSlice) {
          if (outOfTime()) { stopped = "time budget reached"; break; }
          const resp = await search(kind, slice, page);
          for (const row of resp.results ?? []) await store(row, kind, `${kind} slice ${slice.start} page ${page}`);
          hasNext = resp.page_metadata?.hasNext ?? false;
          page++;
        }
        if (stopped) break;
      }
      if (stopped) break;
      nextSlice = si + 1;
    }

    // 2. Awards of any kind to tracked companies (exact normalised-name matches only).
    const companyRows = await sql`
      select distinct c.name
        from companies c
        join securities s on s.ticker = c.primary_ticker
       where s.is_active = true and s.type in ('equity','etf','adr') and c.name is not null
       order by c.name
       limit ${companyCap}
    `;
    companyTotal = companyRows.length;
    const wholeWindow: Slice = { start: windowStart, end: windowEnd };
    if (!stopped) {
      for (let ci = nextSlice >= slices.length ? startCompany : 0; ci < companyRows.length; ci++) {
        if (outOfTime()) { stopped = "time budget reached"; break; }
        nextCompany = ci;
        const name = String(companyRows[ci]!["name"]);
        const key = normalizeOrgName(name);
        const text = recipientSearchText(name);
        if (text.length < 3) { nextCompany = ci + 1; continue; }
        try {
          let kept = 0;
          for (const kind of ALL_KINDS) {
            let page = 1;
            let hasNext = true;
            while (hasNext && page <= COMPANY_PAGES) {
              if (outOfTime()) { stopped = "time budget reached"; break; }
              const resp = await search(kind, wholeWindow, page, text);
              for (const row of resp.results ?? []) {
                if (normalizeOrgName(row["Recipient Name"] as string | null) !== key) { seenByKind[kind] = (seenByKind[kind] ?? 0) + 1; continue; }
                if (await store(row, kind, `company "${name.slice(0, 30)}"`)) kept++;
              }
              hasNext = resp.page_metadata?.hasNext ?? false;
              page++;
            }
            if (stopped) break;
          }
          if (stopped) break; // this company is repeated by the next run
          companiesSearched++;
          if (kept > 0) companiesWithAwards++;
          companyKept += kept;
          nextCompany = ci + 1;
        } catch (err) {
          if (err instanceof ShapeError) throw err;
          companyFailures++;
          nextCompany = ci + 1;
          ctx.quarantine(`company "${name.slice(0, 40)}"`, err instanceof Error ? err.message : String(err));
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            throw new SystemicFailureError(`${SOURCE}: ${consecutiveFailures} requests failed in a row`, ctx.stats());
          }
        }
      }
    } else {
      nextCompany = startCompany;
    }
  } catch (err) {
    if (err instanceof ShapeError || !(err instanceof SystemicFailureError)) {
      failedMessage = err instanceof Error ? err.message : String(err);
    } else {
      failedMessage = err.message;
    }
  }

  const complete = !failedMessage && !stopped;
  const [totals] = await sql<{ rows: number; grants: number; direct: number; loans: number; other: number }[]>`
    select count(*)::int as rows,
           count(*) filter (where kind = 'grant')::int as grants,
           count(*) filter (where kind = 'direct_payment')::int as direct,
           count(*) filter (where kind = 'loan')::int as loans,
           count(*) filter (where kind = 'other')::int as other
      from assistance_awards`;

  ctx.extra["mode"] = mode;
  ctx.extra["resumed"] = resume;
  ctx.extra["full_sweep_complete"] = mode === "full" && complete;
  ctx.extra["last_full_sweep_at"] = lastFullAt ? lastFullAt.toISOString() : null;
  ctx.extra["max_minutes"] = maxMinutes;
  ctx.extra["elapsed_seconds"] = Math.round((Date.now() - startedAt) / 1000);
  ctx.extra["stopped"] = stopped;
  ctx.extra["next_slice"] = stopped && nextSlice < slices.length ? nextSlice : slices.length;
  ctx.extra["next_company"] = stopped && nextSlice >= slices.length ? nextCompany : 0;
  ctx.extra["window_days"] = windowDays;
  ctx.extra["window_start"] = windowStart;
  ctx.extra["window_end"] = windowEnd;
  ctx.extra["slices"] = slices.length;
  ctx.extra["requests"] = requests;
  ctx.extra["rows_seen_by_kind"] = seenByKind;
  ctx.extra["rows_kept_by_kind"] = keptByKind;
  ctx.extra["rows_outside_window"] = outsideWindow;
  ctx.extra["future_start_dates_skipped"] = futureStartDates;
  ctx.extra["masked_recipients"] = masked;
  ctx.extra["companies_total"] = companyTotal;
  ctx.extra["companies_searched"] = companiesSearched;
  ctx.extra["companies_with_awards"] = companiesWithAwards;
  ctx.extra["company_rows_kept"] = companyKept;
  ctx.extra["company_search_failures"] = companyFailures;
  ctx.extra["accepted"] = Object.fromEntries(
    ALL_KINDS.map((k) => [
      k,
      {
        extra_codes: neg[k].useExtraCodes && KIND_SPECS[k].extraCodes.length > 0,
        date_type: neg[k].useDateType,
        dropped_fields: [...neg[k].dropped],
        settled: neg[k].settled,
      },
    ]),
  );
  ctx.extra["table_rows"] = totals?.rows ?? 0;
  ctx.extra["table_by_kind"] = { grant: totals?.grants ?? 0, direct_payment: totals?.direct ?? 0, loan: totals?.loans ?? 0, other: totals?.other ?? 0 };
  if (failedMessage) ctx.extra["error"] = failedMessage;
  if (stopped) ctx.warn(`${SOURCE} ${mode} pass stopped early: ${stopped} (next slice ${ctx.extra["next_slice"]}, next company ${ctx.extra["next_company"]})`);

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: failedMessage ? "failed" : stopped ? "partial" : "success",
    ...(failedMessage ? { error: failedMessage } : stopped ? { error: `${mode} pass stopped early: ${stopped}` } : {}),
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- usaspending_assistance`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestUsaspendingAssistance()
    .then((r) => {
      console.log(`${r.status === "failed" ? "x" : "ok"} ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})${r.error ? ` - ${r.error}` : ""}`);
      if (r.status === "failed") process.exitCode = 1;
    })
    .catch((e) => {
      console.error(`x ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
