// Live values the guides are written against: constants from the code, counts from the model,
// the current I-Bond rate from the database. A guide that quotes one of these can never
// disagree with the site, because both read the same thing.
import { feedDef } from "../feeds";
import { ALERTS_ENABLED, ALERT_BODY_DAYS, ALERT_MAX_AGE_DAYS, ALERT_PENDING_DAYS, FEED_NEW_MAX_AGE_DAYS } from "../account";
import { WATCH_WINDOW_DAYS } from "../watchcards";
import { COMMITTEE_TRADE_ROWS } from "../committees";
import { DEFAULT_PER as SCREENER_ROWS } from "../screener";
import { RECORD_START, FIRST_MIN_DAYS, RUN_MIN } from "../tickerhistory";
import { getFlagship, senateShown, CONGRESS_DEADLINE_DAYS, FORM4_DEADLINE_DAYS, num } from "../flagship";
import { CAP_BANDS } from "../capband";
import { JOINT_MIN_VALUE } from "../joint";
import { HEATMAP_WINDOW_DAYS, RECENT_DAYS } from "../heatmap";
import { getLatestIBondRate, getCpiSeries } from "../db";
import { resetOutlook } from "../ibond";
import { getCoverage } from "../coverage";
import { formatDate, formatPercent } from "../format";
import { FACTS } from "./facts";
import { FORM4_FLOOR } from "@stm/shared";
import { ISSUES_INLINE, ISSUE_FILING_ROWS, ISSUE_TOP_ROWS } from "../lobbyissues";
import { FEED_CAPS, CLUSTER_MIN_INSIDERS, CLUSTER_DAYS, STAKE_MIN_PCT, STAKE_MIN_VALUE, LARGE_SALE_MIN, CONGRESS_MIN_LOW, CLUSTER_SELL_MIN_INSIDERS, CLUSTER_SELL_MIN_VALUE, CLUSTER_SELL_MIN_PCT } from "../notable";

export interface GuideCtx {
  facts: typeof FACTS;
  /** Days a member of Congress has to report a trade (the site's late rule). */
  congressDeadlineDays: number;
  /** Days of trades counted in the watchlist cards (lib/watchcards.ts). */
  watchWindowDays: number; feedNewMaxAgeDays: number;
  /** Email digests: the site switch (lib/account.ts) and the two retention periods. */
  alertsEnabled: boolean; alertPendingDays: number; alertBodyDays: number; alertMaxAgeDays: number;
  /** Item limits of the RSS feeds (lib/feeds.ts). */
  feedCongressItems: number; feedPurchaseItems: number; feedInsiderItems: number;
  /** Rows in a committee page's trade table (lib/committees.ts). */
  committeeTradeRows: number;
  /** Rows per page the Congress trade screener opens on (lib/screener.ts). */
  screenerRows: number;
  /** Ticker history flags (lib/tickerhistory.ts): the day the record of congressional reports starts, as text
   *  ("October 1, 2025"), the days after it before a trade can be "first on record", and the shortest run flagged. */
  congressRecordStart: string; firstMinDays: number; runMin: number;
  /** Issue names shown in one lobbying table cell, and rows in an issue page's tables (lib/lobbyissues.ts). */
  issuesInline: number; issueFilingRows: number; issueTopRows: number;
  /** First filing date of the Form 4 record, as text ("October 1, 2025"). */
  form4Floor: string;
  /** Calendar days after which the site flags a Form 4 as late. */
  form4LateAfterDays: number;
  capBands: { label: string; range: string }[];
  jointMinUsd: string;
  mapYearDays: number;
  recentDays: number;
  hasSenate: boolean;
  /** Thresholds of the home page notable-trades feed (lib/notable.ts). */
  notable: { clusterInsiders: number; clusterDays: number; stakePct: number; stakeValue: string; largeSale: string; congressLow: string; sellInsiders: number; sellValue: string; sellPct: number; capBuys: string; capSales: string };
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
    watchWindowDays: WATCH_WINDOW_DAYS, feedNewMaxAgeDays: FEED_NEW_MAX_AGE_DAYS,
    alertsEnabled: ALERTS_ENABLED, alertPendingDays: ALERT_PENDING_DAYS, alertBodyDays: ALERT_BODY_DAYS, alertMaxAgeDays: ALERT_MAX_AGE_DAYS,
    feedCongressItems: feedDef("congress-trades").limit, feedPurchaseItems: feedDef("insider-purchases").limit, feedInsiderItems: feedDef("insider-trades").limit,
    committeeTradeRows: COMMITTEE_TRADE_ROWS,
    screenerRows: SCREENER_ROWS,
    congressRecordStart: new Date(RECORD_START + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }), firstMinDays: FIRST_MIN_DAYS, runMin: RUN_MIN,
    issuesInline: ISSUES_INLINE, issueFilingRows: ISSUE_FILING_ROWS, issueTopRows: ISSUE_TOP_ROWS,
    form4Floor: new Date(FORM4_FLOOR + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
    form4LateAfterDays: FORM4_DEADLINE_DAYS,
    capBands: CAP_BANDS.map((b) => ({ label: b.label, range: b.range })),
    jointMinUsd: usd(JOINT_MIN_VALUE),
    mapYearDays: HEATMAP_WINDOW_DAYS,
    recentDays: RECENT_DAYS,
    hasSenate: senateShown(m),
    notable: { clusterInsiders: CLUSTER_MIN_INSIDERS, clusterDays: CLUSTER_DAYS, stakePct: STAKE_MIN_PCT, stakeValue: usd(STAKE_MIN_VALUE), largeSale: usd(LARGE_SALE_MIN), congressLow: usd(CONGRESS_MIN_LOW), sellInsiders: CLUSTER_SELL_MIN_INSIDERS, sellValue: usd(CLUSTER_SELL_MIN_VALUE), sellPct: CLUSTER_SELL_MIN_PCT, capBuys: `${FEED_CAPS.buys[1]}, ${FEED_CAPS.buys[7]} and ${FEED_CAPS.buys[30]}`, capSales: `${FEED_CAPS.sales[1]}, ${FEED_CAPS.sales[7]} and ${FEED_CAPS.sales[30]}` },
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
