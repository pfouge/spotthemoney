// Offline test of the Insider Transactions Data Sets reader (no network, no database). Run:
//   npx tsx --test ingest/src/sources/sec_form4_bulk.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  headerIndex, parseBulkDate, padCik, readQuarter, toPayload, quarterDirs, findTableFile, filingIndexUrl, invalidReason, REQUIRED, OPTIONAL,
} from "./sec_form4_bulk.js";
import { primaryTicker, codeToSide } from "./sec_form4.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "form345");
const QDIR = path.join(FIXTURE, "2026q3_form345");
const FLOOR = "2025-10-01";

test("header lookup is by name, case-insensitive, in any column order", () => {
  const { idx } = headerIndex("document_type\tACCESSION_NUMBER\tFILING_DATE\tISSUERCIK\tISSUERNAME\tissuertradingsymbol", REQUIRED.SUBMISSION, OPTIONAL.SUBMISSION, "SUBMISSION");
  assert.equal(idx["ACCESSION_NUMBER"], 1);
  assert.equal(idx["DOCUMENT_TYPE"], 0);
  assert.equal(idx["ISSUERTRADINGSYMBOL"], 5);
});

test("a missing optional column is tolerated and reported; a missing required one fails clearly", () => {
  const ok = headerIndex("ACCESSION_NUMBER\tFILING_DATE\tDOCUMENT_TYPE\tISSUERCIK\tISSUERNAME\tISSUERTRADINGSYMBOL", REQUIRED.SUBMISSION, OPTIONAL.SUBMISSION, "SUBMISSION");
  assert.deepEqual(ok.missingOptional, ["SUBMISSION.AFF10B5ONE"]);
  assert.throws(
    () => headerIndex("ACCESSION_NUMBER\tFILING_DATE\tDOCUMENT_TYPE\tISSUERNAME", REQUIRED.SUBMISSION, OPTIONAL.SUBMISSION, "SUBMISSION"),
    /required column\(s\) not found.*ISSUERCIK.*ISSUERTRADINGSYMBOL/,
  );
});

test("dates and numbers", () => {
  assert.equal(parseBulkDate("05-NOV-2026"), "2026-11-05");
  assert.equal(parseBulkDate("5-nov-2026"), "2026-11-05");
  assert.equal(parseBulkDate("2026-11-05"), "2026-11-05");
  assert.equal(parseBulkDate(""), null);
  assert.equal(parseBulkDate("garbage"), null);
  assert.equal(padCik("1900001"), "0001900001");
  assert.equal(padCik("0001900001"), "0001900001");
});

test("table files are found by name with or without extension", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-names-"));
  try {
    fs.writeFileSync(path.join(tmp, "submission.TSV"), "x");
    fs.writeFileSync(path.join(tmp, "REPORTINGOWNER"), "x");
    assert.ok(findTableFile(tmp, "SUBMISSION"));
    assert.ok(findTableFile(tmp, "REPORTINGOWNER"));
    assert.equal(findTableFile(tmp, "DERIV_TRANS"), null);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("fixture quarter: non-4 types and pre-floor filings are dropped, stored ones skipped", async () => {
  const { filings, stats } = await readQuarter(QDIR, { floor: FLOOR, skip: (a) => a.startsWith("0001045810-") });
  assert.equal(stats.nonForm4Dropped, 2, "4/A and Form 3");
  assert.equal(stats.preFloorDropped, 1);
  assert.equal(stats.skippedExisting, 3);
  assert.equal(filings.length, 7);
  assert.ok(!filings.some((f) => f.accession === "0001900003-26-000032"), "4/A dropped");
  assert.ok(!filings.some((f) => f.accession === "0001900003-26-000033"), "Form 3 dropped");
  assert.ok(!filings.some((f) => f.accession === "0001900003-25-000034"), "pre-floor dropped");
  assert.deepEqual(stats.missingOptional, []);
});

test("the first reporting owner of an accession is the filer", async () => {
  const { filings } = await readQuarter(QDIR, { floor: FLOOR, skip: () => false });
  const f = filings.find((x) => x.accession === "0001900001-26-000011")!;
  assert.equal(f.owner!.name, "Rivera Dana");
  assert.equal(f.owner!.cik, "0001900101");
  assert.equal(f.owner!.title, "Chief Executive Officer");
});

test("payload keeps the XML path's shape and order: non-derivative rows first, then derivative", async () => {
  const { filings } = await readQuarter(QDIR, { floor: FLOOR, skip: () => false });
  const f = filings.find((x) => x.accession === "0001900001-26-000011")!;
  const p = toPayload(f);
  assert.deepEqual(Object.keys(p), ["accession", "issuer", "owner", "relationship", "footnotes", "aff10b5One", "transactions"]);
  assert.deepEqual(p.transactions.map((t) => t.isDerivative), [false, false, true]);
  assert.deepEqual(p.transactions.map((t) => t.code), ["S", "S", "M"]);
  assert.deepEqual(Object.keys(p.transactions[0]!), ["code", "date", "shares", "price", "sharesOwnedAfter", "ownership", "isDerivative"]);
  assert.equal(p.transactions[0]!.date, "2026-10-09");
  assert.equal(p.transactions[0]!.sharesOwnedAfter, 400000);
  assert.equal(p.transactions[1]!.ownership, "I");
  assert.equal(p.transactions[2]!.price, 2);
  assert.deepEqual(p.relationship, { isDirector: false, isOfficer: true, officerTitle: "Chief Executive Officer" });
});

test("derivative rows are read from DERIV_TRANS and counted as derivative", async () => {
  const { filings } = await readQuarter(QDIR, { floor: FLOOR, skip: () => false });
  const f = filings.find((x) => x.accession === "0001900002-26-000022")!;
  assert.equal(f.txns.length, 2);
  assert.equal(f.txns[1]!.isDerivative, true);
  assert.equal(codeToSide(f.txns[1]!.code), "option");
});

test("the Rule 10b5-1 flag comes from AFF10B5ONE", async () => {
  const { filings } = await readQuarter(QDIR, { floor: FLOOR, skip: () => false });
  assert.equal(filings.find((x) => x.accession === "0001900001-26-000011")!.aff10b5One, true);
  assert.equal(filings.find((x) => x.accession === "0001900001-26-000012")!.aff10b5One, false);
});

test("a multi-class symbol resolves through primaryTicker, and XML entities are decoded", async () => {
  const { filings } = await readQuarter(QDIR, { floor: FLOOR, skip: () => false });
  const beta = filings.find((x) => x.accession === "0001900002-26-000021")!;
  assert.equal(beta.issuerSymbol, "BFC, BFC.B");
  assert.equal(primaryTicker(beta.issuerSymbol), "BFC");
  const delta = filings.find((x) => x.accession === "0001900004-26-000041")!;
  assert.equal(delta.issuerName, "DELTA BIO & DEVICES INC");
  assert.equal(delta.owner!.name, "Mbeki Thandi & Co.");
});

test("a table without the optional columns still reads", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-min-"));
  try {
    fs.writeFileSync(path.join(tmp, "SUBMISSION.tsv"), "ACCESSION_NUMBER\tFILING_DATE\tDOCUMENT_TYPE\tISSUERCIK\tISSUERNAME\tISSUERTRADINGSYMBOL\n0000000001-26-000001\t01-NOV-2026\t4\t12345\tTINY CO\tTINY\n");
    fs.writeFileSync(path.join(tmp, "REPORTINGOWNER.tsv"), "ACCESSION_NUMBER\tRPTOWNERCIK\tRPTOWNERNAME\n0000000001-26-000001\t777\tSmith Pat\n");
    fs.writeFileSync(path.join(tmp, "NONDERIV_TRANS.tsv"), "ACCESSION_NUMBER\tTRANS_CODE\n0000000001-26-000001\tP\n");
    const { filings, stats } = await readQuarter(tmp, { floor: FLOOR, skip: () => false });
    assert.equal(filings.length, 1);
    assert.equal(filings[0]!.issuerCik, "0000012345");
    assert.equal(filings[0]!.owner!.cik, "0000000777");
    assert.equal(filings[0]!.aff10b5One, false);
    assert.equal(filings[0]!.txns[0]!.date, null);
    assert.ok(stats.missingOptional.includes("SUBMISSION.AFF10B5ONE"));
    assert.ok(stats.missingOptional.includes("DERIV_TRANS (file)"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("quarter folders are found under a root; a filing with no owner is invalid", async () => {
  assert.deepEqual(quarterDirs(FIXTURE).map((d) => path.basename(d)), ["2026q3_form345"]);
  const { filings } = await readQuarter(QDIR, { floor: FLOOR, skip: () => false });
  const f = { ...filings[0]!, owner: null };
  assert.match(invalidReason(f) ?? "", /no reporting owner/);
  assert.equal(invalidReason(filings[0]!), null);
  assert.equal(filingIndexUrl(filings.find((x) => x.accession === "0001900001-26-000011")!), "https://www.sec.gov/Archives/edgar/data/1900001/000190000126000011/0001900001-26-000011-index.htm");
});
