// Source: SEC EDGAR daily index, market-wide Form 4 (stage 2 of market-wide Form 4, 2026-11-16).
//
// Stage 1 (`sec_form4_bulk`) loaded the SEC quarterly Insider Transactions Data Sets through
// 2026-09-30. This source carries it forward: for every day after SEC_INDEX_SINCE (default
// 2026-10-01) it reads EDGAR's daily index, takes every Form 4 filed that day whoever the issuer
// is, and stores it. It runs first as a chained catch-up (form4-index.yml, about 20,000
// filings) and then every day inside the daily ingest (group `insiders-market`).
//
// WHAT IT READS
//   <base>/Archives/edgar/daily-index/<year>/QTR<n>/index.json   the day files that exist
//   <base>/Archives/edgar/daily-index/<year>/QTR<n>/master.YYYYMMDD.idx
//       CIK|Company Name|Form Type|Date Filed|File Name, one row per CIK involved in a filing,
//       so the same accession appears several times; form type must be exactly "4".
//   <base>/Archives/<File Name>   the full submission text; one request per filing, the
//       ownership XML sits between <XML> and </XML>.
//
// WHAT IT WRITES (storeForm4Filing in sec_form4.ts, the same write path the daily source uses)
//   * An issuer that is already tracked: the filing is written exactly as the daily
//     sec_form4 source would write it (market = false), raw-document archive included.
//   * Any other issuer: market = true. A NEW company gets tracked = false, a NEW security
//     is_active = false, the filing has scope 'market', nothing is archived. The site's
//     site_* views hide all of it until promote_market_scope() finds an active security.
//
// RESUME. ingest_runs.stats.through holds the newest index day fully processed (stored,
// already stored, or quarantined). The next run starts at the 2 newest days at or before it
// (stored accessions are skipped, so this is cheap) and then every later day.
//
// STOPPING. SEC_INDEX_MAX_MINUTES (default 40) ends the run in the middle of a day: that day
// is NOT marked processed, status is "partial" (the workflow chains on that word). Five request
// failures in a row (SEC_INDEX_MAX_CONSECUTIVE_FAILURES) end the run as "failed" with stats.
// SEC_INDEX_RETRIES (default 3, the http client's own default) is for tests only.
//
// Env: SEC_EDGAR_BASE (tests only, shared with sec_form4), SEC_INDEX_SINCE, SEC_INDEX_MAX_MINUTES,
// SEC_INDEX_MAX_CONSECUTIVE_FAILURES, SEC_INDEX_RETRIES.

import { fetchJson, fetchText } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";
import { SEC_BASE, sec, parseForm4Xml, storeForm4Filing, outageCounter, type ParsedForm4 } from "./sec_form4.js";
import { padCik } from "./sec_form4_bulk.js";

const SOURCE = "sec_form4_index";
export const DEFAULT_SINCE = "2026-10-01";
/** How many of the newest processed days are read again on every run. */
export const REREAD_DAYS = 2;

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (tested in sec_form4_index.test.ts)
// ──────────────────────────────────────────────────────────────────────────

export interface IndexRow {
  cik: string;
  company: string;
  form: string;
  /** YYYY-MM-DD */
  filedAt: string;
  /** e.g. edgar/data/1001250/0001628280-26-073892.txt */
  file: string;
  /** e.g. 0001628280-26-073892 */
  accession: string;
}

/** `20261113` -> `2026-11-13`; null when it is not a date. */
export function compactToIso(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Rows of a master.YYYYMMDD.idx file whose form type is exactly "4" (not 4/A, 144, 3 or 5), one
 * per accession. The header lines and the dashed line before the data are skipped by shape: a
 * data row has five pipe-separated cells and a file name ending in `.txt`.
 */
export function parseMasterIndex(text: string): IndexRow[] {
  const out: IndexRow[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split("|");
    if (cells.length !== 5) continue;
    const [cik, company, form, date, file] = cells.map((c) => c.trim()) as [string, string, string, string, string];
    if (form !== "4") continue;
    if (!/^\d+$/.test(cik)) continue; // also drops the column-title row
    const filedAt = compactToIso(date);
    if (!filedAt) continue;
    const m = /([^/]+)\.txt$/.exec(file);
    if (!m) continue;
    const accession = m[1]!;
    if (seen.has(accession)) continue;
    seen.add(accession);
    out.push({ cik, company, form, filedAt, file, accession });
  }
  return out;
}

/** The ownership XML inside a full submission text, or null when the submission has none. */
export function extractOwnershipXml(submission: string): string | null {
  const re = /<XML>([\s\S]*?)<\/XML>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(submission))) {
    const body = m[1]!.trim();
    if (/<ownershipDocument[\s>]/.test(body)) return body;
  }
  return null;
}

/** `master.20261113.idx` -> `2026-11-13`; null for any other file name. */
export function masterNameToDate(name: string): string | null {
  const m = /^master\.(\d{8})\.idx$/.exec(name);
  return m ? compactToIso(m[1]!) : null;
}

/** Day files named in a daily-index `index.json`, as sorted ISO dates. */
export function masterDaysFromListing(listing: unknown): string[] {
  const items = (listing as { directory?: { item?: unknown } } | null)?.directory?.item;
  const arr = Array.isArray(items) ? items : items ? [items] : [];
  const days = new Set<string>();
  for (const it of arr) {
    const d = masterNameToDate(String((it as { name?: unknown })?.name ?? ""));
    if (d) days.add(d);
  }
  return [...days].sort();
}

export interface QuarterFolder { year: number; quarter: number; }

/** Quarter folders from the quarter holding `from` to the one holding `to`, across year ends. */
export function quarterFolders(from: string, to: string): QuarterFolder[] {
  const parse = (d: string) => ({ y: Number(d.slice(0, 4)), q: Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1 });
  const a = parse(from);
  const b = parse(to);
  const out: QuarterFolder[] = [];
  let y = a.y;
  let q = a.q;
  while (y < b.y || (y === b.y && q <= b.q)) {
    out.push({ year: y, quarter: q });
    q++;
    if (q > 4) { q = 1; y++; }
  }
  return out;
}

export function quarterListingPath(f: QuarterFolder): string {
  return `/Archives/edgar/daily-index/${f.year}/QTR${f.quarter}`;
}

/** ISO date minus `n` days (UTC). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Days to work on, given every index day on file (any order), the resume point `through` (the
 * newest day fully processed, or null) and the start date. Days before `since` are never read.
 * With a resume point: the `reread` newest days at or before it, then every later day.
 */
export function daysToProcess(allDays: string[], through: string | null, since: string, reread = REREAD_DAYS): string[] {
  const days = [...new Set(allDays)].filter((d) => d >= since).sort();
  if (!through) return days;
  let last = -1;
  for (let i = 0; i < days.length; i++) if (days[i]! <= through) last = i;
  const start = last < 0 ? 0 : Math.max(0, last - (reread - 1));
  return days.slice(start);
}

/** Where listing starts: far enough before `through` that the re-read days are in range. */
export function listingStart(through: string | null, since: string): string {
  if (!through) return since;
  const back = addDays(through, -10);
  return back > since ? back : since;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /HTTP 404\b/.test(err.message);
}

// ──────────────────────────────────────────────────────────────────────────
// The job
// ──────────────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function ingestSecForm4Index(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE, 300);
  const startedAt = Date.now();

  const since = process.env.SEC_INDEX_SINCE ?? DEFAULT_SINCE;
  const budgetMin = Number(process.env.SEC_INDEX_MAX_MINUTES ?? 40);
  const budgetMs = Number.isFinite(budgetMin) && budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const outageLimit = Number(process.env.SEC_INDEX_MAX_CONSECUTIVE_FAILURES ?? 5);
  const outage = outageCounter(Number.isFinite(outageLimit) ? outageLimit : 5);
  const retriesEnv = process.env.SEC_INDEX_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;
  const reqOpts = () => ({ ...sec(), ...(retries != null ? { retries } : {}) });

  const c = {
    days_listed: 0, days_processed: 0, filings_listed: 0, filings_skipped_existing: 0, filings_inserted: 0,
    filings_market: 0, filings_tracked: 0, rows_written: 0, companies_created: 0, people_created: 0,
    securities_created: 0, no_xml: 0, requests: 0, documents_archived: 0, future_dates_nulled: 0,
  };
  let through: string | null = null;
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  const sync = () => {
    Object.assign(ctx.extra, c);
    ctx.extra["through"] = through;
    ctx.extra["since"] = since;
    ctx.extra["stopped_on_budget"] = stoppedOnBudget;
    ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
  };

  const get = async (url: string): Promise<string> => { c.requests++; return fetchText(url, reqOpts()); };
  const getJson = async <T>(url: string): Promise<T> => { c.requests++; return fetchJson<T>(url, reqOpts()); };

  // Resume point: newest day fully processed by an earlier run that got anywhere.
  const [prev] = await sql<{ through: string | null }[]>`
    select r.stats->>'through' as through
      from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.status in ('success', 'partial') and r.stats->>'through' is not null
     order by r.id desc limit 1
  `;
  const prevThrough = prev?.through && /^\d{4}-\d{2}-\d{2}$/.test(prev.through) ? prev.through : null;
  through = prevThrough;

  // The day files that exist, quarter by quarter.
  const today = todayIso();
  const allDays: string[] = [];
  for (const q of quarterFolders(listingStart(prevThrough, since), today)) {
    try {
      const listing = await getJson<unknown>(`${SEC_BASE}${quarterListingPath(q)}/index.json`);
      allDays.push(...masterDaysFromListing(listing));
      outage.ok();
    } catch (err) {
      if (isNotFound(err)) continue; // a quarter folder that does not exist yet
      outage.fail();
      lastFailure = err instanceof Error ? err.message : String(err);
      fatal = `could not list ${quarterListingPath(q)}: ${lastFailure.slice(0, 160)}`;
      break;
    }
  }
  const days = fatal ? [] : daysToProcess(allDays, prevThrough, since);
  c.days_listed = days.length;

  const quarterOf = (iso: string): QuarterFolder => quarterFolders(iso, iso)[0]!;

  for (const day of days) {
    if (fatal || outage.tripped) break;
    if (overBudget()) { stoppedOnBudget = true; break; }

    const q = quarterOf(day);
    let rows: IndexRow[];
    try {
      const text = await get(`${SEC_BASE}${quarterListingPath(q)}/master.${day.replace(/-/g, "")}.idx`);
      rows = parseMasterIndex(text);
      // No outage.ok() here: a day file that reads fine says nothing about the submissions
      // behind it, and resetting would hide five failed submissions spread over several days.
    } catch (err) {
      outage.fail();
      lastFailure = err instanceof Error ? err.message : String(err);
      fatal = `could not read the master index for ${day}: ${lastFailure.slice(0, 160)}`;
      break;
    }
    c.filings_listed += rows.length;

    const accessions = rows.map((r) => r.accession);
    const existing = new Set<string>();
    if (accessions.length > 0) {
      const have = await sql`select external_id from filings where source = 'sec_form4' and external_id = any(${accessions})`;
      for (const r of have) existing.add(String(r.external_id));
    }

    let dayDone = true;
    for (const row of rows) {
      if (existing.has(row.accession)) { c.filings_skipped_existing++; continue; }
      if (overBudget()) { stoppedOnBudget = true; dayDone = false; break; }
      if (outage.tripped) { dayDone = false; break; }
      if (!ctx.markSeen(row.accession)) continue;
      ctx.rowsSeen++;

      let submission: string;
      try {
        submission = await get(`${SEC_BASE}/Archives/${row.file}`);
        outage.ok();
      } catch (err) {
        lastFailure = err instanceof Error ? err.message : String(err);
        if (!isNotFound(err)) outage.fail();
        ctx.quarantine(row.accession, `submission not fetched: ${lastFailure.slice(0, 200)}`);
        sync();
        continue;
      }

      const xml = extractOwnershipXml(submission);
      if (!xml) {
        c.no_xml++;
        ctx.quarantine(row.accession, "submission has no ownership XML");
        continue;
      }
      let parsed: ParsedForm4;
      try {
        parsed = parseForm4Xml(xml);
      } catch (err) {
        ctx.quarantine(row.accession, `unparseable Form 4 XML: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (!parsed.issuerCik && !parsed.issuerName) { ctx.quarantine(row.accession, "parsed XML missing issuer identity"); continue; }
      if (!parsed.rptOwnerName) { ctx.quarantine(row.accession, "parsed XML missing reporting owner name"); continue; }

      try {
        const issuerCik = parsed.issuerCik ? padCik(parsed.issuerCik) : null;
        const tracked = issuerCik
          ? (await sql`select cik, primary_ticker from companies where cik = ${issuerCik} and tracked`)[0] ?? null
          : null;
        const idxUrl = `${SEC_BASE}/Archives/edgar/data/${(issuerCik ?? row.cik).replace(/^0+/, "") || "0"}/${row.accession.replace(/-/g, "")}/${row.accession}-index.htm`;
        const stored = await sql.begin(async (tx) =>
          storeForm4Filing(tx as unknown as ReturnType<typeof getDb>, {
            accession: row.accession,
            filingDate: row.filedAt,
            xmlUrl: idxUrl,
            xmlText: xml,
            parsed,
            ticker: tracked ? ((tracked.primary_ticker as string | null) ?? null) : null,
            cik: tracked ? String(tracked.cik) : null,
            market: !tracked,
            warn: (m) => ctx.warn(m),
          }),
        );
        if (!stored.ok) { ctx.quarantine(row.accession, stored.reason); continue; }
        if (!stored.inserted) { c.filings_skipped_existing++; continue; }
        c.filings_inserted++;
        if (stored.scope === "market") c.filings_market++; else c.filings_tracked++;
        c.rows_written += stored.transactions;
        ctx.rowsChanged += stored.transactions;
        if (stored.companyCreated) c.companies_created++;
        if (stored.personCreated) c.people_created++;
        if (stored.securityCreated) c.securities_created++;
        if (stored.archived) c.documents_archived++;
        c.future_dates_nulled += stored.futureDatesNulled;
      } catch (err) {
        // A database error on one filing is that filing's problem, not the SEC's.
        ctx.quarantine(row.accession, `write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      sync();
    }

    if (!dayDone || stoppedOnBudget || outage.tripped) break;
    c.days_processed++;
    if (!through || day > through) through = day;
    sync();
  }

  const stoppedOnOutage = outage.tripped || fatal != null;

  // Market filings whose issuer has since gained an active security join the tracked set.
  try {
    ctx.extra["market_filings_promoted"] = Number((await sql`select promote_market_scope() as n`)[0]?.n ?? 0);
  } catch (err) {
    ctx.warn(`promote_market_scope failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  sync();
  ctx.extra["stopped_on_outage"] = stoppedOnOutage;

  const status: IngestRunResult["status"] = stoppedOnOutage ? "failed" : stoppedOnBudget ? "partial" : "success";
  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status,
    ...(stoppedOnOutage
      ? { error: fatal ?? `SEC EDGAR is not answering: ${outage.count} requests in a row failed after retries (last: ${lastFailure.slice(0, 160)}); stopped after ${c.days_processed} of ${c.days_listed} days` }
      : {}),
    stats: ctx.stats(),
  };
}

// Allow running directly: `npx tsx src/sources/sec_form4_index.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSecForm4Index()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
