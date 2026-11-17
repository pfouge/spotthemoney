// Source: SEC submissions data (data.sec.gov) — each company's industry code. Keyless.
//
// WHY. The site had no industry for any company (`companies.sector` was never filled). The SEC
// assigns every filer a four-digit Standard Industrial Classification (SIC) code and a short
// description; both are in the filer's submissions file:
//   <base>/submissions/CIK<10 digits>.json   →  { "sic": "3674", "sicDescription": "Semiconductors & Related Devices", ... }
// One request per company. This job stores the two values as stated (table company_sic,
// migration 0021). The division a code falls in is a lookup done where it is shown
// (shared/src/sic.ts).
//
// WHICH COMPANIES. Every company with a CIK that has no row yet, companies the site tracks
// first, then at most SEC_SIC_REFRESH_PER_RUN (default 300) of the rows last checked more than
// SEC_SIC_REFRESH_DAYS (default 90) ago, oldest first, so the refresh is spread over many
// days. A company the SEC lists no code for (or does not know: HTTP 404) gets a row with
// sic NULL, so it is not asked again until its refresh comes round.
//
// STOPPING. SEC_SIC_MAX_MINUTES (default 40) ends the run as "partial" with `remaining`
// in the stats; the next run carries on. Five request failures in a row
// (SEC_SIC_MAX_CONSECUTIVE_FAILURES) end the run as "failed" with stats: the SEC is down.
// If the first SHAPE_CHECK_AFTER answers hold no `sic` key at all, the response is not what
// this job expects and it fails instead of filling the table with NULLs.
//
// Env: SEC_DATA_BASE (tests only: a local fake), SEC_SIC_MAX_MINUTES, SEC_SIC_REFRESH_DAYS,
// SEC_SIC_REFRESH_PER_RUN, SEC_SIC_MAX_CONSECUTIVE_FAILURES, SEC_SIC_RETRIES (tests only),
// SEC_SIC_MIN_GAP_MS (tests only), SEC_SIC_SHAPE_CHECK_AFTER (tests only).

import { fetchJson } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import { cleanSicCode, sicDivision, type IngestRunResult } from "@stm/shared";
import { sec, outageCounter } from "./sec_form4.js";

const SOURCE = "sec_company_sic";
const DATA_BASE = (process.env.SEC_DATA_BASE ?? "https://data.sec.gov").replace(/\/$/, "");
/** After this many answers, at least one must have carried a `sic` key. */
export const SHAPE_CHECK_AFTER = 50;

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (tested in sec_company_sic.test.ts)
// ──────────────────────────────────────────────────────────────────────────

export interface SicFact {
  /** Four digits, or null when the SEC lists none. */
  sic: string | null;
  /** The SEC's wording, white space tidied; null when there is no code or no wording. */
  description: string | null;
  /** False when the answer has no `sic` key at all (not the shape this job expects). */
  hasKey: boolean;
}

/** Read the industry code out of one submissions file. Never throws. */
export function parseSubmissionSic(json: unknown): SicFact {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { sic: null, description: null, hasKey: false };
  const o = json as Record<string, unknown>;
  const hasKey = Object.prototype.hasOwnProperty.call(o, "sic");
  const sic = cleanSicCode(o["sic"]);
  const raw = typeof o["sicDescription"] === "string" ? (o["sicDescription"] as string).replace(/\s+/g, " ").trim() : "";
  return { sic, description: sic && raw ? raw.slice(0, 200) : null, hasKey };
}

/** `320193` or `0000320193` → `0000320193`; null when it is not a CIK. */
export function tenDigitCik(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return /^\d{1,10}$/.test(s) ? s.padStart(10, "0") : null;
}

export function submissionsUrl(base: string, cik: string): string {
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

// ──────────────────────────────────────────────────────────────────────────
// The job
// ──────────────────────────────────────────────────────────────────────────

export async function ingestSecCompanySic(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();

  const budgetMin = envNumber("SEC_SIC_MAX_MINUTES", 40);
  const budgetMs = budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const refreshDays = Math.max(1, envNumber("SEC_SIC_REFRESH_DAYS", 90));
  const refreshPerRun = Math.max(0, Math.floor(envNumber("SEC_SIC_REFRESH_PER_RUN", 300)));
  const outage = outageCounter(envNumber("SEC_SIC_MAX_CONSECUTIVE_FAILURES", 5));
  const shapeCheckAfter = Math.max(1, Math.floor(envNumber("SEC_SIC_SHAPE_CHECK_AFTER", SHAPE_CHECK_AFTER)));
  const retriesEnv = process.env.SEC_SIC_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;
  const gapEnv = process.env.SEC_SIC_MIN_GAP_MS;
  const reqOpts = () => ({
    ...sec(),
    ...(gapEnv != null && gapEnv !== "" && Number.isFinite(Number(gapEnv)) ? { minGapMs: Number(gapEnv) } : {}),
    ...(retries != null ? { retries } : {}),
  });

  // Never asked: tracked companies first, then the rest, in a stable order.
  const fresh = await sql<{ cik: string; tracked: boolean }[]>`
    select c.cik, c.tracked
      from companies c left join company_sic s on s.cik = lpad(c.cik, 10, '0')
     where c.cik is not null and s.cik is null
     order by c.tracked desc, c.id`;
  // Asked long ago: a capped number a run, oldest first.
  const stale = refreshPerRun > 0 ? await sql<{ cik: string; tracked: boolean }[]>`
    select c.cik, c.tracked
      from companies c join company_sic s on s.cik = lpad(c.cik, 10, '0')
     where c.cik is not null and s.checked_at < now() - make_interval(days => ${refreshDays})
     order by s.checked_at, c.id
     limit ${refreshPerRun}` : [];

  const c = {
    to_check_new: fresh.length, to_check_refresh: stale.length, requests: 0, checked: 0,
    with_sic: 0, without_sic: 0, not_found: 0, no_division: 0, tracked_checked: 0, failures: 0, remaining: 0,
  };
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  let sawKey = false;
  let answers = 0;
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

    let fact: SicFact;
    let notFound = false;
    try {
      c.requests++;
      fact = parseSubmissionSic(await fetchJson<unknown>(submissionsUrl(DATA_BASE, cik), reqOpts()));
      outage.ok();
    } catch (err) {
      if (isNotFound(err)) {
        // The SEC has no submissions file under this CIK. Record that, so it is not asked daily.
        c.not_found++;
        notFound = true;
        fact = { sic: null, description: null, hasKey: true };
      } else {
        outage.fail();
        c.failures++;
        lastFailure = err instanceof Error ? err.message : String(err);
        continue; // no row written and still counted in `remaining`: asked again next run
      }
    }
    if (fact.hasKey && !notFound) sawKey = true; // a 404 says nothing about the shape
    if (!notFound) answers++;
    if (!sawKey && answers >= shapeCheckAfter) {
      fatal = `the first ${shapeCheckAfter} answers held no "sic" key: the submissions data is not in the shape this job expects`;
      break;
    }
    if (!fact.hasKey) { done++; c.checked++; continue; } // odd answer: leave the company for another run

    const res = await sql`
      insert into company_sic (cik, sic, sic_description, checked_at, updated_at)
      values (${cik}, ${fact.sic}, ${fact.description}, now(), now())
      on conflict (cik) do update
        set sic = excluded.sic, sic_description = excluded.sic_description, checked_at = now(),
            updated_at = case when company_sic.sic is distinct from excluded.sic
                                or company_sic.sic_description is distinct from excluded.sic_description
                              then now() else company_sic.updated_at end`;
    ctx.rowsChanged += res.count ?? 0;
    c.checked++;
    if (co.tracked) c.tracked_checked++;
    if (fact.sic) { c.with_sic++; if (!sicDivision(fact.sic)) c.no_division++; } else c.without_sic++;
    done++;
    if (c.checked % 500 === 0) console.log(`${SOURCE}: ${c.checked} of ${queue.length} checked, ${c.with_sic} with a code`);
  }
  c.remaining = queue.length - done;
  sync();

  const [tot] = await sql<{ rows: number; with_sic: number }[]>`
    select count(*)::int as rows, count(sic)::int as with_sic from company_sic`;
  ctx.extra["table_rows"] = tot?.rows ?? 0;
  ctx.extra["table_with_sic"] = tot?.with_sic ?? 0;
  console.log(`${SOURCE}: checked ${c.checked} of ${queue.length} (${c.with_sic} with a code, ${c.without_sic} without, ${c.not_found} unknown to the SEC, ${c.failures} failed, ${c.remaining} left); table holds ${tot?.rows ?? 0} rows, ${tot?.with_sic ?? 0} with a code`);

  if (fatal || outage.tripped) {
    const error = fatal ?? `${outage.count} requests in a row failed (last: ${lastFailure.slice(0, 160)})`;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() };
  }
  const status = stoppedOnBudget || c.failures > 0 ? "partial" : "success";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}
