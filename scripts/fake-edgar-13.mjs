// A small fake of the SEC EDGAR daily index holding Schedule 13D and 13G statements, for testing
// the sec_schedule13 source offline. Used only through SEC_EDGAR_BASE; never part of a workflow.
//
//   node scripts/fake-edgar-13.mjs <port>
//
// Serves one quarter (2026 QTR4). Everything else answers 404. The XML follows the element
// names of two real filings read on 2026-11-19 (see sec_schedule13.ts).
//   Day 2026-10-01  13D for NVIDIA (tracked in scripts/seed-local.sql) by a group of three,
//                   13G for ACME by one adviser, 13G/A for ACME; the day's master file also
//                   lists a Form 144 and an old-style "SC 13G", which must be ignored
//   Day 2026-10-02  13D/A for BETA, a 13G with no data file, a 13G with two reporting persons
//                   and a date that is not a date
// Env: FAKE_13=noshape-g (every 13G uses element names the parser does not know),
// FAKE_13=noshape (both schedules do), FAKE_SLOW_MS (delay before every submission answer),
// FAKE_FAIL_500=1 (every submission answers 500), FAKE_FAIL_ONCE=<accession,...> (those answer
// 502 for the first FAKE_FAIL_ONCE_TIMES requests). GET /__stats returns request counts per path.

import http from "node:http";

const port = Number(process.argv[2] ?? 4373);
const SLOW = Number(process.env.FAKE_SLOW_MS ?? 0);
const FAIL = process.env.FAKE_FAIL_500 === "1";
const MODE = process.env.FAKE_13 ?? "";
const FAIL_ONCE = new Set((process.env.FAKE_FAIL_ONCE ?? "").split(",").filter(Boolean));
const FAIL_ONCE_TIMES = Number(process.env.FAKE_FAIL_ONCE_TIMES ?? 1);

const head = (form, filerCik) => `<headerData>
    <submissionType>${form}</submissionType>
    <filerInfo><filer><filerCredentials><cik>${filerCik}</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer><liveTestFlag>LIVE</liveTestFlag></filerInfo>
  </headerData>`;

function xml13d(n, form) {
  if (MODE === "noshape") {
    return `<?xml version="1.0"?><edgarSubmission><formData><coverPageHeader><company>${n.issuerName}</company></coverPageHeader>
<reportingPersons><holder><holderName>${n.persons[0].name}</holderName><held>${n.persons[0].amount}</held></holder></reportingPersons></formData></edgarSubmission>`;
  }
  const persons = n.persons.map((p) => `
      <reportingPersonInfo>
        ${p.cik ? `<reportingPersonCIK>${p.cik}</reportingPersonCIK><reportingPersonNoCIK>N</reportingPersonNoCIK>` : "<reportingPersonNoCIK>Y</reportingPersonNoCIK>"}
        <reportingPersonName>${p.name}</reportingPersonName>
        <memberOfGroup>a</memberOfGroup>
        <fundType>${p.funds ?? "WC"}</fundType>
        <legalProceedings>N</legalProceedings>
        <citizenshipOrOrganization>${p.cit ?? "DE"}</citizenshipOrOrganization>
        <soleVotingPower>0.00</soleVotingPower>
        <sharedVotingPower>${p.amount}</sharedVotingPower>
        <soleDispositivePower>0.00</soleDispositivePower>
        <sharedDispositivePower>${p.amount}</sharedDispositivePower>
        <aggregateAmountOwned>${p.amount}</aggregateAmountOwned>
        <isAggregateExcludeShares>N</isAggregateExcludeShares>
        <percentOfClass>${p.percent}</percentOfClass>
        <typeOfReportingPerson>${p.type ?? "CO"}</typeOfReportingPerson>
      </reportingPersonInfo>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D" xmlns:com="http://www.sec.gov/edgar/common">
  ${head(form, n.filerCik)}
  <formData>
    <coverPageHeader>
      <securitiesClassTitle>${n.cls ?? "Common Stock, par value $0.001 per share"}</securitiesClassTitle>
      <dateOfEvent>${n.event}</dateOfEvent>
      <previouslyFiledFlag>false</previouslyFiledFlag>
      <issuerInfo>
        <issuerCIK>${n.issuerCik}</issuerCIK>
        <issuerCUSIP>${n.cusip}</issuerCUSIP>
        <issuerName>${n.issuerName}</issuerName>
        <address><com:street1>1 Issuer Way</com:street1><com:city>Santa Clara</com:city><com:stateOrCountry>CA</com:stateOrCountry><com:zipCode>95051</com:zipCode></address>
      </issuerInfo>
      <authorizedPersons><notificationInfo><personName>Pat Lawyer, Esq.</personName><personPhoneNum>(212) 555-0100</personPhoneNum>
        <personAddress><com:street1>30 Counsel Plaza</com:street1><com:city>New York</com:city></personAddress></notificationInfo></authorizedPersons>
    </coverPageHeader>
    <reportingPersons>${persons}
    </reportingPersons>
    <items1To7>
      <item1><securityTitle>Common Stock</securityTitle><issuerName>${n.issuerName}</issuerName>
        <issuerPrincipalAddress><com:street1>1 Issuer Way</com:street1></issuerPrincipalAddress></item1>
      <item2><filingPersonName>This Schedule 13D is filed by the group.</filingPersonName>
        <principalBusinessAddress>99 Private Road, Greenwich, CT</principalBusinessAddress>
        <hasBeenConvicted>None of the Reporting Persons has been convicted.</hasBeenConvicted></item2>
      <item3><fundsSource>Working capital of the funds.</fundsSource></item3>
      <item4><transactionPurpose>${n.purpose ?? "The Reporting Persons acquired the shares for investment purposes &amp; may talk to the board."}</transactionPurpose></item4>
      <item5><percentageOfClassSecurities>See the cover pages.</percentageOfClassSecurities></item5>
    </items1To7>
    <signatureInfo><signaturePerson><signatureReportingPerson>${n.persons[0].name}</signatureReportingPerson>
      <signatureDetails><signature>/s/ Sam Signer</signature><title>Chairman</title><date>10/01/2026</date></signatureDetails></signaturePerson></signatureInfo>
  </formData>
</edgarSubmission>`;
}

function xml13g(n, form) {
  if (MODE === "noshape" || MODE === "noshape-g") {
    return `<?xml version="1.0"?><edgarSubmission><formData><coverPageHeader><company>${n.issuerName}</company></coverPageHeader>
<holders><holder><holderName>${n.persons[0].name}</holderName><held>${n.persons[0].amount}</held></holder></holders></formData></edgarSubmission>`;
  }
  const persons = n.persons.map((p) => `
    <coverPageHeaderReportingPersonDetails>
      <reportingPersonName>${p.name}</reportingPersonName>
      <citizenshipOrOrganization>${p.cit ?? "MD"}</citizenshipOrOrganization>
      <reportingPersonBeneficiallyOwnedNumberOfShares>
        <soleVotingPower>${p.amount}</soleVotingPower><sharedVotingPower>0</sharedVotingPower>
        <soleDispositivePower>${p.amount}</soleDispositivePower><sharedDispositivePower>0</sharedDispositivePower>
      </reportingPersonBeneficiallyOwnedNumberOfShares>
      <reportingPersonBeneficiallyOwnedAggregateNumberOfShares>${p.amount}</reportingPersonBeneficiallyOwnedAggregateNumberOfShares>
      <aggregateAmountExcludesCertainSharesFlag>N</aggregateAmountExcludesCertainSharesFlag>
      <classPercent>${p.percent}</classPercent>
      <typeOfReportingPerson>${p.type ?? "IA"}</typeOfReportingPerson>
    </coverPageHeaderReportingPersonDetails>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13g" xmlns:ns2="http://www.sec.gov/edgar/common">
  ${head(form, n.filerCik)}
  <formData>
    <coverPageHeader>
      <securitiesClassTitle>${n.cls ?? "COMMON STOCK"}</securitiesClassTitle>
      <eventDateRequiresFilingThisStatement>${n.event}</eventDateRequiresFilingThisStatement>
      <issuerInfo>
        <issuerCik>${n.issuerCik}</issuerCik>
        <issuerName>${n.issuerName}</issuerName>
        ${n.newCusipName ? `<issuerCusipNumber>${n.cusip}</issuerCusipNumber>` : `<issuerCusip>${n.cusip}</issuerCusip>`}
        <issuerPrincipalExecutiveOfficeAddress><ns2:street1>60 FIRST ST.</ns2:street1><ns2:city>CAMBRIDGE</ns2:city></issuerPrincipalExecutiveOfficeAddress>
      </issuerInfo>
      <designateRulesPursuantThisScheduleFiled><designateRulePursuantThisScheduleFiled>${n.rule ?? "Rule 13d-1(b)"}</designateRulePursuantThisScheduleFiled></designateRulesPursuantThisScheduleFiled>
    </coverPageHeader>${persons}
    <items>
      <item1><issuerName>${n.issuerName}</issuerName><issuerPrincipalExecutiveOfficeAddress>60 FIRST ST., CAMBRIDGE, MA</issuerPrincipalExecutiveOfficeAddress></item1>
      <item2><filingPersonName>${n.persons[0].name}</filingPersonName><principalBusinessOfficeOrResidenceAddress>1307 Harbor Street, Baltimore, MD</principalBusinessOfficeOrResidenceAddress><citizenship>Maryland</citizenship></item2>
      <item4><amountBeneficiallyOwned>${n.persons[0].amount}</amountBeneficiallyOwned><classPercent>${n.persons[0].percent}</classPercent></item4>
    </items>
    <signatureInformation><reportingPersonName>${n.persons[0].name}</reportingPersonName>
      <signatureDetails><signature>Sam Signer</signature><title>Vice President</title><date>10/01/2026</date></signatureDetails></signatureInformation>
  </formData>
</edgarSubmission>`;
}

const submission = (acc, form, body, day) =>
  `<SEC-DOCUMENT>${acc}.txt : ${day}\n<SEC-HEADER>ACCESSION NUMBER:\t\t${acc}\nCONFORMED SUBMISSION TYPE:\t${form}\nPUBLIC DOCUMENT COUNT:\t\t1\nFILED AS OF DATE:\t\t${day}\n</SEC-HEADER>\n<DOCUMENT>\n<TYPE>${form}\n<SEQUENCE>1\n<FILENAME>primary_doc.xml\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>\n`;

const NV = { issuerCik: "0001045810", issuerName: "NVIDIA CORP", cusip: "67066G104" };
const ACME = { issuerCik: "0009100001", issuerName: "ACME ROBOTICS INC", cusip: "00444T100" };
const BETA = { issuerCik: "9100002", issuerName: "BETA FOODS &amp; CO", cusip: "08888B200" };

const FILINGS = [
  { acc: "0009900013-26-000001", day: "20261001", cik: "1045810", form: "SCHEDULE 13D",
    n: { ...NV, filerCik: "0009000011", event: "09/24/2026", persons: [
      { name: "Harbor Holdings Venture Inc.", cik: "0009000011", amount: "223201.00", percent: "19.9", cit: "PR" },
      { name: "Walker Scott", amount: "223201.00", percent: "19.9", funds: "AF", type: "IN", cit: "X1" },
      { name: "Pierce Dana", amount: "100000.00", percent: "8.9", funds: "AF", type: "IN", cit: "X1" }] } },
  { acc: "0009900013-26-000002", day: "20261001", cik: "9100001", form: "SCHEDULE 13G",
    n: { ...ACME, filerCik: "0009000012", event: "09/30/2026", persons: [{ name: "Example Investment Management, Inc.", amount: "9236955", percent: "5.3" }] } },
  { acc: "0009900013-26-000003", day: "20261001", cik: "9100001", form: "SCHEDULE 13G/A",
    // this one names the CUSIP element as statements filed from March 2026 do
    n: { ...ACME, newCusipName: true, filerCik: "0009000012", event: "09/30/2026", rule: "Rule 13d-1(c)", persons: [{ name: "Example Investment Management, Inc.", amount: "9,300,000", percent: "5.4%" }] } },
  { acc: "0009900013-26-000004", day: "20261002", cik: "9100002", form: "SCHEDULE 13D/A",
    n: { ...BETA, filerCik: "0009000014", event: "10/01/2026", purpose: "x".repeat(2600), persons: [{ name: "Delta Dana Family Trust", amount: "1500000.00", percent: "12.25", type: "OO" }] } },
  { acc: "0009900013-26-000005", day: "20261002", cik: "9100002", form: "SCHEDULE 13G", n: null /* no data file */ },
  { acc: "0009900013-26-000006", day: "20261002", cik: "9100002", form: "SCHEDULE 13G",
    n: { ...BETA, filerCik: "", event: "13/45/2026", persons: [
      { name: "Echo Capital LP", amount: "700000", percent: "5.7", type: "PN" },
      { name: "Echo Eve", amount: "700000", percent: "5.7", type: "IN", cit: "US" }] } },
];
const EXTRA_ROWS = [
  { day: "20261001", cik: "1045810", name: "NVIDIA CORP", form: "144", file: "edgar/data/1045810/0009900144-26-000001.txt" },
  { day: "20261001", cik: "1045810", name: "NVIDIA CORP", form: "SC 13G", file: "edgar/data/1045810/0009900001-26-000050.txt" },
  { day: "20261002", cik: "9100002", name: "BETA FOODS & CO", form: "10-Q", file: "edgar/data/9100002/0009900001-26-000099.txt" },
];
const DAYS = ["20261001", "20261002"];

function master(day) {
  const lines = [
    "Description:           Master Index of EDGAR Dissemination Feed",
    `Last Data Received:    ${day}`,
    "",
    "CIK|Company Name|Form Type|Date Filed|File Name",
    "--------------------------------------------------------------------------------",
  ];
  for (const f of FILINGS.filter((f) => f.day === day)) {
    // two rows per accession (subject company and filer), as the real file has
    lines.push(`${f.cik}|SOME ISSUER|${f.form}|${day}|edgar/data/${f.cik}/${f.acc}.txt`);
    lines.push(`9000000|SOME FILER|${f.form}|${day}|edgar/data/9000000/${f.acc}.txt`);
  }
  for (const r of EXTRA_ROWS.filter((r) => r.day === day)) lines.push(`${r.cik}|${r.name}|${r.form}|${day}|${r.file}`);
  return lines.join("\n") + "\n";
}

const counts = new Map();
const hit = (p) => counts.set(p, (counts.get(p) ?? 0) + 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

http
  .createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/__stats") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(Object.fromEntries(counts)));
    }
    hit(path);
    const send = (code, body, type = "text/plain") => { res.statusCode = code; res.setHeader("content-type", type); res.end(body); };

    if (path === "/Archives/edgar/daily-index/2026/QTR4/index.json") {
      const item = [];
      for (const d of DAYS) for (const kind of ["master", "company", "form"]) item.push({ name: `${kind}.${d}.idx`, type: "text" });
      return send(200, JSON.stringify({ directory: { item } }), "application/json");
    }
    let m = /^\/Archives\/edgar\/daily-index\/2026\/QTR4\/master\.(\d{8})\.idx$/.exec(path);
    if (m && DAYS.includes(m[1])) return send(200, master(m[1]));

    m = /^\/Archives\/edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt$/.exec(path);
    if (m) {
      if (SLOW) await sleep(SLOW);
      if (FAIL) return send(500, "server error");
      if (FAIL_ONCE.has(m[2]) && (counts.get(path) ?? 0) <= FAIL_ONCE_TIMES) return send(502, "bad gateway");
      const f = FILINGS.find((f) => f.acc === m[2]);
      if (!f) return send(404, "not found");
      if (!f.n) return send(200, submission(f.acc, f.form, "<PDF>\nbegin 644 sc13g.pdf\nend\n</PDF>", f.day));
      const body = f.form.startsWith("SCHEDULE 13D") ? xml13d(f.n, f.form) : xml13g(f.n, f.form);
      return send(200, submission(f.acc, f.form, `<XML>\n${body}\n</XML>`, f.day));
    }
    return send(404, "not found");
  })
  .listen(port, "127.0.0.1", () => console.log(`fake EDGAR (Schedules 13D and 13G) on http://127.0.0.1:${port}`));
