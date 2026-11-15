// "Held after" and "Change" on insider trade rows.
//
// Every Form 4 row reports the shares the insider owns after the transaction. With the row's own
// share count that gives the holding before it, and the change as a percentage of that holding.
// Only rows whose direction is known are used: the site's own side (buy = shares acquired, sell =
// shares disposed of; codes P / S, F, D). Anything else (awards, gifts, option exercises, other
// codes, derivative rows, congressional rows) has no change and shows a dash.

/** A percentage change, "new" for a first position, or null when there is nothing safe to show. */
export type HoldingsChange = number | "new" | null;

/** Anything beyond this is a mis-filed number, not a holding change. */
export const MAX_ABS_PCT = 100_000;

export interface HoldingsInput {
  /** The row's side as the site stores it: "buy" (acquired) or "sell" (disposed). Other values give null. */
  side: string | null | undefined;
  isDerivative: boolean | null | undefined;
  /** "sec_form4" only; congressional reports carry no holdings. */
  source: string | null | undefined;
  shares: number | null | undefined;
  /** Shares owned after the transaction, as filed. */
  ownedAfter: number | null | undefined;
}

const pos = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0;

/** The "Held after" figure a row may show: non-derivative Form 4 rows with a filed holding. */
export function heldAfter(r: Pick<HoldingsInput, "isDerivative" | "source" | "ownedAfter">): number | null {
  if (r.source !== "sec_form4" || r.isDerivative === true) return null;
  const o = r.ownedAfter;
  return o != null && Number.isFinite(o) && o >= 0 ? o : null;
}

/** Percentage change in the insider's reported holding caused by this row. */
export function holdingsChange(r: HoldingsInput): HoldingsChange {
  const owned = heldAfter(r);
  if (owned == null || !pos(r.shares)) return null;
  let before: number;
  if (r.side === "sell") before = owned + r.shares;
  else if (r.side === "buy") before = owned - r.shares;
  else return null; // direction unknown: do not guess
  if (r.side === "buy" && Math.abs(before) < 1e-9) return "new";
  if (before <= 0) return null; // owned after is smaller than the purchase: an inconsistent filing
  const pct = ((owned - before) / before) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > MAX_ABS_PCT) return null;
  return pct;
}

/** Display text: "−12.4%", "+3.0%", "new", "—". Sign is always written. */
export function changeLabel(c: HoldingsChange): string {
  if (c == null) return "—";
  if (c === "new") return "new";
  const a = Math.abs(c);
  const digits = a >= 100 ? 0 : 1;
  const body = a.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (Number(body.replace(/,/g, "")) === 0) return "0.0%";
  return `${c < 0 ? "−" : "+"}${body}%`;
}

/** Sort key: "new" ranks above every number, null is empty (sorts last). */
export function changeSortKey(c: HoldingsChange): number | null {
  if (c == null) return null;
  return c === "new" ? 1e9 : c;
}

/** CSV cell: the number rounded to 2 places; blank for "new" and null. */
export function changeCsv(c: HoldingsChange): number | null {
  return typeof c === "number" ? Math.round(c * 100) / 100 : null;
}
