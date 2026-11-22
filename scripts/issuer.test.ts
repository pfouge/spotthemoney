// Offline tests for the rule that takes a Form 4 row off a ticker another company owns. Run:
//   npx tsx --test scripts/issuer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { foreignIssuerRows, sharedMainTickers, issuerLog } from "../web/src/lib/issuer";

const securities = new Map([
  [1, { ticker: "PRU", companyId: 10 }],
  [2, { ticker: "SPY", companyId: null }],
  [3, { ticker: "KKR", companyId: 30 }],
]);
const filings = new Map([
  [100, { source: "sec_form4", companyId: 10 }],   // Prudential's own filing
  [101, { source: "sec_form4", companyId: 11 }],   // a fund's filing stored on PRU
  [102, { source: "house_ptr", companyId: null }], // a member's report
  [103, { source: "sec_form4", companyId: null }], // no issuer on record
  [104, { source: "sec_form4", companyId: 12 }],   // another fund on PRU
  [105, { source: "sec_form4", companyId: 31 }],   // a trust on KKR
]);

test("a row of the ticker's own company stays", () => {
  const out = foreignIssuerRows([{ id: 1, filing_id: 100, security_id: 1 }], filings, securities);
  assert.equal(out.size, 0);
});

test("a row whose filing names another issuer comes off the ticker", () => {
  const out = foreignIssuerRows([
    { id: 1, filing_id: 100, security_id: 1 },
    { id: 2, filing_id: 101, security_id: 1 },
    { id: 3, filing_id: 101, security_id: 1 },
  ], filings, securities);
  assert.deepEqual([...out.keys()], [2, 3]);
  assert.deepEqual(out.get(2), { securityId: 1, issuerCompanyId: 11, filingId: 101 });
});

test("nothing to compare, nothing changed", () => {
  const out = foreignIssuerRows([
    { id: 1, filing_id: 102, security_id: 1 },  // congressional row: never touched
    { id: 2, filing_id: 103, security_id: 1 },  // filing with no issuer
    { id: 3, filing_id: 101, security_id: 2 },  // security with no company
    { id: 4, filing_id: 101, security_id: null },
    { id: 5, filing_id: 999, security_id: 1 },  // filing not on the site
    { id: 6, filing_id: 101, security_id: 77 }, // security not on the site
  ], filings, securities);
  assert.equal(out.size, 0);
});

test("main tickers carried by more than one company are listed", () => {
  assert.deepEqual(sharedMainTickers([
    { name: "PRUDENTIAL FINANCIAL INC", primaryTicker: "PRU" },
    { name: "PGIM Private Credit Fund", primaryTicker: "pru" },
    { name: "Blackstone Inc.", primaryTicker: "BX" },
    { name: "No Ticker Fund", primaryTicker: null },
    { name: "Blank", primaryTicker: " " },
  ]), [{ ticker: "PRU", companies: ["PGIM Private Credit Fund", "PRUDENTIAL FINANCIAL INC"] }]);
  assert.deepEqual(sharedMainTickers([{ name: "A", primaryTicker: "A" }, { name: "B", primaryTicker: "B" }]), []);
});

test("the build-log line counts rows, filings and issuers per ticker", () => {
  const rows = [
    { id: 2, filing_id: 101, security_id: 1 }, { id: 3, filing_id: 101, security_id: 1 },
    { id: 4, filing_id: 104, security_id: 1 }, { id: 5, filing_id: 105, security_id: 3 },
  ];
  const foreign = foreignIssuerRows(rows, filings, securities);
  const names = new Map([[10, "PRUDENTIAL FINANCIAL INC"], [30, "KKR & Co. Inc."]]);
  const line = issuerLog(foreign, securities, (id) => names.get(id) ?? "?", []);
  assert.equal(line, "[web] ticker owners: 4 Form 4 rows in 3 filings name an issuer other than the company that owns the ticker; " +
    "ticker (owner) rows from issuers: PRU (PRUDENTIAL FINANCIAL INC) 3 from 2, KKR (KKR & Co. Inc.) 1 from 1; " +
    "no ticker is the main ticker of more than one company");
  const empty = issuerLog(new Map(), securities, () => "?", [{ ticker: "PRU", companies: ["a", "b"] }]);
  assert.equal(empty, "[web] ticker owners: 0 Form 4 rows in 0 filings name an issuer other than the company that owns the ticker; " +
    "1 tickers are the main ticker of more than one company (PRU)");
});
