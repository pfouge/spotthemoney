import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMasterIndex13, asFormType, scheduleOf, isAmendment, parseFigure, parsePercent, parseSubmissionHeader13,
  readRetryList13, extractSchedule13Xml, parseSchedule13Xml, hasShape13, toPayload13, PURPOSE_MAX, PERSONS_MAX,
} from "./sec_schedule13.js";

const MASTER = [
  "Description:           Master Index of EDGAR Dissemination Feed",
  "",
  "CIK|Company Name|Form Type|Date Filed|File Name",
  "--------------------------------------------------------------------------------",
  "1045810|NVIDIA CORP|SCHEDULE 13D|20261001|edgar/data/1045810/0009900013-26-000001.txt",
  "9000011|HARBOR HOLDINGS|SCHEDULE 13D|20261001|edgar/data/9000011/0009900013-26-000001.txt",
  "9100001|ACME|SCHEDULE 13G/A|20261001|edgar/data/9100001/0009900013-26-000003.txt",
  "9100001|ACME|SCHEDULE 13G|20261001|edgar/data/9100001/0009900013-26-000002.txt",
  "9100002|BETA|SCHEDULE 13D/A|20261001|edgar/data/9100002/0009900013-26-000004.txt",
  "1045810|NVIDIA CORP|SC 13G|20261001|edgar/data/1045810/0009900001-26-000050.txt",
  "1045810|NVIDIA CORP|144|20261001|edgar/data/1045810/0009900144-26-000001.txt",
  "1045810|NVIDIA CORP|SCHEDULE 13GX|20261001|edgar/data/1045810/0009900001-26-000051.txt",
  "abc|BAD CIK|SCHEDULE 13G|20261001|edgar/data/1/0009900013-26-000009.txt",
  "9100001|ACME|SCHEDULE 13G|2026101|edgar/data/9100001/0009900013-26-000010.txt",
].join("\n");

// Element names as in the two real filings read on 2026-11-19 (see the source's header).
const XML_D = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D" xmlns:com="http://www.sec.gov/edgar/common">
  <headerData><submissionType>SCHEDULE 13D</submissionType>
    <filerInfo><filer><filerCredentials><!-- Field: Pseudo-Tag --><cik>0002108849</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer><liveTestFlag>LIVE</liveTestFlag></filerInfo>
  </headerData>
  <formData>
    <coverPageHeader>
      <securitiesClassTitle>Common Stock, par value $0.001 per share</securitiesClassTitle>
      <dateOfEvent>12/15/2025</dateOfEvent>
      <previouslyFiledFlag>false</previouslyFiledFlag>
      <issuerInfo>
        <issuerCIK>0001178697</issuerCIK><issuerCUSIP>83548F309</issuerCUSIP><issuerName>WELLS &amp; SONS,  Inc.</issuerName>
        <address><com:street1>4445 SECRET MALL</com:street1><com:city>SAN DIEGO</com:city><com:zipCode>92121</com:zipCode></address>
      </issuerInfo>
      <authorizedPersons><notificationInfo><personName>Pat Lawyer, Esq.</personName><personPhoneNum>(212) 555-0100</personPhoneNum>
        <personAddress><com:street1>30 Counsel Plaza</com:street1></personAddress></notificationInfo></authorizedPersons>
    </coverPageHeader>
    <reportingPersons>
      <reportingPersonInfo>
        <reportingPersonCIK>0002108849</reportingPersonCIK><reportingPersonNoCIK>N</reportingPersonNoCIK>
        <reportingPersonName>Harbor Holdings Venture Inc.</reportingPersonName>
        <fundType>WC</fundType><legalProceedings>N</legalProceedings><citizenshipOrOrganization>PR</citizenshipOrOrganization>
        <soleVotingPower>0.00</soleVotingPower><sharedVotingPower>223201.00</sharedVotingPower>
        <soleDispositivePower>0.00</soleDispositivePower><sharedDispositivePower>223201.00</sharedDispositivePower>
        <aggregateAmountOwned>223201.00</aggregateAmountOwned><isAggregateExcludeShares>N</isAggregateExcludeShares>
        <percentOfClass>19.9</percentOfClass><typeOfReportingPerson>CO</typeOfReportingPerson>
      </reportingPersonInfo>
      <reportingPersonInfo>
        <reportingPersonNoCIK>Y</reportingPersonNoCIK>
        <reportingPersonName>Walker Scott</reportingPersonName>
        <fundType>AF</fundType><fundType>OO</fundType><legalProceedings>N</legalProceedings><citizenshipOrOrganization>X1</citizenshipOrOrganization>
        <soleVotingPower>0.00</soleVotingPower><sharedVotingPower>223201.00</sharedVotingPower>
        <soleDispositivePower>0.00</soleDispositivePower><sharedDispositivePower>223201.00</sharedDispositivePower>
        <aggregateAmountOwned>223201.00</aggregateAmountOwned>
        <percentOfClass>19.9</percentOfClass><typeOfReportingPerson>IN</typeOfReportingPerson>
      </reportingPersonInfo>
      <reportingPersonInfo>
        <reportingPersonName>Pierce Dana</reportingPersonName>
        <aggregateAmountOwned>100,000</aggregateAmountOwned><percentOfClass>8.9%</percentOfClass><typeOfReportingPerson>IN</typeOfReportingPerson>
      </reportingPersonInfo>
    </reportingPersons>
    <items1To7>
      <item2><filingPersonName>This Schedule 13D is filed by the group.</filingPersonName>
        <principalBusinessAddress>99 Private Road, Greenwich</principalBusinessAddress>
        <hasBeenConvicted>None of the Reporting Persons has been convicted.</hasBeenConvicted></item2>
      <item3><fundsSource>Working capital.</fundsSource></item3>
      <item4><transactionPurpose>Acquired for investment  purposes &amp; may talk to the board.</transactionPurpose></item4>
    </items1To7>
    <signatureInfo><signaturePerson><signatureReportingPerson>Harbor Holdings Venture Inc.</signatureReportingPerson>
      <signatureDetails><signature>/s/ Sam Signer</signature><title>Chairman</title><date>02/20/2026</date></signatureDetails></signaturePerson></signatureInfo>
  </formData>
</edgarSubmission>`;

const XML_G = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13g" xmlns:ns2="http://www.sec.gov/edgar/common">
  <headerData><submissionType>SCHEDULE 13G</submissionType>
    <filerInfo><filer><filerCredentials><cik>0001897612</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer></filerInfo></headerData>
  <formData>
    <coverPageHeader>
      <securitiesClassTitle>COMMON STOCK</securitiesClassTitle>
      <eventDateRequiresFilingThisStatement>09/30/2025</eventDateRequiresFilingThisStatement>
      <issuerInfo><issuerCik>1894562</issuerCik><issuerName>PRIME EXAMPLE INC</issuerName><issuerCusip>74168J101</issuerCusip>
        <issuerPrincipalExecutiveOfficeAddress><ns2:street1>60 SECRET ST.</ns2:street1><ns2:city>CAMBRIDGE</ns2:city></issuerPrincipalExecutiveOfficeAddress></issuerInfo>
      <designateRulesPursuantThisScheduleFiled><designateRulePursuantThisScheduleFiled>Rule 13d-1(b)</designateRulePursuantThisScheduleFiled></designateRulesPursuantThisScheduleFiled>
    </coverPageHeader>
    <coverPageHeaderReportingPersonDetails>
      <reportingPersonName>Example Investment Management, Inc.</reportingPersonName>
      <citizenshipOrOrganization>MD</citizenshipOrOrganization>
      <reportingPersonBeneficiallyOwnedNumberOfShares><soleVotingPower>9236955</soleVotingPower><sharedVotingPower>0</sharedVotingPower>
        <soleDispositivePower>9236955</soleDispositivePower><sharedDispositivePower>0</sharedDispositivePower></reportingPersonBeneficiallyOwnedNumberOfShares>
      <reportingPersonBeneficiallyOwnedAggregateNumberOfShares>9236955</reportingPersonBeneficiallyOwnedAggregateNumberOfShares>
      <aggregateAmountExcludesCertainSharesFlag>N</aggregateAmountExcludesCertainSharesFlag>
      <classPercent>5.3</classPercent>
      <typeOfReportingPerson>IA</typeOfReportingPerson>
    </coverPageHeaderReportingPersonDetails>
    <items>
      <item2><filingPersonName>Example Investment Management, Inc.</filingPersonName>
        <principalBusinessOfficeOrResidenceAddress>1307 Harbor Street, Baltimore, MD 21231</principalBusinessOfficeOrResidenceAddress></item2>
      <item4><amountBeneficiallyOwned>1</amountBeneficiallyOwned><classPercent>99</classPercent></item4>
    </items>
    <signatureInformation><reportingPersonName>Example Investment Management, Inc.</reportingPersonName>
      <signatureDetails><signature>Ellen Signer</signature><title>Vice President</title><date>11/14/2025</date></signatureDetails></signatureInformation>
  </formData>
</edgarSubmission>`;

test("form types: the four structured schedules only", () => {
  assert.equal(asFormType("SCHEDULE 13D"), "SCHEDULE 13D");
  assert.equal(asFormType(" schedule  13g/a "), "SCHEDULE 13G/A");
  for (const bad of ["SC 13G", "SC 13D/A", "SCHEDULE 13GX", "144", "", null, undefined]) assert.equal(asFormType(bad), null);
  assert.equal(scheduleOf("SCHEDULE 13D/A"), "13D");
  assert.equal(scheduleOf("SCHEDULE 13G"), "13G");
  assert.equal(isAmendment("SCHEDULE 13G/A"), true);
  assert.equal(isAmendment("SCHEDULE 13D"), false);
});

test("master index: one row per accession, other forms and bad rows ignored", () => {
  const rows = parseMasterIndex13(MASTER);
  assert.deepEqual(rows.map((r) => [r.accession, r.form]), [
    ["0009900013-26-000001", "SCHEDULE 13D"],
    ["0009900013-26-000003", "SCHEDULE 13G/A"],
    ["0009900013-26-000002", "SCHEDULE 13G"],
    ["0009900013-26-000004", "SCHEDULE 13D/A"],
  ]);
  assert.equal(rows[0]!.filedAt, "2026-10-01");
  assert.equal(rows[0]!.cik, "1045810");
});

test("figures and percentages", () => {
  assert.equal(parseFigure("223201.00"), 223201);
  assert.equal(parseFigure("9,300,000"), 9300000);
  assert.equal(parseFigure("5.4%"), 5.4);
  for (const bad of ["", "n/a", "-5", "1e5", "See Item 4", null]) assert.equal(parseFigure(bad), null);
  assert.equal(parsePercent("19.9"), 19.9);
  assert.equal(parsePercent("100"), 100);
  assert.equal(parsePercent("223201.00"), null);
});

test("submission header: the form type has a space in it", () => {
  const h = parseSubmissionHeader13("<SEC-HEADER>\nCONFORMED SUBMISSION TYPE:\tSCHEDULE 13G/A\nPUBLIC DOCUMENT COUNT:\t1\nFILED AS OF DATE:\t\t20261002\n");
  assert.deepEqual(h, { form: "SCHEDULE 13G/A", filedAt: "2026-10-02" });
  assert.deepEqual(parseSubmissionHeader13("CONFORMED SUBMISSION TYPE: 144\n"), { form: null, filedAt: null });
});

test("retry list: well-formed entries only", () => {
  const list = readRetryList13([
    { a: "0009900013-26-000001", f: "edgar/data/1045810/0009900013-26-000001.txt", t: "SCHEDULE 13D", d: "2026-10-01", n: 2 },
    { a: "0009900013-26-000001", f: "edgar/data/1045810/0009900013-26-000001.txt" },
    { a: "0009900013-26-000002", f: "edgar/data/1/0009900013-26-000099.txt" },
    { a: "x", f: "https://evil.example/x.txt" },
    { a: "0009900013-26-000003", f: "edgar/data/9/0009900013-26-000003.txt", t: "144" },
    null,
  ]);
  assert.deepEqual(list, [
    { a: "0009900013-26-000001", f: "edgar/data/1045810/0009900013-26-000001.txt", t: "SCHEDULE 13D", d: "2026-10-01", n: 2 },
    { a: "0009900013-26-000003", f: "edgar/data/9/0009900013-26-000003.txt", n: 0 },
  ]);
  assert.deepEqual(readRetryList13("nope"), []);
});

test("extract: the schedule's XML among a submission's documents", () => {
  const sub = `<DOCUMENT><TEXT><XML><other><a>1</a></other></XML></TEXT></DOCUMENT><DOCUMENT><TEXT>\n<XML>\n${XML_G}\n</XML></TEXT></DOCUMENT>`;
  assert.ok(extractSchedule13Xml(sub)!.includes("coverPageHeaderReportingPersonDetails"));
  assert.equal(extractSchedule13Xml("<DOCUMENT><TEXT><PDF>x</PDF></TEXT></DOCUMENT>"), null);
});

test("13D: issuer, every reporting person, largest figures, purpose", () => {
  const p = parseSchedule13Xml(XML_D, "13D");
  assert.equal(p.issuerCik, "0001178697");
  assert.equal(p.issuerName, "WELLS & SONS, Inc.");
  assert.equal(p.issuerCusip, "83548F309");
  assert.equal(p.securityClass, "Common Stock, par value $0.001 per share");
  assert.equal(p.eventDate, "2025-12-15");
  assert.equal(p.filerCik, "0002108849");
  assert.equal(p.previouslyFiled, false);
  assert.equal(p.personsOnForm, 3);
  assert.equal(p.reporterName, "Harbor Holdings Venture Inc.");
  // Group members each report the same combined holding: the headline is the largest, not 546,402.
  assert.equal(p.sharesOwned, 223201);
  assert.equal(p.percentOfClass, 19.9);
  assert.deepEqual(p.persons[0], {
    name: "Harbor Holdings Venture Inc.", cik: "0002108849", citizenship: "PR", type: "CO", funds: "WC", group: null,
    sole_voting: 0, shared_voting: 223201, sole_dispositive: 0, shared_dispositive: 223201, amount: 223201, percent: 19.9,
  });
  assert.equal(p.persons[1]!.cik, null);
  assert.equal(p.persons[1]!.funds, "AF, OO");
  assert.equal(p.persons[2]!.amount, 100000);
  assert.equal(p.persons[2]!.percent, 8.9);
  assert.equal(p.purpose, "Acquired for investment purposes & may talk to the board.");
  assert.deepEqual(p.rules, []);
  assert.ok(hasShape13(p));
});

test("CUSIP: the element name used from March 2026 (issuerCusipNumber), with or without a wrapper", () => {
  const d = XML_D.replace("<issuerCUSIP>83548F309</issuerCUSIP>", "<issuerCusipNumber>83548F309</issuerCusipNumber>");
  assert.notEqual(d, XML_D);
  assert.equal(parseSchedule13Xml(d, "13D").issuerCusip, "83548F309");
  const g = XML_G.replace("<issuerCusip>74168J101</issuerCusip>", "<issuerCusips><issuerCusipNumber>74168J101</issuerCusipNumber><issuerCusipNumber>74168J209</issuerCusipNumber></issuerCusips>");
  assert.notEqual(g, XML_G);
  assert.equal(parseSchedule13Xml(g, "13G").issuerCusip, "74168J101");
  // No CUSIP at all stays empty, and nothing else moves.
  const none = parseSchedule13Xml(XML_G.replace("<issuerCusip>74168J101</issuerCusip>", ""), "13G");
  assert.equal(none.issuerCusip, null);
  assert.equal(none.issuerCik, "0001894562");
});

test("13G: its own element names; item 4 figures are not taken for a person's", () => {
  const p = parseSchedule13Xml(XML_G, "13G");
  assert.equal(p.issuerCik, "0001894562");
  assert.equal(p.issuerName, "PRIME EXAMPLE INC");
  assert.equal(p.issuerCusip, "74168J101");
  assert.equal(p.eventDate, "2025-09-30");
  assert.equal(p.filerCik, "0001897612");
  assert.deepEqual(p.rules, ["Rule 13d-1(b)"]);
  assert.equal(p.personsOnForm, 1);
  assert.equal(p.reporterName, "Example Investment Management, Inc.");
  assert.equal(p.sharesOwned, 9236955);
  assert.equal(p.percentOfClass, 5.3);
  assert.equal(p.persons[0]!.sole_voting, 9236955);
  assert.equal(p.persons[0]!.type, "IA");
  assert.equal(p.purpose, null);
  assert.ok(hasShape13(p));
});

test("a mislabelled submission still parses with the other schedule's names", () => {
  assert.equal(parseSchedule13Xml(XML_G, "13D").sharesOwned, 9236955);
  assert.equal(parseSchedule13Xml(XML_D, "13G").personsOnForm, 3);
});

test("unknown element names do not pass the shape guard", () => {
  const p = parseSchedule13Xml("<edgarSubmission><formData><coverPageHeader><company>X</company></coverPageHeader><holders><holder><held>5</held></holder></holders></formData></edgarSubmission>", "13G");
  assert.equal(hasShape13(p), false);
  assert.equal(p.personsOnForm, 0);
});

test("limits: purpose is cut, persons are capped and counted", () => {
  const long = XML_D.replace(/<transactionPurpose>[\s\S]*?<\/transactionPurpose>/, `<transactionPurpose>${"y".repeat(PURPOSE_MAX + 500)}</transactionPurpose>`);
  assert.equal(parseSchedule13Xml(long, "13D").purpose!.length, PURPOSE_MAX);
  const one = "<reportingPersonInfo><reportingPersonName>P</reportingPersonName><aggregateAmountOwned>1</aggregateAmountOwned></reportingPersonInfo>";
  const many = parseSchedule13Xml(`<x><coverPageHeader><issuerInfo><issuerName>I</issuerName></issuerInfo></coverPageHeader>${one.repeat(PERSONS_MAX + 7)}</x>`, "13D");
  assert.equal(many.persons.length, PERSONS_MAX);
  assert.equal(many.personsOnForm, PERSONS_MAX + 7);
});

test("nothing with an address, phone number, signature or legal answer is stored", () => {
  for (const [xml, k] of [[XML_D, "13D"], [XML_G, "13G"]] as const) {
    const p = parseSchedule13Xml(xml, k);
    const kept = JSON.stringify({ ...p, payload: toPayload13(p) });
    for (const secret of ["SECRET", "Counsel Plaza", "555-0100", "Pat Lawyer", "Private Road", "Harbor Street", "Signer", "Chairman", "Vice President", "convicted", "XXXXXXXX", "Working capital"]) {
      assert.ok(!kept.includes(secret), `${k}: "${secret}" must not be kept`);
    }
  }
});
