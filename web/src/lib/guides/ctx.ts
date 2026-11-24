// Live values the guides are written against: constants from the code, counts from the model,
// the current I-Bond rate from the database. A guide that quotes one of these can never
// disagree with the site, because both read the same thing.
import { NOTICE_ROWS, VALUE_MAX_PER_SHARE } from "../form144";
import { YEARS_SHOWN, QUARTERS_SHOWN, MIN_IMPLIED_SHARES, RATIOS } from "../financials";
import { HOLDER_ROWS, THRESHOLD_PERCENT, RECORD_START_LABEL, TYPO_MAX_DISTANCE } from "../schedule13";
import { DESCRIPTION_SHOWN } from "../contracts";
import { EVENT_ROWS, EVENT_WINDOW_DAYS } from "../events8k";
import { PAY_YEARS, PAY_LARGE, PAY_SMALL } from "../execpay";
import { INST_TOP, INST_MIN_MANAGERS, INST_SHOWN_DAYS, quarterDate as instQuarterDate } from "../inst13f";
import { instHubShown } from "../inst13f-hub";
import { ASSISTANCE_WINDOW_DAYS } from "../assistance";
import { DLA_WINDOW_DAYS, windowLabel } from "../dla";
import { feedDef } from "../feeds";
import { ALERTS_ENABLED, ALERT_BODY_DAYS, ALERT_MAX_AGE_DAYS, ALERT_PENDING_DAYS, FEED_NEW_MAX_AGE_DAYS } from "../account";
import { WATCH_WINDOW_DAYS } from "../watchcards";
import { COMMITTEE_TRADE_ROWS } from "../committees";
import { VOTE_ROWS } from "../votes";
import { DEFAULT_PER as SCREENER_ROWS } from "../screener";
import { MAX_SAVED as SAVED_SCREENS_MAX } from "../savedscreens";
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
import { EMPLOYER_ROWS as CAMPAIGN_EMPLOYER_ROWS, STATE_ROWS as CAMPAIGN_STATE_ROWS, MAX_COMMITTEES_PER_MEMBER as CAMPAIGN_MAX_COMMITTEES, RECENT_DAYS as CAMPAIGN_RECENT_DAYS } from "../campaign";
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
  voteRows: number;
  /** Rows per page the Congress trade screener opens on (lib/screener.ts). */
  screenerRows: number;
  /** Most saved screens the Congress trade screener keeps in a browser (lib/savedscreens.ts). */
  savedScreensMax: number;
  /** Ticker history flags (lib/tickerhistory.ts): the day the record of congressional reports starts, as text
   *  ("October 1, 2025"), the days after it before a trade can be "first on record", and the shortest run flagged. */
  congressRecordStart: string; firstMinDays: number; runMin: number;
  /** Issue names shown in one lobbying table cell, and rows in an issue page's tables (lib/lobbyissues.ts). */
  issuesInline: number; issueFilingRows: number; issueTopRows: number;
  /** Campaign committees (lib/campaign.ts): how many are linked to members, the table sizes and the recent window. */
  campaignLinked: number; campaignEmployerRows: number; campaignStateRows: number; campaignMaxCommittees: number; campaignRecentDays: number;
  /** Characters of a contract description shown in a table cell (lib/contracts.ts). */
  contractDescriptionShown: number;
  /** Days back that grants, loans and direct payments are listed (lib/assistance.ts). */
  assistanceWindowDays: number;
  /** True when military parts orders were read from nsnexplorer.com for at least one company (lib/dla.ts), and the days back they cover. */
  dlaShown: boolean; dlaWindowDays: number; dlaWindow: string;
  /** True once Form 144 notices are shown on pages (lib/form144.ts), and the rows a page's table prints. */
  /** True when Form 13F holders are shown on pages (lib/inst13f.ts); managers listed per company; managers a quarter needs to count as loaded; days a load may be old; the newer quarter end as text. */
  instShown: boolean; instTop: number; instMinManagers: string; instShownDays: number; instPeriod: string;
  form144Shown: boolean; form144Rows: number;
  /** Dollars a share above which a notice's stated market value is not shown, as text ("1,000,000"). */
  form144ValueMaxPerShare: string;
  /** True once Schedule 13D and 13G statements are shown on pages (lib/schedule13.ts); the rows a page prints, the filing threshold in percent, and the month the record starts. */
  schedule13Shown: boolean; holderRows: number; holderThreshold: number; holderRecordStart: string; cusipTypoMax: number;
  /** True when company financials are on file (lib/financials.ts); the fiscal years and quarters a page shows; the share count under which earnings per share are held back, as text. */
  financialsShown: boolean; finYears: number; finQuarters: number; finMinImpliedShares: string;
  /** The limits beyond which a ratio is printed in words (lib/financials.ts RATIOS): net margin in percent, liabilities to equity. */
  finMarginCap: string; finLeCap: string;
  /** True when Form 8-K reports are on file (lib/events8k.ts); the rows a company page prints and the window in days. */
  eventsShown: boolean; eventRows: number; eventWindowDays: number;
  /** True when executive pay figures are on file (lib/execpay.ts); the fiscal years a page shows; the size ("$1 billion", "$1,000") at which a figure is marked. */
  execPayShown: boolean; payYears: number; payLarge: string; paySmall: string;
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
    voteRows: VOTE_ROWS,
    screenerRows: SCREENER_ROWS, savedScreensMax: SAVED_SCREENS_MAX,
    congressRecordStart: new Date(RECORD_START + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }), firstMinDays: FIRST_MIN_DAYS, runMin: RUN_MIN,
    issuesInline: ISSUES_INLINE, issueFilingRows: ISSUE_FILING_ROWS, issueTopRows: ISSUE_TOP_ROWS,
    campaignLinked: m.campaign.committees.length, campaignEmployerRows: CAMPAIGN_EMPLOYER_ROWS, campaignStateRows: CAMPAIGN_STATE_ROWS, campaignMaxCommittees: CAMPAIGN_MAX_COMMITTEES, campaignRecentDays: CAMPAIGN_RECENT_DAYS,
    contractDescriptionShown: DESCRIPTION_SHOWN,
    instShown: instHubShown(m), instTop: INST_TOP, instMinManagers: INST_MIN_MANAGERS.toLocaleString("en-US"), instShownDays: INST_SHOWN_DAYS, instPeriod: m.inst.period ? instQuarterDate(m.inst.period) : "",
    assistanceWindowDays: ASSISTANCE_WINDOW_DAYS,
    dlaShown: m.dla.byCompany.size > 0, dlaWindowDays: DLA_WINDOW_DAYS, dlaWindow: windowLabel(m.dla),
    form144Shown: m.form144.shown, form144Rows: NOTICE_ROWS, form144ValueMaxPerShare: VALUE_MAX_PER_SHARE.toLocaleString("en-US"),
    schedule13Shown: m.schedule13.shown, holderRows: HOLDER_ROWS, holderThreshold: THRESHOLD_PERCENT, holderRecordStart: RECORD_START_LABEL, cusipTypoMax: TYPO_MAX_DISTANCE,
    financialsShown: m.financials.byCik.size > 0, finYears: YEARS_SHOWN, finQuarters: QUARTERS_SHOWN, finMinImpliedShares: MIN_IMPLIED_SHARES.toLocaleString("en-US"),
    finMarginCap: RATIOS[0]!.cap.toLocaleString("en-US"), finLeCap: RATIOS[1]!.cap.toLocaleString("en-US"),
    eventsShown: m.events.byCik.size > 0, eventRows: EVENT_ROWS, eventWindowDays: EVENT_WINDOW_DAYS,
    execPayShown: m.execPay.byCik.size > 0, payYears: PAY_YEARS, payLarge: `$${(PAY_LARGE / 1e9).toLocaleString("en-US")} billion`, paySmall: `$${PAY_SMALL.toLocaleString("en-US")}`,
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
