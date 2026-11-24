// Source: executive pay read from each tracked company's own proxy statement. Keyless.
// Stored only (tables exec_pay_proxy and exec_pay_proxy_checked, migration 0042); no page reads
// them yet. exec_pay (the frames source, sec_exec_pay) is not touched.
//
// WHY. The frames API serves only facts with no dimension, and many companies tag their principal
// executive's pay with the person it belongs to, so frames had a figure for about 4 in 10 companies
// with a page (256 of 998 for the principal executive, 2026-11-24). The company's own filing has all of them.
//
// PER COMPANY, up to three kinds of request:
//   1. <data base>/submissions/CIK<10 digits>.json      → the newest DEF 14A filings (lib/proxypay.ts)
//   2. <edgar base>/Archives/edgar/data/<cik>/<accession>/index.json → the file named *_htm.xml
//   3. that file, the extracted XBRL instance             → the four ecd pay tags
// Up to PROXY_CANDIDATES proxy statements are tried, newest first, until one yields a figure (a
// proxy for a special meeting has no pay table). A company whose newest proxy statement is the one
// already read is not fetched again (one request).
//
// WHICH COMPANIES. Tracked companies with a CIK: never asked first, then at most
// SEC_PROXY_REFRESH_PER_RUN (default 150) of those last asked more than SEC_PROXY_REFRESH_DAYS
// (default 30) days ago, oldest first. A proxy statement comes once a year.
//
// WRITING. Per company, in one transaction: for every fiscal year the filing states, the stored
// rows of that company and year are replaced; years only an older filing stated are kept. The
// checked row records status ok, no_proxy, no_instance, no_facts or not_found.
//
// STOPPING. SEC_PROXY_MAX_MINUTES (default 40) ends the run "partial" with `remaining`. Five
// request failures in a row end it "failed". SHAPE GUARD: nothing is written and no company is
// marked until one instance has yielded a figure (in this run, or in an earlier one: a row in
// exec_pay_proxy). Until then answers are held in memory; SEC_PROXY_SHAPE_CHECK_AFTER (default
// 25) companies that had a proxy statement and yielded nothing end the run "failed" with nothing
// written. A 404 for a folder or an instance is not an outage: the next candidate is tried.
//
// NEVER STORED OR LOGGED: the person a figure belongs to (no member name, no PeoName).
//
// Env: SEC_DATA_BASE, SEC_EDGAR_BASE (tests only), SEC_PROXY_MAX_MINUTES, SEC_PROXY_REFRESH_DAYS,
// SEC_PROXY_REFRESH_PER_RUN, SEC_PROXY_MAX_CONSECUTIVE_FAILURES, SEC_PROXY_SHAPE_CHECK_AFTER,
// SEC_PROXY_RETRIES (tests only), SEC_PROXY_MIN_GAP_MS (tests only), SEC_PROXY_LIMIT (first N of
// the queue; for a first live run).

import { fetchJson, fetchText } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import { filingFolder, pickInstance, pickProxies, readProxyInstance, type ProxyFact, type ProxyFiling } from "../lib/proxypay.js";
import type { IngestRunResult } from "@stm/shared";
import { sec, outageCounter, SEC_BASE } from "./sec_form4.js";
import { tenDigitCik } from "./sec_company_sic.js";

const SOURCE = "sec_proxy_pay";
const DATA_BASE = (process.env.SEC_DATA_BASE ?? "https://data.sec.gov").replace(/\/$/, "");

type Status = "ok" | "no_proxy" | "no_instance" | "no_facts" | "not_found";

interface Outcome {
  cik: string;
  status: Status;
  filing: ProxyFiling | null;
  facts: ProxyFact[];
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

export async function ingestSecProxyPay(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();

  const budgetMin = envNumber("SEC_PROXY_MAX_MINUTES", 40);
  const budgetMs = budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const refreshDays = Math.max(1, Math.floor(envNumber("SEC_PROXY_REFRESH_DAYS", 30)));
  const refreshPerRun = Math.max(0, Math.floor(envNumber("SEC_PROXY_REFRESH_PER_RUN", 150)));
  const outage = outageCounter(envNumber("SEC_PROXY_MAX_CONSECUTIVE_FAILURES", 5));
  const shapeCheckAfter = Math.max(1, Math.floor(envNumber("SEC_PROXY_SHAPE_CHECK_AFTER", 25)));
  const limit = Math.max(0, Math.floor(envNumber("SEC_PROXY_LIMIT", 0)));
  const retriesEnv = process.env.SEC_PROXY_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;
  const gapEnv = process.env.SEC_PROXY_MIN_GAP_MS;
  const reqOpts = () => ({
    ...sec(),
    ...(gapEnv != null && gapEnv !== "" && Number.isFinite(Number(gapEnv)) ? { minGapMs: Number(gapEnv) } : {}),
    ...(retries != null ? { retries } : {}),
  });

  const fresh = await sql<{ cik: string; accession: string | null }[]>`
    select c.cik, null::text as accession
      from companies c left join exec_pay_proxy_checked f on f.cik = lpad(c.cik, 10, '0')
     where c.tracked and c.cik is not null and f.cik is null
     order by c.id`;
  const stale = refreshPerRun > 0 ? await sql<{ cik: string; accession: string | null }[]>`
    select c.cik, case when f.status = 'ok' then f.accession end as accession
      from companies c join exec_pay_proxy_checked f on f.cik = lpad(c.cik, 10, '0')
     where c.tracked and c.cik is not null and f.checked_at < now() - make_interval(days => ${refreshDays})
     order by f.checked_at, c.id
     limit ${refreshPerRun}` : [];
  let queue = [...fresh, ...stale];
  const queued = queue.length;
  if (limit > 0) queue = queue.slice(0, limit);

  const c: Record<string, number> = {
    to_check: queued, asked: 0, requests: 0, ok: 0, unchanged: 0, no_proxy: 0, no_instance: 0, no_facts: 0, not_found: 0,
    odd_answers: 0, folders_not_found: 0, instances_read: 0, rows_written: 0, failures: 0, remaining: 0,
    companies_peo: 0, companies_peo_per_person: 0, companies_several_people: 0, companies_neo: 0,
    facts_seen: 0, skipped_other_axis: 0, skipped_other_member: 0, skipped_bad_period: 0, skipped_other_entity: 0,
    skipped_no_context: 0, skipped_not_number: 0, conflicts: 0, skipped_neo_per_person: 0,
  };
  const axes = new Set<string>();
  let newestYear = "";
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  const [held] = await sql<{ n: number }[]>`select count(*)::int as n from (select 1 from exec_pay_proxy limit 1) x`;
  let shapeProven = (held?.n ?? 0) > 0;
  /** Companies read before the layout was proven: written once it is, dropped if it never is. */
  const pending: Outcome[] = [];
  let emptyBeforeProof = 0;

  const write = async (o: Outcome) => {
    await sql.begin(async (tx) => {
      if (o.status === "ok" && o.filing) {
        const years = [...new Set(o.facts.map((f) => f.fiscalYearEnd))];
        await tx`delete from exec_pay_proxy where cik = ${o.cik} and fiscal_year_end in ${tx(years)}`;
        for (const f of o.facts) {
          await tx`
            insert into exec_pay_proxy (cik, measure, fiscal_year_end, seq, tag, period_start, value, persons, dimensioned, accession, filed, updated_at)
            values (${o.cik}, ${f.measure}, ${f.fiscalYearEnd}, ${f.seq}, ${f.tag}, ${f.periodStart}, ${f.value}, ${f.persons}, ${f.dimensioned}, ${o.filing.accession}, ${o.filing.filed}, now())`;
        }
      }
      await tx`
        insert into exec_pay_proxy_checked (cik, checked_at, status, accession, filed, rows)
        values (${o.cik}, now(), ${o.status}, ${o.filing?.accession ?? null}, ${o.filing?.filed ?? null}, ${o.facts.length})
        on conflict (cik) do update
          set checked_at = excluded.checked_at, status = excluded.status, accession = excluded.accession,
              filed = excluded.filed, rows = excluded.rows`;
    });
    if (o.status === "ok") { c.rows_written! += o.facts.length; ctx.rowsChanged += o.facts.length; }
  };
  const settle = async (o: Outcome) => {
    if (shapeProven) await write(o);
    else pending.push(o);
  };

  let done = 0;
  for (const co of queue) {
    if (outage.tripped || fatal) break;
    if (overBudget()) { stoppedOnBudget = true; break; }
    const cik = tenDigitCik(co.cik);
    if (!cik || !ctx.markSeen(cik)) { done++; continue; }
    ctx.rowsSeen++;
    c.asked!++;

    // One company. A request that fails (not a 404) leaves the company for another run.
    let outcome: Outcome | null = null;
    try {
      let proxies: ProxyFiling[];
      try {
        c.requests!++;
        const picked = pickProxies(await fetchJson<unknown>(`${DATA_BASE}/submissions/CIK${cik}.json`, reqOpts()));
        outage.ok();
        if (!picked.hasShape) { c.odd_answers!++; continue; }
        proxies = picked.proxies;
      } catch (err) {
        if (!isNotFound(err)) throw err;
        outage.ok();
        outcome = { cik, status: "not_found", filing: null, facts: [] };
        proxies = [];
      }
      if (!outcome && proxies.length === 0) outcome = { cik, status: "no_proxy", filing: null, facts: [] };
      if (!outcome && co.accession && proxies[0]!.accession === co.accession) {
        // Nothing newer than the proxy statement already read.
        c.unchanged!++;
        await sql`update exec_pay_proxy_checked set checked_at = now() where cik = ${cik}`;
        done++;
        continue;
      }
      if (!outcome) {
        let sawInstance = false;
        for (const filing of proxies) {
          const folder = filingFolder(SEC_BASE, cik, filing.accession);
          let name: string | null = null;
          try {
            c.requests!++;
            const idx = pickInstance(await fetchJson<unknown>(`${folder}/index.json`, reqOpts()));
            outage.ok();
            if (!idx.hasShape) { c.odd_answers!++; continue; }
            name = idx.name;
          } catch (err) {
            if (!isNotFound(err)) throw err;
            outage.ok();
            c.folders_not_found!++;
            continue;
          }
          if (!name) continue;
          let xml: string;
          try {
            c.requests!++;
            xml = await fetchText(`${folder}/${name}`, reqOpts());
            outage.ok();
          } catch (err) {
            if (!isNotFound(err)) throw err;
            outage.ok();
            c.folders_not_found!++;
            continue;
          }
          sawInstance = true;
          c.instances_read!++;
          const read = readProxyInstance(xml, cik);
          c.facts_seen! += read.seen;
          c.skipped_other_axis! += read.skipped.otherAxis;
          c.skipped_other_member! += read.skipped.otherMember;
          c.skipped_bad_period! += read.skipped.badPeriod;
          c.skipped_other_entity! += read.skipped.otherEntity;
          c.skipped_no_context! += read.skipped.noContext;
          c.skipped_not_number! += read.skipped.notNumber;
          c.conflicts! += read.skipped.conflicts;
          c.skipped_neo_per_person! += read.skipped.neoPerPerson;
          read.axes.forEach((a) => axes.add(a));
          if (read.facts.length > 0) {
            outcome = { cik, status: "ok", filing, facts: read.facts };
            break;
          }
        }
        if (!outcome) outcome = { cik, status: sawInstance ? "no_facts" : "no_instance", filing: proxies[0] ?? null, facts: [] };
      }
    } catch (err) {
      outage.fail();
      c.failures!++;
      lastFailure = err instanceof Error ? err.message : String(err);
      continue; // nothing written; stays due
    }

    c[outcome.status] = (c[outcome.status] ?? 0) + 1;
    if (outcome.status === "ok") {
      const peo = outcome.facts.filter((f) => f.measure.startsWith("peo"));
      if (peo.length > 0) c.companies_peo!++;
      if (peo.some((f) => f.dimensioned)) c.companies_peo_per_person!++;
      if (peo.some((f) => f.persons > 1)) c.companies_several_people!++;
      if (outcome.facts.some((f) => f.measure.startsWith("neo"))) c.companies_neo!++;
      for (const f of outcome.facts) if (f.fiscalYearEnd > newestYear) newestYear = f.fiscalYearEnd;
      if (!shapeProven) {
        shapeProven = true;
        for (const p of pending.splice(0)) await write(p);
      }
    } else if (!shapeProven && (outcome.status === "no_facts" || outcome.status === "no_instance")) {
      emptyBeforeProof++;
      if (emptyBeforeProof >= shapeCheckAfter) {
        fatal = `the first ${emptyBeforeProof} companies with a proxy statement yielded no pay figure: the filings are not in the shape this job expects; nothing was written`;
        break;
      }
    }
    await settle(outcome);
    done++;
    if (c.asked! % 100 === 0) console.log(`${SOURCE}: ${done} of ${queue.length} done, ${c.ok} with figures`);
  }
  // Companies held back while the layout was unproven were not written: they stay due.
  const unwritten = shapeProven ? 0 : pending.length;
  c.remaining = queued - done + unwritten;
  Object.assign(ctx.extra, c);
  ctx.extra["other_axes"] = [...axes].sort().slice(0, 12).join(",");
  ctx.extra["newest_fiscal_year_end"] = newestYear;
  ctx.extra["held_back_unproven"] = unwritten;
  ctx.extra["stopped_on_budget"] = stoppedOnBudget;
  ctx.extra["limit"] = limit;
  ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;

  const [tot] = await sql<{ rows: number; companies: number; peo: number; peo_new: number; any_new: number; checked: number }[]>`
    select (select count(*) from exec_pay_proxy)::int as rows,
           (select count(distinct cik) from exec_pay_proxy)::int as companies,
           (select count(distinct cik) from exec_pay_proxy where measure = 'peo_total')::int as peo,
           (select count(distinct p.cik) from exec_pay_proxy p where p.measure = 'peo_total'
              and not exists (select 1 from exec_pay e where e.cik = p.cik and e.measure = 'peo_total'))::int as peo_new,
           (select count(distinct p.cik) from exec_pay_proxy p
              where not exists (select 1 from exec_pay e where e.cik = p.cik))::int as any_new,
           (select count(*) from exec_pay_proxy_checked)::int as checked`;
  ctx.extra["table_rows"] = tot?.rows ?? 0;
  ctx.extra["table_companies"] = tot?.companies ?? 0;
  ctx.extra["table_companies_peo"] = tot?.peo ?? 0;
  ctx.extra["table_companies_peo_not_in_frames"] = tot?.peo_new ?? 0;
  ctx.extra["table_companies_not_in_frames"] = tot?.any_new ?? 0;
  ctx.extra["table_companies_checked"] = tot?.checked ?? 0;
  console.log(`${SOURCE}: asked ${c.asked} of ${queued}; ${c.ok} with figures (${c.companies_peo_per_person} filed per person, ${c.companies_several_people} with several people in a year), ${c.unchanged} unchanged, ${c.no_proxy} with no proxy statement, ${c.no_instance} with no instance, ${c.no_facts} with no pay figure, ${c.not_found} unknown to the SEC, ${c.failures} failed, ${c.remaining} left; table holds ${tot?.rows ?? 0} rows for ${tot?.companies ?? 0} companies, ${tot?.peo_new ?? 0} of them with a principal executive figure the frames source lacks`);

  if (!fatal && !shapeProven && emptyBeforeProof > 0 && !stoppedOnBudget && !outage.tripped) {
    fatal = `none of the ${emptyBeforeProof} companies with a proxy statement yielded a pay figure: the filings are not in the shape this job expects; nothing was written`;
  }
  if (fatal || outage.tripped) {
    const error = fatal ?? `${outage.count} requests in a row failed (last: ${lastFailure.slice(0, 160)})`;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() };
  }
  const status = stoppedOnBudget || c.failures! > 0 || unwritten > 0 || (limit > 0 && queued > limit) ? "partial" : "success";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}
