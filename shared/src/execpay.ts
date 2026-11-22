// Executive pay figures from the SEC "Pay Versus Performance" tables, read from the XBRL frames API
// (taxonomy `ecd`, Executive Compensation Disclosure; table exec_pay, migration 0039).
//
// Each measure is one tag of the ecd taxonomy, in US dollars. A company reports the first two for its
// principal executive officer (PEO, usually the CEO) and the last two as an average over its other
// named executive officers.

export const EXEC_PAY_TAXONOMY = "ecd";
export const EXEC_PAY_UNIT = "USD";

export interface ExecPayMeasure {
  key: "peo_total" | "peo_actually_paid" | "neo_avg_total" | "neo_avg_actually_paid";
  tag: string;
  label: string;
}

export const EXEC_PAY_MEASURES: readonly ExecPayMeasure[] = [
  { key: "peo_total", tag: "PeoTotalCompAmt", label: "Principal executive officer: total pay in the summary compensation table" },
  { key: "peo_actually_paid", tag: "PeoActuallyPaidCompAmt", label: "Principal executive officer: compensation actually paid" },
  { key: "neo_avg_total", tag: "NonPeoNeoAvgTotalCompAmt", label: "Other named executive officers: average total pay in the summary compensation table" },
  { key: "neo_avg_actually_paid", tag: "NonPeoNeoAvgCompActuallyPaidAmt", label: "Other named executive officers: average compensation actually paid" },
];
