// Source: SEC "Insider Transactions Data Sets" (quarterly ZIPs of tab-separated tables) — every
// Form 4 filed market-wide, loaded WITHOUT changing the built site. Stage 1 of market-wide Form 4.
//
// INPUT: env SEC_BULK_DIR, a folder holding one unzipped folder per quarter (for example
// `2026q3_form345`), or the table files themselves. No network here: the form4-bulk workflow
// downloads and unzips. Tables are found by name (SUBMISSION, REPORTINGOWNER, NONDERIV_TRANS,
// DERIV_TRANS), case-insensitive, with or without a .tsv/.txt extension; columns are found by
// header name, never by position. A missing optional column is tolerated and counted; a missing
// required column fails the run with a message naming it.
//
// WHAT IS KEPT: DOCUMENT_TYPE exactly "4" (not 4/A, not Forms 3 and 5), filed on or after
// FORM4_FLOOR, and not already stored (filings.external_id = the dashed accession number).
// The first REPORTINGOWNER row of an accession is the filer, as in the XML path.
//
// WHAT IS WRITTEN: the same rows the XML path (sec_form4) writes, with the same mapping and
// the same payload shape and order (non-derivative rows first, then derivative), so the site
// code that joins payload entries to transaction rows by position keeps working. Differences,
// all on purpose:
//   - companies the bulk load creates get tracked = false; existing companies are left alone.
//   - securities the bulk load creates get is_active = false; existing ones are left alone.
//   - a filing is scope 'market' unless its company is tracked ('tracked' otherwise).
//   - no raw_documents row (no XML is downloaded), source_url points at the EDGAR filing index.
//   - a person whose name slug is taken gets a CIK-suffixed slug instead of being quarantined.
// The site never sees market-scope rows: see db/migrations/0019_form4_market_scope.sql.
//
// SAFETY: writes are batched (one transaction per BATCH filings; a failed batch is retried one
// filing at a time, a bad filing is quarantined, 300 quarantined filings end the run).
// SEC_BULK_MAX_MINUTES (default 40) ends the run as "partial"; re-running resumes because
// stored accessions are skipped.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { FORM4_FLOOR } from "@stm/shared";
import type { IngestRunResult } from "@stm/shared";
import { codeToSide, decodeXmlEntities, guardFutureTxnDate, isoDateDiffDays, primaryTicker, slugifyCompany, slugifyName } from "./sec_form4.js";

const SOURCE = "sec_form4_bulk";
const BATCH = 300;

// ──────────────────────────────────────────────────────────────────────────
// Reading (pure parts are exported for tests)
// ──────────────────────────────────────────────────────────────────────────

export interface BulkTxn {
  isDerivative: boolean;
  code: string | null;
  date: string | null;
  shares: number | null;
  price: number | null;
  sharesOwnedAfter: number | null;
  ownership: string | null;
}

export interface BulkFiling {
  accession: string;
  filingDate: string;
  issuerCik: string;
  issuerName: string;
  issuerSymbol: string | null;
  aff10b5One: boolean;
  owner: { cik: string; name: string; relationship: string; title: string | null } | null;
  txns: BulkTxn[];
}

export interface ReadStats {
  nonForm4Dropped: number;
  preFloorDropped: number;
  skippedExisting: number;
  filingsKept: number;
  missingOptional: string[];
  rowsWithoutFiling: number;
}

export const REQUIRED = {
  SUBMISSION: ["ACCESSION_NUMBER", "FILING_DATE", "DOCUMENT_TYPE", "ISSUERCIK", "ISSUERNAME", "ISSUERTRADINGSYMBOL"],
  REPORTINGOWNER: ["ACCESSION_NUMBER", "RPTOWNERCIK", "RPTOWNERNAME"],
  NONDERIV_TRANS: ["ACCESSION_NUMBER", "TRANS_CODE"],
  DERIV_TRANS: ["ACCESSION_NUMBER", "TRANS_CODE"],
} as const;

export const OPTIONAL = {
  SUBMISSION: ["AFF10B5ONE"],
  REPORTINGOWNER: ["RPTOWNER_RELATIONSHIP", "RPTOWNER_TITLE"],
  NONDERIV_TRANS: ["TRANS_DATE", "TRANS_SHARES", "TRANS_PRICEPERSHARE", "SHRS_OWND_FOLWNG_TRANS", "DIRECT_INDIRECT_OWNERSHIP"],
  DERIV_TRANS: ["TRANS_DATE", "TRANS_SHARES", "TRANS_PRICEPERSHARE", "SHRS_OWND_FOLWNG_TRANS", "DIRECT_INDIRECT_OWNERSHIP"],
} as const;

type TableName = keyof typeof REQUIRED;

/** Split one tab-separated line (a trailing CR from CRLF files is dropped). */
export function splitLine(line: string): string[] {
  return line.replace(/\r$/, "").split("\t");
}

/**
 * Map header names to column positions, case-insensitively. Throws naming every missing required
 * column; returns the optional ones that are absent so the caller can count them.
 */
export function headerIndex(
  headerLine: string,
  required: readonly string[],
  optional: readonly string[],
  table = "table",
): { idx: Record<string, number>; missingOptional: string[] } {
  const names = splitLine(headerLine).map((h) => h.trim().replace(/^﻿/, "").toUpperCase());
  const idx: Record<string, number> = {};
  names.forEach((n, i) => { if (!(n in idx)) idx[n] = i; });
  const missingRequired = required.filter((c) => !(c in idx));
  if (missingRequired.length > 0) {
    throw new Error(`${table}: required column(s) not found in the header: ${missingRequired.join(", ")} (header has: ${names.join(", ").slice(0, 300)})`);
  }
  return { idx, missingOptional: optional.filter((c) => !(c in idx)).map((c) => `${table}.${c}`) };
}

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "05-NOV-2026" or "2026-11-05" -> "2026-11-05"; anything else -> null. */
export function parseBulkDate(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  let m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (m) {
    const mm = MONTHS[m[2]!.toUpperCase()];
    return mm ? `${m[3]}-${mm}-${m[1]!.padStart(2, "0")}` : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function toNum(s: string | null | undefined): number | null {
  const v = (s ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** CIKs are stored zero-padded to ten digits, as EDGAR writes them in the ownership XML. */
export function padCik(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  return /^\d{1,10}$/.test(v) ? v.padStart(10, "0") : v;
}

export function parseFlag(s: string | null | undefined): boolean {
  return /^(1|true|y|yes)$/i.test((s ?? "").trim());
}

function clean(s: string | undefined): string {
  return decodeXmlEntities((s ?? "").trim());
}

/** The table file for `name` inside `dir`: name matched case-insensitively, extension optional. */
export function findTableFile(dir: string, name: string): string | null {
  const want = name.toLowerCase();
  for (const f of fs.readdirSync(dir)) {
    const base = f.toLowerCase().replace(/\.(tsv|txt|csv)$/, "");
    if (base === want && fs.statSync(path.join(dir, f)).isFile()) return path.join(dir, f);
  }
  return null;
}

async function* tableRows(file: string): AsyncGenerator<string[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) if (line.length > 0) yield splitLine(line);
}

/** Read a table: yields rows as arrays; the first yielded value is the header index result. */
async function readTable(
  dir: string,
  table: TableName,
  stats: ReadStats,
  each: (row: string[], idx: Record<string, number>) => void,
  tolerateMissingFile = false,
): Promise<boolean> {
  const file = findTableFile(dir, table);
  if (!file) {
    if (tolerateMissingFile) { stats.missingOptional.push(`${table} (file)`); return false; }
    throw new Error(`${dir}: table file ${table} not found (looked for ${table}[.tsv|.txt], case-insensitive)`);
  }
  let idx: Record<string, number> | null = null;
  for await (const row of tableRows(file)) {
    if (!idx) {
      const h = headerIndex(row.join("\t"), REQUIRED[table], OPTIONAL[table], table);
      idx = h.idx;
      for (const m of h.missingOptional) if (!stats.missingOptional.includes(m)) stats.missingOptional.push(m);
      continue;
    }
    each(row, idx);
  }
  return true;
}

function cell(row: string[], idx: Record<string, number>, col: string): string | undefined {
  const i = idx[col];
  return i === undefined ? undefined : row[i];
}

/**
 * Read one quarter folder into filings: Form 4 only, on or after `floor`, not `skip`ped.
 * The first REPORTINGOWNER row per accession is the filer.
 */
export async function readQuarter(
  dir: string,
  opts: { floor: string; skip: (accession: string) => boolean },
): Promise<{ filings: BulkFiling[]; stats: ReadStats }> {
  const stats: ReadStats = { nonForm4Dropped: 0, preFloorDropped: 0, skippedExisting: 0, filingsKept: 0, missingOptional: [], rowsWithoutFiling: 0 };
  const wanted = new Map<string, BulkFiling>();

  await readTable(dir, "SUBMISSION", stats, (row, idx) => {
    const type = (cell(row, idx, "DOCUMENT_TYPE") ?? "").trim();
    if (type !== "4") { stats.nonForm4Dropped++; return; }
    const accession = (cell(row, idx, "ACCESSION_NUMBER") ?? "").trim();
    const filingDate = parseBulkDate(cell(row, idx, "FILING_DATE"));
    if (!accession || !filingDate) { stats.nonForm4Dropped++; return; }
    if (filingDate < opts.floor) { stats.preFloorDropped++; return; }
    if (opts.skip(accession)) { stats.skippedExisting++; return; }
    if (wanted.has(accession)) return;
    const sym = clean(cell(row, idx, "ISSUERTRADINGSYMBOL"));
    wanted.set(accession, {
      accession,
      filingDate,
      issuerCik: padCik(cell(row, idx, "ISSUERCIK")),
      issuerName: clean(cell(row, idx, "ISSUERNAME")),
      issuerSymbol: sym || null,
      aff10b5One: parseFlag(cell(row, idx, "AFF10B5ONE")),
      owner: null,
      txns: [],
    });
  });

  await readTable(dir, "REPORTINGOWNER", stats, (row, idx) => {
    const f = wanted.get((cell(row, idx, "ACCESSION_NUMBER") ?? "").trim());
    if (!f || f.owner) return;
    f.owner = {
      cik: padCik(cell(row, idx, "RPTOWNERCIK")),
      name: clean(cell(row, idx, "RPTOWNERNAME")),
      relationship: clean(cell(row, idx, "RPTOWNER_RELATIONSHIP")),
      title: clean(cell(row, idx, "RPTOWNER_TITLE")) || null,
    };
  });

  const nonDeriv = new Map<string, BulkTxn[]>();
  const deriv = new Map<string, BulkTxn[]>();
  const collect = (into: Map<string, BulkTxn[]>, isDerivative: boolean) => (row: string[], idx: Record<string, number>) => {
    const acc = (cell(row, idx, "ACCESSION_NUMBER") ?? "").trim();
    if (!wanted.has(acc)) { stats.rowsWithoutFiling++; return; }
    const own = (cell(row, idx, "DIRECT_INDIRECT_OWNERSHIP") ?? "").trim().toUpperCase();
    const t: BulkTxn = {
      isDerivative,
      code: (cell(row, idx, "TRANS_CODE") ?? "").trim() || null,
      date: parseBulkDate(cell(row, idx, "TRANS_DATE")),
      shares: toNum(cell(row, idx, "TRANS_SHARES")),
      price: toNum(cell(row, idx, "TRANS_PRICEPERSHARE")),
      sharesOwnedAfter: toNum(cell(row, idx, "SHRS_OWND_FOLWNG_TRANS")),
      ownership: own || null,
    };
    let list = into.get(acc);
    if (!list) into.set(acc, (list = []));
    list.push(t);
  };
  await readTable(dir, "NONDERIV_TRANS", stats, collect(nonDeriv, false));
  await readTable(dir, "DERIV_TRANS", stats, collect(deriv, true), true);

  for (const [acc, f] of wanted) f.txns = [...(nonDeriv.get(acc) ?? []), ...(deriv.get(acc) ?? [])];
  stats.filingsKept = wanted.size;
  return { filings: [...wanted.values()], stats };
}

/** The stored payload: the XML path's shape and order (non-derivative rows first). */
export function toPayload(f: BulkFiling) {
  const rel = f.owner?.relationship ?? "";
  return {
    accession: f.accession,
    issuer: { cik: f.issuerCik, name: f.issuerName, ticker: f.issuerSymbol },
    owner: { cik: f.owner?.cik ?? null, name: f.owner?.name ?? null },
    relationship: {
      isDirector: /director/i.test(rel),
      isOfficer: /officer/i.test(rel),
      officerTitle: f.owner?.title ?? null,
    },
    footnotes: [] as string[],
    aff10b5One: f.aff10b5One,
    transactions: f.txns.map((t) => ({
      code: t.code, date: t.date, shares: t.shares, price: t.price,
      sharesOwnedAfter: t.sharesOwnedAfter, ownership: t.ownership, isDerivative: t.isDerivative,
    })),
  };
}

export function filingIndexUrl(f: BulkFiling): string {
  const cik = f.issuerCik.replace(/^0+/, "") || "0";
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${f.accession.replace(/-/g, "")}/${f.accession}-index.htm`;
}

/** Quarter folders under `root` (sorted), or `root` itself when it holds the tables directly. */
export function quarterDirs(root: string): string[] {
  if (findTableFile(root, "SUBMISSION")) return [root];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .filter((d) => findTableFile(d, "SUBMISSION") !== null)
    .sort();
}

// ──────────────────────────────────────────────────────────────────────────
// Writing
// ──────────────────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof getDb>;

interface WriteCounts {
  filingsInserted: number; filingsTracked: number; filingsMarket: number; transactions: number;
  companiesCreated: number; peopleCreated: number; securitiesCreated: number; tickerConflicts: number;
  futureDatesNulled: number;
}

const newCounts = (): WriteCounts => ({ filingsInserted: 0, filingsTracked: 0, filingsMarket: 0, transactions: 0, companiesCreated: 0, peopleCreated: 0, securitiesCreated: 0, tickerConflicts: 0, futureDatesNulled: 0 });

/** Why a filing cannot be written at all (checked before touching the database). */
export function invalidReason(f: BulkFiling): string | null {
  if (!f.issuerCik) return "no issuer CIK";
  if (!f.issuerName) return "no issuer name";
  if (!f.owner) return "no reporting owner row";
  if (!f.owner.cik) return "reporting owner has no CIK";
  if (!f.owner.name) return "reporting owner has no name";
  return null;
}

/** One transaction (several hundred filings) in a single database transaction. */
async function writeBatch(sql: Sql, filings: BulkFiling[], counts: WriteCounts): Promise<void> {
  await sql.begin(async (tx) => {
    // ── companies
    const compByCik = new Map<string, { name: string; ticker: string | null }>();
    for (const f of filings) if (!compByCik.has(f.issuerCik)) compByCik.set(f.issuerCik, { name: f.issuerName, ticker: primaryTicker(f.issuerSymbol) });
    const ciks = [...compByCik.keys()];
    const existingC = await tx`select cik from companies where cik = any(${ciks}::text[])`;
    const haveC = new Set(existingC.map((r) => String(r.cik)));
    const newC = ciks.filter((c) => !haveC.has(c));
    if (newC.length > 0) {
      const usedSlugs = new Set<string>();
      const slugs = newC.map((c) => {
        let s = slugifyCompany(compByCik.get(c)!.name, c);
        if (usedSlugs.has(s)) s = `cik-${c}`;
        usedSlugs.add(s);
        return s;
      });
      const made = await tx`
        insert into companies (name, cik, primary_ticker, slug, tracked)
        select x.name, x.cik, nullif(x.ticker, '')::citext,
               (case when exists (select 1 from companies c2 where c2.slug = x.slug::citext) then 'cik-' || x.cik else x.slug end)::citext,
               false
          from unnest(${newC.map((c) => compByCik.get(c)!.name)}::text[], ${newC}::text[],
                      ${newC.map((c) => compByCik.get(c)!.ticker ?? "")}::text[], ${slugs}::text[]) as x(name, cik, ticker, slug)
        on conflict (cik) do nothing
        returning id`;
      counts.companiesCreated += made.length;
    }
    const compRows = await tx`select id, cik, tracked from companies where cik = any(${ciks}::text[])`;
    const company = new Map<string, { id: number; tracked: boolean }>();
    for (const r of compRows) company.set(String(r.cik), { id: Number(r.id), tracked: Boolean(r.tracked) });

    // ── people
    const personByCik = new Map<string, string>();
    for (const f of filings) if (!personByCik.has(f.owner!.cik)) personByCik.set(f.owner!.cik, f.owner!.name);
    const pciks = [...personByCik.keys()];
    const existingP = await tx`select cik from people where cik = any(${pciks}::text[])`;
    const haveP = new Set(existingP.map((r) => String(r.cik)));
    const newP = pciks.filter((c) => !haveP.has(c));
    if (newP.length > 0) {
      const usedSlugs = new Set<string>();
      const slugs = newP.map((c) => {
        let s = slugifyName(personByCik.get(c)!) || `person-${c}`;
        if (usedSlugs.has(s)) s = `${s}-${c}`;
        usedSlugs.add(s);
        return s;
      });
      const made = await tx`
        insert into people (full_name, cik, slug)
        select x.name, x.cik,
               (case when exists (select 1 from people p2 where p2.slug = x.slug::citext) then x.slug || '-' || x.cik else x.slug end)::citext
          from unnest(${newP.map((c) => personByCik.get(c)!)}::text[], ${newP}::text[], ${slugs}::text[]) as x(name, cik, slug)
        on conflict (cik) where cik is not null do nothing
        returning id`;
      counts.peopleCreated += made.length;
    }
    const personRows = await tx`select id, cik from people where cik = any(${pciks}::text[])`;
    const person = new Map<string, number>();
    for (const r of personRows) person.set(String(r.cik), Number(r.id));

    // ── securities (existing left alone; new ones inactive until promoted)
    const tickers = new Map<string, number>(); // ticker -> company id that asks for it first
    for (const f of filings) {
      const t = primaryTicker(f.issuerSymbol);
      if (t && !tickers.has(t)) tickers.set(t, company.get(f.issuerCik)!.id);
    }
    const tlist = [...tickers.keys()];
    const security = new Map<string, { id: number; companyId: number | null }>();
    if (tlist.length > 0) {
      const made = await tx`
        insert into securities (ticker, type, company_id, is_active)
        select x.t::citext, 'equity'::security_type, x.cid::bigint, false
          from unnest(${tlist}::text[], ${tlist.map((t) => String(tickers.get(t)))}::text[]) as x(t, cid)
        on conflict (ticker, type) do nothing
        returning id`;
      counts.securitiesCreated += made.length;
      const rows = await tx`select id, ticker::text as ticker, company_id from securities where type = 'equity' and ticker = any(${tlist}::citext[])`;
      for (const r of rows) security.set(String(r.ticker).toUpperCase(), { id: Number(r.id), companyId: r.company_id == null ? null : Number(r.company_id) });
    }

    // ── insider roles (one per person + company)
    const rolePairs = new Map<string, { pid: number; cid: number; title: string | null; director: boolean }>();
    for (const f of filings) {
      const pid = person.get(f.owner!.cik)!;
      const cid = company.get(f.issuerCik)!.id;
      const k = `${pid}:${cid}`;
      if (!rolePairs.has(k)) rolePairs.set(k, { pid, cid, title: f.owner!.title, director: /director/i.test(f.owner!.relationship) });
    }
    const rp = [...rolePairs.values()];
    await tx`
      insert into person_roles (person_id, role_kind, company_id, officer_title, is_director)
      select x.pid::bigint, 'insider', x.cid::bigint, nullif(x.title, ''), x.dir::boolean
        from unnest(${rp.map((r) => String(r.pid))}::text[], ${rp.map((r) => String(r.cid))}::text[],
                    ${rp.map((r) => r.title ?? "")}::text[], ${rp.map((r) => String(r.director))}::text[]) as x(pid, cid, title, dir)
       where not exists (select 1 from person_roles r where r.person_id = x.pid::bigint and r.company_id = x.cid::bigint and r.role_kind = 'insider')`;

    // ── filings
    interface Prep { f: BulkFiling; pid: number; cid: number; secId: number | null; scope: "tracked" | "market" }
    const prepared: Prep[] = [];
    for (const f of filings) {
      const c = company.get(f.issuerCik)!;
      const t = primaryTicker(f.issuerSymbol);
      const s = t ? security.get(t) : undefined;
      let secId: number | null = null;
      if (s) {
        if (s.companyId === null || s.companyId === c.id) secId = s.id;
        else counts.tickerConflicts++;
      }
      prepared.push({ f, pid: person.get(f.owner!.cik)!, cid: c.id, secId, scope: c.tracked ? "tracked" : "market" });
    }
    const made = await tx`
      insert into filings (source, external_id, filer_person_id, filer_company_id, filed_at, source_url, confidence, review, is_published, payload, scope)
      select 'sec_form4'::filing_source, x.acc, x.pid::bigint, x.cid::bigint, x.filed::timestamptz, x.url, 1.0, 'auto_approved'::review_status, false, x.payload::jsonb, x.scope
        from unnest(${prepared.map((p) => p.f.accession)}::text[], ${prepared.map((p) => String(p.pid))}::text[],
                    ${prepared.map((p) => String(p.cid))}::text[], ${prepared.map((p) => p.f.filingDate)}::text[],
                    ${prepared.map((p) => filingIndexUrl(p.f))}::text[], ${prepared.map((p) => JSON.stringify(scrubDeep(toPayload(p.f))))}::text[],
                    ${prepared.map((p) => p.scope)}::text[]) as x(acc, pid, cid, filed, url, payload, scope)
      on conflict (source, external_id) do nothing
      returning id, external_id`;
    const filingId = new Map<string, number>();
    for (const r of made) filingId.set(String(r.external_id), Number(r.id));
    counts.filingsInserted += made.length;

    // ── transactions: same columns and mapping as the XML path; order = payload order
    const col = { fid: [] as string[], pid: [] as string[], sid: [] as string[], side: [] as string[], code: [] as string[], deriv: [] as string[], date: [] as string[], disc: [] as string[], shares: [] as string[], price: [] as string[], lag: [] as string[], t10: [] as string[], owner: [] as string[], asset: [] as string[] };
    for (const p of prepared) {
      const fid = filingId.get(p.f.accession);
      if (fid === undefined) continue; // already stored (raced) — leave its rows alone
      if (p.scope === "tracked") counts.filingsTracked++; else counts.filingsMarket++;
      for (const t of p.f.txns) {
        const guarded = guardFutureTxnDate(t.date, p.f.filingDate);
        if (guarded.nulled) counts.futureDatesNulled++;
        const lag = isoDateDiffDays(p.f.filingDate, guarded.date);
        col.fid.push(String(fid)); col.pid.push(String(p.pid)); col.sid.push(p.secId == null ? "" : String(p.secId));
        col.side.push(codeToSide(t.code)); col.code.push(t.code ?? ""); col.deriv.push(String(t.isDerivative));
        col.date.push(guarded.date ?? ""); col.disc.push(p.f.filingDate);
        col.shares.push(t.shares == null ? "" : String(t.shares)); col.price.push(t.price == null ? "" : String(t.price));
        col.lag.push(lag == null ? "" : String(lag)); col.t10.push(String(p.f.aff10b5One));
        col.owner.push(t.ownership === "I" ? "indirect" : "self"); col.asset.push(t.isDerivative ? "derivative" : "stock");
      }
    }
    if (col.fid.length > 0) {
      await tx`
        insert into transactions (filing_id, person_id, security_id, side, txn_code, is_derivative, txn_date, disclosed_at, shares, price,
                                  disclosure_lag_days, confidence, review, is_10b5_1, owner_type, asset_type)
        select x.fid::bigint, x.pid::bigint, nullif(x.sid, '')::bigint, x.side::txn_side, nullif(x.code, ''), x.deriv::boolean,
               nullif(x.date, '')::date, x.disc::date, nullif(x.shares, '')::numeric, nullif(x.price, '')::numeric,
               nullif(x.lag, '')::integer, 1.0, 'auto_approved'::review_status, x.t10::boolean, x.owner, x.asset
          from unnest(${col.fid}::text[], ${col.pid}::text[], ${col.sid}::text[], ${col.side}::text[], ${col.code}::text[], ${col.deriv}::text[],
                      ${col.date}::text[], ${col.disc}::text[], ${col.shares}::text[], ${col.price}::text[], ${col.lag}::text[],
                      ${col.t10}::text[], ${col.owner}::text[], ${col.asset}::text[])
               with ordinality as x(fid, pid, sid, side, code, deriv, date, disc, shares, price, lag, t10, owner, asset, ord)
         order by x.ord`;
      counts.transactions += col.fid.length;
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Job
// ──────────────────────────────────────────────────────────────────────────

export async function ingestSecForm4Bulk(): Promise<IngestRunResult> {
  const root = process.env.SEC_BULK_DIR;
  const ctx = createRunContext(SOURCE, 300);
  if (!root || !fs.existsSync(root)) {
    ctx.warn("SEC_BULK_DIR is not set or does not exist — nothing to load");
    ctx.extra["skipped"] = "no SEC_BULK_DIR";
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }
  const sql = getDb();
  const startedAt = Date.now();
  const minutes = Number(process.env.SEC_BULK_MAX_MINUTES ?? 40);
  const budgetMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;

  const stored = new Set((await sql`select external_id from filings where source = 'sec_form4'`).map((r) => String(r.external_id)));
  const counts = newCounts();
  const totals = { nonForm4Dropped: 0, preFloorDropped: 0, skippedExisting: 0, filingsKept: 0 };
  const missingOptional = new Set<string>();
  let quarters = 0;
  let stoppedOnBudget = false;
  let filingsQuarantined = 0;

  for (const dir of quarterDirs(root)) {
    if (overBudget()) { stoppedOnBudget = true; break; }
    const { filings, stats } = await readQuarter(dir, { floor: FORM4_FLOOR, skip: (a) => stored.has(a) });
    quarters++;
    totals.nonForm4Dropped += stats.nonForm4Dropped;
    totals.preFloorDropped += stats.preFloorDropped;
    totals.skippedExisting += stats.skippedExisting;
    totals.filingsKept += stats.filingsKept;
    stats.missingOptional.forEach((m) => missingOptional.add(m));
    console.log(`${SOURCE}: ${path.basename(dir)}: ${stats.filingsKept} new Form 4 filings to load (${stats.skippedExisting} already stored, ${stats.preFloorDropped} before the floor, ${stats.nonForm4Dropped} other forms)`);

    const ok: BulkFiling[] = [];
    for (const f of filings) {
      ctx.rowsSeen++;
      const bad = invalidReason(f);
      if (bad) { filingsQuarantined++; ctx.quarantine(f.accession, bad); } else ok.push(f);
    }
    for (let i = 0; i < ok.length; i += BATCH) {
      if (overBudget()) { stoppedOnBudget = true; break; }
      const batch = ok.slice(i, i + BATCH);
      const before = counts.filingsInserted;
      try {
        await writeBatch(sql, batch, counts);
      } catch (err) {
        ctx.warn(`batch of ${batch.length} failed (${err instanceof Error ? err.message.slice(0, 160) : String(err)}); retrying one filing at a time`);
        for (const f of batch) {
          try { await writeBatch(sql, [f], counts); } catch (e) {
            filingsQuarantined++;
            ctx.quarantine(f.accession, `write failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
          }
        }
      }
      for (const f of batch) stored.add(f.accession);
      ctx.rowsChanged += counts.filingsInserted - before;
    }
    if (stoppedOnBudget) break;
  }

  ctx.extra["quarters_read"] = quarters;
  ctx.extra["filings_new_in_files"] = totals.filingsKept;
  ctx.extra["filings_skipped_existing"] = totals.skippedExisting;
  ctx.extra["pre_floor_dropped"] = totals.preFloorDropped;
  ctx.extra["other_forms_dropped"] = totals.nonForm4Dropped;
  ctx.extra["filings_inserted"] = counts.filingsInserted;
  ctx.extra["filings_tracked"] = counts.filingsTracked;
  ctx.extra["filings_market"] = counts.filingsMarket;
  ctx.extra["filings_quarantined"] = filingsQuarantined;
  ctx.extra["transactions_written"] = counts.transactions;
  ctx.extra["companies_created"] = counts.companiesCreated;
  ctx.extra["people_created"] = counts.peopleCreated;
  ctx.extra["securities_created"] = counts.securitiesCreated;
  ctx.extra["ticker_conflicts"] = counts.tickerConflicts;
  ctx.extra["future_dates_nulled"] = counts.futureDatesNulled;
  ctx.extra["missing_optional_columns"] = [...missingOptional];
  ctx.extra["stopped_on_budget"] = stoppedOnBudget;
  ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: stoppedOnBudget ? "partial" : "success",
    stats: ctx.stats(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSecForm4Bulk()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
