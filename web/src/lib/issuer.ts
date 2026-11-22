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
// THE EXCEPTION: a row stays on the ticker when the filing itself states that ticker as its
// issuer's trading symbol AND the issuer has no ticker of its own in the SEC's list. That is
// an earlier registrant of the same listed stock (a merger or a new holding company moves a
// ticker to another filer number: SUPN on the first run of the list, 2026-11-22). When the
// issuer IS listed under another ticker, the symbol has changed hands (SATS went from EchoStar,
// now ECHO, to Strive the same day) and the old holder's rows are not this stock's. A fund
// never states its sponsor's symbol; it states none.
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

export interface IssuerSplit {
  /** Rows taken off their ticker, by row id. */
  foreign: Map<number, ForeignRow>;
  /** Rows of an earlier registrant left on the ticker: the filing states it and the issuer has no ticker of its own. */
  kept: Map<number, ForeignRow>;
  /** Of `foreign`: rows whose filing states the ticker, taken off because the issuer is listed under another one. */
  changedHands: Map<number, ForeignRow>;
}

/** The symbols a Form 4 states for its issuer: "LEN, LEN.B" → LEN, LEN.B; "[ABUS]" → ABUS; "NONE" → none. */
export function statedSymbols(symbol: string | null | undefined): string[] {
  if (typeof symbol !== "string") return [];
  return symbol.toUpperCase().split(/[,;\/\s]+/)
    .map((s) => s.replace(/^[\[\(\"']+|[\]\)\"']+$/g, "").trim())
    .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) && !["NONE", "NA", "N/A", "NULL"].includes(s));
}

/** True when the filing states this ticker (BRK.B and BRK-B are one symbol). */
export function statesTicker(symbol: string | null | undefined, ticker: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/\./g, "-");
  const t = norm(ticker.trim());
  return statedSymbols(symbol).some((s) => norm(s) === t);
}

/**
 * Splits the rows of Form 4 filings whose issuer is a company other than the one that owns
 * the row's security. `stated` gives each filing's own trading symbol for its issuer;
 * `hasOwnTicker` says whether a company is in the SEC's ticker list under any ticker:
 *   - a symbol that names the security's ticker, from an issuer with no ticker of its own:
 *     the row stays on the ticker (`kept`);
 *   - the same from an issuer that has its own ticker: the row comes off (`foreign`, and
 *     `changedHands`);
 *   - any other text ("NONE", "N/A", another ticker): the row comes off (`foreign`);
 *   - no symbol on record (not a string): nothing to judge by, the row stays and is not counted.
 * A row is left alone when the filing has no issuer on record or the security has no company.
 * Congressional rows are never touched (a member's report has no issuer).
 */
export function foreignIssuerRows(
  rows: readonly IssuerRow[],
  filings: ReadonlyMap<number, IssuerFiling>,
  securities: ReadonlyMap<number, IssuerSecurity>,
  stated: ReadonlyMap<number, string | null | undefined>,
  hasOwnTicker: (companyId: number) => boolean,
): IssuerSplit {
  const out: IssuerSplit = { foreign: new Map(), kept: new Map(), changedHands: new Map() };
  for (const r of rows) {
    if (r.security_id == null) continue;
    const f = filings.get(r.filing_id);
    if (!f || f.source !== "sec_form4" || f.companyId == null) continue;
    const s = securities.get(r.security_id);
    if (!s || s.companyId == null || s.companyId === f.companyId) continue;
    const symbol = stated.get(r.filing_id);
    if (typeof symbol !== "string") continue;
    const row = { securityId: r.security_id, issuerCompanyId: f.companyId, filingId: r.filing_id };
    if (!statesTicker(symbol, s.ticker)) out.foreign.set(r.id, row);
    else if (hasOwnTicker(f.companyId)) { out.foreign.set(r.id, row); out.changedHands.set(r.id, row); }
    else out.kept.set(r.id, row);
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

function perTicker(rows: ReadonlyMap<number, ForeignRow>, securities: ReadonlyMap<number, IssuerSecurity>, companyName: (id: number) => string): string {
  const per = new Map<number, { rows: number; issuers: Set<number> }>();
  for (const f of rows.values()) {
    const e = per.get(f.securityId) ?? { rows: 0, issuers: new Set<number>() };
    e.rows++; e.issuers.add(f.issuerCompanyId);
    per.set(f.securityId, e);
  }
  return [...per].map(([sid, e]) => {
    const s = securities.get(sid);
    const owner = s?.companyId != null ? companyName(s.companyId) : "no company";
    return { ticker: s?.ticker ?? String(sid), text: `${s?.ticker ?? sid} (${owner}) ${e.rows} from ${e.issuers.size}`, rows: e.rows };
  }).sort((a, b) => b.rows - a.rows || a.ticker.localeCompare(b.ticker)).map((p) => p.text).join(", ");
}

/** One build-log line, for comparison with SQL. */
export function issuerLog(
  split: IssuerSplit,
  securities: ReadonlyMap<number, IssuerSecurity>,
  companyName: (id: number) => string,
  shared: readonly SharedTicker[],
): string {
  const filings = new Set([...split.foreign.values()].map((f) => f.filingId));
  const off = perTicker(split.foreign, securities, companyName);
  const kept = perTicker(split.kept, securities, companyName);
  const changed = perTicker(split.changedHands, securities, companyName);
  const sharedText = shared.length
    ? `${shared.length} tickers are the main ticker of more than one company (${shared.slice(0, 15).map((s) => s.ticker).join(", ")})`
    : "no ticker is the main ticker of more than one company";
  return `[web] ticker owners: ${split.foreign.size} Form 4 rows in ${filings.size} filings are off the ticker they were stored under (the issuer is another company)` +
    `${off ? `; ticker (owner) rows from issuers: ${off}` : ""}` +
    `; of them ${split.changedHands.size} state the ticker but their issuer has a ticker of its own${changed ? `: ${changed}` : ""}` +
    `; ${split.kept.size} rows of an earlier registrant stay on the ticker their filing states${kept ? `: ${kept}` : ""}; ${sharedText}`;
}
