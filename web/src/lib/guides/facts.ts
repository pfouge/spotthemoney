// Facts about the outside world that the guides state and that go stale on their own.
// One entry per fact, with the date it was checked against its source and the date by which it
// must be checked again. scripts/verify-guides.mjs lists every entry past its re-check date.
// A guide never hard-codes one of these: it reads the value from here, so one edit updates
// every guide and FAQ answer that uses it.
//
// To update: check the source, change `value` / `text`, set `asOf` to today and move `recheckBy`.

export interface Fact { asOf: string; recheckBy: string; source: string; note?: string }

export const FACTS = {
  /** Has Congress restricted members' stock trading? The most time-sensitive statement on the site. */
  tradingBan: {
    asOf: "2026-10-08", recheckBy: "2026-11-20",
    source: "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00253.htm",
    enacted: false,
    billName: "Stop Insider Trading Act (H.R. 7008)",
    houseVote: { date: "July 22, 2026", yeas: 232, nays: 198, url: "https://clerk.house.gov/Votes/2026280" },
    senateVote: { date: "September 30, 2026", yeas: 53, nays: 47, needed: 60, url: "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00253.htm" },
    note: "If a bill is enacted, rewrite the congress-stock-trading-rules guide, not just this entry.",
  },
  /** STOCK Act numbers (statute; changes only by legislation). */
  stockAct: {
    asOf: "2026-10-08", recheckBy: "2027-04-01",
    source: "https://www.law.cornell.edu/uscode/text/5/13105",
    thresholdUsd: 1000, noticeDays: 30, lateFeeUsd: 200, lateFeeAfterDays: 30,
  },
  /** FEC limits are indexed in odd-numbered years. */
  fecLimits: {
    asOf: "2026-10-08", recheckBy: "2027-02-15",
    source: "https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/contribution-limits/",
    cycle: "2025–2026", perElectionToCandidateUsd: 3500, perYearToPacUsd: 5000, perYearToNationalPartyUsd: 44300, itemizeOverUsd: 200,
  },
  /** LDA registration thresholds are adjusted every four years (next: January 1, 2029). */
  ldaThresholds: {
    asOf: "2026-10-08", recheckBy: "2029-01-05",
    source: "https://lobbyingdisclosure.house.gov/",
    firmIncomePerQuarterUsd: 3500, inHouseExpensePerQuarterUsd: 16000, effective: "January 1, 2025",
  },
  /** I Bond purchase rules (regulation). The RATE is never stored here: it comes from the database. */
  iBondRules: {
    asOf: "2026-10-08", recheckBy: "2027-04-01",
    source: "https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-359",
    annualLimitUsd: 10000, minHoldMonths: 12, penaltyMonths: 3, penaltyBeforeYears: 5, maxYears: 30,
  },
  /** Rule 10b5-1 cooling-off periods (SEC rule, effective February 27, 2023). */
  rule10b51: {
    asOf: "2026-10-08", recheckBy: "2027-10-01",
    source: "https://www.sec.gov/files/33-11138-fact-sheet.pdf",
    insiderCoolingDays: 90, insiderCoolingMaxDays: 120, othersCoolingDays: 30, checkboxSince: "April 1, 2023",
  },
  /** Section 16 reporting by insiders of foreign private issuers. */
  foreignInsiders: {
    asOf: "2026-10-08", recheckBy: "2027-10-01",
    source: "https://www.sec.gov/files/rules/final/2026/34-104903.pdf",
    since: "March 18, 2026",
  },
  /** Treasury's published curve maturities and auction line-up. */
  treasuryLineup: {
    asOf: "2026-10-08", recheckBy: "2027-10-01",
    source: "https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics",
  },
  /** USAspending reporting lag (FAR 4.604; Defense data released after 90 days). */
  contractLag: {
    asOf: "2026-10-08", recheckBy: "2027-10-01",
    source: "https://www.acquisition.gov/far/subpart-4.6",
    reportWithinBusinessDays: 3, defenseDelayDays: 90,
  },
} as const satisfies Record<string, Fact & Record<string, unknown>>;

export type FactKey = keyof typeof FACTS;
