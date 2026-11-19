import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMasterIndex144, blocks, leaf, cleanText, parseFormDate, parseAmount, extractForm144Xml, leafTags,
  parseForm144Xml, hasShape, toPayload, noticeIndexUrl, parseSubmissionHeader, readRetryList, retryFromQuarantine,
} from "./sec_form144.js";

const MASTER = [
  "Description:           Master Index of EDGAR Dissemination Feed",
  "",
  "CIK|Company Name|Form Type|Date Filed|File Name",
  "--------------------------------------------------------------------------------",
  "1045810|NVIDIA CORP|144|20261001|edgar/data/1045810/0009900144-26-000001.txt",
  "9000001|ALICE ALPHA|144|20261001|edgar/data/9000001/0009900144-26-000001.txt",
  "9100001|ACME|144/A|20261001|edgar/data/9100001/0009900144-26-000003.txt",
  "1045810|NVIDIA CORP|4|20261001|edgar/data/1045810/0009900001-26-000001.txt",
  "1045810|NVIDIA CORP|1440|20261001|edgar/data/1045810/0009900001-26-000002.txt",
  "abc|BAD CIK|144|20261001|edgar/data/1/0009900144-26-000009.txt",
  "9100001|ACME|144|2026101|edgar/data/9100001/0009900144-26-000010.txt",
].join("\n");

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://example.test/144" xmlns:com="http://example.test/common">
  <headerData><submissionType>144</submissionType>
    <filerInfo><filer><filerCredentials><cik>0009000001</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer></filerInfo>
  </headerData>
  <formData>
    <issuerInfo>
      <issuerCik>1045810</issuerCik>
      <issuerName>WELLS &amp; SONS  CORP</issuerName>
      <issuerAddress><com:street1>1 Secret St</com:street1></issuerAddress>
      <issuerContactPhone>4085550100</issuerContactPhone>
      <nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>Alpha Alice</nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>
      <relationshipsToIssuer><relationshipToIssuer>Officer</relationshipToIssuer><relationshipToIssuer>Director</relationshipToIssuer><relationshipToIssuer>Officer</relationshipToIssuer></relationshipsToIssuer>
    </issuerInfo>
    <securitiesInformation>
      <securitiesClassTitle>Common</securitiesClassTitle>
      <brokerOrMarketmakerDetails><name>Example Brokerage</name><address><street1>1 Main St</street1></address></brokerOrMarketmakerDetails>
      <noOfUnitsSold>12,500</noOfUnitsSold>
      <aggregateMarketValue>2256250.00</aggregateMarketValue>
      <noOfUnitsOutstanding>2440000000</noOfUnitsOutstanding>
      <approxSaleDate>10/03/2026</approxSaleDate>
      <securitiesExchangeName>NASDAQ</securitiesExchangeName>
    </securitiesInformation>
    <securitiesInformation>
      <securitiesClassTitle>Class B</securitiesClassTitle>
      <noOfUnitsSold>500</noOfUnitsSold>
      <aggregateMarketValue>90000</aggregateMarketValue>
      <approxSaleDate>10/01/2026</approxSaleDate>
    </securitiesInformation>
    <securitiesToBeSold>
      <securitiesClassTitle>Common</securitiesClassTitle>
      <acquiredDate>03/15/2024</acquiredDate>
      <natureOfAcquisitionTransaction>Restricted stock vesting</natureOfAcquisitionTransaction>
      <nameOfPersonfromWhomAcquired>Issuer</nameOfPersonfromWhomAcquired>
      <isGiftTransaction>N</isGiftTransaction>
      <amountOfSecuritiesAcquired>13000</amountOfSecuritiesAcquired>
      <paymentDate>not a date</paymentDate>
      <natureOfPayment>Compensation</natureOfPayment>
    </securitiesToBeSold>
    <securitiesSoldInPast3Months>
      <sellerDetails><name>Alpha Alice</name><address><street1>9 Private Rd</street1></address></sellerDetails>
      <securitiesClassTitle>Common</securitiesClassTitle>
      <saleDate>08/15/2026</saleDate><amountOfSecuritiesSold>5000</amountOfSecuritiesSold><grossProceeds>875000.00</grossProceeds>
    </securitiesSoldInPast3Months>
    <securitiesSoldInPast3Months>
      <sellerDetails><name>Alpha Alice</name></sellerDetails>
      <saleDate>09/02/2026</saleDate><amountOfSecuritiesSold>2500</amountOfSecuritiesSold><grossProceeds>450000</grossProceeds>
    </securitiesSoldInPast3Months>
    <remarks>Plan &lt;one&gt;</remarks>
    <noticeSignature><noticeDate>10/01/2026</noticeDate>
      <planAdoptionDates><planAdoptionDate>06/30/2026</planAdoptionDate><planAdoptionDate>03/01/2026</planAdoptionDate></planAdoptionDates>
      <signature>/s/ Alpha Alice</signature></noticeSignature>
  </formData>
</edgarSubmission>`;

test("master index: only 144 and 144/A, one row per accession, bad rows dropped", () => {
  const rows = parseMasterIndex144(MASTER);
  assert.deepEqual(rows.map((r) => [r.accession, r.form, r.filedAt, r.cik]), [
    ["0009900144-26-000001", "144", "2026-10-01", "1045810"],
    ["0009900144-26-000003", "144/A", "2026-10-01", "9100001"],
  ]);
  assert.deepEqual(parseMasterIndex144(""), []);
});

test("xml helpers: blocks ignore prefixes, case and look-alike names; leaf takes the first with text", () => {
  assert.deepEqual(blocks("<a:name>x</a:name><NAME attr='1'>y</NAME><nameOfPerson>z</nameOfPerson>", "name"), ["x", "y"]);
  assert.equal(leaf("<a> </a><b>two  words</b>", "a", "b"), "two words");
  assert.equal(leaf("<a/>", "a"), null);
  assert.equal(cleanText("  A &amp; B <i>c</i>\n d "), "A & B c d");
  assert.equal(cleanText("x".repeat(400))!.length, 300);
  assert.equal(cleanText("   "), null);
});

test("dates: US and ISO forms, real calendar dates only", () => {
  assert.equal(parseFormDate("10/03/2026"), "2026-10-03");
  assert.equal(parseFormDate("1/3/2026"), "2026-01-03");
  assert.equal(parseFormDate("2026-10-03"), "2026-10-03");
  assert.equal(parseFormDate("2026-10-03T00:00:00"), "2026-10-03");
  assert.equal(parseFormDate("13/45/2026"), null);
  assert.equal(parseFormDate("02/30/2026"), null);
  assert.equal(parseFormDate("10/03/26"), null);
  assert.equal(parseFormDate("soon"), null);
  assert.equal(parseFormDate(null), null);
});

test("amounts: commas and a dollar sign are read; anything else is empty", () => {
  assert.equal(parseAmount("12,500"), 12500);
  assert.equal(parseAmount("$ 2,256,250.00"), 2256250);
  assert.equal(parseAmount("0"), 0);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("1e9"), null);
  assert.equal(parseAmount("about 500"), null);
  assert.equal(parseAmount(null), null);
});

test("submission text: the form's XML is found; a submission without one gives null", () => {
  assert.ok(extractForm144Xml(`<XML>\n<other/>\n</XML>\n<XML>\n${XML}\n</XML>`)?.includes("<issuerInfo>"));
  assert.equal(extractForm144Xml("<XML><ownershipDocument/></XML>"), null);
  assert.equal(extractForm144Xml("<PDF>begin 644</PDF>"), null);
});

test("leaf tags: element names only, no values, no prefixes, each once", () => {
  const tags = leafTags(XML);
  assert.ok(tags.includes("issuerCik") && tags.includes("street1") && tags.includes("noOfUnitsSold"));
  assert.equal(tags.filter((t) => t === "securitiesClassTitle").length, 1);
  assert.ok(!tags.some((t) => /Alice|1045810/.test(t)));
  assert.equal(leafTags(XML, 3).length, 3);
});

test("a notice: issuer, filer, seller, relationships, sums, earliest dates", () => {
  const p = parseForm144Xml(XML);
  assert.equal(p.issuerCik, "0001045810");
  assert.equal(p.issuerName, "WELLS & SONS CORP");
  assert.equal(p.filerCik, "0009000001");
  assert.equal(p.sellerName, "Alpha Alice");
  assert.deepEqual(p.relationships, ["Officer", "Director"]);
  assert.equal(p.securities.length, 2);
  assert.equal(p.shares, 13000);
  assert.equal(p.marketValue, 2346250);
  assert.equal(p.sharesOutstanding, 2440000000);
  assert.equal(p.approxSaleDate, "2026-10-01");
  assert.equal(p.securityClass, "Common");
  assert.equal(p.exchange, "NASDAQ");
  assert.equal(p.broker, "Example Brokerage");
  assert.equal(p.noticeDate, "2026-10-01");
  assert.deepEqual(p.planAdoptionDates, ["2026-06-30", "2026-03-01"]);
  assert.equal(p.planAdoptionDate, "2026-03-01");
  assert.equal(p.sold3mShares, 7500);
  assert.equal(p.sold3mProceeds, 1325000);
  assert.equal(p.nothingSold, null);
  assert.equal(p.remarks, "Plan <one>");
  assert.deepEqual(p.acquired[0], {
    class: "Common", acquired_date: "2024-03-15", nature: "Restricted stock vesting", from: "Issuer",
    gift: false, amount: 13000, payment_date: null, payment: "Compensation",
  });
  assert.equal(hasShape(p), true);
});

test("nothing with an address, a phone number or a signature reaches the stored payload", () => {
  const p = parseForm144Xml(XML);
  const stored = JSON.stringify({ ...p, payload: toPayload(p) });
  assert.ok(!/Secret St|Main St|Private Rd|4085550100|\/s\/|XXXXXXXX/.test(stored));
});

test("an unknown shape parses to empty fields and fails the shape test, without throwing", () => {
  const p = parseForm144Xml("<edgarSubmission><issuerInfo><companyName>X</companyName></issuerInfo><securitiesInformation><units>5</units></securitiesInformation></edgarSubmission>");
  assert.equal(p.issuerName, null);
  assert.equal(p.shares, null);
  assert.equal(hasShape(p), false);
  assert.equal(hasShape(parseForm144Xml("")), false);
  // an issuer and a seller but no units: stored once the shape is proven, but proves nothing itself
  assert.equal(hasShape(parseForm144Xml("<issuerInfo><issuerName>X</issuerName><nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>Y</nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold></issuerInfo>")), false);
});

test("a filer CIK that is not a number is left empty; the link uses the bare CIK", () => {
  const p = parseForm144Xml(XML.replace("<cik>0009000001</cik>", "<cik></cik>"));
  assert.equal(p.filerCik, null);
  assert.equal(noticeIndexUrl("0001045810", "0009900144-26-000001"),
    "https://www.sec.gov/Archives/edgar/data/1045810/000990014426000001/0009900144-26-000001-index.htm");
});

test("submission header: form type and filing date; anything else is empty", () => {
  const h = "<SEC-DOCUMENT>x.txt : 20251103\n<SEC-HEADER>\nACCESSION NUMBER:\t\t0001950047-25-007661\nCONFORMED SUBMISSION TYPE:\t144/A\nPUBLIC DOCUMENT COUNT:\t\t1\nFILED AS OF DATE:\t\t20251103\n</SEC-HEADER>";
  assert.deepEqual(parseSubmissionHeader(h), { form: "144/A", filedAt: "2025-11-03" });
  assert.deepEqual(parseSubmissionHeader(h.replace("144/A", "4")), { form: null, filedAt: "2025-11-03" });
  assert.deepEqual(parseSubmissionHeader("no header"), { form: null, filedAt: null });
});

test("retry list: only well-formed entries, one per accession; the quarantine sample of an older run is read", () => {
  const good = { a: "0001950047-25-007661", f: "edgar/data/1243040/0001950047-25-007661.txt", t: "144", d: "2025-11-03", n: 2 };
  assert.deepEqual(readRetryList([good, good, { a: "x", f: "y" }, null, { a: good.a, f: "edgar/data/1/0000000000-25-000001.txt" },
    { a: "0000000001-25-000002", f: "https://evil.example/edgar/data/1/0000000001-25-000002.txt" }]), [good]);
  assert.deepEqual(readRetryList({}), []);
  const sample = [
    { ref: "0001950047-25-007661", reason: "submission not fetched: Exhausted 4 attempts for www.sec.gov/Archives/edgar/data/1243040/0001950047-25-007661.txt: HTTP 502 from www.sec.gov/Archives/edgar/data/1243040/0001950047-25-007661.txt" },
    { ref: "0001950047-25-000002", reason: "parsed XML missing issuer identity" },
    { ref: "0001950047-25-000003", reason: "write failed: Archives/edgar/data/1/0001950047-25-000003.txt" },
  ];
  assert.deepEqual(retryFromQuarantine(sample), [{ a: "0001950047-25-007661", f: "edgar/data/1243040/0001950047-25-007661.txt", n: 0 }]);
  assert.deepEqual(retryFromQuarantine(null), []);
});
