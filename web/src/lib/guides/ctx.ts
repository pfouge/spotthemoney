// Live values the guides are written against: constants from the code, counts from the model,
// the current I-Bond rate from the database. A guide that quotes one of these can never
// disagree with the site, because both read the same thing.
import { getFlagship, senateShown, CONGRESS_DEADLINE_DAYS, FORM4_DEADLINE_DAYS, num } from "../flagship";
import { CAP_BANDS } from "../capband";
import { JOINT_MIN_VALUE } from "../joint";
import { HEATMAP_WINDOW_DAYS, RECENT_DAYS } from "../heatmap";
import { getLatestIBondRate, getCpiSeries } from "../db";
import { resetOutlook } from "../ibond";
import { getCoverage } from "../coverage";
import { formatDate, formatPercent } from "../format";
import { FACTS } from "./facts";

export interface GuideCtx {
  facts: typeof FACTS;
  /** Days a member of Congress has to report a trade (the site's late rule). */
  congressDeadlineDays: number;
  /** Calendar days after which the site flags a Form 4 as late. */
  form4LateAfterDays: number;
  capBands: { label: string; range: string }[];
  jointMinUsd: string;
  mapYearDays: number;
  recentDays: number;
  hasSenate: boolean;
  counts: { congressTxns: string; insiderTxns: string; tickers: string; members: string; lobbying: string; contracts: string; committees: string };
  /** Scanned or paper congressional filings held back until read by hand. */
  heldPaper: string | null;
  donationWindowDays: number;
  ibond: { composite: string; fixed: string; inflation: string; effective: string } | null;
  nextReset: string;
  usd: (n: number) => string;
  n: (n: number) => string;
}

let memo: Promise<GuideCtx> | null = null;
export function getGuideCtx(): Promise<GuideCtx> { return (memo ??= build()); }

async function build(): Promise<GuideCtx> {
  const m = await getFlagship();
  const [rate, cpi, cov] = await Promise.all([getLatestIBondRate().catch(() => null), getCpiSeries(30).catch(() => []), getCoverage().catch(() => null)]);
  const outlook = resetOutlook(cpi, rate?.fixedRate ?? null);
  const members = [...m.people.values()].filter((p) => p.isCongress && p.txns.length > 0).length;
  const held = cov?.totals?.reviewQueuePending;
  const usd = (v: number) => "$" + v.toLocaleString("en-US");
  return {
    facts: FACTS,
    congressDeadlineDays: CONGRESS_DEADLINE_DAYS,
    form4LateAfterDays: FORM4_DEADLINE_DAYS,
    capBands: CAP_BANDS.map((b) => ({ label: b.label, range: b.range })),
    jointMinUsd: usd(JOINT_MIN_VALUE),
    mapYearDays: HEATMAP_WINDOW_DAYS,
    recentDays: RECENT_DAYS,
    hasSenate: senateShown(m),
    counts: {
      congressTxns: num(m.counts.congressTxns ?? 0), insiderTxns: num(m.counts.insiderTxns ?? 0), tickers: num(m.counts.securities ?? 0),
      members: num(members), lobbying: num(m.counts.lobbying ?? 0), contracts: num(m.counts.contracts ?? 0), committees: num(m.counts.committees ?? 0),
    },
    heldPaper: typeof held === "number" && held > 0 ? num(held) : null,
    donationWindowDays: m.donationWindowDays,
    ibond: rate?.compositeRate != null ? { composite: formatPercent(rate.compositeRate), fixed: formatPercent(rate.fixedRate), inflation: formatPercent(rate.semiannualInflationRate), effective: formatDate(rate.effectiveDate) } : null,
    nextReset: formatDate(outlook.nextResetDate),
    usd, n: (v: number) => v.toLocaleString("en-US"),
  };
}
