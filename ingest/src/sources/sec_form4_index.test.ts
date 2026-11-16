// Offline tests for the daily-index source (no network, no database). Run:
//   npx tsx --test ingest/src/sources/sec_form4_index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMasterIndex, extractOwnershipXml, masterNameToDate, masterDaysFromListing, quarterFolders,
  quarterListingPath, daysToProcess, listingStart, addDays, compactToIso,
} from "./sec_form4_index.js";
import { parseForm4Xml } from "./sec_form4.js";

const MASTER = `Description:           Master Index of EDGAR Dissemination Feed
Last Data Received:    November 13, 2026
Comments:              webmaster@sec.gov
Company Data Owner:    U.S. Securities and Exchange Commission
Number of Records:     9

CIK|Company Name|Form Type|Date Filed|File Name
--------------------------------------------------------------------------------
1001250|ESTEE LAUDER COMPANIES INC|4|20261113|edgar/data/1001250/0001628280-26-073892.txt
1234567|LAUDER WILLIAM P|4|20261113|edgar/data/1234567/0001628280-26-073892.txt
1045810|NVIDIA CORP|4|20261113|edgar/data/1045810/0001045810-26-000101.txt
1045810|NVIDIA CORP|4/A|20261113|edgar/data/1045810/0001045810-26-000102.txt
1045810|NVIDIA CORP|144|20261113|edgar/data/1045810/0001045810-26-000103.txt
1045810|NVIDIA CORP|3|20261113|edgar/data/1045810/0001045810-26-000104.txt
777|SOME | PIPE CO|4|20261113|edgar/data/777/0000000777-26-000001.txt
888|NO DATE CO|4|notadate|edgar/data/888/0000000888-26-000001.txt
999|ODD FILE CO|4|20261113|edgar/data/999/oddfile.htm
`;

test("master index: header skipped, form type exactly 4, one row per accession", () => {
  const rows = parseMasterIndex(MASTER);
  assert.deepEqual(rows.map((r) => r.accession), ["0001628280-26-073892", "0001045810-26-000101"]);
  assert.equal(rows[0]!.cik, "1001250");
  assert.equal(rows[0]!.filedAt, "2026-11-13");
  assert.equal(rows[0]!.file, "edgar/data/1001250/0001628280-26-073892.txt");
});

test("master index: empty and header-only text give no rows", () => {
  assert.deepEqual(parseMasterIndex(""), []);
  assert.deepEqual(parseMasterIndex("CIK|Company Name|Form Type|Date Filed|File Name\n------\n"), []);
});

const XML = `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <issuer><issuerCik>0001045810</issuerCik><issuerName>NVIDIA CORP</issuerName><issuerTradingSymbol>NVDA</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerCik>0001234567</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship></reportingOwner>
</ownershipDocument>`;

test("submission text: the ownership XML is cut out and parses", () => {
  const sub = `<SEC-DOCUMENT>0001-26-1.txt : 20261113\n<SEC-HEADER>ACCESSION NUMBER: 0001-26-1\n</SEC-HEADER>\n<DOCUMENT>\n<TYPE>4\n<SEQUENCE>1\n<FILENAME>doc4.xml\n<TEXT>\n<XML>\n${XML}\n</XML>\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>\n`;
  const xml = extractOwnershipXml(sub);
  assert.ok(xml && xml.startsWith("<?xml"));
  const p = parseForm4Xml(xml!);
  assert.equal(p.issuerTradingSymbol, "NVDA");
  assert.equal(p.rptOwnerName, "Doe Jane");
});

test("submission text: no XML, or XML that is not an ownership document, gives null", () => {
  assert.equal(extractOwnershipXml("<SEC-DOCUMENT>\n<DOCUMENT>\n<TYPE>4\n<TEXT>\nplain text\n</TEXT>\n</DOCUMENT>"), null);
  assert.equal(extractOwnershipXml("<XML>\n<?xml version=\"1.0\"?><other/>\n</XML>"), null);
  assert.equal(extractOwnershipXml(""), null);
});

test("submission text: the ownership XML is found after another XML block", () => {
  const sub = `<XML>\n<?xml version="1.0"?><cover/>\n</XML>\n<XML>\n${XML}\n</XML>`;
  assert.ok(extractOwnershipXml(sub)?.includes("<ownershipDocument>"));
});

test("listing: only master files count, sorted and unique; a single item object works", () => {
  const listing = { directory: { item: [
    { name: "master.20261113.idx" }, { name: "company.20261113.idx" }, { name: "master.20261112.idx" },
    { name: "sitemap.20261113.xml" }, { name: "form.20261112.idx" }, { name: "master.20261112.idx" },
  ] } };
  assert.deepEqual(masterDaysFromListing(listing), ["2026-11-12", "2026-11-13"]);
  assert.deepEqual(masterDaysFromListing({ directory: { item: { name: "master.20261001.idx" } } }), ["2026-10-01"]);
  assert.deepEqual(masterDaysFromListing(null), []);
  assert.equal(masterNameToDate("master.20261113.idx.gz"), null);
  assert.equal(compactToIso("2026111"), null);
});

test("quarter folders: within a year, across a year boundary, and a single quarter", () => {
  assert.deepEqual(quarterFolders("2026-10-01", "2026-11-16"), [{ year: 2026, quarter: 4 }]);
  assert.deepEqual(quarterFolders("2026-09-30", "2027-04-02"), [
    { year: 2026, quarter: 3 }, { year: 2026, quarter: 4 }, { year: 2027, quarter: 1 }, { year: 2027, quarter: 2 },
  ]);
  assert.equal(quarterListingPath({ year: 2027, quarter: 1 }), "/Archives/edgar/daily-index/2027/QTR1");
  assert.deepEqual(quarterFolders("2025-12-31", "2026-01-01").map((q) => `${q.year}Q${q.quarter}`), ["2025Q4", "2026Q1"]);
});

test("resume: no earlier run starts at the first day on or after the start date", () => {
  const all = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"];
  assert.deepEqual(daysToProcess(all, null, "2026-10-01"), ["2026-10-01", "2026-10-02", "2026-10-05"]);
});

test("resume: the 2 newest processed days are read again, then every later day", () => {
  const all = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"];
  assert.deepEqual(daysToProcess(all, "2026-10-05", "2026-10-01"), ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(daysToProcess(all, "2026-10-07", "2026-10-01"), ["2026-10-06", "2026-10-07"]);
  assert.deepEqual(daysToProcess(all, "2026-10-01", "2026-10-01"), ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(daysToProcess(all, "2026-10-04", "2026-10-01"), ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"].slice(0, 5));
  assert.deepEqual(daysToProcess(all, "2026-10-07", "2026-10-01", 1), ["2026-10-07"]);
});

test("resume: a resume point on a day with no index file still re-reads the days before it", () => {
  const all = ["2026-10-01", "2026-10-02", "2026-10-05"];
  // 2026-10-03 was a Saturday: the newest day at or before it is 2026-10-02.
  assert.deepEqual(daysToProcess(all, "2026-10-03", "2026-10-01"), ["2026-10-01", "2026-10-02", "2026-10-05"]);
});

test("listing start moves back from the resume point but never before the start date", () => {
  assert.equal(addDays("2027-01-03", -10), "2026-12-24");
  assert.equal(listingStart(null, "2026-10-01"), "2026-10-01");
  assert.equal(listingStart("2026-10-04", "2026-10-01"), "2026-10-01");
  assert.equal(listingStart("2027-01-03", "2026-10-01"), "2026-12-24");
});
