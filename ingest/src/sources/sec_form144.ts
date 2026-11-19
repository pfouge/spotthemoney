// Source: SEC Form 144 notices from the EDGAR daily index (queue item 8, stage 1, 2026-11-19).
//
// A Form 144 is the notice a holder files when they PROPOSE to sell restricted or control
// securities under Rule 144. It is not a report of a sale: the sale may follow later, in part,
// or not at all. Since April 2023 the form is filed on EDGAR as XML. This source stores one
// row per submission in `form144_notices` (migration 0029). Stage 1 stores only: nothing on
// the site reads the table yet.
//
// WHAT IT READS (the walk of sec_form4_index.ts, with another form type)
//   <base>/Archives/edgar/daily-index/<year>/QTR<n>/index.json        the day files that exist
//   <base>/Archives/edgar/daily-index/<year>/QTR<n>/master.YYYYMMDD.idx
//       form type exactly "144" or "144/A"; one request per accession for
//   <base>/Archives/<File Name>   the full submission text; the form's XML sits between <XML>
//       and </XML>.
//
// THE XML SHAPE WAS WRITTEN FROM MEMORY (sec.gov cannot be reached from where this was built).
// Three things make a wrong guess visible and repairable instead of silent:
//   * Shape guard. Nothing is written until one parsed notice names an issuer, a seller and a
//     number of units. If the first SHAPE_SAMPLE (20) notices do not, the run ends "failed",
//     stores nothing and does not move its resume point.
//   * stats.sample_tags lists the element names of the first notice read (names only, no
//     values), and stats.with_* count how many stored rows carry each field.
//   * PARSER_VERSION. A stored row is skipped only if it was written by this parser version or
//     a newer one, so after a parser fix (bump the constant) old rows are re-read in place.
//
// WHAT IT KEEPS. Issuer (CIK, name), the submission's filer CIK, the person for whose account
// the securities are to be sold, the stated relationships, class, units, aggregate market
// value, units outstanding, approximate sale date, exchange, broker name, Rule 10b5-1 plan
// adoption date, notice date, the acquisition lines and the "sold during the past 3 months"
// lines. Addresses, phone numbers and signatures are not stored.
//
// RESUME. ingest_runs.stats.through = the newest index day fully processed. The next run reads
// the REREAD_DAYS newest days at or before it again (stored accessions are skipped), then every
// later day. STOPPING. SEC_144_MAX_MINUTES (default 30) ends the run inside a day: that day is
// not marked processed, status "partial". Five request failures in a row end it "failed".
//
// Env: SEC_EDGAR_BASE (tests only, shared with sec_form4), SEC_144_SINCE (default the Form 4
// floor), SEC_144_MAX_MINUTES, SEC_144_MAX_CONSECUTIVE_FAILURES, SEC_144_RETRIES (tests).

import { fetchJson, fetchText } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { scrubDeep } from "../lib/sanitize.js";
import { FORM4_FLOOR, type IngestRunResult } from "@stm/shared";
import { SEC_BASE, sec, decodeXmlEntities, outageCounter } from "./sec_form4.js";
import { padCik } from "./sec_form4_bulk.js";
import {
  compactToIso, masterDaysFromListing, quarterFolders, quarterListingPath, daysToProcess, listingStart,
  type QuarterFolder,
} from "./sec_form4_index.js";

const SOURCE = "sec_form144";
/** Bump after a parser fix: rows stored by an older version are fetched and written again. */
export const PARSER_VERSION = 1;
export const DEFAULT_SINCE = FORM4_FLOOR;
/** Notices held back, unwritten, until one of them has the expected shape. */
export const SHAPE_SAMPLE = 20;
const TEXT_MAX = 300;
const REMARKS_MAX = 1000;
const LINES_MAX = 50;

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (tested in sec_form144.test.ts)
// ──────────────────────────────────────────────────────────────────────────

export interface Index144Row {
  cik: string;
  form: "144" | "144/A";
  /** YYYY-MM-DD */
  filedAt: string;
  file: string;
  accession: string;
}

/** Rows of a master.YYYYMMDD.idx file whose form type is exactly 144 or 144/A, one per accession. */
export function parseMasterIndex144(text: string): Index144Row[] {
  const out: Index144Row[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split("|");
    if (cells.length !== 5) continue;
    const [cik, , form, date, file] = cells.map((c) => c.trim()) as [string, string, string, string, string];
    if (form !== "144" && form !== "144/A") continue;
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

const open = (name: string) => `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>`;
const close = (name: string) => `</(?:[\\w.-]+:)?${name}\\s*>`;

/** Inner text of every `<name>...</name>` element, any namespace prefix, any letter case. */
export function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`${open(name)}([\\s\\S]*?)${close(name)}`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!);
  return out;
}

/** Clean text: tags inside dropped, XML escapes undone, white space collapsed, cut at `max`. */
export function cleanText(s: string | null | undefined, max = TEXT_MAX): string | null {
  if (s == null) return null;
  const t = decodeXmlEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** Text of the first non-empty element among `names` inside `xml`. */
export function leaf(xml: string, ...names: string[]): string | null {
  for (const n of names) {
    for (const b of blocks(xml, n)) {
      const t = cleanText(b);
      if (t) return t;
    }
  }
  return null;
}

/** A calendar date from `MM/DD/YYYY`, `MM-DD-YYYY` or `YYYY-MM-DD`; null for anything else. */
export function parseFormDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; }
  else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
    if (!m) return null;
    mo = +m[1]!; d = +m[2]!; y = +m[3]!;
  }
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A non-negative number from "1,234.50" or "$1,234.50"; null for anything else. */
export function parseAmount(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = s.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function yes(s: string | null): boolean | null {
  if (s == null) return null;
  if (/^(y|yes|true|1)$/i.test(s)) return true;
  if (/^(n|no|false|0)$/i.test(s)) return false;
  return null;
}

/** The Form 144 XML inside a full submission text, or null when the submission has none. */
export function extractForm144Xml(submission: string): string | null {
  const re = /<XML>([\s\S]*?)<\/XML>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(submission))) {
    const body = m[1]!.trim();
    if (new RegExp(open("issuerInfo"), "i").test(body) || new RegExp(open("securitiesInformation"), "i").test(body)) return body;
  }
  return null;
}

/** Names of the elements that hold text, in document order, without namespace prefixes. */
export function leafTags(xml: string, max = 80): string[] {
  const re = /<(?:[\w.-]+:)?([A-Za-z][\w.-]*)(?:\s[^>]*)?>[^<]+<\//g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && seen.size < max) seen.add(m[1]!);
  return [...seen];
}

export interface SecurityLine {
  class: string | null; broker: string | null; units: number | null; value: number | null;
  outstanding: number | null; sale_date: string | null; exchange: string | null;
}
export interface AcquiredLine {
  class: string | null; acquired_date: string | null; nature: string | null; from: string | null;
  gift: boolean | null; amount: number | null; payment_date: string | null; payment: string | null;
}
export interface SoldLine {
  seller: string | null; class: string | null; sale_date: string | null; amount: number | null; proceeds: number | null;
}

export interface ParsedForm144 {
  issuerCik: string | null;
  issuerName: string | null;
  filerCik: string | null;
  sellerName: string | null;
  relationships: string[];
  securities: SecurityLine[];
  acquired: AcquiredLine[];
  sold: SoldLine[];
  nothingSold: boolean | null;
  remarks: string | null;
  noticeDate: string | null;
  planAdoptionDates: string[];
  // Summed or first-of, for the table's columns:
  securityClass: string | null;
  shares: number | null;
  marketValue: number | null;
  sharesOutstanding: number | null;
  approxSaleDate: string | null;
  exchange: string | null;
  broker: string | null;
  planAdoptionDate: string | null;
  sold3mShares: number | null;
  sold3mProceeds: number | null;
}

function sum(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}
function earliest(values: (string | null)[]): string | null {
  const v = values.filter((x): x is string => x != null).sort();
  return v[0] ?? null;
}
function cikOf(s: string | null): string | null {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d && d.length <= 10 && Number(d) > 0 ? padCik(d) : null;
}

export function parseForm144Xml(xml: string): ParsedForm144 {
  const issuerBlock = blocks(xml, "issuerInfo")[0] ?? xml;
  const header = blocks(xml, "headerData")[0] ?? "";
  const filerCik = cikOf(leaf(blocks(header, "filerCredentials")[0] ?? header, "cik"));

  const relationships: string[] = [];
  for (const r of blocks(issuerBlock, "relationshipToIssuer")) {
    const t = cleanText(r, 60);
    if (t && !relationships.includes(t) && relationships.length < 10) relationships.push(t);
  }

  const securities: SecurityLine[] = blocks(xml, "securitiesInformation").slice(0, LINES_MAX).map((b) => ({
    class: leaf(b, "securitiesClassTitle"),
    broker: leaf(blocks(b, "brokerOrMarketmakerDetails")[0] ?? "", "name"),
    units: parseAmount(leaf(b, "noOfUnitsSold")),
    value: parseAmount(leaf(b, "aggregateMarketValue")),
    outstanding: parseAmount(leaf(b, "noOfUnitsOutstanding")),
    sale_date: parseFormDate(leaf(b, "approxSaleDate")),
    exchange: leaf(b, "securitiesExchangeName"),
  }));

  const acquired: AcquiredLine[] = blocks(xml, "securitiesToBeSold").slice(0, LINES_MAX).map((b) => ({
    class: leaf(b, "securitiesClassTitle"),
    acquired_date: parseFormDate(leaf(b, "acquiredDate")),
    nature: leaf(b, "natureOfAcquisitionTransaction"),
    from: leaf(b, "nameOfPersonfromWhomAcquired"),
    gift: yes(leaf(b, "isGiftTransaction")),
    amount: parseAmount(leaf(b, "amountOfSecuritiesAcquired")),
    payment_date: parseFormDate(leaf(b, "paymentDate")),
    payment: leaf(b, "natureOfPayment"),
  }));

  const sold: SoldLine[] = blocks(xml, "securitiesSoldInPast3Months").slice(0, LINES_MAX).map((b) => ({
    seller: leaf(blocks(b, "sellerDetails")[0] ?? "", "name"),
    class: leaf(b, "securitiesClassTitle"),
    sale_date: parseFormDate(leaf(b, "saleDate")),
    amount: parseAmount(leaf(b, "amountOfSecuritiesSold")),
    proceeds: parseAmount(leaf(b, "grossProceeds")),
  }));

  const signature = blocks(xml, "noticeSignature")[0] ?? xml;
  const planAdoptionDates = blocks(signature, "planAdoptionDate")
    .map((d) => parseFormDate(cleanText(d)))
    .filter((d): d is string => d != null)
    .slice(0, 10);

  return {
    issuerCik: cikOf(leaf(issuerBlock, "issuerCik")),
    issuerName: leaf(issuerBlock, "issuerName"),
    filerCik,
    sellerName: leaf(issuerBlock, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold"),
    relationships,
    securities,
    acquired,
    sold,
    nothingSold: yes(leaf(xml, "nothingToReportFlagOnSecuritiesSoldInPast3Months")),
    remarks: cleanText(blocks(xml, "remarks")[0], REMARKS_MAX),
    noticeDate: parseFormDate(leaf(signature, "noticeDate")),
    planAdoptionDates,
    securityClass: securities.find((s) => s.class)?.class ?? null,
    shares: sum(securities.map((s) => s.units)),
    marketValue: sum(securities.map((s) => s.value)),
    sharesOutstanding: securities.find((s) => s.outstanding != null)?.outstanding ?? null,
    approxSaleDate: earliest(securities.map((s) => s.sale_date)),
    exchange: securities.find((s) => s.exchange)?.exchange ?? null,
    broker: securities.find((s) => s.broker)?.broker ?? null,
    planAdoptionDate: earliest(planAdoptionDates),
    sold3mShares: sum(sold.map((s) => s.amount)),
    sold3mProceeds: sum(sold.map((s) => s.proceeds)),
  };
}

/** The shape the parser was written for: an issuer, a seller and a number of units. */
export function hasShape(p: ParsedForm144): boolean {
  return Boolean((p.issuerCik || p.issuerName) && p.sellerName && p.shares != null);
}

/** What goes into `payload`: the form's lines as parsed, nothing with an address or phone number. */
export function toPayload(p: ParsedForm144) {
  return {
    securities: p.securities,
    acquired: p.acquired,
    sold_past_3_months: p.sold,
    remarks: p.remarks,
    plan_adoption_dates: p.planAdoptionDates,
  };
}

export function noticeIndexUrl(cik: string, accession: string): string {
  const bare = cik.replace(/^0+/, "") || "0";
  return `https://www.sec.gov/Archives/edgar/data/${bare}/${accession.replace(/-/g, "")}/${accession}-index.htm`;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /HTTP 404\b/.test(err.message);
}

// ──────────────────────────────────────────────────────────────────────────
// The job
// ──────────────────────────────────────────────────────────────────────────

export async function ingestSecForm144(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE, 300);
  const startedAt = Date.now();

  const since = process.env.SEC_144_SINCE ?? DEFAULT_SINCE;
  const budgetMin = Number(process.env.SEC_144_MAX_MINUTES ?? 30);
  const budgetMs = Number.isFinite(budgetMin) && budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const outageLimit = Number(process.env.SEC_144_MAX_CONSECUTIVE_FAILURES ?? 5);
  const outage = outageCounter(Number.isFinite(outageLimit) ? outageLimit : 5);
  const retriesEnv = process.env.SEC_144_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;
  const reqOpts = () => ({ ...sec(), ...(retries != null ? { retries } : {}) });

  const c = {
    days_listed: 0, days_processed: 0, notices_listed: 0, notices_skipped_existing: 0, notices_stored: 0,
    notices_rewritten: 0, amendments: 0, no_xml: 0, requests: 0, dates_unreadable: 0,
    with_issuer_cik: 0, with_filer_cik: 0, with_seller: 0, with_relationship: 0, with_shares: 0, with_value: 0,
    with_sale_date: 0, with_broker: 0, with_plan_date: 0, with_acquired_lines: 0, with_sold_lines: 0,
  };
  let prevThrough: string | null = null;
  let completedThrough: string | null = null;
  let shapeSeen = false;
  let sampleTags: string[] | null = null;
  let stoppedOnBudget = false;
  let fatal: string | null = null;
  let lastFailure = "";
  const pending: { row: Index144Row; parsed: ParsedForm144 }[] = [];

  // The resume point only moves past days whose notices are actually written.
  const through = () => (shapeSeen || pending.length === 0 ? completedThrough ?? prevThrough : prevThrough);
  const sync = () => {
    Object.assign(ctx.extra, c);
    ctx.extra["through"] = through();
    ctx.extra["since"] = since;
    ctx.extra["parser_version"] = PARSER_VERSION;
    ctx.extra["shape_seen"] = shapeSeen;
    ctx.extra["sample_tags"] = sampleTags;
    ctx.extra["stopped_on_budget"] = stoppedOnBudget;
    ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
  };

  const get = async (url: string): Promise<string> => { c.requests++; return fetchText(url, reqOpts()); };
  const getJson = async <T>(url: string): Promise<T> => { c.requests++; return fetchJson<T>(url, reqOpts()); };

  const write = async (row: Index144Row, p: ParsedForm144): Promise<void> => {
    if (!p.issuerCik && !p.issuerName) { ctx.quarantine(row.accession, "parsed XML missing issuer identity"); return; }
    try {
      const payload = scrubDeep(toPayload(p));
      const rels = scrubDeep(p.relationships);
      const res = await sql`
        insert into form144_notices (
          accession, form_type, filed_at, issuer_cik, issuer_name, filer_cik, seller_name, relationships,
          security_class, shares, market_value, shares_outstanding, approx_sale_date, exchange, broker,
          plan_adoption_date, notice_date, sold_3m_shares, sold_3m_proceeds, nothing_sold_3m,
          payload, source_url, parser_version
        ) values (
          ${row.accession}, ${row.form}, ${row.filedAt}::date, ${p.issuerCik}, ${scrubDeep(p.issuerName)}, ${p.filerCik},
          ${scrubDeep(p.sellerName)},
          (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${sql.json(rels as never)}::jsonb) x),
          ${scrubDeep(p.securityClass)}, ${p.shares}::numeric, ${p.marketValue}::numeric, ${p.sharesOutstanding}::numeric,
          ${p.approxSaleDate}::date, ${scrubDeep(p.exchange)}, ${scrubDeep(p.broker)},
          ${p.planAdoptionDate}::date, ${p.noticeDate}::date, ${p.sold3mShares}::numeric, ${p.sold3mProceeds}::numeric,
          ${p.nothingSold}::boolean, ${sql.json(payload as never)}, ${noticeIndexUrl(p.issuerCik ?? row.cik, row.accession)},
          ${PARSER_VERSION}
        )
        on conflict (accession) do update set
          form_type = excluded.form_type, filed_at = excluded.filed_at, issuer_cik = excluded.issuer_cik,
          issuer_name = excluded.issuer_name, filer_cik = excluded.filer_cik, seller_name = excluded.seller_name,
          relationships = excluded.relationships, security_class = excluded.security_class, shares = excluded.shares,
          market_value = excluded.market_value, shares_outstanding = excluded.shares_outstanding,
          approx_sale_date = excluded.approx_sale_date, exchange = excluded.exchange, broker = excluded.broker,
          plan_adoption_date = excluded.plan_adoption_date, notice_date = excluded.notice_date,
          sold_3m_shares = excluded.sold_3m_shares, sold_3m_proceeds = excluded.sold_3m_proceeds,
          nothing_sold_3m = excluded.nothing_sold_3m, payload = excluded.payload, source_url = excluded.source_url,
          parser_version = excluded.parser_version, updated_at = now()
          where form144_notices.parser_version < excluded.parser_version
        returning (xmax = 0) as inserted`;
      if (res.length === 0) { c.notices_skipped_existing++; return; }
      if (res[0]!.inserted) c.notices_stored++; else c.notices_rewritten++;
      ctx.rowsChanged++;
      if (row.form === "144/A") c.amendments++;
      if (p.issuerCik) c.with_issuer_cik++;
      if (p.filerCik) c.with_filer_cik++;
      if (p.sellerName) c.with_seller++;
      if (p.relationships.length) c.with_relationship++;
      if (p.shares != null) c.with_shares++;
      if (p.marketValue != null) c.with_value++;
      if (p.approxSaleDate) c.with_sale_date++;
      if (p.broker) c.with_broker++;
      if (p.planAdoptionDate) c.with_plan_date++;
      if (p.acquired.length) c.with_acquired_lines++;
      if (p.sold.length) c.with_sold_lines++;
      if (p.securities.length > 0 && !p.approxSaleDate) c.dates_unreadable++;
    } catch (err) {
      // A database error on one notice is that notice's problem, not the SEC's.
      ctx.quarantine(row.accession, `write failed: ${err instanceof Error ? err.message : String(err)}`);
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

    let rows: Index144Row[];
    try {
      const text = await get(`${SEC_BASE}${quarterListingPath(quarterOf(day))}/master.${day.replace(/-/g, "")}.idx`);
      rows = parseMasterIndex144(text);
    } catch (err) {
      outage.fail();
      lastFailure = err instanceof Error ? err.message : String(err);
      fatal = `could not read the master index for ${day}: ${lastFailure.slice(0, 160)}`;
      break;
    }
    c.notices_listed += rows.length;

    const existing = new Set<string>();
    if (rows.length > 0) {
      const have = await sql`
        select accession from form144_notices
         where accession = any(${rows.map((r) => r.accession)}) and parser_version >= ${PARSER_VERSION}`;
      for (const r of have) existing.add(String(r.accession));
    }

    let dayDone = true;
    for (const row of rows) {
      if (existing.has(row.accession)) { c.notices_skipped_existing++; continue; }
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
        if (!isNotFound(err)) outage.fail();
        ctx.quarantine(row.accession, `submission not fetched: ${lastFailure.slice(0, 200)}`);
        sync();
        continue;
      }

      const xml = extractForm144Xml(submission);
      if (!xml) {
        // A notice filed as a document with no data file. Counted, not quarantined: before the
        // shape is proven this must not stand in for "the parser is wrong" either way.
        c.no_xml++;
        continue;
      }
      if (!sampleTags) sampleTags = leafTags(xml);
      const parsed = parseForm144Xml(xml);

      if (!shapeSeen) {
        pending.push({ row, parsed });
        if (hasShape(parsed)) {
          shapeSeen = true;
          for (const p of pending.splice(0)) await write(p.row, p.parsed);
        } else if (pending.length >= SHAPE_SAMPLE) {
          fatal = `the first ${pending.length} Form 144 notices did not have the expected XML shape (issuer, seller, units); nothing was stored. See stats.sample_tags.`;
          dayDone = false;
          break;
        }
      } else {
        await write(row, parsed);
      }
      sync();
    }

    if (!dayDone || stoppedOnBudget || outage.tripped || fatal) break;
    c.days_processed++;
    if (!completedThrough || day > completedThrough) completedThrough = day;
    sync();
  }

  // Fewer than SHAPE_SAMPLE notices in the whole run and none with the shape: do not store them.
  if (!fatal && !shapeSeen && pending.length > 0 && !stoppedOnBudget && !outage.tripped) {
    fatal = `none of the ${pending.length} Form 144 notices read had the expected XML shape (issuer, seller, units); nothing was stored. See stats.sample_tags.`;
  }

  const stoppedOnOutage = outage.tripped || fatal != null;
  try {
    const [t] = await sql`
      select count(*)::int as notices, count(distinct issuer_cik)::int as issuers,
             count(*) filter (where issuer_cik in (select cik from companies where tracked))::int as tracked_notices,
             max(filed_at)::text as newest
        from form144_notices`;
    ctx.extra["table_rows"] = t?.notices ?? 0;
    ctx.extra["table_issuers"] = t?.issuers ?? 0;
    ctx.extra["table_rows_tracked_issuers"] = t?.tracked_notices ?? 0;
    ctx.extra["table_newest_filed"] = t?.newest ?? null;
  } catch (err) {
    ctx.warn(`could not count form144_notices: ${err instanceof Error ? err.message : String(err)}`);
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

// Allow running directly: `npx tsx src/sources/sec_form144.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSecForm144()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
