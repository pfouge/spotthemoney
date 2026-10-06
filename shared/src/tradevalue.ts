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

export const DERIVATIVE_PRICE_FACTOR = 3;
export const STOCK_PRICE_FACTOR = 50;
/** With no other trades in the stock to compare against, a derivative "price" above this is a total. */
export const DERIVATIVE_PRICE_NO_REF = 25_000;
export const MAX_TRADE_VALUE = 1e12;

export interface TradeValueInput {
  shares: number | null | undefined;
  price: number | null | undefined;
  isDerivative?: boolean | null;
  /** Typical per-share price of the same stock: median of its open-market insider trades. */
  refPrice?: number | null;
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
