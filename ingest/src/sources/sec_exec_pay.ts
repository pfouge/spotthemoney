// Source: SEC XBRL "frames" of the `ecd` taxonomy (Executive Compensation Disclosure, the Pay Versus
// Performance table of a proxy statement). Keyless. Stored only (table exec_pay, migration 0039);
// no page reads it yet.
//
//   <base>/api/xbrl/frames/ecd/<Tag>/USD/CY<year>.json
//
// One request returns one fact for every filer, so about 4 measures x (years since
// EXEC_PAY_FIRST_YEAR) requests cover everything. Measures and tags: shared/src/execpay.ts.
// Facts of companies that are in `companies` (tracked or not) are stored, upserted by
// (cik, measure, fiscal_year_end): a later run replaces value and accession. Values are stored as
// filed (a negative "actually paid" figure is real).
//
// NOT STORED: the executive's NAME (`ecd:PeoName`). A company with two principal executives in one
// year reports one fact per person, told apart by a dimension; the frames API serves one
// undimensioned fact per filer and not dimensioned ones, so there is nothing to read. (This is
// inferred from how frames work; it was not tested against a live answer for PeoName.)
//
// WHEN IT RUNS. The source is `daily`, but does real work only when the last COMPLETE run (status
// success with `frames_asked` in its stats) is more than EXEC_PAY_REFRESH_DAYS (default 7) days
// old. Otherwise it records `stats.skipped` and ends as success. A skipped, partial or failed run
// is never "complete", so the gate reopens the next day.
//
// STOPPING. EXEC_PAY_MAX_MINUTES (default 20) ends the run as "partial" with `frames_left`. Five
// non-404 request failures in a row (EXEC_PAY_MAX_CONSECUTIVE_FAILURES) end it as "failed". A 404
// is a year not yet reported: counted `frames_404`, not a failure. SHAPE GUARD: a 200 answer must
// have a `data` array of objects with cik, end, val and accn. If the first EXEC_PAY_SHAPE_CHECK_AFTER
// (default 3) non-empty answers all lack it, the run ends "failed" with nothing written; after one
// answer has it, a later answer without it is counted `odd_answers` and held.
//
// Env: SEC_DATA_BASE (tests only: a local fake), EXEC_PAY_FIRST_YEAR, EXEC_PAY_REFRESH_DAYS,
// EXEC_PAY_MAX_MINUTES, EXEC_PAY_MAX_CONSECUTIVE_FAILURES, EXEC_PAY_SHAPE_CHECK_AFTER,
// EXEC_PAY_NOW (tests only: a clock, YYYY-MM-DD), EXEC_PAY_RETRIES / EXEC_PAY_MIN_GAP_MS (tests only).

import { fetchJson } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import { readFrame, type ExecPayFact } from "../lib/execpay.js";
import { EXEC_PAY_MEASURES, EXEC_PAY_TAXONOMY, EXEC_PAY_UNIT, type IngestRunResult } from "@stm/shared";
import { sec, outageCounter } from "./sec_form4.js";

const SOURCE = "sec_exec_pay";
const DATA_BASE = (process.env.SEC_DATA_BASE ?? "https://data.sec.gov").replace(/\/$/, "");
const BATCH = 500;

export function framesUrl(base: string, tag: string, year: number): string {
  return `${base}/api/xbrl/frames/${EXEC_PAY_TAXONOMY}/${tag}/${EXEC_PAY_UNIT}/CY${year}.json`;
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

export async function ingestSecExecPay(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();

  const nowRaw = process.env.EXEC_PAY_NOW;
  const now = nowRaw && /^\d{4}-\d{2}-\d{2}$/.test(nowRaw) ? new Date(`${nowRaw}T12:00:00Z`) : new Date();
  const lastYear = now.getUTCFullYear();
  const firstYear = Math.min(lastYear, Math.floor(envNumber("EXEC_PAY_FIRST_YEAR", 2022)));
  const refreshDays = Math.max(1, envNumber("EXEC_PAY_REFRESH_DAYS", 7));
  const budgetMin = envNumber("EXEC_PAY_MAX_MINUTES", 20);
  const budgetMs = budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const outage = outageCounter(envNumber("EXEC_PAY_MAX_CONSECUTIVE_FAILURES", 5));
  const shapeCheckAfter = Math.max(1, Math.floor(envNumber("EXEC_PAY_SHAPE_CHECK_AFTER", 3)));
  const retriesEnv = process.env.EXEC_PAY_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;
  const gapEnv = process.env.EXEC_PAY_MIN_GAP_MS;
  const reqOpts = () => ({
    ...sec(),
    ...(gapEnv != null && gapEnv !== "" && Number.isFinite(Number(gapEnv)) ? { minGapMs: Number(gapEnv) } : {}),
    ...(retries != null ? { retries } : {}),
  });

  // The refresh gate: the newest COMPLETE run. Only a full pass records `frames_asked`.
  const [last] = await sql<{ age_days: number | null }[]>`
    select extract(epoch from (now() - max(r.finished_at))) / 86400 as age_days
      from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.status = 'success' and r.stats ? 'frames_asked'`;
  const ageDays = last?.age_days == null ? null : Number(last.age_days);
  if (ageDays != null && ageDays <= refreshDays) {
    ctx.extra["skipped"] = `last complete run was ${Math.round(ageDays * 10) / 10} days ago; refresh every ${refreshDays} days`;
    console.log(`${SOURCE}: skipped (${ctx.extra["skipped"]})`);
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }

  const known = new Set((await sql<{ cik: string }[]>`
    select distinct lpad(cik, 10, '0') as cik from companies where cik is not null`).map((r) => r.cik));

  const c: Record<string, number> = {
    frames_asked: 0, frames_found: 0, frames_404: 0, facts_seen: 0, facts_for_known_companies: 0,
    rows_written: 0, companies: 0, failures: 0, odd_answers: 0, frames_left: 0,
  };
  for (const m of EXEC_PAY_MEASURES) c[`rows_${m.key}`] = 0;
  const pending = new Map<string, ExecPayFact & { measure: string; tag: string; frame: string }>();
  const companiesSeen = new Set<string>();
  let newest: string | null = null;
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  let shapeProven = false;
  let oddBeforeProof = 0;

  const flush = async () => {
    const rows = [...pending.values()];
    pending.clear();
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => ({
        cik: r.cik, measure: r.measure, tag: r.tag, fiscal_year_end: r.fiscalYearEnd, period_start: r.periodStart,
        value: r.value, accession: r.accession, frame: r.frame,
      }));
      await sql`
        insert into exec_pay ${sql(chunk, "cik", "measure", "tag", "fiscal_year_end", "period_start", "value", "accession", "frame")}
        on conflict (cik, measure, fiscal_year_end) do update
          set tag = excluded.tag, period_start = excluded.period_start, value = excluded.value,
              accession = excluded.accession, frame = excluded.frame, updated_at = now()`;
    }
    ctx.rowsChanged += rows.length;
    c.rows_written! += rows.length;
  };

  const jobs: { measure: string; tag: string; year: number }[] = [];
  for (let y = firstYear; y <= lastYear; y++) for (const m of EXEC_PAY_MEASURES) jobs.push({ measure: m.key, tag: m.tag, year: y });

  let done = 0;
  for (const job of jobs) {
    if (outage.tripped) break;
    if (overBudget()) { stoppedOnBudget = true; break; }
    const frame = `CY${job.year}`;
    ctx.rowsSeen++;
    let answer: unknown;
    try {
      c.frames_asked!++;
      answer = await fetchJson<unknown>(framesUrl(DATA_BASE, job.tag, job.year), reqOpts());
      outage.ok();
    } catch (err) {
      if (isNotFound(err)) {
        outage.ok();
        c.frames_404!++;
        done++;
        continue;
      }
      outage.fail();
      c.failures!++;
      lastFailure = err instanceof Error ? err.message : String(err);
      done++;
      continue;
    }
    done++;
    const read = readFrame(answer);
    answer = null;
    if (read.isArray && read.seen === 0) { c.frames_found!++; continue; } // empty: neutral, proves nothing
    if (!read.hasShape) {
      c.odd_answers!++;
      if (!shapeProven) {
        oddBeforeProof++;
        if (oddBeforeProof >= shapeCheckAfter) {
          fatal = `the first ${oddBeforeProof} answers did not have the frames layout (data array with cik, end, val, accn): the data is not in the shape this job expects; nothing was written`;
          break;
        }
      }
      continue;
    }
    shapeProven = true;
    c.frames_found!++;
    c.facts_seen! += read.seen;
    for (const f of read.facts) {
      if (!known.has(f.cik)) continue;
      c.facts_for_known_companies!++;
      pending.set(`${f.cik}|${job.measure}|${f.fiscalYearEnd}`, { ...f, measure: job.measure, tag: job.tag, frame });
      companiesSeen.add(f.cik);
      c[`rows_${job.measure}`]!++;
      if (!newest || f.fiscalYearEnd > newest) newest = f.fiscalYearEnd;
    }
    await flush();
  }
  c.frames_left = jobs.length - done;
  c.companies = companiesSeen.size;
  Object.assign(ctx.extra, c);
  ctx.extra["stopped_on_budget"] = stoppedOnBudget;
  ctx.extra["newest_fiscal_year_end"] = newest;
  ctx.extra["first_year"] = firstYear;
  ctx.extra["last_year"] = lastYear;
  ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;

  const [tot] = await sql<{ rows: number; companies: number }[]>`
    select count(*)::int as rows, count(distinct cik)::int as companies from exec_pay`;
  ctx.extra["table_rows"] = tot?.rows ?? 0;
  ctx.extra["table_companies"] = tot?.companies ?? 0;
  console.log(`${SOURCE}: asked ${c.frames_asked} frames (${c.frames_found} found, ${c.frames_404} not yet reported, ${c.odd_answers} odd, ${c.failures} failed); ${c.facts_seen} facts, ${c.facts_for_known_companies} for known companies, ${c.rows_written} rows written; table holds ${tot?.rows ?? 0} rows for ${tot?.companies ?? 0} companies`);

  if (!fatal && !shapeProven && c.odd_answers! > 0) {
    fatal = `none of the ${c.odd_answers} answers had the frames layout: the data is not in the shape this job expects; nothing was written`;
  }
  if (fatal || outage.tripped) {
    const error = fatal ?? `${outage.count} requests in a row failed (last: ${lastFailure.slice(0, 160)})`;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() };
  }
  const status = stoppedOnBudget || c.failures! > 0 || c.odd_answers! > 0 ? "partial" : "success";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}
