// How a stored transaction row becomes a Txn the pages show: price-box correction, option rows,
// impossible trade dates, holdings, and the rule that one trade reported in several filings
// counts once. Pure (no database, no Node APIs): lib/flagship.ts feeds it every row at build time,
// and lib/server/od.ts feeds it one entity's rows when the Worker renders a page on demand, so the
// two can never disagree about a number.
import { tradeValue, unitPrice, median, priceUnusable, WEAK_REF_ROWS, MAX_UNCONFIRMED_PRICE, MAX_IMPLIED_COMPANY_VALUE } from "@stm/shared";
import { jointDuplicates, type JointRow } from "./joint";
import { heldAfter, holdingsChange } from "./holdings";
import type { Txn } from "./flagship-core";

/** One transactions row as the queries return it (numbers already float8, dates as text). */
export interface RawTxn {
  id: number; filing_id: number; person_id: number | null; security_id: number | null; side: string; txn_code: string | null;
  is_derivative: boolean | null; txn_date: string | null; disclosed_at: string | null; amount_low: number | null; amount_high: number | null;
  shares: number | null; price: number | null; disclosure_lag_days: number | null; is_10b5_1: boolean | null; owner_type: string | null;
  asset_type: string | null; owned_after: number | null;
}
/** What a row needs to know about its filing. */
export interface FilingFacts { source: string; filedAt: string | null; sourceUrl: string | null; isPublished: boolean }

/**
 * Typical share price per security (median of open-market insider trades): the yardstick that
 * tells a per-share price from a row total typed into the price box (shared/tradevalue). Pass only
 * rows of Form 4 filings.
 */
type RefRow = { security_id: number | null; is_derivative: boolean | null; txn_code: string | null; price: number | null };
const isRefRow = (t: RefRow): t is RefRow & { security_id: number; price: number } =>
  t.security_id != null && t.is_derivative !== true && (t.txn_code === "P" || t.txn_code === "S") && t.price != null && t.price > 0;

/** Median price and the number of rows it was taken from, per security (see shared/tradevalue: WEAK_REF_ROWS). */
export function refStatsMap(rows: Iterable<RefRow>): Map<number, { price: number; rows: number }> {
  const prices = new Map<number, number[]>();
  for (const t of rows) {
    if (!isRefRow(t)) continue;
    const xs = prices.get(t.security_id); if (xs) xs.push(t.price); else prices.set(t.security_id, [t.price]);
  }
  const out = new Map<number, { price: number; rows: number }>();
  for (const [id, xs] of prices) { const m = median(xs); if (m != null) out.set(id, { price: m, rows: xs.length }); }
  return out;
}

export function refPriceMap(rows: Iterable<RefRow>): Map<number, number> {
  return new Map([...refStatsMap(rows)].map(([id, s]) => [id, s.price]));
}

/** What else the price check may know about a row's stock (shared/tradevalue: priceUnusable). */
export interface RefExtra { rows?: number | null; sharesOutstanding?: number | null }

/**
 * Stock rows whose price was not used (priceUnusable), per ticker, for the build log, so the
 * count can be compared with SQL. `tickerOf` names a security; rows without one are "(no ticker)".
 */
export function unusablePriceLog(rows: Iterable<RawTxn>, refStats: Map<number, { price: number; rows: number }>, soOf: (securityId: number) => number | null, tickerOf: (securityId: number) => string | null, label: string): string {
  const per = new Map<string, number>(); let n = 0;
  for (const t of rows) {
    if (t.security_id == null || t.is_derivative === true || !(t.shares != null && t.shares > 0)) continue;
    const s = refStats.get(t.security_id);
    if (!priceUnusable({ shares: t.shares, price: t.price, isDerivative: t.is_derivative, refPrice: s?.price ?? null, refRows: s?.rows ?? 0, sharesOutstanding: soOf(t.security_id) })) continue;
    n++; const k = tickerOf(t.security_id) ?? "(no ticker)"; per.set(k, (per.get(k) ?? 0) + 1);
  }
  const list = [...per].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, c]) => `${k} ${c}`).join(", ");
  return `[web] prices not used (${label}): ${n} Form 4 stock ${n === 1 ? "row" : "rows"} of stocks with fewer than ${WEAK_REF_ROWS} open-market trades state a price above ${MAX_UNCONFIRMED_PRICE} a share or one that values the company above ${MAX_IMPLIED_COMPANY_VALUE}${n ? `: ${list}` : ""}`;
}

/** The Txn a stored row stands for (before the joint-filing rule). */
export function buildTxn(t: RawTxn, f: FilingFacts, refPrice: number | null | undefined, ref: RefExtra = {}): Txn {
  // A security with no open-market row at all has no yardstick either: zero rows, the weak case.
  const refRows = ref.rows ?? (refPrice == null ? 0 : null);
  const basis = { shares: t.shares, price: t.price, isDerivative: t.is_derivative, refPrice, refRows, sharesOutstanding: ref.sharesOutstanding ?? null };
  const value = tradeValue(basis) ?? (t.shares != null && t.price != null && t.price > 0 ? null : t.amount_high ?? null);
  const price = unitPrice(basis) ?? t.price;
  // Options, warrants and other derivative rows are not purchases or sales of the stock: a put
  // bought is a bet against it, and the dollars are a premium, not shares × share price. They
  // stay in the tables, marked "Option · derivative", and out of every buy/sell total
  // (all of which key on side being buy or sell).
  const side = f.source === "sec_form4" && t.is_derivative === true && (t.side === "buy" || t.side === "sell") ? "option" : t.side;
  // A trade cannot be dated after the report that discloses it (one House row read 2026-12-26
  // on a filing from 2026-02-09). Such a date is a typo or a misread: drop it, keep the row.
  const filedDay = f.filedAt?.slice(0, 10) ?? t.disclosed_at;
  let txnDate = t.txn_date, lagDays = t.disclosure_lag_days;
  if (txnDate && filedDay && txnDate > filedDay) { txnDate = null; lagDays = null; }
  const txn: Txn = { id: t.id, filingId: t.filing_id, personId: t.person_id, securityId: t.security_id, side, code: t.txn_code,
    isDerivative: t.is_derivative, txnDate, disclosedAt: t.disclosed_at ?? f.filedAt?.slice(0, 10) ?? null,
    amountLow: t.amount_low, amountHigh: t.amount_high, shares: t.shares, price, lagDays,
    is10b51: t.is_10b5_1, ownerType: t.owner_type, assetType: t.asset_type, source: f.source, sourceUrl: f.sourceUrl,
    filedAt: f.filedAt, isPublished: f.isPublished, value };
  // Holdings columns: direction comes from the stored side (buy = acquired, sell = disposed),
  // read before the option / joint relabelling.
  if (f.source === "sec_form4") {
    txn.ownedAfter = heldAfter({ source: f.source, isDerivative: t.is_derivative, ownedAfter: t.owned_after });
    txn.holdingsChange = holdingsChange({ source: f.source, side: t.side, isDerivative: t.is_derivative, shares: t.shares, ownedAfter: t.owned_after });
  }
  return txn;
}

/**
 * The same trade reported in more than one filing counts once (lib/joint.ts): duplicate row id →
 * id of the row that keeps it. The filer's own page keeps the row as filed; every list that spans
 * filers gets it with side "other", which takes it out of the buy/sell totals the same way a
 * derivative row is.
 */
export function jointMap(built: Txn[], ownedAfter: Map<number, number | null>): Map<number, number> {
  return jointDuplicates(built.filter((t) => t.source === "sec_form4" && (t.side === "buy" || t.side === "sell")).map((t): JointRow =>
    ({ id: t.id, filingId: t.filingId, personId: t.personId, securityId: t.securityId, date: t.txnDate, code: t.code, isDerivative: t.isDerivative, shares: t.shares, price: t.price, value: t.value, ownedAfter: ownedAfter.get(t.id) ?? null })));
}
