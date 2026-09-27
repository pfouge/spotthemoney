// Source: SEC EDGAR — Form 4 (statement of changes in beneficial ownership). Keyless.
// Contract: integration contract §4.2 (companies/people/person_roles/filings/transactions),
// §3.1 (identity resolution), §3.2 (filings conventions + re-ingest rule), §3.5 (side mapping).
//
// COVERAGE (contract §4.2, binding): ticker-scoped until IIF Requirement A (market-wide
// list_recent_form4s via the EDGAR daily-index) exists. Phase-1 universe is the
// Congress-bought ticker set — see UNIVERSE below.
//
// XML PARSING (binding constraint: no XML library, per project policy — the ownership
// XML is machine-generated and structurally regular). This mirrors the proven IIF
// Python connector (plugins/sec-edgar/mcp/edgar_client.py, verified 2026-07-06):
//   - SEC's Form 4 XML wraps almost every leaf value in a nested <value> child
//     (e.g. <transactionShares><value>50000</value></transactionShares>), sometimes
//     with a sibling <footnoteId>. transactionCode is the one notable exception —
//     it is a direct text element with no <value> wrapper.
//   - Namespace prefixes (if present) are stripped by matching on local tag names only
//     (regex `(?:\w+:)?tag`), never assuming a specific prefix.
//   - isDirector/isOfficer are literal strings "true"/"1" in the wild.
//
// TICKER→CIK (verified against IIF edgar_client.py ticker_to_cik): company_tickers.json
// values keyed by ticker.upper() -> 10-digit zero-padded CIK, fetched once per run and
// cached. Class-share tickers: EDGAR uses a hyphen (BRK-B) where quotes/users often use
// a dot (BRK.B) or a space — try ticker as-is, then dot<->dash swapped each way, before
// giving up.
//
// LIST FILINGS gotcha (binding): EDGAR's `type=4` query param is a PREFIX match that
// also returns "4/A" (amendments) and "425" (merger communications, no ownership XML).
// We over-fetch (count = N+25) then keep only entries whose filing-type is EXACTLY "4".
//
// RE-INGEST RULE (contract §3.2): re-processing a filing deletes and reinserts its
// transactions rather than diffing — transactions have no natural key by design.
//
// APPROVAL GATE: filings.is_published stays FALSE for this (new) source until Peter
// reviews a sample — auto_approved review status, but not auto-published.

import { fetchJson, fetchText } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { archiveBytes } from "../lib/archive.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "sec_form4";
const SEC_BASE = "https://www.sec.gov";

const DEFAULT_USER_AGENT = "spotthemoney.com ingest (Peter Fougerousse <pfouge@gmail.com>)";

function userAgent(): string {
  return process.env.SEC_EDGAR_USER_AGENT ?? DEFAULT_USER_AGENT;
}

// ──────────────────────────────────────────────────────────────────────────
// Ticker → CIK
// ──────────────────────────────────────────────────────────────────────────

interface CompanyTickerRow {
  ticker: string;
  cik_str: number | string;
  title: string;
}

/** Fetch + build a ticker(upper) -> 10-digit zero-padded CIK map. Fetched once per run. */
async function buildTickerCikMap(): Promise<Map<string, string>> {
  const data = await fetchJson<Record<string, CompanyTickerRow>>(
    `${SEC_BASE}/files/company_tickers.json`,
    { userAgent: userAgent() },
  );
  const map = new Map<string, string>();
  for (const row of Object.values(data)) {
    const ticker = String(row.ticker ?? "").toUpperCase().trim();
    if (!ticker) continue;
    const cikNum = Number(row.cik_str);
    if (!Number.isFinite(cikNum)) continue;
    map.set(ticker, String(cikNum).padStart(10, "0"));
  }
  return map;
}

/**
 * Resolve a ticker to a 10-digit zero-padded CIK, trying dot/dash variants
 * (EDGAR uses BRK-B where quotes use BRK.B).
 */
function resolveCik(map: Map<string, string>, ticker: string): string | null {
  const t = ticker.toUpperCase().trim();
  const candidates = [t, t.replace(/\./g, "-"), t.replace(/-/g, ".")];
  for (const cand of candidates) {
    const cik = map.get(cand);
    if (cik) return cik;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Atom feed: list filings
// ──────────────────────────────────────────────────────────────────────────

interface FilingListEntry {
  accession: string;
  filingDate: string;
  filingType: string;
}

const ATOM_ENTRY_RE =
  /<accession-number>([^<]+)<\/accession-number>[\s\S]*?<filing-date>([^<]+)<\/filing-date>[\s\S]*?<filing-type>([^<]+)<\/filing-type>/g;

/**
 * List Form 4 filings for a CIK via the browse-edgar atom feed. `type=4` is a PREFIX
 * match at the API level (also returns "4/A", "425") — we over-fetch and filter to
 * filing-type EXACTLY "4" here.
 */
async function listForm4Filings(cik: string, limit: number): Promise<FilingListEntry[]> {
  const fetchN = limit + 25;
  const url =
    `${SEC_BASE}/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include` +
    `&count=${fetchN}&output=atom`;
  const xml = await fetchText(url, { userAgent: userAgent() });

  const out: FilingListEntry[] = [];
  for (const m of xml.matchAll(ATOM_ENTRY_RE)) {
    const accession = m[1]!.trim();
    const filingDate = m[2]!.trim();
    const filingType = m[3]!.trim();
    if (filingType !== "4") continue; // drop 4/A, 425, etc.
    out.push({ accession, filingDate, filingType });
    if (out.length >= limit) break;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Ownership XML: locate + fetch
// ──────────────────────────────────────────────────────────────────────────

interface DirectoryItem {
  name?: string;
}
interface IndexJson {
  directory?: { item?: DirectoryItem[] };
}

/**
 * Locate the ownership XML for a filing via index.json: pick the first .xml name
 * containing "form" (case-insensitive), else the first .xml file. Returns null if
 * no XML file is present in the directory at all.
 */
async function findOwnershipXmlUrl(cik: string, accession: string): Promise<string | null> {
  const unpaddedCik = String(Number(cik));
  const accessionNoDashes = accession.replace(/-/g, "");
  const base = `${SEC_BASE}/Archives/edgar/data/${unpaddedCik}/${accessionNoDashes}`;
  const idx = await fetchJson<IndexJson>(`${base}/index.json`, { userAgent: userAgent() });
  const items = idx.directory?.item ?? [];
  const xmlNames = items
    .map((it) => it.name ?? "")
    .filter((name) => name.toLowerCase().endsWith(".xml"));
  if (xmlNames.length === 0) return null;
  const pick = xmlNames.find((n) => n.toLowerCase().includes("form")) ?? xmlNames[0]!;
  return `${base}/${pick}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Form 4 XML parsing (no XML library — regular, machine-generated structure)
// ──────────────────────────────────────────────────────────────────────────

interface ParsedTransaction {
  isDerivative: boolean;
  transactionDate: string | null;
  transactionCode: string | null;
  transactionShares: number | null;
  transactionPricePerShare: number | null;
  /** Shares owned following the transaction (postTransactionAmounts). */
  sharesOwnedAfter: number | null;
  /** D (direct) / I (indirect). */
  ownership: string | null;
}

interface ParsedForm4 {
  issuerCik: string | null;
  issuerName: string | null;
  issuerTradingSymbol: string | null;
  rptOwnerCik: string | null;
  rptOwnerName: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string | null;
  transactions: ParsedTransaction[];
  footnotes: string[];
  /** Rule 10b5-1 trading-plan checkbox (EDGAR 23.1, April 2023+); null when the element is absent. */
  aff10b5One: boolean | null;
}

/**
 * Extract the text content of the first `<tag>...</tag>` in `xml`, matching local tag
 * names only (namespace prefixes like "ns1:tag" are tolerated but not required).
 * Restricting the search to `within` (a substring of xml) lets callers scope a lookup
 * to one block (e.g. one <nonDerivativeTransaction>) without a real DOM.
 */
function tagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1]!.trim() : null;
}

/**
 * Extract a leaf value that SEC wraps in a nested <value> element, e.g.
 * <transactionShares><value>50000</value></transactionShares>. Falls back to the
 * outer tag's own text if there is no nested <value> (schema is inconsistent about
 * which leaves get the wrapper — transactionCode notably does not).
 */
function tagValue(xml: string, tag: string): string | null {
  const outer = tagBlock(xml, tag);
  if (outer == null) return null;
  const nested = tagText(outer, "value");
  if (nested != null) return nested;
  const selfText = tagText(outer, tag);
  if (selfText != null) return selfText;
  const trimmed = outer.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Extract the full inner content (incl. child tags) of the first `<tag>...</tag>` block. */
function tagBlock(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1]! : null;
}

/** Extract every top-level `<tag>...</tag>` block's inner content (repeated elements). */
function tagBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "gi");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(m[1]!);
  return out;
}

function boolFromToken(v: string | null): boolean {
  if (v == null) return false;
  const t = v.trim().toLowerCase();
  return t === "1" || t === "true";
}

function numOrNull(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

function parseTransactionBlock(block: string, isDerivative: boolean): ParsedTransaction {
  // transactionCode lives inside <transactionCoding>, as direct text (no <value> wrapper).
  const codingBlock = tagBlock(block, "transactionCoding");
  const transactionCode = codingBlock ? tagText(codingBlock, "transactionCode") : null;

  // transactionDate, transactionShares, transactionPricePerShare all use the nested
  // <value> wrapper convention.
  const transactionDate = tagValue(block, "transactionDate");
  const transactionShares = numOrNull(tagValue(block, "transactionShares"));
  const transactionPricePerShare = numOrNull(tagValue(block, "transactionPricePerShare"));

  const postBlock = tagBlock(block, "postTransactionAmounts");
  const sharesOwnedAfter = postBlock ? numOrNull(tagValue(postBlock, "sharesOwnedFollowingTransaction")) : null;
  const ownBlock = tagBlock(block, "ownershipNature");
  const ownership = ownBlock ? tagValue(ownBlock, "directOrIndirectOwnership") : null;

  return {
    isDerivative,
    transactionDate,
    transactionCode: transactionCode ? transactionCode.trim() : null,
    transactionShares,
    transactionPricePerShare,
    sharesOwnedAfter,
    ownership: ownership ? ownership.trim() : null,
  };
}

/** Parse a Form 4 ownership XML document into the fields this job needs. */
export function parseForm4Xml(xml: string): ParsedForm4 {
  const issuerBlock = tagBlock(xml, "issuer");
  const issuerCik = issuerBlock ? tagText(issuerBlock, "issuerCik") : null;
  const issuerName = issuerBlock ? tagText(issuerBlock, "issuerName") : null;
  const issuerTradingSymbol = issuerBlock ? tagText(issuerBlock, "issuerTradingSymbol") : null;

  const ownerBlock = tagBlock(xml, "reportingOwner");
  let rptOwnerCik: string | null = null;
  let rptOwnerName: string | null = null;
  let isDirector = false;
  let isOfficer = false;
  let officerTitle: string | null = null;

  if (ownerBlock) {
    const ownerIdBlock = tagBlock(ownerBlock, "reportingOwnerId");
    if (ownerIdBlock) {
      rptOwnerCik = tagText(ownerIdBlock, "rptOwnerCik");
      rptOwnerName = tagText(ownerIdBlock, "rptOwnerName");
    }
    const relBlock = tagBlock(ownerBlock, "reportingOwnerRelationship");
    if (relBlock) {
      isDirector = boolFromToken(tagText(relBlock, "isDirector"));
      isOfficer = boolFromToken(tagText(relBlock, "isOfficer"));
      officerTitle = tagText(relBlock, "officerTitle");
    }
  }

  const transactions: ParsedTransaction[] = [
    ...tagBlocks(xml, "nonDerivativeTransaction").map((b) => parseTransactionBlock(b, false)),
    ...tagBlocks(xml, "derivativeTransaction").map((b) => parseTransactionBlock(b, true)),
  ];

  // Document-level Rule 10b5-1 checkbox (EDGAR 23.1). "true"/"1" → true, "false"/"0" → false.
  const aff = tagText(xml, "aff10b5One");
  const aff10b5One = aff == null ? null : boolFromToken(aff);

  const footnotesBlock = tagBlock(xml, "footnotes");
  const footnotes = footnotesBlock
    ? tagBlocks(footnotesBlock, "footnote")
        .map((f) => f.trim())
        .filter((f) => f.length > 0)
    : [];

  return {
    issuerCik: issuerCik ? issuerCik.trim() : null,
    issuerName: issuerName ? issuerName.trim() : null,
    issuerTradingSymbol: issuerTradingSymbol ? issuerTradingSymbol.trim() : null,
    rptOwnerCik: rptOwnerCik ? rptOwnerCik.trim() : null,
    rptOwnerName: rptOwnerName ? rptOwnerName.trim() : null,
    isDirector,
    isOfficer,
    officerTitle: officerTitle ? officerTitle.trim() : null,
    transactions,
    footnotes,
    aff10b5One,
  };
}

/** Company profile slug: "NVIDIA CORP" → "nvidia-corp"; falls back to the CIK. */
export function slugifyCompany(name: string | null, cik: string): string {
  const base = (name ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base.length >= 2 ? base.slice(0, 80) : `cik-${cik}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Mapping helpers (contract §3.5, §3.1)
// ──────────────────────────────────────────────────────────────────────────

/** Form 4 transaction code -> transactions.side, per contract §3.5. */
function codeToSide(code: string | null): "buy" | "sell" | "exchange" | "option" | "other" {
  switch ((code ?? "").toUpperCase()) {
    case "P":
      return "buy";
    case "S":
    case "F":
    case "D":
      return "sell";
    case "C":
      return "exchange";
    case "M":
    case "X":
      return "option";
    default:
      return "other";
  }
}

/** lowercase-hyphen slug of a full name, per contract §3.1. */
function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isoDateDiffDays(later: string | null, earlier: string | null): number | null {
  if (!later || !earlier) return null;
  const a = Date.parse(later);
  const b = Date.parse(earlier);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

// ──────────────────────────────────────────────────────────────────────────
// Main job
// ──────────────────────────────────────────────────────────────────────────

export async function ingestSecForm4(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const maxFilingsPerTicker = Number(process.env.SEC_MAX_FILINGS_PER_TICKER ?? 10);

  // Universe: distinct active tickers from securities (equity/etf/adr) UNION
  // env SEC_EDGAR_TICKERS (comma-separated). Phase-1 fallback universe is the
  // Congress-bought ticker set (contract §4.2 coverage note).
  const dbTickerRows = await sql`
    select distinct ticker from securities
    where type in ('equity','etf','adr') and is_active = true
  `;
  const dbTickers = dbTickerRows.map((r) => String(r.ticker).toUpperCase());
  const envTickers = (process.env.SEC_EDGAR_TICKERS ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);
  const universe = Array.from(new Set([...dbTickers, ...envTickers]));

  if (universe.length === 0) {
    ctx.warn(
      "no ticker universe configured — no-op (Phase-1 universe is the Congress-bought ticker set)",
    );
    return {
      source: SOURCE,
      rowsSeen: 0,
      rowsChanged: 0,
      status: "success",
      stats: ctx.stats(),
    };
  }

  const tickerCikMap = await buildTickerCikMap();

  let tickersProcessed = 0;
  let tickersUnresolved = 0;
  let filingsFetched = 0;
  let filingsSkippedExisting = 0;
  let filingsQuarantined = 0;
  let transactionsWritten = 0;
  let documentsArchived = 0;

  for (const ticker of universe) {
    try {
      const cik = resolveCik(tickerCikMap, ticker);
      if (!cik) {
        tickersUnresolved++;
        ctx.quarantine(ticker, "ticker -> CIK lookup failed (not in company_tickers.json)");
        continue;
      }

      const entries = await listForm4Filings(cik, maxFilingsPerTicker);
      filingsFetched += entries.length;
      if (entries.length === 0) {
        tickersProcessed++;
        continue;
      }

      const accessions = entries.map((e) => e.accession);
      const existingRows = await sql`
        select external_id from filings
        where source = 'sec_form4' and external_id = any(${accessions})
      `;
      const existingSet = new Set(existingRows.map((r) => r.external_id as string));

      for (const entry of entries) {
        if (existingSet.has(entry.accession)) {
          filingsSkippedExisting++;
          continue;
        }
        if (!ctx.markSeen(entry.accession)) continue;
        ctx.rowsSeen++;

        try {
          const xmlUrl = await findOwnershipXmlUrl(cik, entry.accession);
          if (!xmlUrl) {
            filingsQuarantined++;
            ctx.quarantine(entry.accession, "no ownership XML found in filing index.json");
            continue;
          }

          const xmlText = await fetchText(xmlUrl, { userAgent: userAgent() });
          let parsed: ParsedForm4;
          try {
            parsed = parseForm4Xml(xmlText);
          } catch (err) {
            filingsQuarantined++;
            ctx.quarantine(
              entry.accession,
              `unparseable Form 4 XML: ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }

          if (!parsed.issuerCik && !parsed.issuerName) {
            filingsQuarantined++;
            ctx.quarantine(entry.accession, "parsed XML missing issuer identity");
            continue;
          }
          if (!parsed.rptOwnerName) {
            filingsQuarantined++;
            ctx.quarantine(entry.accession, "parsed XML missing reporting owner name");
            continue;
          }

          const clean = scrubDeep({
            accession: entry.accession,
            filingDate: entry.filingDate,
            xmlUrl,
            issuerCik: parsed.issuerCik,
            issuerName: parsed.issuerName,
            issuerTradingSymbol: parsed.issuerTradingSymbol ?? ticker,
            rptOwnerCik: parsed.rptOwnerCik,
            rptOwnerName: parsed.rptOwnerName,
            isDirector: parsed.isDirector,
            isOfficer: parsed.isOfficer,
            officerTitle: parsed.officerTitle,
            transactions: parsed.transactions,
            footnotes: parsed.footnotes,
            aff10b5One: parsed.aff10b5One,
          });

          // companies: upsert on cik (0001 unique).
          const companyCik = clean.issuerCik ?? cik;
          // slug: set once (never regenerated — it is a public URL); a collision falls back
          // to the CIK-based slug so two differently-named issuers never share a URL.
          const companySlug = slugifyCompany(clean.issuerName, companyCik);
          const [company] = await sql`
            insert into companies (name, cik, primary_ticker, slug)
            values (${clean.issuerName ?? ticker}, ${companyCik}, ${clean.issuerTradingSymbol},
                    case when exists (select 1 from companies c2 where c2.slug = ${companySlug} and c2.cik <> ${companyCik})
                         then ${`cik-${companyCik}`} else ${companySlug} end)
            on conflict (cik) do update
              set name = excluded.name,
                  primary_ticker = excluded.primary_ticker,
                  slug = coalesce(companies.slug, excluded.slug)
            returning id
          `;
          const companyId = company!.id as number;

          // people: upsert on cik (0005 partial unique index). Slug collisions are
          // quarantined rather than guessed at (contract-directed fallback behavior).
          let personId: number;
          try {
            const slug = slugifyName(clean.rptOwnerName!);
            const [person] = await sql`
              insert into people (full_name, cik, slug)
              values (${clean.rptOwnerName}, ${clean.rptOwnerCik}, ${slug})
              on conflict (cik) where cik is not null do update
                set full_name = excluded.full_name
              returning id
            `;
            personId = person!.id as number;
          } catch (err) {
            filingsQuarantined++;
            ctx.quarantine(
              entry.accession,
              `person upsert failed (likely slug collision): ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }

          // person_roles: ensure one insider role row for this person+company.
          const [existingRole] = await sql`
            select id from person_roles
            where person_id = ${personId} and company_id = ${companyId} and role_kind = 'insider'
            limit 1
          `;
          if (!existingRole) {
            await sql`
              insert into person_roles (person_id, role_kind, company_id, officer_title, is_director)
              values (${personId}, 'insider', ${companyId}, ${clean.officerTitle}, ${clean.isDirector})
            `;
          }

          // securities: upsert on (ticker, type='equity').
          const secTicker = clean.issuerTradingSymbol ?? ticker;
          const [security] = await sql`
            insert into securities (ticker, type, company_id)
            values (${secTicker}, 'equity', ${companyId})
            on conflict (ticker, type) do update
              set company_id = excluded.company_id
            returning id
          `;
          const securityId = security!.id as number;

          // filings: upsert on (source, external_id). Not auto-published — new-source
          // approval gate until Peter reviews a sample.
          const payload = {
            accession: clean.accession,
            issuer: {
              cik: clean.issuerCik,
              name: clean.issuerName,
              ticker: clean.issuerTradingSymbol,
            },
            owner: {
              cik: clean.rptOwnerCik,
              name: clean.rptOwnerName,
            },
            relationship: {
              isDirector: clean.isDirector,
              isOfficer: clean.isOfficer,
              officerTitle: clean.officerTitle,
            },
            footnotes: clean.footnotes,
            aff10b5One: clean.aff10b5One,
            transactions: clean.transactions.map((t) => ({
              code: t.transactionCode, date: t.transactionDate, shares: t.transactionShares,
              price: t.transactionPricePerShare, sharesOwnedAfter: t.sharesOwnedAfter,
              ownership: t.ownership, isDerivative: t.isDerivative,
            })),
          };

          const [filing] = await sql`
            insert into filings (
              source, external_id, filer_person_id, filer_company_id,
              filed_at, source_url, confidence, review, is_published, payload
            )
            values (
              'sec_form4', ${clean.accession}, ${personId}, ${companyId},
              ${clean.filingDate}, ${clean.xmlUrl}, 1.0, 'auto_approved', false, ${sql.json(payload)}
            )
            on conflict (source, external_id) do update
              set filed_at = excluded.filed_at,
                  source_url = excluded.source_url,
                  payload = excluded.payload
            returning id
          `;
          const filingId = filing!.id as number;

          // Raw-filing archive (roadmap B.6): the ownership XML we just parsed, keyed by URL.
          // Never fatal — a storage failure records the hash and moves on.
          try {
            const arch = await archiveBytes(sql, {
              source: "sec_form4", sourceUrl: xmlUrl, bytes: new TextEncoder().encode(xmlText),
              contentType: "application/xml", filingId,
            });
            if (arch.stored) documentsArchived++;
          } catch (err) {
            ctx.warn(`archive failed for ${entry.accession}: ${err instanceof Error ? err.message : String(err)}`);
          }

          // Re-ingest rule (contract §3.2): transactions have no natural key —
          // delete and reinsert fresh on every (re-)ingest of this filing.
          await sql`delete from transactions where filing_id = ${filingId}`;

          for (const txn of clean.transactions) {
            const side = codeToSide(txn.transactionCode);
            const lagDays = isoDateDiffDays(clean.filingDate, txn.transactionDate);
            await sql`
              insert into transactions (
                filing_id, person_id, security_id, side, txn_code, is_derivative,
                txn_date, disclosed_at, shares, price, disclosure_lag_days,
                confidence, review, is_10b5_1, owner_type, asset_type
              )
              values (
                ${filingId}, ${personId}, ${securityId}, ${side}, ${txn.transactionCode}, ${txn.isDerivative},
                ${txn.transactionDate}, ${clean.filingDate}, ${txn.transactionShares}, ${txn.transactionPricePerShare}, ${lagDays},
                1.0, 'auto_approved', ${clean.aff10b5One}, ${txn.ownership === "I" ? "indirect" : "self"},
                ${txn.isDerivative ? "derivative" : "stock"}
              )
            `;
            transactionsWritten++;
            ctx.rowsChanged++;
          }
        } catch (err) {
          filingsQuarantined++;
          ctx.quarantine(
            entry.accession,
            `per-filing failure: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      tickersProcessed++;
    } catch (err) {
      // One ticker's hard failure quarantines that ticker and continues (does not
      // kill the run).
      ctx.quarantine(ticker, `ticker-level failure: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.extra["tickers_in_universe"] = universe.length;
  ctx.extra["tickers_processed"] = tickersProcessed;
  ctx.extra["tickers_unresolved"] = tickersUnresolved;
  ctx.extra["filings_fetched"] = filingsFetched;
  ctx.extra["filings_skipped_existing"] = filingsSkippedExisting;
  ctx.extra["filings_quarantined"] = filingsQuarantined;
  ctx.extra["transactions_written"] = transactionsWritten;
  ctx.extra["documents_archived"] = documentsArchived;
  ctx.extra["max_filings_per_ticker"] = maxFilingsPerTicker;

  const status: IngestRunResult["status"] = tickersUnresolved > 0 ? "partial" : "success";

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status,
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- sec_form4`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSecForm4()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
