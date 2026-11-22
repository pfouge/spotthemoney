// Offline tests for the rule that takes a Form 4 row off a ticker another company owns. Run:
//   npx tsx --test scripts/issuer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { foreignIssuerRows, sharedMainTickers, issuerLog, statedSymbols, statesTicker } from "../web/src/lib/issuer";

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
  [106, { source: "sec_form4", companyId: 13 }],   // an earlier registrant of the same stock
  [107, { source: "sec_form4", companyId: 14 }],   // another issuer, no symbol on record
  [108, { source: "sec_form4", companyId: 15 }],   // the ticker's former holder, now listed under another ticker
]);
// Company 15 has a ticker of its own in the SEC's list; the others do not.
const own = (companyId: number) => companyId === 15;
// What each filing states as its issuer's trading symbol.
const stated = new Map<number, string | null>([
  [100, "PRU"], [101, "NONE"], [103, "PRU"], [104, "N/A"], [105, "KRST"], [106, "PRU"], [107, null], [108, "PRU"],
]);

test("a row of the ticker's own company stays", () => {
  const out = foreignIssuerRows([{ id: 1, filing_id: 100, security_id: 1 }], filings, securities, stated, own);
  assert.equal(out.foreign.size, 0);
  assert.equal(out.kept.size, 0);
  assert.equal(out.changedHands.size, 0);
});

test("a row whose filing names another issuer comes off the ticker", () => {
  const out = foreignIssuerRows([
    { id: 1, filing_id: 100, security_id: 1 },
    { id: 2, filing_id: 101, security_id: 1 },
    { id: 3, filing_id: 101, security_id: 1 },
  ], filings, securities, stated, own);
  assert.deepEqual([...out.foreign.keys()], [2, 3]);
  assert.deepEqual(out.foreign.get(2), { securityId: 1, issuerCompanyId: 11, filingId: 101 });
  assert.equal(out.kept.size, 0);
});

test("an earlier registrant's row stays when its filing states the ticker and it has no ticker of its own", () => {
  const out = foreignIssuerRows([
    { id: 7, filing_id: 106, security_id: 1 },  // states PRU, issuer not in the SEC's list: the same listed stock
    { id: 8, filing_id: 105, security_id: 3 },  // states another symbol: comes off KKR
    { id: 9, filing_id: 107, security_id: 1 },  // no symbol on record: left alone, not counted
    { id: 10, filing_id: 108, security_id: 1 }, // states PRU, but the issuer now has another ticker: the symbol changed hands
  ], filings, securities, stated, own);
  assert.deepEqual([...out.kept.keys()], [7]);
  assert.deepEqual([...out.foreign.keys()], [8, 10]);
  assert.deepEqual([...out.changedHands.keys()], [10]);
});

test("with no SEC list every issuer counts as listed, so nothing is kept", () => {
  const out = foreignIssuerRows([{ id: 7, filing_id: 106, security_id: 1 }], filings, securities, stated, () => true);
  assert.equal(out.kept.size, 0);
  assert.deepEqual([...out.foreign.keys()], [7]);
});

test("the symbols a filing states", () => {
  assert.deepEqual(statedSymbols("LEN, LEN.B"), ["LEN", "LEN.B"]);
  assert.deepEqual(statedSymbols("[ABUS]"), ["ABUS"]);
  assert.deepEqual(statedSymbols("brk.a / brk.b"), ["BRK.A", "BRK.B"]);
  for (const v of ["NONE", "N/A", "n/a", "NA", "", "  ", null, undefined, "<b>", "NOT APPLICABLE TO THIS"]) {
    assert.equal(statesTicker(v as string | null, "PRU"), false, String(v));
  }
  assert.deepEqual(statedSymbols("NONE"), []);
  assert.ok(statesTicker("GOOGL GOOG", "GOOG"));
  assert.ok(statesTicker("BRK-B", "BRK.B"));
  assert.ok(!statesTicker("ASST", "SATS"));
  assert.ok(!statesTicker("PRUX", "PRU"));
});

test("nothing to compare, nothing changed", () => {
  const out = foreignIssuerRows([
    { id: 1, filing_id: 102, security_id: 1 },  // congressional row: never touched
    { id: 2, filing_id: 103, security_id: 1 },  // filing with no issuer
    { id: 3, filing_id: 101, security_id: 2 },  // security with no company
    { id: 4, filing_id: 101, security_id: null },
    { id: 5, filing_id: 999, security_id: 1 },  // filing not on the site
    { id: 6, filing_id: 101, security_id: 77 }, // security not on the site
  ], filings, securities, stated, own);
  assert.equal(out.foreign.size, 0);
  assert.equal(out.kept.size, 0);
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
    { id: 7, filing_id: 106, security_id: 1 }, { id: 10, filing_id: 108, security_id: 1 },
  ];
  const foreign = foreignIssuerRows(rows, filings, securities, stated, own);
  const names = new Map([[10, "PRUDENTIAL FINANCIAL INC"], [30, "KKR & Co. Inc."]]);
  const line = issuerLog(foreign, securities, (id) => names.get(id) ?? "?", []);
  assert.equal(line, "[web] ticker owners: 5 Form 4 rows in 4 filings are off the ticker they were stored under (the issuer is another company); " +
    "ticker (owner) rows from issuers: PRU (PRUDENTIAL FINANCIAL INC) 4 from 3, KKR (KKR & Co. Inc.) 1 from 1; " +
    "of them 1 state the ticker but their issuer has a ticker of its own: PRU (PRUDENTIAL FINANCIAL INC) 1 from 1; " +
    "1 rows of an earlier registrant stay on the ticker their filing states: PRU (PRUDENTIAL FINANCIAL INC) 1 from 1; " +
    "no ticker is the main ticker of more than one company");
  const empty = issuerLog({ foreign: new Map(), kept: new Map(), changedHands: new Map() }, securities, () => "?", [{ ticker: "PRU", companies: ["a", "b"] }]);
  assert.equal(empty, "[web] ticker owners: 0 Form 4 rows in 0 filings are off the ticker they were stored under (the issuer is another company); " +
    "of them 0 state the ticker but their issuer has a ticker of its own; " +
    "0 rows of an earlier registrant stay on the ticker their filing states; " +
    "1 tickers are the main ticker of more than one company (PRU)");
});
