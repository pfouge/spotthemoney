// The fixed set of financial-statement figures the site keeps for each tracked company, read from
// the SEC's XBRL "companyfacts" data (table company_financials, migration 0032).
//
// A company can state the same thing under different tags over the years (Revenues, then
// RevenueFromContractWithCustomerExcludingAssessedTax), and foreign filers use the IFRS taxonomy.
// Each concept lists its tags in priority order; the reader takes, for each period, the first tag
// that has a figure for it. Tags are written `taxonomy:Tag`.

/** Periods ending before this date are not kept (YYYY-MM-DD). */
export const FIN_FLOOR = "2023-01-01";

/** Annual and quarterly report forms the figures are taken from, amendments included. */
export const FIN_FORMS: readonly string[] = [
  "10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A",
];

export interface FinConcept {
  key: string;
  label: string;
  tags: string[];
}

export const FIN_CONCEPTS: FinConcept[] = [
  { key: "revenue", label: "Revenue", tags: [
    "us-gaap:Revenues",
    "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
    "us-gaap:SalesRevenueNet",
    "us-gaap:RevenuesNetOfInterestExpense",
    "ifrs-full:Revenue",
  ] },
  { key: "net_income", label: "Net income", tags: [
    "us-gaap:NetIncomeLoss",
    "us-gaap:ProfitLoss",
    "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic",
    "ifrs-full:ProfitLoss",
    "ifrs-full:ProfitLossAttributableToOwnersOfParent",
  ] },
  { key: "eps_diluted", label: "Diluted earnings per share", tags: [
    "us-gaap:EarningsPerShareDiluted",
    "us-gaap:EarningsPerShareBasicAndDiluted",
    "ifrs-full:DilutedEarningsLossPerShare",
  ] },
  { key: "operating_cash_flow", label: "Cash from operations", tags: [
    "us-gaap:NetCashProvidedByUsedInOperatingActivities",
    "us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    "ifrs-full:CashFlowsFromUsedInOperatingActivities",
  ] },
  { key: "capex", label: "Capital expenditure", tags: [
    "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment",
    "us-gaap:PaymentsToAcquireProductiveAssets",
    "ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
  ] },
  { key: "assets", label: "Total assets", tags: ["us-gaap:Assets", "ifrs-full:Assets"] },
  { key: "liabilities", label: "Total liabilities", tags: ["us-gaap:Liabilities", "ifrs-full:Liabilities"] },
  { key: "liabilities_and_equity", label: "Liabilities and equity", tags: [
    "us-gaap:LiabilitiesAndStockholdersEquity",
    "ifrs-full:EquityAndLiabilities",
  ] },
  { key: "equity", label: "Shareholders' equity", tags: [
    "us-gaap:StockholdersEquity",
    "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "ifrs-full:EquityAttributableToOwnersOfParent",
    "ifrs-full:Equity",
  ] },
  { key: "cash", label: "Cash and equivalents", tags: [
    "us-gaap:CashAndCashEquivalentsAtCarryingValue",
    "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "ifrs-full:CashAndCashEquivalents",
  ] },
  { key: "long_term_debt", label: "Long-term debt", tags: [
    "us-gaap:LongTermDebt",
    "us-gaap:LongTermDebtNoncurrent",
    "us-gaap:LongTermDebtAndCapitalLeaseObligations",
    "ifrs-full:Borrowings",
  ] },
];
