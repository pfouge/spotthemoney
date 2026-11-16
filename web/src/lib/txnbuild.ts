// How a stored transaction row becomes a Txn the pages show: price-box correction, option rows,
// impossible trade dates, holdings, and the rule that one trade reported in several filings
// counts once. Pure (no database, no Node APIs): lib/flagship.ts feeds it every row at build time,
// and lib/server/od.ts feeds it one entity's rows when the Worker renders a page on demand, so the
// two can never disagree about a number.
import { tradeValue, unitPrice, median } from "@stm/shared";
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
export function refPriceMap(rows: Iterable<{ security_id: number | null; is_derivative: boolean | null; txn_code: string | null; price: number | null }>): Map<number, number> {
  const refPrices = new Map<number, number[]>();
  for (const t of rows) {
    if (t.security_id == null || t.is_derivative === true || !(t.txn_code === "P" || t.txn_code === "S") || !(t.price != null && t.price > 0)) continue;
    const xs = refPrices.get(t.security_id); if (xs) xs.push(t.price); else refPrices.set(t.security_id, [t.price]);
  }
  const refPrice = new Map<number, number>();
  for (const [id, xs] of refPrices) { const m = median(xs); if (m != null) refPrice.set(id, m); }
  return refPrice;
}

/** The Txn a stored row stands for (before the joint-filing rule). */
export function buildTxn(t: RawTxn, f: FilingFacts, refPrice: number | null | undefined): Txn {
  const basis = { shares: t.shares, price: t.price, isDerivative: t.is_derivative, refPrice };
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
