// Offline parser test for the Form 4 ownership XML (no network). Run:
//   npx tsx --test ingest/src/sources/sec_form4.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseForm4Xml, slugifyCompany, primaryTicker } from "./sec_form4.js";

const XML = `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>2026-09-15</periodOfReport>
  <notSubjectToSection16>0</notSubjectToSection16>
  <aff10b5One>1</aff10b5One>
  <issuer>
    <issuerCik>0001045810</issuerCik>
    <issuerName>NVIDIA CORP</issuerName>
    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001234567</rptOwnerCik>
      <rptOwnerName>Doe Jane</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>0</isDirector>
      <isOfficer>1</isOfficer>
      <officerTitle>Chief Financial Officer</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-09-15</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>10000</value></transactionShares>
        <transactionPricePerShare><value>171.25</value><footnoteId id="F1"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>250000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <derivativeTable>
    <derivativeTransaction>
      <securityTitle><value>Restricted Stock Unit</value></securityTitle>
      <transactionDate><value>2026-09-15</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>M</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>10000</value></transactionShares>
        <transactionPricePerShare><value>0</value></transactionPricePerShare>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>40000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>I</value></directOrIndirectOwnership></ownershipNature>
    </derivativeTransaction>
  </derivativeTable>
  <footnotes><footnote id="F1">Weighted average price; range $170.10 to $172.40.</footnote></footnotes>
</ownershipDocument>`;

test("parses issuer, owner, transactions, 10b5-1 flag and post-transaction fields", () => {
  const p = parseForm4Xml(XML);
  assert.equal(p.issuerCik, "0001045810");
  assert.equal(p.issuerTradingSymbol, "NVDA");
  assert.equal(p.rptOwnerName, "Doe Jane");
  assert.equal(p.isOfficer, true);
  assert.equal(p.officerTitle, "Chief Financial Officer");
  assert.equal(p.aff10b5One, true);
  assert.equal(p.transactions.length, 2);
  const [sale, rsu] = p.transactions;
  assert.equal(sale!.transactionCode, "S");
  assert.equal(sale!.transactionShares, 10000);
  assert.equal(sale!.transactionPricePerShare, 171.25);
  assert.equal(sale!.sharesOwnedAfter, 250000);
  assert.equal(sale!.ownership, "D");
  assert.equal(sale!.isDerivative, false);
  assert.equal(rsu!.transactionCode, "M");
  assert.equal(rsu!.isDerivative, true);
  assert.equal(rsu!.ownership, "I");
  assert.equal(p.footnotes.length, 1);
});

test("aff10b5One is null when the element is absent (pre-2023 filings)", () => {
  const p = parseForm4Xml(XML.replace("<aff10b5One>1</aff10b5One>", ""));
  assert.equal(p.aff10b5One, null);
});

test("company slug", () => {
  assert.equal(slugifyCompany("NVIDIA CORP", "0001045810"), "nvidia-corp");
  assert.equal(slugifyCompany("Berkshire Hathaway Inc.", "1"), "berkshire-hathaway-inc");
  assert.equal(slugifyCompany(null, "0000001"), "cik-0000001");
});

test("primaryTicker keeps one clean symbol from multi-class or junk issuerTradingSymbol values", () => {
  assert.equal(primaryTicker("LEN, LEN.B"), "LEN");
  assert.equal(primaryTicker("BRK.A / BRK.B"), "BRK.A");
  assert.equal(primaryTicker("googl goog"), "GOOGL");
  assert.equal(primaryTicker(" NVDA "), "NVDA");
  assert.equal(primaryTicker("NONE"), null);
  assert.equal(primaryTicker("N/A"), null);
  assert.equal(primaryTicker(""), null);
  assert.equal(primaryTicker(null), null);
});
