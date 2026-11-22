// Source: SEC submissions (data.sec.gov) — Form 8-K and 8-K/A filings with their item codes for
// every TRACKED company. Keyless. Stored only (tables company_events and company_events_checked,
// migration 0034); no page reads them yet.
//
//   <base>/submissions/CIK<10 digits>.json  →  filings.recent (parallel arrays)
//
// Only `filings.recent` is read (the newest ~1,000 filings, which covers the floor for all but
// the busiest filers; older pages in `filings.files` are not fetched). Forms kept: exactly 8-K
// and 8-K/A, filed on or after EVENTS_FLOOR. Reading rules: lib/events8k.ts.
//
// WHICH COMPANIES. Tracked companies with a CIK: those never asked first, then those last asked
// more than SEC_EVENTS_REFRESH_HOURS (default 20) hours ago, oldest first. No per-run cap, so
// every tracked company is read about daily.
//
// WRITING. Per company, in one transaction: events upserted by accession (new ones inserted,
// `items` updated when they changed), the checked row upserted. Events are never deleted.
// HTTP 404 → status not_found. A request that fails writes nothing; the company stays due.
//
// STOPPING. SEC_EVENTS_MAX_MINUTES (default 30) ends the run as "partial" with `remaining`.
// Five request failures in a row (SEC_EVENTS_MAX_CONSECUTIVE_FAILURES) end it "failed". SHAPE
// GUARD: nothing is written until one answer has the expected layout (filings.recent.form and
// .accessionNumber arrays of equal length, .items an array); SEC_EVENTS_SHAPE_CHECK_AFTER
// (default 20) answers without it, none with, end the run "failed" with nothing written. Once
// the layout is proven (in this run, or by an earlier run: a checked row with status ok), an
// answer with the layout but no 8-K is simply ok with 0 events; an answer without the layout is
// counted odd_answers and the company is not marked.
//
// Env: SEC_DATA_BASE (tests only), SEC_EVENTS_MAX_MINUTES, SEC_EVENTS_REFRESH_HOURS,
// SEC_EVENTS_MAX_CONSECUTIVE_FAILURES, SEC_EVENTS_SHAPE_CHECK_AFTER, SEC_EVENTS_RETRIES (tests
// only), SEC_EVENTS_MIN_GAP_MS (tests only).

import { fetchJson } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import { pickEvents } from "../lib/events8k.js";
import { EVENTS_FLOOR, type IngestRunResult } from "@stm/shared";
import { sec, outageCounter } from "./sec_form4.js";
import { tenDigitCik } from "./sec_company_sic.js";

const SOURCE = "sec_company_events";
const DATA_BASE = (process.env.SEC_DATA_BASE ?? "https://data.sec.gov").replace(/\/$/, "");

export function eventsSubmissionsUrl(base: string, cik: string): string {
  return `${base}/submissions/CIK${cik}.json`;
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

export async function ingestSecCompanyEvents(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();

  const budgetMin = envNumber("SEC_EVENTS_MAX_MINUTES", 30);
  const budgetMs = budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const refreshHours = Math.max(0, envNumber("SEC_EVENTS_REFRESH_HOURS", 20));
  const outage = outageCounter(envNumber("SEC_EVENTS_MAX_CONSECUTIVE_FAILURES", 5));
  const shapeCheckAfter = Math.max(1, Math.floor(envNumber("SEC_EVENTS_SHAPE_CHECK_AFTER", 20)));
  const retriesEnv = process.env.SEC_EVENTS_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;
  const gapEnv = process.env.SEC_EVENTS_MIN_GAP_MS;
  const reqOpts = () => ({
    ...sec(),
    ...(gapEnv != null && gapEnv !== "" && Number.isFinite(Number(gapEnv)) ? { minGapMs: Number(gapEnv) } : {}),
    ...(retries != null ? { retries } : {}),
  });

  const fresh = await sql<{ cik: string }[]>`
    select c.cik
      from companies c left join company_events_checked f on f.cik = lpad(c.cik, 10, '0')
     where c.tracked and c.cik is not null and f.cik is null
     order by c.id`;
  const stale = await sql<{ cik: string }[]>`
    select c.cik
      from companies c join company_events_checked f on f.cik = lpad(c.cik, 10, '0')
     where c.tracked and c.cik is not null and f.checked_at < now() - make_interval(secs => ${refreshHours * 3600})
     order by f.checked_at, c.id`;

  const c: Record<string, number> = {
    to_check: fresh.length + stale.length, asked: 0, companies_with_events: 0, events_new: 0, events_updated: 0,
    not_found: 0, odd_answers: 0, failures: 0, remaining: 0,
  };
  const itemCounts: Record<string, number> = {};
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  const [held] = await sql<{ n: number }[]>`select count(*)::int as n from (select 1 from company_events_checked where status = 'ok' limit 1) x`;
  let shapeProven = (held?.n ?? 0) > 0;
  let oddBeforeProof = 0;
  const sync = () => {
    Object.assign(ctx.extra, c);
    for (const [k, v] of Object.entries(itemCounts)) ctx.extra[`item_${k.replace(/\W+/g, "_")}`] = v;
    ctx.extra["stopped_on_budget"] = stoppedOnBudget;
    ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
  };

  const queue = [...fresh, ...stale];
  let done = 0;
  for (const co of queue) {
    if (outage.tripped) break;
    if (overBudget()) { stoppedOnBudget = true; break; }
    const cik = tenDigitCik(co.cik);
    if (!cik || !ctx.markSeen(cik)) { done++; continue; }
    ctx.rowsSeen++;

    let events: ReturnType<typeof pickEvents>["events"] = [];
    let status: "ok" | "not_found";
    try {
      c.asked!++;
      const answer = await fetchJson<unknown>(eventsSubmissionsUrl(DATA_BASE, cik), reqOpts());
      outage.ok();
      const picked = pickEvents(answer, cik, EVENTS_FLOOR);
      if (!picked.hasShape) {
        c.odd_answers!++;
        if (!shapeProven) {
          oddBeforeProof++;
          if (oddBeforeProof >= shapeCheckAfter) {
            fatal = `the first ${oddBeforeProof} answers did not have the submissions layout: the data is not in the shape this job expects; nothing was written`;
            break;
          }
        }
        continue; // not marked: asked again next run
      }
      shapeProven = true;
      events = picked.events;
      status = "ok";
    } catch (err) {
      if (isNotFound(err)) {
        outage.ok();
        status = "not_found";
      } else {
        outage.fail();
        c.failures!++;
        lastFailure = err instanceof Error ? err.message : String(err);
        continue; // nothing written; stays due
      }
    }

    const newest = events.reduce<string | null>((m, e) => (!m || e.filed > m ? e.filed : m), null);
    const counts = await sql.begin(async (tx) => {
      let added = 0;
      let changed = 0;
      const newItems: string[][] = [];
      if (events.length > 0) {
        const existing = await tx<{ accession: string; items: string[] }[]>`
          select accession, items from company_events where accession in ${tx(events.map((e) => e.accession))}`;
        const had = new Map(existing.map((r) => [r.accession, r.items]));
        for (const e of events) {
          const prev = had.get(e.accession);
          if (!prev) { added++; newItems.push(e.items); }
          else if (prev.join(",") !== e.items.join(",")) changed++;
          await tx`
            insert into company_events (accession, cik, form, filed, report_date, accepted_at, items, primary_document, source_url)
            values (${e.accession}, ${cik}, ${e.form}, ${e.filed}, ${e.reportDate}, ${e.acceptedAt}, ${e.items}, ${e.primaryDocument}, ${e.sourceUrl})
            on conflict (accession) do update set items = excluded.items
              where company_events.items is distinct from excluded.items`;
        }
      }
      await tx`
        insert into company_events_checked (cik, checked_at, status, events, newest_filed)
        values (${cik}, now(), ${status}, ${events.length}, ${newest})
        on conflict (cik) do update
          set checked_at = excluded.checked_at, status = excluded.status, events = excluded.events, newest_filed = excluded.newest_filed`;
      return { added, changed, newItems };
    });
    c.events_new! += counts.added;
    c.events_updated! += counts.changed;
    ctx.rowsChanged += counts.added + counts.changed;
    for (const list of counts.newItems) for (const it of list) itemCounts[it] = (itemCounts[it] ?? 0) + 1;
    if (status === "not_found") c.not_found!++;
    else if (events.length > 0) c.companies_with_events!++;
    done++;
    if (c.asked! % 100 === 0) console.log(`${SOURCE}: ${done} of ${queue.length} done, ${c.events_new} new events`);
  }
  c.remaining = queue.length - done;
  sync();

  const [tot] = await sql<{ companies: number; events: number }[]>`
    select (select count(*) from company_events_checked)::int as companies,
           (select count(*) from company_events)::int as events`;
  ctx.extra["table_companies_checked"] = tot?.companies ?? 0;
  ctx.extra["table_events"] = tot?.events ?? 0;
  console.log(`${SOURCE}: asked ${c.asked} of ${queue.length}; ${c.events_new} new events, ${c.events_updated} updated, ${c.companies_with_events} companies with events, ${c.not_found} unknown to the SEC, ${c.odd_answers} odd, ${c.failures} failed, ${c.remaining} left; table holds ${tot?.events ?? 0} events for ${tot?.companies ?? 0} companies`);

  if (!fatal && !shapeProven && c.odd_answers! > 0) {
    fatal = `none of the ${c.odd_answers} answers had the submissions layout: the data is not in the shape this job expects; nothing was written`;
  }
  if (fatal || outage.tripped) {
    const error = fatal ?? `${outage.count} requests in a row failed (last: ${lastFailure.slice(0, 160)})`;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() };
  }
  const status = stoppedOnBudget || c.failures! > 0 ? "partial" : "success";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}
