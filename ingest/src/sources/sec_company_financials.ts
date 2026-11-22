// Source: SEC XBRL "companyfacts" (data.sec.gov) — a fixed set of financial-statement figures for
// every TRACKED company. Keyless. Stored only (tables company_financials and
// company_financials_checked, migration 0032); no page reads them yet.
//
//   <base>/api/xbrl/companyfacts/CIK<10 digits>.json
//
// One request per company; the answer can be several MB. The reading rules (which concepts, tags,
// forms, floor, and which filing wins when a period is repeated) are in lib/companyfacts.ts and
// shared/src/fundamentals.ts.
//
// WHICH COMPANIES. Tracked companies with a CIK: those never asked first, then at most
// SEC_FIN_REFRESH (default 150) of the ones last asked more than SEC_FIN_REFRESH_DAYS (default 7)
// days ago, oldest first, so every company is refreshed about weekly. There is no index walk: a
// filing is picked up at the next refresh.
//
// WRITING. Per company, in one transaction: the company's rows are deleted, the new rows inserted
// in batches and the checked row upserted. HTTP 404 → status not_found, rows deleted. An answer
// with the expected layout but no usable figure → status no_facts, rows deleted. A request that
// fails writes nothing and leaves the company in the queue for the next run.
//
// STOPPING. SEC_FIN_MAX_MINUTES (default 40) ends the run as "partial" with `remaining`. Five
// request failures in a row (SEC_FIN_MAX_CONSECUTIVE_FAILURES) end it as "failed". SHAPE GUARD:
// nothing is written or marked until one answer has the expected layout (hasShape); answers
// without it are not marked; SEC_FIN_SHAPE_CHECK_AFTER (default 20) of them with no answer yet
// having the layout end the run "failed" with nothing written. After the layout is proven, an
// answer without it is counted `odd_answers` and the company is not marked.
//
// Env: SEC_DATA_BASE (tests only: a local fake), SEC_FIN_MAX_MINUTES, SEC_FIN_REFRESH,
// SEC_FIN_REFRESH_DAYS, SEC_FIN_MAX_CONSECUTIVE_FAILURES, SEC_FIN_SHAPE_CHECK_AFTER,
// SEC_FIN_RETRIES (tests only), SEC_FIN_MIN_GAP_MS (tests only).

import { fetchJson } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import { pickFacts, type FinRow } from "../lib/companyfacts.js";
import { FIN_CONCEPTS, type IngestRunResult } from "@stm/shared";
import { sec, outageCounter } from "./sec_form4.js";
import { tenDigitCik } from "./sec_company_sic.js";

const SOURCE = "sec_company_financials";
const DATA_BASE = (process.env.SEC_DATA_BASE ?? "https://data.sec.gov").replace(/\/$/, "");
const BATCH = 500;

export function companyFactsUrl(base: string, cik: string): string {
  return `${base}/api/xbrl/companyfacts/CIK${cik}.json`;
}

export interface RowSummary {
  concepts: string[];
  nonUsd: boolean;
  ifrs: boolean;
  newestFiled: string | null;
}

/** What a company's rows say, for the run stats and the checked row. */
export function summarizeRows(rows: FinRow[]): RowSummary {
  const concepts = new Set<string>();
  let nonUsd = false;
  let ifrs = false;
  let newest: string | null = null;
  for (const r of rows) {
    concepts.add(r.concept);
    if (!r.unit.startsWith("USD")) nonUsd = true;
    if (r.tag.startsWith("ifrs-full:")) ifrs = true;
    if (!newest || r.filed > newest) newest = r.filed;
  }
  return { concepts: [...concepts], nonUsd, ifrs, newestFiled: newest };
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

export async function ingestSecCompanyFinancials(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();

  const budgetMin = envNumber("SEC_FIN_MAX_MINUTES", 40);
  const budgetMs = budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const refreshDays = Math.max(1, envNumber("SEC_FIN_REFRESH_DAYS", 7));
  const refreshPerRun = Math.max(0, Math.floor(envNumber("SEC_FIN_REFRESH", 150)));
  const outage = outageCounter(envNumber("SEC_FIN_MAX_CONSECUTIVE_FAILURES", 5));
  const shapeCheckAfter = Math.max(1, Math.floor(envNumber("SEC_FIN_SHAPE_CHECK_AFTER", 20)));
  const retriesEnv = process.env.SEC_FIN_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;
  const gapEnv = process.env.SEC_FIN_MIN_GAP_MS;
  const reqOpts = () => ({
    ...sec(),
    ...(gapEnv != null && gapEnv !== "" && Number.isFinite(Number(gapEnv)) ? { minGapMs: Number(gapEnv) } : {}),
    ...(retries != null ? { retries } : {}),
  });

  const fresh = await sql<{ cik: string }[]>`
    select c.cik
      from companies c left join company_financials_checked f on f.cik = lpad(c.cik, 10, '0')
     where c.tracked and c.cik is not null and f.cik is null
     order by c.id`;
  const stale = refreshPerRun > 0 ? await sql<{ cik: string }[]>`
    select c.cik
      from companies c join company_financials_checked f on f.cik = lpad(c.cik, 10, '0')
     where c.tracked and c.cik is not null and f.checked_at < now() - make_interval(days => ${refreshDays})
     order by f.checked_at, c.id
     limit ${refreshPerRun}` : [];

  const c: Record<string, number> = {
    to_check: fresh.length + stale.length, asked: 0, stored_companies: 0, rows_written: 0, not_found: 0,
    no_facts: 0, odd_answers: 0, failures: 0, remaining: 0, non_usd_companies: 0, ifrs_companies: 0,
  };
  for (const k of FIN_CONCEPTS) c[`with_${k.key}`] = 0;
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  let shapeProven = false;
  let oddBeforeProof = 0;
  const sync = () => {
    Object.assign(ctx.extra, c);
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

    let rows: FinRow[] = [];
    let status: "ok" | "not_found" | "no_facts";
    try {
      c.asked!++;
      let answer: unknown = await fetchJson<unknown>(companyFactsUrl(DATA_BASE, cik), reqOpts());
      outage.ok();
      const picked = pickFacts(answer);
      answer = null; // the answer can be several MB; keep only the rows
      if (!picked.hasShape) {
        c.odd_answers!++;
        if (!shapeProven) {
          oddBeforeProof++;
          if (oddBeforeProof >= shapeCheckAfter) {
            fatal = `the first ${oddBeforeProof} answers did not have the companyfacts layout: the data is not in the shape this job expects; nothing was written`;
            break;
          }
        }
        continue; // not marked: asked again next run
      }
      shapeProven = true;
      rows = picked.rows;
      status = rows.length > 0 ? "ok" : "no_facts";
    } catch (err) {
      if (isNotFound(err)) {
        outage.ok();
        status = "not_found";
      } else {
        outage.fail();
        c.failures!++;
        lastFailure = err instanceof Error ? err.message : String(err);
        continue; // nothing written; stays in the queue for the next run
      }
    }

    const summary = summarizeRows(rows);
    await sql.begin(async (tx) => {
      await tx`delete from company_financials where cik = ${cik}`;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH).map((r) => ({
          cik, concept: r.concept, tag: r.tag, unit: r.unit, period_start: r.periodStart, period_end: r.periodEnd,
          value: r.value, form: r.form, fy: r.fy, fp: r.fp, filed: r.filed, accession: r.accession,
        }));
        await tx`insert into company_financials ${tx(chunk, "cik", "concept", "tag", "unit", "period_start", "period_end", "value", "form", "fy", "fp", "filed", "accession")}`;
      }
      await tx`
        insert into company_financials_checked (cik, checked_at, status, rows, newest_filed)
        values (${cik}, now(), ${status}, ${rows.length}, ${summary.newestFiled})
        on conflict (cik) do update
          set checked_at = excluded.checked_at, status = excluded.status, rows = excluded.rows, newest_filed = excluded.newest_filed`;
    });
    ctx.rowsChanged += rows.length;
    c.rows_written! += rows.length;
    if (status === "not_found") c.not_found!++;
    else if (status === "no_facts") c.no_facts!++;
    else {
      c.stored_companies!++;
      for (const k of summary.concepts) c[`with_${k}`]!++;
      if (summary.nonUsd) c.non_usd_companies!++;
      if (summary.ifrs) c.ifrs_companies!++;
    }
    done++;
    if (c.asked! % 100 === 0) console.log(`${SOURCE}: ${done} of ${queue.length} done, ${c.rows_written} rows written`);
  }
  c.remaining = queue.length - done;
  sync();

  const [tot] = await sql<{ companies: number; rows: number }[]>`
    select (select count(*) from company_financials_checked)::int as companies,
           (select count(*) from company_financials)::int as rows`;
  ctx.extra["table_companies_checked"] = tot?.companies ?? 0;
  ctx.extra["table_rows"] = tot?.rows ?? 0;
  console.log(`${SOURCE}: asked ${c.asked} of ${queue.length}; ${c.stored_companies} with figures (${c.rows_written} rows), ${c.no_facts} without, ${c.not_found} unknown to the SEC, ${c.odd_answers} odd, ${c.failures} failed, ${c.remaining} left; table holds ${tot?.rows ?? 0} rows for ${tot?.companies ?? 0} companies`);

  if (fatal || outage.tripped) {
    const error = fatal ?? `${outage.count} requests in a row failed (last: ${lastFailure.slice(0, 160)})`;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() };
  }
  const status = stoppedOnBudget || c.failures! > 0 ? "partial" : "success";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}
