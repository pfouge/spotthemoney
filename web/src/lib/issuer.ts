// A Form 4 row belongs to the company the filing names as issuer, not to whichever company
// owns the ticker the row was stored under.
//
// The Form 4 write path finds a security by ticker alone. A fund or spin-off whose filing
// carries no trading symbol ("NONE", "N/A") is stored under the symbol of the tracked company
// the filing was fetched for, so its insiders' rows sat on the sponsor's stock page (PGIM funds
// on PRU, Blackstone and Franklin funds on BX and BEN, a KKR fund on GE; 392 rows on 14
// issuer and ticker pairs on production, 2026-11-22). This file is the build-time rule that
// takes such a row off the ticker: the row keeps everything it states, loses the link to the
// security, and is listed on the issuer's own company page and the filer's page.
//
// Which company owns a ticker is settled in the database (migration 0031: the SEC's ticker
// list and repair_ticker_owners()). Pure: no database, no Astro. Tests: scripts/issuer.test.ts.

export interface IssuerRow { id: number; filing_id: number; security_id: number | null }
export interface IssuerFiling { source: string; companyId: number | null }
export interface IssuerSecurity { ticker: string; companyId: number | null }

export interface ForeignRow {
  /** The security the row was stored under. */
  securityId: number;
  /** The company the filing names as issuer. */
  issuerCompanyId: number;
  filingId: number;
}

/**
 * Rows of Form 4 filings whose issuer is a company other than the one that owns the row's
 * security, by row id. A row is left alone when the filing has no issuer on record or the
 * security has no company: there is nothing to compare. Congressional rows are never touched
 * (a member's report has no issuer).
 */
export function foreignIssuerRows(
  rows: readonly IssuerRow[],
  filings: ReadonlyMap<number, IssuerFiling>,
  securities: ReadonlyMap<number, IssuerSecurity>,
): Map<number, ForeignRow> {
  const out = new Map<number, ForeignRow>();
  for (const r of rows) {
    if (r.security_id == null) continue;
    const f = filings.get(r.filing_id);
    if (!f || f.source !== "sec_form4" || f.companyId == null) continue;
    const s = securities.get(r.security_id);
    if (!s || s.companyId == null || s.companyId === f.companyId) continue;
    out.set(r.id, { securityId: r.security_id, issuerCompanyId: f.companyId, filingId: r.filing_id });
  }
  return out;
}

export interface SharedTicker { ticker: string; companies: string[] }

/** Tickers that are the main ticker of more than one company (there should be none). */
export function sharedMainTickers(companies: Iterable<{ name: string; primaryTicker: string | null }>): SharedTicker[] {
  const by = new Map<string, string[]>();
  for (const c of companies) {
    const t = (c.primaryTicker ?? "").trim().toUpperCase();
    if (!t) continue;
    const list = by.get(t) ?? [];
    list.push(c.name);
    by.set(t, list);
  }
  return [...by].filter(([, names]) => names.length > 1)
    .map(([ticker, names]) => ({ ticker, companies: names.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** One build-log line, for comparison with SQL. */
export function issuerLog(
  foreign: ReadonlyMap<number, ForeignRow>,
  securities: ReadonlyMap<number, IssuerSecurity>,
  companyName: (id: number) => string,
  shared: readonly SharedTicker[],
): string {
  const per = new Map<number, { rows: number; issuers: Set<number> }>();
  const filings = new Set<number>();
  for (const f of foreign.values()) {
    filings.add(f.filingId);
    const e = per.get(f.securityId) ?? { rows: 0, issuers: new Set<number>() };
    e.rows++; e.issuers.add(f.issuerCompanyId);
    per.set(f.securityId, e);
  }
  const parts = [...per].map(([sid, e]) => {
    const s = securities.get(sid);
    const owner = s?.companyId != null ? companyName(s.companyId) : "no company";
    return { ticker: s?.ticker ?? String(sid), text: `${s?.ticker ?? sid} (${owner}) ${e.rows} from ${e.issuers.size}`, rows: e.rows };
  }).sort((a, b) => b.rows - a.rows || a.ticker.localeCompare(b.ticker));
  const sharedText = shared.length
    ? `${shared.length} tickers are the main ticker of more than one company (${shared.slice(0, 15).map((s) => s.ticker).join(", ")})`
    : "no ticker is the main ticker of more than one company";
  return `[web] ticker owners: ${foreign.size} Form 4 rows in ${filings.size} filings name an issuer other than the company that owns the ticker` +
    `${parts.length ? `; ticker (owner) rows from issuers: ${parts.map((p) => p.text).join(", ")}` : ""}; ${sharedText}`;
}
