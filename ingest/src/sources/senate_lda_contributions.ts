// Source: Senate lobbying disclosure API, LD-203 contribution reports (lda.gov, keyless or with
// LDA_API_KEY). Stored only (tables lobby_contribution_filings and lobby_contribution_items,
// migration 0033); no page reads them yet.
//
//   <base>/contributions/?ordering=-dt_posted&page_size=N&filing_dt_posted_after=<floor>[&filing_dt_posted_before=<cursor>]&page=K
//
// Reading layout and the rules for one filing are in lib/lobbycontrib.ts. Names (filer, honoree,
// payee) are stored as filed; nothing is matched to members of Congress or committees.
//
// WHICH FILINGS. filing_year >= LDA_CONTRIB_SINCE_YEAR (default 2025), newest posted first.
//   Pass 1 walks from the newest filing and stops at the first page whose filings are ALL already
//   stored (nothing newer is missing). Pass 2 runs only when the previous run did not finish the
//   catch-up: it continues OLDER than the saved cursor (stats.cursor, the oldest posting time
//   reached, as a `filing_dt_posted_before` value) until the floor is reached. Overlap is harmless:
//   a filing is replaced whole (filing row upserted, its items deleted and inserted) in one
//   transaction. An amendment is a new filing_uuid and is not linked to what it amends.
//
// STOPPING. LDA_CONTRIB_MAX_MINUTES (default 40) ends the run "partial" with the cursor saved.
//   LDA_CONTRIB_MAX_CONSECUTIVE_FAILURES (default 5) failed requests in a row end it "failed".
//   SHAPE GUARD: nothing is written until a page has the layout (count + results) and, when it has
//   results, at least one of them looks like a contribution filing; otherwise "failed".
//
// PACING. Same as senate_lda: keyless sleeps LDA_KEYLESS_SLEEP_MS (2500 ms) after each page
//   (15 a minute), keyed uses the 750 ms gap of ldaFetchOptions (120 a minute).
//
// Env: LDA_API_BASE (tests only), LDA_API_KEY, LDA_CONTRIB_SINCE_YEAR, LDA_CONTRIB_MAX_MINUTES,
// LDA_CONTRIB_PAGE_SIZE (25), LDA_CONTRIB_MAX_PAGES (tests), LDA_CONTRIB_MAX_CONSECUTIVE_FAILURES,
// LDA_CONTRIB_NOW (tests: today as YYYY-MM-DD), LDA_CONTRIB_RETRIES (tests), LDA_KEYLESS_SLEEP_MS, LDA_KEYED_GAP_MS.

import { fetchJson } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import { beforeCursor, hasPageShape, looksLikeFiling, parseContribFiling } from "../lib/lobbycontrib.js";
import { baseUrl, ldaFetchOptions } from "./senate_lda.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "senate_lda_contributions";
const ITEM_BATCH = 500;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function contribUrl(opts: { after: string; before?: string | null; page: number; pageSize: number }): string {
  const u = new URL(`${baseUrl()}/contributions/`);
  u.searchParams.set("filing_dt_posted_after", opts.after);
  if (opts.before) u.searchParams.set("filing_dt_posted_before", opts.before);
  u.searchParams.set("ordering", "-dt_posted");
  u.searchParams.set("page_size", String(opts.pageSize));
  u.searchParams.set("page", String(opts.page));
  return u.toString();
}

function failCounter(limit: number) {
  let n = 0;
  return {
    fail() { n++; },
    ok() { n = 0; },
    get tripped() { return limit > 0 && n >= limit; },
    get count() { return n; },
  };
}

export async function ingestSenateLdaContributions(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();
  const budgetMin = envNumber("LDA_CONTRIB_MAX_MINUTES", 40);
  const overBudget = () => budgetMin > 0 && Date.now() - startedAt > budgetMin * 60_000;
  const sinceYear = Math.floor(envNumber("LDA_CONTRIB_SINCE_YEAR", 2025));
  const pageSize = Math.max(1, Math.floor(envNumber("LDA_CONTRIB_PAGE_SIZE", 25)));
  const maxPages = envNumber("LDA_CONTRIB_MAX_PAGES", 0);
  const outage = failCounter(envNumber("LDA_CONTRIB_MAX_CONSECUTIVE_FAILURES", 5));
  const today = process.env.LDA_CONTRIB_NOW ?? new Date().toISOString().slice(0, 10);
  const apiKey = process.env.LDA_API_KEY;
  const keyless = !apiKey;
  const retriesEnv = process.env.LDA_CONTRIB_RETRIES; // tests only
  const opts = { ...ldaFetchOptions(apiKey), ...(retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? { retries: Number(retriesEnv) } : {}) };
  const keylessSleep = envNumber("LDA_KEYLESS_SLEEP_MS", 2500);
  const floor = `${sinceYear}-01-01`;

  const [prev] = await sql<{ cursor: string | null; complete: string | null }[]>`
    select r.stats->>'cursor' as cursor, r.stats->>'catch_up_complete' as complete
      from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.status <> 'running' and r.stats ? 'catch_up_complete'
     order by r.id desc limit 1`;
  const prevIncomplete = prev?.complete === "false" && !!prev.cursor;
  const [held] = await sql<{ n: number }[]>`select count(*)::int as n from (select 1 from lobby_contribution_filings limit 1) x`;
  let shapeProven = (held?.n ?? 0) > 0;

  const c: Record<string, number> = {
    pages: 0, filings_seen: 0, filings_stored: 0, items_stored: 0, no_contribution_filings: 0,
    filer_lobbyist: 0, filer_organization: 0, filer_other: 0, skipped_before_since_year: 0,
    unparseable_filings: 0, null_amounts: 0, null_dates: 0, failures: 0,
  };
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  let minPosted: string | null = null; // oldest posting time reached in this run's walks
  let walkedToEnd = false; // the last walk reached the end of the list
  let maxedOut = false;

  async function storeFiling(p: NonNullable<ReturnType<typeof parseContribFiling>>): Promise<void> {
    const f = p.filing;
    await sql.begin(async (tx) => {
      await tx`
        insert into lobby_contribution_filings
          (filing_uuid, filing_type, filing_year, filing_period, filer_type, registrant_id, registrant_name,
           lobbyist_name, no_contributions, pacs, posted_at, source_url, item_count)
        values (${f.filing_uuid}, ${f.filing_type}, ${f.filing_year}, ${f.filing_period}, ${f.filer_type},
                ${f.registrant_id}, ${f.registrant_name}, ${f.lobbyist_name}, ${f.no_contributions},
                ${f.pacs}, ${f.posted_at}, ${f.source_url}, ${f.item_count})
        on conflict (filing_uuid) do update set
          filing_type = excluded.filing_type, filing_year = excluded.filing_year, filing_period = excluded.filing_period,
          filer_type = excluded.filer_type, registrant_id = excluded.registrant_id, registrant_name = excluded.registrant_name,
          lobbyist_name = excluded.lobbyist_name, no_contributions = excluded.no_contributions, pacs = excluded.pacs,
          posted_at = excluded.posted_at, source_url = excluded.source_url, item_count = excluded.item_count`;
      await tx`delete from lobby_contribution_items where filing_uuid = ${f.filing_uuid}`;
      for (let i = 0; i < p.items.length; i += ITEM_BATCH) {
        const chunk = p.items.slice(i, i + ITEM_BATCH).map((it) => ({ filing_uuid: f.filing_uuid, ...it }));
        await tx`insert into lobby_contribution_items ${tx(chunk, "filing_uuid", "seq", "contribution_type", "contributor_name", "payee_name", "honoree_name", "amount", "contributed_at")}`;
      }
    });
  }

  /** Walk one list; `stopOnKnown` ends it at the first page whose filings are all stored. */
  async function walk(before: string | null, stopOnKnown: boolean): Promise<"end" | "known" | "budget" | "failed" | "cap"> {
    for (let page = 1; ; page++) {
      if (outage.tripped) return "failed";
      if (overBudget()) { stoppedOnBudget = true; return "budget"; }
      if (maxPages > 0 && c.pages! >= maxPages) { maxedOut = true; return "cap"; }
      let data: unknown;
      try {
        try {
          data = await fetchJson<unknown>(contribUrl({ after: floor, before, page, pageSize }), opts);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (apiKey && msg.includes("401")) {
            ctx.warn("401 with LDA_API_KEY set; retrying without the auth header");
            data = await fetchJson<unknown>(contribUrl({ after: floor, before, page, pageSize }));
          } else throw err;
        }
        outage.ok();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A page past the end of the list answers 404 in this pager; that is the end, not a failure.
        if (/HTTP 404\b/.test(msg) && page > 1) { outage.ok(); return "end"; }
        outage.fail();
        c.failures!++;
        lastFailure = msg;
        page--; // ask for the same page again; LDA_CONTRIB_MAX_CONSECUTIVE_FAILURES in a row end the run
        continue;
      }
      if (!hasPageShape(data)) {
        if (!shapeProven) { fatal = "the first answer did not have the contributions layout (count and results): the data is not in the shape this job expects; nothing was written"; return "failed"; }
        c.failures!++;
        lastFailure = "answer without the page layout";
        outage.fail();
        return "failed";
      }
      c.pages!++;
      const results = data.results;
      if (!shapeProven) {
        if (results.length > 0 && !results.some(looksLikeFiling)) {
          fatal = "no result on the first page looks like a contribution filing: the data is not in the shape this job expects; nothing was written";
          return "failed";
        }
        if (results.some(looksLikeFiling)) shapeProven = true;
      }
      const parsed = [];
      for (const raw of results) {
        const p = parseContribFiling(raw, today);
        if (!p) { c.unparseable_filings!++; continue; }
        if (!ctx.markSeen(p.filing.filing_uuid)) continue;
        parsed.push(p);
      }
      c.filings_seen! += parsed.length;
      ctx.rowsSeen += parsed.length;
      const known = new Set(
        parsed.length
          ? (await sql<{ filing_uuid: string }[]>`select filing_uuid from lobby_contribution_filings where filing_uuid = any(${parsed.map((p) => p.filing.filing_uuid)})`).map((r) => r.filing_uuid)
          : [],
      );
      for (const p of parsed) {
        const posted = p.filing.posted_at;
        if (posted && (!minPosted || posted.slice(0, 19) < minPosted.slice(0, 19))) minPosted = posted;
        if (p.filing.filing_year != null && p.filing.filing_year < sinceYear) { c.skipped_before_since_year!++; continue; }
        if (known.has(p.filing.filing_uuid)) continue;
        try {
          await storeFiling(p);
        } catch (err) {
          ctx.quarantine(p.filing.filing_uuid, `write failed: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        c.filings_stored!++;
        c.items_stored! += p.items.length;
        c.null_amounts! += p.badAmounts;
        c.null_dates! += p.badDates;
        if (p.filing.no_contributions) c.no_contribution_filings!++;
        const ft = p.filing.filer_type;
        if (ft === "lobbyist") c.filer_lobbyist!++;
        else if (ft === "organization") c.filer_organization!++;
        else c.filer_other!++;
        ctx.rowsChanged++;
      }
      if (stopOnKnown && parsed.length > 0 && parsed.every((p) => known.has(p.filing.filing_uuid) || (p.filing.filing_year != null && p.filing.filing_year < sinceYear))) return "known";
      if (c.pages! % 20 === 0) console.log(`${SOURCE}: ${c.pages} pages, ${c.filings_stored} filings stored, ${c.items_stored} items`);
      if (!data.next || results.length === 0) return "end";
      if (keyless) await sleep(keylessSleep);
    }
  }

  // Pass 1: newest first, until what is stored begins.
  const r1 = await walk(null, true);
  let catchUpComplete = false;
  let cursor: string | null = minPosted ? beforeCursor(minPosted) : prev?.cursor ?? null;
  if (r1 === "end") {
    catchUpComplete = true;
  } else if (r1 === "known") {
    if (!prevIncomplete) catchUpComplete = true;
    else {
      // Pass 2: continue older than where the earlier run stopped.
      const before = prev!.cursor!;
      minPosted = null;
      const r2 = await walk(before, false);
      if (r2 === "end") catchUpComplete = true;
      cursor = minPosted ? beforeCursor(minPosted) : before;
    }
  } else if (r1 === "budget" || r1 === "cap") {
    // Pass 1 itself is unfinished. If an earlier catch-up was also unfinished, keep its older cursor.
    cursor = prevIncomplete && prev!.cursor && (!cursor || prev!.cursor < cursor) ? prev!.cursor : cursor;
  }
  if (!catchUpComplete && r1 === "failed" && prevIncomplete) cursor = prev!.cursor;

  Object.assign(ctx.extra, c);
  ctx.extra["catch_up_complete"] = catchUpComplete;
  ctx.extra["cursor"] = cursor ?? "";
  ctx.extra["since_year"] = sinceYear;
  ctx.extra["page_size"] = pageSize;
  ctx.extra["stopped_on_budget"] = stoppedOnBudget;
  ctx.extra["stopped_on_page_cap"] = maxedOut;
  ctx.extra["keyed"] = !keyless;
  ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
  const [tot] = await sql<{ filings: number; items: number }[]>`
    select (select count(*) from lobby_contribution_filings)::int as filings, (select count(*) from lobby_contribution_items)::int as items`;
  ctx.extra["table_filings"] = tot?.filings ?? 0;
  ctx.extra["table_items"] = tot?.items ?? 0;
  console.log(`${SOURCE}: ${c.pages} pages; ${c.filings_stored} filings stored (${c.items_stored} items, ${c.no_contribution_filings} with none); complete=${catchUpComplete}; table holds ${tot?.filings ?? 0} filings, ${tot?.items ?? 0} items`);

  if (fatal || outage.tripped) {
    const error = fatal ?? `${outage.count} requests in a row failed (last: ${lastFailure.slice(0, 160)})`;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() };
  }
  const status = catchUpComplete && c.failures === 0 ? "success" : "partial";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}
