// Sales of shares from options exercised the same day ("exercise and sell").
//
// An executive paid in options turns them into cash by exercising them (Form 4 code M, or X for
// an option exercised on the market) and selling the shares at once (code S), usually in the same
// filing. Such a sale says little about what the insider thinks of the stock: it is how the pay is
// collected, and nobody buys shares that way. On the charts of buying against selling and on the
// trade map these sales are left out by default (Peter, 2026-11-24); the trade map has a switch to
// show them, and every table still lists them.
//
// The rule is mechanical: a Form 4 row with code S whose own filing also has a row with code M or
// X dated the same day. Derivative and stock exercise rows both count (a filer may report only
// one of the two). The whole sale row is marked, also when more shares were sold than exercised:
// the form does not say which shares were sold. Rows with no trade date are never marked.
// Measured on production 2026-11-24 (tracked companies, open-market sales outside 10b5-1 plans,
// last 30 days): 416 of 1,151 sale rows, $1.2 billion of $4.7 billion.
// Tests: scripts/exercise.test.ts.

import type { Txn } from "./flagship-core";

export const EXERCISE_CODES = ["M", "X"] as const;

type Row = Pick<Txn, "id" | "filingId" | "source" | "code" | "txnDate"> & { exerciseSale?: boolean };

/** Marks exercise sales in place (`exerciseSale = true`) and returns how many rows were marked. */
export function markExerciseSales(txns: Iterable<Row>): number {
  const rows = [...txns];
  const exercised = new Set<string>();
  for (const t of rows) {
    if (t.source === "sec_form4" && t.txnDate && (t.code === "M" || t.code === "X")) exercised.add(`${t.filingId}|${t.txnDate}`);
  }
  let n = 0;
  for (const t of rows) {
    if (t.source === "sec_form4" && t.code === "S" && t.txnDate && exercised.has(`${t.filingId}|${t.txnDate}`)) { t.exerciseSale = true; n++; }
  }
  return n;
}

/** True for a sale of shares from options exercised the same day. */
export const isExerciseSale = (t: { exerciseSale?: boolean }): boolean => t.exerciseSale === true;

/** One build-log line to compare with SQL: marked rows and their dollars (open-market, outside plans, buy/sell side only). */
export function exerciseLog(txns: Iterable<Txn>, label: string): string {
  let rows = 0, dollars = 0, sales = 0, saleDollars = 0;
  for (const t of txns) {
    if (t.source !== "sec_form4" || t.code !== "S" || t.side !== "sell" || t.is10b51 === true) continue;
    sales++; saleDollars += t.value ?? 0;
    if (t.exerciseSale) { rows++; dollars += t.value ?? 0; }
  }
  const b = (v: number) => `$${(v / 1e9).toFixed(2)}B`;
  return `[web] exercise sales (${label}): ${rows} of ${sales} open-market sale rows outside 10b5-1 plans follow an option exercise in the same filing on the same day, ${b(dollars)} of ${b(saleDollars)}`;
}
