// Company size bands for the "Size" filter — estimated from SEC filings only (no price feed;
// docs/04 #33). See ingest/src/sources/sec_company_size.ts for where the inputs come from.
//
//   estimate = shares outstanding (latest 10-Q/10-K cover) × the median of the company's
//              most recent open-market Form 4 prices (last 400 days)
//   fallback = public float from the latest 10-K, when there is no single shares figure
//              (multi-class companies) or no recent Form 4 price
//   guards:   see estimateSize — shares × price needs a float on file (rules out ADS
//              issuers), and figures above $6 trillion are thrown away as filing mistakes.
//
// It is an estimate for sorting companies into wide bands, not a market capitalisation.
import type { Flagship } from "./flagship";

export type CapBand = "mega" | "large" | "mid" | "small" | "micro";
export const CAP_BANDS: { code: CapBand; label: string; range: string; min: number }[] = [
  { code: "mega", label: "Mega cap", range: "$200B and up", min: 200e9 },
  { code: "large", label: "Large cap", range: "$10B – $200B", min: 10e9 },
  { code: "mid", label: "Mid cap", range: "$2B – $10B", min: 2e9 },
  { code: "small", label: "Small cap", range: "$300M – $2B", min: 300e6 },
  { code: "micro", label: "Micro cap", range: "under $300M", min: 0 },
];

export function bandOf(value: number): CapBand {
  for (const b of CAP_BANDS) if (value >= b.min) return b.code;
  return "micro";
}

export interface SizeInput { shares: number | null; sharesAsOf: string | null; float: number | null; floatAsOf: string | null }
export interface SizeEstimate { value: number; band: CapBand; basis: "shares" | "float"; asOf: string | null; price: number | null }

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** Larger than any listed company: a figure above this is a filing mistake, not a size. */
const ABSURD = 6e12;

/**
 * Pure: one company's estimate from its filed figures and its recent Form 4 prices (newest first).
 *
 * Rules, each from a real case on the first live run (2026-10-05):
 *  - shares × price is used whenever it is available. A public float that disagrees with it by
 *    a wide margin is the float's mistake more often than not: Novanta's 10-K states a float
 *    of $3.5 TRILLION (thousands tagged as dollars) against a real value near $5 billion.
 *  - shares × price is only trusted for companies that also report a public float. Foreign
 *    issuers on Form 20-F report no float, count ORDINARY shares, and trade here as ADSs worth
 *    several shares each, so shares × ADS price overstates them (NetEase came out near $415B
 *    against a real value near $85B). They are left unsized rather than mis-sized.
 *  - any figure above ABSURD is discarded.
 */
export function estimateSize(size: SizeInput, recentPrices: number[]): SizeEstimate | null {
  const price = recentPrices.length ? median(recentPrices.slice(0, 5)) : null;
  const hasFloat = size.float != null && size.float > 0;
  const byShares = hasFloat && size.shares != null && size.shares > 0 && price != null && price > 0 ? size.shares * price : null;
  if (byShares != null && byShares <= ABSURD) return { value: byShares, band: bandOf(byShares), basis: "shares", asOf: size.sharesAsOf, price };
  const byFloat = hasFloat && size.float! <= ABSURD ? size.float! : null;
  if (byFloat != null) return { value: byFloat, band: bandOf(byFloat), basis: "float", asOf: size.floatAsOf, price: null };
  return null;
}

/** ticker → estimate, for every tracked security whose company has a size on file. */
export function sizeByTicker(m: Flagship): Map<string, SizeEstimate> {
  const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - 400);
  const cut = cutoff.toISOString().slice(0, 10);
  const out = new Map<string, SizeEstimate>();
  for (const c of m.companies.values()) {
    const size = c.cik ? m.companySize.get(c.cik.padStart(10, "0")) : undefined;
    if (!size) continue;
    // Prices from open-market, non-derivative Form 4 trades in the company's own primary
    // ticker only: another class or a derivative would price a different security.
    const primary = c.primaryTicker?.toUpperCase() ?? null;
    const prices = c.txns
      .filter((t) => t.source === "sec_form4" && t.isDerivative !== true && (t.code === "P" || t.code === "S") && (t.price ?? 0) > 0 && (t.txnDate ?? "") >= cut
        && (primary == null || t.securityId == null || m.securities.get(t.securityId)?.ticker.toUpperCase() === primary))
      .sort((a, b) => (b.txnDate ?? "").localeCompare(a.txnDate ?? ""))
      .map((t) => t.price!);
    const est = estimateSize(size, prices);
    if (!est) continue;
    for (const sid of c.securityIds) { const s = m.securities.get(sid); if (s) out.set(s.ticker.toUpperCase(), est); }
  }
  return out;
}
