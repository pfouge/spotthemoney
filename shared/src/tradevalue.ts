// Dollar value of one reported transaction, from the numbers on the filing.
//
// Form 4 has a "price per share" box. Most filers put a per-share (or per-option) price in it;
// some put the total paid for the whole row instead — Magnetar's CoreWeave call-option sales in
// August 2026 are the case that surfaced this (627,486 options at a "price" of $12,502,658.55,
// which is $19.925 each). Multiplying shares by that squares the quantity and produced a
// $68 trillion bar. The rule here: a derivative cannot be worth several times the share it is
// written on, and a share cannot trade at fifty times what the same stock's other insider trades
// went for — when the box says so, it holds the row total. Anything still above a trillion
// dollars is not a real trade and gets no value at all.
//
// The fifty-times test needs other trades to compare with. When a stock has only a handful
// (fewer than WEAK_REF_ROWS open-market rows), the bad rows ARE the yardstick: Simpple Ltd.
// (SPPL) had four rows in November 2026, three of them with the row total in the price box
// ($121,664 to $270,711 "a share"), so the median was itself a total and a $51 billion sale went
// through. For such a stock two more tests apply, and a row that fails either gets no dollar
// value (it stays listed with the figures as filed; nothing is guessed, because some of these
// boxes hold a total and others a price in another currency, such as Infosys rows in rupees):
//   · a price above MAX_UNCONFIRMED_PRICE a share (no stock in the data trades near it; the one
//     real case, Berkshire Hathaway class A, has no open-market insider trades);
//   · on a purchase, sale or shares handed back (codes P, S, D, F), a price above
//     IMPLIED_TEST_MIN_PRICE that, times the company's shares outstanding, would make it worth
//     more than MAX_IMPLIED_COMPANY_VALUE (only where the shares outstanding are known). Limited
//     to those codes and to prices above $100 because a foreign company's shares outstanding can
//     be counted in ordinary shares while its insiders report ADS prices: Akari (AKTX) grants at
//     $3 to $13 "valued" it above $600 billion. Grants, exercises and other codes rest on the
//     per-share ceiling alone.
// Checked on production 2026-11-24 (first deploy): the two tests caught 50 rows; with this scope
// the ones left are all mistakes (Mizuho rows in yen, Infosys and Wipro in rupees, price boxes
// holding a total).

export const DERIVATIVE_PRICE_FACTOR = 3;
export const STOCK_PRICE_FACTOR = 50;
/** With no other trades in the stock to compare against, a derivative "price" above this is a total. */
export const DERIVATIVE_PRICE_NO_REF = 25_000;
export const MAX_TRADE_VALUE = 1e12;
/** Fewer open-market rows than this and the stock's median price is not trusted as a yardstick. */
export const WEAK_REF_ROWS = 5;
/** Per-share price no weakly referenced stock row may state. */
export const MAX_UNCONFIRMED_PRICE = 100_000;
/** Company value (price × shares outstanding) no weakly referenced stock row may imply. */
export const MAX_IMPLIED_COMPANY_VALUE = 5e11;
/** The company-value test only applies above this price, and only to these Form 4 codes. */
export const IMPLIED_TEST_MIN_PRICE = 100;
export const IMPLIED_TEST_CODES = ["P", "S", "D", "F"];

export interface TradeValueInput {
  shares: number | null | undefined;
  price: number | null | undefined;
  isDerivative?: boolean | null;
  /** Typical per-share price of the same stock: median of its open-market insider trades. */
  refPrice?: number | null;
  /** How many open-market rows that median was taken from. Unset: the weak-reference tests are off. */
  refRows?: number | null;
  /** The issuer's shares outstanding, when known (company_size). */
  sharesOutstanding?: number | null;
  /** Form 4 transaction code; unset applies the company-value test as for a sale. */
  code?: string | null;
}

/** True when a stock row of a weakly referenced stock states a price that cannot be a dollar price per share. */
export function priceUnusable(t: TradeValueInput): boolean {
  const { price } = t;
  if (t.isDerivative || price == null || !(price > 0) || t.refRows == null || t.refRows >= WEAK_REF_ROWS) return false;
  if (price > MAX_UNCONFIRMED_PRICE) return true;
  if (price <= IMPLIED_TEST_MIN_PRICE || (t.code != null && !IMPLIED_TEST_CODES.includes(t.code))) return false;
  const so = t.sharesOutstanding;
  return so != null && so > 0 && price * so > MAX_IMPLIED_COMPANY_VALUE;
}

/** True when the price box holds the total for the row, not a per-unit price. */
export function priceIsRowTotal(t: TradeValueInput): boolean {
  const { shares, price } = t;
  if (shares == null || price == null || !(price > 0) || !(shares > 1)) return false;
  const ref = t.refPrice != null && t.refPrice > 0 ? t.refPrice : null;
  if (t.isDerivative) return ref != null ? price > ref * DERIVATIVE_PRICE_FACTOR : price > DERIVATIVE_PRICE_NO_REF;
  return ref != null && price > ref * STOCK_PRICE_FACTOR;
}

/** shares × price, corrected for a total in the price box; null when there is nothing usable. */
export function tradeValue(t: TradeValueInput): number | null {
  const { shares, price } = t;
  if (shares == null || price == null || !(price > 0) || !(shares > 0)) return null;
  if (priceUnusable(t)) return null;
  const v = priceIsRowTotal(t) ? price : shares * price;
  return Number.isFinite(v) && v <= MAX_TRADE_VALUE ? v : null;
}

/** Per-unit price for display: the box as filed, or total ÷ units when the box held the total. */
export function unitPrice(t: TradeValueInput): number | null {
  const { shares, price } = t;
  if (price == null || !(price > 0)) return null;
  return priceIsRowTotal(t) && shares ? price / shares : price;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
