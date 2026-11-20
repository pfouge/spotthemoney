// Source: SEC Schedules 13D and 13G from the EDGAR daily index (queue item 8, stage 1, 2026-11-19).
//
// A Schedule 13D or 13G is the statement a person or group files after coming to own more than
// 5% of a class of a company's voting shares. 13D is the long form; 13G the short form for
// passive and institutional holders. Both state what the filer says it owned on a date: they are
// not reports of trades. Since December 2024 both are filed on EDGAR as XML. This source stores
// one row per submission in `schedule13_filings` (migration 0030). Stage 1 stores only: nothing
// on the site reads the table yet.
//
// WHAT IT READS (the walk of sec_form144.ts, with other form types)
//   <base>/Archives/edgar/daily-index/<year>/QTR<n>/index.json        the day files that exist
//   <base>/Archives/edgar/daily-index/<year>/QTR<n>/master.YYYYMMDD.idx
//       form type exactly SCHEDULE 13D, SCHEDULE 13D/A, SCHEDULE 13G or SCHEDULE 13G/A; one
//       request per accession for
//   <base>/Archives/<File Name>   the full submission text; the form's XML sits between <XML>
//       and </XML>.
//
// THE XML SHAPE. The element names were read from one real filing of each schedule on
// 2026-11-19 (13D: accession 0001493152-26-007602; 13G: 0001897612-25-000555). The two
// schedules use different names for the same things, and two files are a thin sample, so the
// guards of sec_form144.ts are kept, one per schedule:
//   * Shape guard. Nothing of a schedule is written until one parsed statement of that schedule
//     names an issuer, a reporting person and an amount or a percentage. If the first
//     SHAPE_SAMPLE (20) of a schedule do not, the run ends "failed" and does not move its
//     resume point (rows of the other schedule already written stay; they are skipped next time).
//   * stats.sample_tags_13d / sample_tags_13g list the element names of the first statement of
//     each schedule (names only, no values), and stats.with_* count the filled fields.
//   * PARSER_VERSION. A stored row is skipped only if it was written by this parser version or
//     a newer one, so after a parser fix (bump the constant) old rows are re-read in place.
//
// WHAT IT KEEPS. Issuer (CIK, name, CUSIP), class of securities, the event date, the
// submission's filer CIK, and for every reporting person on the cover pages: name, CIK when
// given, citizenship or place of organization, type code, source-of-funds code (13D), the four
// voting and dispositive figures, the aggregate amount and the percent of class. For 13G the
// rule(s) the schedule is filed under; for 13D the "purpose of transaction" text, cut at
// PURPOSE_MAX. Headline columns are the LARGEST amount and percent any one person states (group
// members commonly each report the same combined holding, so a sum would count it twice).
// Addresses, phone numbers, signatures, the authorized-persons block and the legal-proceedings
// answers are not stored.
//
// RESUME, STOPPING and the RETRY LIST work as in sec_form144.ts: stats.through is the newest
// index day fully processed; SEC_13DG_MAX_MINUTES (default 40) ends a run "partial"; five
// request failures in a row end it "failed"; a submission the SEC would not serve goes into
// stats.retry and is asked for first on the next run (given up after RETRY_MAX_TRIES or a 404).
//
// Env: SEC_EDGAR_BASE (tests only, shared with sec_form4), SEC_13DG_SINCE (default the Form 4
// floor), SEC_13DG_MAX_MINUTES, SEC_13DG_MAX_CONSECUTIVE_FAILURES, SEC_13DG_RETRIES (tests).

import { fetchJson, fetchText } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { scrubDeep } from "../lib/sanitize.js";
import { FORM4_FLOOR, type IngestRunResult } from "@stm/shared";
import { SEC_BASE, sec, outageCounter } from "./sec_form4.js";
import { padCik } from "./sec_form4_bulk.js";
import {
  compactToIso, masterDaysFromListing, quarterFolders, quarterListingPath, daysToProcess, listingStart,
  type QuarterFolder,
} from "./sec_form4_index.js";
import { blocks, cleanText, leaf, parseFormDate, leafTags, noticeIndexUrl } from "./sec_form144.js";

const SOURCE = "sec_schedule13";
/** Bump after a parser fix: rows stored by an older version are fetched and written again. */
export const PARSER_VERSION = 1;
export const DEFAULT_SINCE = FORM4_FLOOR;
/** Statements of one schedule held back, unwritten, until one of them has the expected shape. */
export const SHAPE_SAMPLE = 20;
export const PERSONS_MAX = 60;
export const PURPOSE_MAX = 2000;
export const RETRY_MAX_TRIES = 10;
export const RETRY_LIST_MAX = 200;

export const FORM_TYPES = ["SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A"] as const;
export type FormType = (typeof FORM_TYPES)[number];
export type Schedule = "13D" | "13G";

export function asFormType(s: string | null | undefined): FormType | null {
  const t = (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return (FORM_TYPES as readonly string[]).includes(t) ? (t as FormType) : null;
}
export const scheduleOf = (f: FormType): Schedule => (f.startsWith("SCHEDULE 13D") ? "13D" : "13G");
export const isAmendment = (f: FormType): boolean => f.endsWith("/A");

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (tested in sec_schedule13.test.ts)
// ──────────────────────────────────────────────────────────────────────────

export interface IndexRow {
  cik: string;
  form: FormType;
  /** YYYY-MM-DD */
  filedAt: string;
  file: string;
  accession: string;
}

/** Rows of a master.YYYYMMDD.idx file whose form type is one of FORM_TYPES, one per accession. */
export function parseMasterIndex13(text: string): IndexRow[] {
  const out: IndexRow[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split("|");
    if (cells.length !== 5) continue;
    const [cik, , formRaw, date, file] = cells.map((c) => c.trim()) as [string, string, string, string, string];
    const form = asFormType(formRaw);
    if (!form) continue;
    if (!/^\d+$/.test(cik)) continue;
    const filedAt = compactToIso(date);
    if (!filedAt) continue;
    const m = /([^/]+)\.txt$/.exec(file);
    if (!m) continue;
    const accession = m[1]!;
    if (seen.has(accession)) continue;
    seen.add(accession);
    out.push({ cik, form, filedAt, file, accession });
  }
  return out;
}

/** A non-negative number from "223201.00", "1,234", "5.3" or "5.3%"; null for anything else. */
export function parseFigure(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = s.replace(/[$,%\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A percent of class: a figure from 0 to 100; anything else is not a percentage. */
export function parsePercent(s: string | null | undefined): number | null {
  const n = parseFigure(s);
  return n != null && n <= 100 ? n : null;
}

function cikOf(s: string | null): string | null {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d && d.length <= 10 && Number(d) > 0 ? padCik(d) : null;
}

/** Form type and filing date from a full submission's SEC-HEADER; null fields when absent. */
export function parseSubmissionHeader13(text: string): { form: FormType | null; filedAt: string | null } {
  const head = text.slice(0, 6000);
  const t = /CONFORMED SUBMISSION TYPE:[ \t]*([^\r\n]+)/.exec(head)?.[1] ?? null;
  const d = /FILED AS OF DATE:\s*(\d{8})/.exec(head)?.[1] ?? null;
  return { form: asFormType(t), filedAt: d ? compactToIso(d) : null };
}

export interface RetryEntry {
  /** accession */ a: string;
  /** file name under /Archives/ */ f: string;
  /** form type, when known */ t?: FormType;
  /** filing date, when known */ d?: string;
  /** failed attempts so far (runs) */ n?: number;
}

/** A clean retry list from whatever an earlier run stored: well-formed entries only, one per accession. */
export function readRetryList13(value: unknown): RetryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RetryEntry[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    const e = v as Partial<RetryEntry> | null;
    if (!e || typeof e.a !== "string" || typeof e.f !== "string") continue;
    if (!/^\d{10}-\d{2}-\d{6}$/.test(e.a) || !/^edgar\/data\/\d+\/[\d-]+\.txt$/.test(e.f) || !e.f.endsWith(`/${e.a}.txt`)) continue;
    if (seen.has(e.a)) continue;
    seen.add(e.a);
    const t = asFormType(e.t);
    out.push({
      a: e.a, f: e.f,
      ...(t ? { t } : {}),
      ...(typeof e.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.d) ? { d: e.d } : {}),
      n: Number.isFinite(Number(e.n)) ? Number(e.n) : 0,
    });
  }
  return out.slice(0, RETRY_LIST_MAX);
}

/** The schedule's XML inside a full submission text, or null when the submission has none. */
export function extractSchedule13Xml(submission: string): string | null {
  const re = /<XML>([\s\S]*?)<\/XML>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(submission))) {
    const body = m[1]!.trim();
    if (/<(?:[\w.-]+:)?coverPageHeader[\s>]/i.test(body) || /<(?:[\w.-]+:)?reportingPersons[\s>]/i.test(body)) return body;
  }
  return null;
}

export interface ReportingPerson {
  name: string | null;
  cik: string | null;
  citizenship: string | null;
  /** type of reporting person, as coded on the form: IN, CO, IA, ... (several joined by ", ") */
  type: string | null;
  /** 13D: source of funds code(s), as coded on the form: WC, AF, OO, ... */
  funds: string | null;
  /** 13D: member of a group, as marked (a or b) */
  group: string | null;
  sole_voting: number | null;
  shared_voting: number | null;
  sole_dispositive: number | null;
  shared_dispositive: number | null;
  amount: number | null;
  percent: number | null;
}

export interface ParsedSchedule13 {
  schedule: Schedule;
  issuerCik: string | null;
  issuerName: string | null;
  issuerCusip: string | null;
  securityClass: string | null;
  eventDate: string | null;
  filerCik: string | null;
  persons: ReportingPerson[];
  personsOnForm: number;
  rules: string[];
  purpose: string | null;
  previouslyFiled: boolean | null;
  // Headline columns:
  reporterName: string | null;
  sharesOwned: number | null;
  percentOfClass: number | null;
}

/** Every distinct non-empty value of `<name>` inside `xml`, joined by ", " (codes can repeat). */
function joined(xml: string, name: string, max = 60): string | null {
  const seen: string[] = [];
  for (const b of blocks(xml, name)) {
    const t = cleanText(b, 40);
    if (t && !seen.includes(t)) seen.push(t);
  }
  if (seen.length === 0) return null;
  const s = seen.join(", ");
  return s.length > max ? s.slice(0, max) : s;
}

function largest(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
}

function flag(s: string | null): boolean | null {
  if (s == null) return null;
  if (/^(y|yes|true|1)$/i.test(s)) return true;
  if (/^(n|no|false|0)$/i.test(s)) return false;
  return null;
}

/**
 * Parse a schedule's XML. `schedule` says which cover-page names to expect; when the block of
 * that schedule is absent the other schedule's block is tried, so a mislabelled submission
 * still parses.
 */
export function parseSchedule13Xml(xml: string, schedule: Schedule): ParsedSchedule13 {
  const header = blocks(xml, "headerData")[0] ?? "";
  const cover = blocks(xml, "coverPageHeader")[0] ?? xml;
  const issuerBlock = blocks(cover, "issuerInfo")[0] ?? cover;

  const dBlocks = blocks(xml, "reportingPersonInfo");
  const gBlocks = blocks(xml, "coverPageHeaderReportingPersonDetails");
  const useD = schedule === "13D" ? dBlocks.length > 0 || gBlocks.length === 0 : gBlocks.length === 0 && dBlocks.length > 0;
  const personBlocks = useD ? dBlocks : gBlocks;

  const persons: ReportingPerson[] = personBlocks.slice(0, PERSONS_MAX).map((b) => ({
    name: leaf(b, "reportingPersonName"),
    cik: cikOf(leaf(b, "reportingPersonCIK")),
    citizenship: leaf(b, "citizenshipOrOrganization"),
    type: joined(b, "typeOfReportingPerson"),
    funds: joined(b, "fundType"),
    group: cleanText(blocks(b, "memberOfGroup")[0], 20),
    sole_voting: parseFigure(leaf(b, "soleVotingPower")),
    shared_voting: parseFigure(leaf(b, "sharedVotingPower")),
    sole_dispositive: parseFigure(leaf(b, "soleDispositivePower")),
    shared_dispositive: parseFigure(leaf(b, "sharedDispositivePower")),
    amount: parseFigure(leaf(b, "aggregateAmountOwned", "reportingPersonBeneficiallyOwnedAggregateNumberOfShares")),
    percent: parsePercent(leaf(b, "percentOfClass", "classPercent")),
  }));

  const rules: string[] = [];
  for (const r of blocks(cover, "designateRulePursuantThisScheduleFiled")) {
    const t = cleanText(r, 40);
    if (t && !rules.includes(t) && rules.length < 5) rules.push(t);
  }

  return {
    schedule,
    issuerCik: cikOf(leaf(issuerBlock, "issuerCik")),
    issuerName: leaf(issuerBlock, "issuerName"),
    // Statements filed from March 2026 name the element issuerCusipNumber (seen in the live run's
    // sample_tags on 2026-11-20; every statement before that month had issuerCusip). First one given.
    issuerCusip: cleanText(blocks(issuerBlock, "issuerCusip")[0] ?? blocks(issuerBlock, "issuerCusipNumber")[0] ?? blocks(cover, "issuerCusipNumber")[0], 20),
    securityClass: leaf(cover, "securitiesClassTitle"),
    eventDate: parseFormDate(leaf(cover, "dateOfEvent", "eventDateRequiresFilingThisStatement")),
    filerCik: cikOf(leaf(blocks(header, "filerCredentials")[0] ?? header, "cik")),
    persons,
    personsOnForm: personBlocks.length,
    rules,
    purpose: cleanText(blocks(xml, "transactionPurpose")[0], PURPOSE_MAX),
    previouslyFiled: flag(leaf(cover, "previouslyFiledFlag")),
    reporterName: persons.find((p) => p.name)?.name ?? null,
    sharesOwned: largest(persons.map((p) => p.amount)),
    percentOfClass: largest(persons.map((p) => p.percent)),
  };
}

/** The shape the parser was written for: an issuer, a named reporting person, an amount or a percentage. */
export function hasShape13(p: ParsedSchedule13): boolean {
  return Boolean((p.issuerCik || p.issuerName) && p.reporterName && (p.sharesOwned != null || p.percentOfClass != null));
}

/** What goes into `payload`: the cover-page figures as parsed, nothing with an address or phone number. */
export function toPayload13(p: ParsedSchedule13) {
  return {
    persons: p.persons,
    persons_on_form: p.personsOnForm,
    ...(p.schedule === "13D" ? { purpose: p.purpose, previously_filed: p.previouslyFiled } : {}),
  };
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /HTTP 404\b/.test(err.message);
}

// ──────────────────────────────────────────────────────────────────────────
// The job
// ──────────────────────────────────────────────────────────────────────────

export async function ingestSecSchedule13(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE, 300);
  const startedAt = Date.now();

  const since = process.env.SEC_13DG_SINCE ?? DEFAULT_SINCE;
  const budgetMin = Number(process.env.SEC_13DG_MAX_MINUTES ?? 40);
  const budgetMs = Number.isFinite(budgetMin) && budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const outageLimit = Number(process.env.SEC_13DG_MAX_CONSECUTIVE_FAILURES ?? 5);
  const outage = outageCounter(Number.isFinite(outageLimit) ? outageLimit : 5);
  const retriesEnv = process.env.SEC_13DG_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;
  const reqOpts = () => ({ ...sec(), ...(retries != null ? { retries } : {}) });

  const c = {
    days_listed: 0, days_processed: 0, listed: 0, skipped_existing: 0, stored: 0, rewritten: 0,
    stored_13d: 0, stored_13g: 0, amendments: 0, no_xml: 0, requests: 0, persons_cut: 0,
    retry_tried: 0, retry_stored: 0, retry_given_up: 0,
    with_issuer_cik: 0, with_cusip: 0, with_class: 0, with_event_date: 0, with_filer_cik: 0, with_reporter: 0,
    with_shares: 0, with_percent: 0, with_several_persons: 0, with_person_cik: 0, with_rules: 0, with_purpose: 0,
  };
  let prevThrough: string | null = null;
  let completedThrough: string | null = null;
  const shapeSeen: Record<Schedule, boolean> = { "13D": false, "13G": false };
  const sampleTags: Record<Schedule, string[] | null> = { "13D": null, "13G": null };
  const pending: Record<Schedule, { row: IndexRow; parsed: ParsedSchedule13 }[]> = { "13D": [], "13G": [] };
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  let retry: RetryEntry[] = [];

  const held = () => pending["13D"].length + pending["13G"].length;
  // The resume point only moves past days whose statements are actually written.
  const through = () => (held() === 0 ? completedThrough ?? prevThrough : prevThrough);
  const sync = () => {
    Object.assign(ctx.extra, c);
    ctx.extra["through"] = through();
    ctx.extra["since"] = since;
    ctx.extra["parser_version"] = PARSER_VERSION;
    ctx.extra["shape_seen_13d"] = shapeSeen["13D"];
    ctx.extra["shape_seen_13g"] = shapeSeen["13G"];
    ctx.extra["sample_tags_13d"] = sampleTags["13D"];
    ctx.extra["sample_tags_13g"] = sampleTags["13G"];
    ctx.extra["retry"] = retry.slice(0, RETRY_LIST_MAX);
    ctx.extra["stopped_on_budget"] = stoppedOnBudget;
    ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
  };

  const get = async (url: string): Promise<string> => { c.requests++; return fetchText(url, reqOpts()); };
  const getJson = async <T>(url: string): Promise<T> => { c.requests++; return fetchJson<T>(url, reqOpts()); };

  const write = async (row: IndexRow, p: ParsedSchedule13): Promise<void> => {
    if (!p.issuerCik && !p.issuerName) { ctx.quarantine(row.accession, "parsed XML missing issuer identity"); return; }
    try {
      const payload = scrubDeep(toPayload13(p));
      const rules = scrubDeep(p.rules);
      const res = await sql`
        insert into schedule13_filings (
          accession, form_type, schedule, is_amendment, filed_at, issuer_cik, issuer_name, issuer_cusip,
          security_class, event_date, filer_cik, reporter_name, reporter_count, shares_owned, percent_of_class,
          rules, payload, source_url, parser_version
        ) values (
          ${row.accession}, ${row.form}, ${scheduleOf(row.form)}, ${isAmendment(row.form)}, ${row.filedAt}::date,
          ${p.issuerCik}, ${scrubDeep(p.issuerName)}, ${scrubDeep(p.issuerCusip)}, ${scrubDeep(p.securityClass)},
          ${p.eventDate}::date, ${p.filerCik}, ${scrubDeep(p.reporterName)}, ${p.personsOnForm}::int,
          ${p.sharesOwned}::numeric, ${p.percentOfClass}::numeric,
          (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${sql.json(rules as never)}::jsonb) x),
          ${sql.json(payload as never)}, ${noticeIndexUrl(p.issuerCik ?? row.cik, row.accession)}, ${PARSER_VERSION}
        )
        on conflict (accession) do update set
          form_type = excluded.form_type, schedule = excluded.schedule, is_amendment = excluded.is_amendment,
          filed_at = excluded.filed_at, issuer_cik = excluded.issuer_cik, issuer_name = excluded.issuer_name,
          issuer_cusip = excluded.issuer_cusip, security_class = excluded.security_class,
          event_date = excluded.event_date, filer_cik = excluded.filer_cik, reporter_name = excluded.reporter_name,
          reporter_count = excluded.reporter_count, shares_owned = excluded.shares_owned,
          percent_of_class = excluded.percent_of_class, rules = excluded.rules, payload = excluded.payload,
          source_url = excluded.source_url, parser_version = excluded.parser_version, updated_at = now()
          where schedule13_filings.parser_version < excluded.parser_version
        returning (xmax = 0) as inserted`;
      if (res.length === 0) { c.skipped_existing++; return; }
      if (res[0]!.inserted) c.stored++; else c.rewritten++;
      ctx.rowsChanged++;
      if (scheduleOf(row.form) === "13D") c.stored_13d++; else c.stored_13g++;
      if (isAmendment(row.form)) c.amendments++;
      if (p.issuerCik) c.with_issuer_cik++;
      if (p.issuerCusip) c.with_cusip++;
      if (p.securityClass) c.with_class++;
      if (p.eventDate) c.with_event_date++;
      if (p.filerCik) c.with_filer_cik++;
      if (p.reporterName) c.with_reporter++;
      if (p.sharesOwned != null) c.with_shares++;
      if (p.percentOfClass != null) c.with_percent++;
      if (p.personsOnForm > 1) c.with_several_persons++;
      if (p.persons.some((x) => x.cik)) c.with_person_cik++;
      if (p.rules.length) c.with_rules++;
      if (p.purpose) c.with_purpose++;
      if (p.personsOnForm > p.persons.length) c.persons_cut++;
    } catch (err) {
      // A database error on one statement is that statement's problem, not the SEC's.
      ctx.quarantine(row.accession, `write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Write now when the schedule's shape is proven; otherwise hold. Sets `fatal` on a failed guard. */
  const take = async (row: IndexRow, parsed: ParsedSchedule13): Promise<void> => {
    const k = scheduleOf(row.form);
    if (shapeSeen[k]) { await write(row, parsed); return; }
    pending[k].push({ row, parsed });
    if (hasShape13(parsed)) {
      shapeSeen[k] = true;
      for (const p of pending[k].splice(0)) await write(p.row, p.parsed);
    } else if (pending[k].length >= SHAPE_SAMPLE) {
      fatal = `the first ${pending[k].length} Schedule ${k} statements did not have the expected XML shape (issuer, reporting person, amount or percent); none of them was stored. See stats.sample_tags_${k.toLowerCase()}.`;
    }
  };

  // Resume point: newest day fully processed by an earlier run that got anywhere.
  const [prev] = await sql<{ through: string | null }[]>`
    select r.stats->>'through' as through
      from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.status in ('success', 'partial') and r.stats->>'through' is not null
       and coalesce((r.stats->>'parser_version')::int, 0) = ${PARSER_VERSION}
     order by r.id desc limit 1
  `;
  prevThrough = prev?.through && /^\d{4}-\d{2}-\d{2}$/.test(prev.through) ? prev.through : null;

  // Rows of this parser version already in the table prove a schedule's shape.
  for (const r of await sql<{ schedule: string }[]>`
    select distinct schedule from schedule13_filings where parser_version >= ${PARSER_VERSION}`) {
    if (r.schedule === "13D" || r.schedule === "13G") shapeSeen[r.schedule] = true;
  }

  // Submissions the newest earlier run of this parser version could not fetch.
  const [earlier] = await sql<{ retry: unknown }[]>`
    select r.stats->'retry' as retry
      from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.stats is not null and jsonb_typeof(r.stats->'retry') = 'array'
       and coalesce((r.stats->>'parser_version')::int, 0) = ${PARSER_VERSION}
     order by r.id desc limit 1
  `;
  const toRetry = readRetryList13(earlier?.retry);

  if (toRetry.length > 0) {
    const have = new Set<string>(
      (await sql`select accession from schedule13_filings where accession = any(${toRetry.map((e) => e.a)}) and parser_version >= ${PARSER_VERSION}`)
        .map((r) => String(r.accession)),
    );
    for (const e of toRetry) {
      if (have.has(e.a)) continue;
      if (outage.tripped || overBudget() || fatal) { retry.push(e); continue; }
      ctx.markSeen(e.a);
      c.retry_tried++;
      let submission: string;
      try {
        submission = await get(`${SEC_BASE}/Archives/${e.f}`);
        outage.ok();
      } catch (err) {
        lastFailure = err instanceof Error ? err.message : String(err);
        if (isNotFound(err)) { c.retry_given_up++; continue; }
        outage.fail();
        const n = (e.n ?? 0) + 1;
        if (n >= RETRY_MAX_TRIES) { c.retry_given_up++; ctx.warn(`gave up on ${e.a} after ${n} runs: ${lastFailure.slice(0, 120)}`); }
        else retry.push({ ...e, n });
        continue;
      }
      const head = parseSubmissionHeader13(submission);
      const form = head.form ?? e.t ?? null;
      const filedAt = head.filedAt ?? e.d ?? null;
      const xml = extractSchedule13Xml(submission);
      if (!form || !filedAt || !xml) { c.retry_given_up++; if (!xml) c.no_xml++; continue; }
      // A retried submission is only written once its schedule's shape is proven; until then it stays listed.
      if (!shapeSeen[scheduleOf(form)]) { retry.push(e); continue; }
      const cik = /edgar\/data\/(\d+)\//.exec(e.f)?.[1] ?? "0";
      const before = c.stored + c.rewritten;
      await write({ cik, form, filedAt, file: e.f, accession: e.a }, parseSchedule13Xml(xml, scheduleOf(form)));
      if (c.stored + c.rewritten > before) c.retry_stored++;
    }
    sync();
  }

  const today = new Date().toISOString().slice(0, 10);
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

    let rows: IndexRow[];
    try {
      const text = await get(`${SEC_BASE}${quarterListingPath(quarterOf(day))}/master.${day.replace(/-/g, "")}.idx`);
      rows = parseMasterIndex13(text);
    } catch (err) {
      outage.fail();
      lastFailure = err instanceof Error ? err.message : String(err);
      fatal = `could not read the master index for ${day}: ${lastFailure.slice(0, 160)}`;
      break;
    }
    c.listed += rows.length;

    const existing = new Set<string>();
    if (rows.length > 0) {
      const have = await sql`
        select accession from schedule13_filings
         where accession = any(${rows.map((r) => r.accession)}) and parser_version >= ${PARSER_VERSION}`;
      for (const r of have) existing.add(String(r.accession));
    }

    let dayDone = true;
    for (const row of rows) {
      if (existing.has(row.accession)) { c.skipped_existing++; continue; }
      if (overBudget()) { stoppedOnBudget = true; dayDone = false; break; }
      if (outage.tripped || fatal) { dayDone = false; break; }
      if (!ctx.markSeen(row.accession)) continue;
      ctx.rowsSeen++;

      let submission: string;
      try {
        submission = await get(`${SEC_BASE}/Archives/${row.file}`);
        outage.ok();
      } catch (err) {
        lastFailure = err instanceof Error ? err.message : String(err);
        if (!isNotFound(err)) {
          outage.fail();
          if (!retry.some((x) => x.a === row.accession)) retry.push({ a: row.accession, f: row.file, t: row.form, d: row.filedAt, n: 1 });
        }
        ctx.quarantine(row.accession, `submission not fetched: ${lastFailure.slice(0, 200)}`);
        sync();
        continue;
      }

      const xml = extractSchedule13Xml(submission);
      if (!xml) { c.no_xml++; continue; }
      const k = scheduleOf(row.form);
      if (!sampleTags[k]) sampleTags[k] = leafTags(xml, 120);
      await take(row, parseSchedule13Xml(xml, k));
      if (fatal) { dayDone = false; break; }
      sync();
    }

    if (!dayDone || stoppedOnBudget || outage.tripped || fatal) break;
    c.days_processed++;
    if (!completedThrough || day > completedThrough) completedThrough = day;
    sync();
  }

  // Statements still held when the walk ended on its own: their schedule never showed the shape.
  if (!fatal && held() > 0 && !stoppedOnBudget && !outage.tripped) {
    const which = (["13D", "13G"] as Schedule[]).filter((k) => pending[k].length > 0);
    fatal = `none of the ${held()} Schedule ${which.join(" and ")} statements held back had the expected XML shape (issuer, reporting person, amount or percent); they were not stored. See stats.sample_tags_*.`;
  }

  const stoppedOnOutage = outage.tripped || fatal != null;
  try {
    const [t] = await sql`
      select count(*)::int as n, count(*) filter (where schedule = '13D')::int as d,
             count(*) filter (where schedule = '13G')::int as g, count(distinct issuer_cik)::int as issuers,
             count(*) filter (where issuer_cik in (select cik from companies where tracked))::int as tracked,
             max(filed_at)::text as newest
        from schedule13_filings`;
    ctx.extra["table_rows"] = t?.n ?? 0;
    ctx.extra["table_rows_13d"] = t?.d ?? 0;
    ctx.extra["table_rows_13g"] = t?.g ?? 0;
    ctx.extra["table_issuers"] = t?.issuers ?? 0;
    ctx.extra["table_rows_tracked_issuers"] = t?.tracked ?? 0;
    ctx.extra["table_newest_filed"] = t?.newest ?? null;
  } catch (err) {
    ctx.warn(`could not count schedule13_filings: ${err instanceof Error ? err.message : String(err)}`);
  }
  sync();
  ctx.extra["held_unwritten"] = held();
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

// Allow running directly: `npx tsx src/sources/sec_schedule13.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSecSchedule13()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
