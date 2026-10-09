// /data/trade-cross.json — per-ticker dollar totals for "the other group" on a one-group page.
//
// The scatter view of the trade map (scripts/scatter.ts) puts the page's own group across and the
// other group up and down. /congress/ loads only congressional rows and /insiders/ only Form 4
// rows, and the full insiders file is megabytes, so the other axis comes from this small file:
// for each window the map offers, each ticker's dollars bought and sold by Congress and by
// corporate insiders. Insider figures use the map's defaults (open-market codes P and S,
// Rule 10b5-1 plan trades left out); windows count from the disclosure date, as on the map,
// measured back from the build date. The home page does not use this file: it has both sets of
// rows loaded and applies the reader's own filters to each.
import type { CongressRow, InsiderRow } from "./heatmap";

export const CROSS_WINDOWS = [7, 30, 90, 365] as const;
/** ticker → [bought, sold] for each window in CROSS_WINDOWS order: [b7, s7, b30, s30, b90, s90, b365, s365]. */
export type CrossTotals = Record<string, number[]>;
export interface CrossFile { builtAt: string; windows: number[]; congress: CrossTotals; insiders: CrossTotals }

const dayBefore = (iso: string, days: number): string => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };

function totals<R extends { t: string; s: string; v: number; d: string; f: string | null }>(rows: R[], builtAt: string, keep: (r: R) => boolean): CrossTotals {
  const cuts = CROSS_WINDOWS.map((w) => dayBefore(builtAt, w));
  const out: CrossTotals = {};
  for (const r of rows) {
    if (!keep(r) || (r.s !== "buy" && r.s !== "sell") || !(r.v > 0)) continue;
    const day = r.f ?? r.d;
    let a = out[r.t];
    cuts.forEach((cut, i) => {
      if (day < cut) return;
      if (!a) a = out[r.t] = new Array(CROSS_WINDOWS.length * 2).fill(0);
      a[i * 2 + (r.s === "buy" ? 0 : 1)]! += r.v;
    });
  }
  for (const a of Object.values(out)) for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i]!);
  return out;
}

export function crossFile(congress: CongressRow[], insiders: InsiderRow[], builtAt: string): CrossFile {
  return {
    builtAt, windows: [...CROSS_WINDOWS],
    congress: totals(congress, builtAt, () => true),
    insiders: totals(insiders, builtAt, (r) => (r.c === "P" || r.c === "S") && !r.pl),
  };
}
