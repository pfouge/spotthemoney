// Offline parser test for the Form 4 ownership XML (no network). Run:
//   npx tsx --test ingest/src/sources/sec_form4.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseForm4Xml, slugifyCompany, primaryTicker, decodeXmlEntities, collectForm4Entries, guardFutureTxnDate, rotateByDay, outageCounter } from "./sec_form4.js";

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

test("decodeXmlEntities restores issuer names filed with XML escapes", () => {
  assert.equal(decodeXmlEntities("WELLS FARGO &amp; COMPANY/MN"), "WELLS FARGO & COMPANY/MN");
  assert.equal(decodeXmlEntities("A &lt;B&gt; &quot;C&quot; &apos;D&apos; &#39;E&#39; &#x26;F"), "A <B> \"C\" 'D' 'E' &F");
  assert.equal(decodeXmlEntities("plain"), "plain");
});

// ── Listing walk (history pass) ───────────────────────────────────────────
function atomPage(rows: Array<[string, string, string]>): string {
  return rows
    .map(([acc, date, type]) =>
      `<entry><content><accession-number>${acc}</accession-number><filing-date>${date}</filing-date><filing-type>${type}</filing-type></content></entry>`)
    .join("\n");
}
/** A fake EDGAR: `n` filings, newest first, one every 3 days back from 2026-10-01, every 5th a 4/A. */
function fakeEdgar(n: number) {
  const all: Array<[string, string, string]> = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 9, 1) - i * 3 * 86_400_000).toISOString().slice(0, 10);
    all.push([`0000000000-26-${String(i).padStart(6, "0")}`, d, i % 5 === 4 ? "4/A" : "4"]);
  }
  const calls: Array<[number, number]> = [];
  const fetchPage = async (start: number, count: number) => { calls.push([start, count]); return atomPage(all.slice(start, start + count)); };
  return { all, calls, fetchPage };
}

test("daily listing: one page of 40, newest N exact Form 4s only", async () => {
  const f = fakeEdgar(300);
  const r = await collectForm4Entries(f.fetchPage, { limit: 10 });
  assert.deepEqual(f.calls, [[0, 40]]);
  assert.equal(r.entries.length, 10);
  assert.ok(r.entries.every((e) => e.filingType === "4"));
  assert.equal(r.entries[0]!.filingDate, "2026-10-01");
  assert.equal(r.truncated, false);
});

test("daily listing: entries filed before the floor are ignored", async () => {
  const f = fakeEdgar(300); // 2026-10-01, 09-28, 09-25, 09-22 (4/A at index 4) ...
  const r = await collectForm4Entries(f.fetchPage, { limit: 10, floor: "2026-09-25" });
  assert.deepEqual(f.calls, [[0, 40]]);
  assert.deepEqual(r.entries.map((e) => e.filingDate), ["2026-10-01", "2026-09-28", "2026-09-25"]);
  const none = await collectForm4Entries(f.fetchPage, { limit: 10, floor: "2027-01-01" });
  assert.equal(none.entries.length, 0);
});

test("rotateByDay: same items, a start point that moves each day, stable within a day", () => {
  const items = Array.from({ length: 1000 }, (_, i) => `T${i}`);
  const d1 = new Date("2026-11-15T03:00:00Z"), d1b = new Date("2026-11-15T22:00:00Z"), d2 = new Date("2026-11-16T03:00:00Z");
  const a = rotateByDay(items, d1), b = rotateByDay(items, d2);
  assert.deepEqual(a, rotateByDay(items, d1b));
  assert.notEqual(a[0], b[0]);
  assert.deepEqual([...a].sort(), [...items].sort());
  assert.equal(a.length, 1000);
  assert.deepEqual(rotateByDay(["X"], d1), ["X"]);
  assert.deepEqual(rotateByDay([], d1), []);
  // Over a month the start points spread across the list rather than clustering.
  const starts = new Set(Array.from({ length: 30 }, (_, i) => rotateByDay(items, new Date(d1.getTime() + i * 86_400_000))[0]));
  assert.equal(starts.size, 30);
});

test("outageCounter: trips on failures in a row, any success resets it", () => {
  const o = outageCounter(3);
  o.fail(); o.fail();
  assert.equal(o.tripped, false);
  o.ok(); o.fail(); o.fail();
  assert.equal(o.tripped, false);
  o.fail();
  assert.equal(o.tripped, true);
  assert.equal(o.count, 3);
  const off = outageCounter(0);
  off.fail(); off.fail(); off.fail();
  assert.equal(off.tripped, false);
});

test("history listing: pages back to the since date and stops there", async () => {
  const f = fakeEdgar(300);
  const r = await collectForm4Entries(f.fetchPage, { limit: 2000, since: "2026-01-01" });
  const want = f.all.filter(([, d, t]) => d >= "2026-01-01" && t === "4").map(([a]) => a);
  assert.deepEqual(r.entries.map((e) => e.accession), want);
  assert.deepEqual(f.calls, [[0, 100]]); // 92 filings since Jan 1 sit on the first page
  assert.equal(r.truncated, false);
});

test("history listing: walks several pages and stops on a short page", async () => {
  const f = fakeEdgar(250);
  const r = await collectForm4Entries(f.fetchPage, { limit: 2000, since: "2020-01-01" });
  assert.deepEqual(f.calls, [[0, 100], [100, 100], [200, 100]]);
  assert.equal(r.entries.length, 200); // 250 minus the fifty 4/A rows
  assert.equal(r.truncated, false);
});

test("history listing: exact multiple of the page size ends on an empty page", async () => {
  const f = fakeEdgar(200);
  const r = await collectForm4Entries(f.fetchPage, { limit: 2000, since: "2020-01-01" });
  assert.deepEqual(f.calls, [[0, 100], [100, 100], [200, 100]]);
  assert.equal(r.entries.length, 160);
});

test("history listing: the per-ticker cap reports truncation", async () => {
  const f = fakeEdgar(250);
  const r = await collectForm4Entries(f.fetchPage, { limit: 50, since: "2020-01-01" });
  assert.equal(r.entries.length, 50);
  assert.equal(r.truncated, true);
});

test("guardFutureTxnDate: a trade date after the filing date is nulled; others untouched", () => {
  assert.deepEqual(guardFutureTxnDate("2027-05-27", "2026-09-17"), { date: null, nulled: true });
  assert.deepEqual(guardFutureTxnDate("2026-09-18", "2026-09-17"), { date: null, nulled: true });
  assert.deepEqual(guardFutureTxnDate("2026-09-17", "2026-09-17"), { date: "2026-09-17", nulled: false });
  assert.deepEqual(guardFutureTxnDate("2026-09-15", "2026-09-17"), { date: "2026-09-15", nulled: false });
  assert.deepEqual(guardFutureTxnDate(null, "2026-09-17"), { date: null, nulled: false });
  assert.deepEqual(guardFutureTxnDate("2026-09-15", null), { date: "2026-09-15", nulled: false });
});
