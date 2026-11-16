// A small fake of the SEC EDGAR daily index, for testing the sec_form4_index source offline.
// Used only through SEC_EDGAR_BASE; never part of a workflow.
//
//   node scripts/fake-edgar-index.mjs <port>
//
// Serves one quarter (2026 QTR4): index.json, master files for three days, and submission texts
// built from ownership XML. Everything else answers 404.
//   Day 2026-10-01  3 filings: NVIDIA (tracked in scripts/seed-local.sql) + two for new company ACME
//   Day 2026-10-02  3 filings: new company BETA, NVIDIA again, and 0001321655-26-000306, which the
//                   seed already stores (the source must not request it)
//   Day 2026-10-05  3 filings: new company GAMMA (two) and one submission with no ownership XML;
//                   the day's master file also lists a 4/A and a 144, which must be ignored
// Env: FAKE_SLOW_MS (delay before every submission answer), FAKE_FAIL_500=1 (every submission
// answers 500). GET /__stats returns the request counts per path.

import http from "node:http";

const port = Number(process.argv[2] ?? 4371);
const SLOW = Number(process.env.FAKE_SLOW_MS ?? 0);
const FAIL = process.env.FAKE_FAIL_500 === "1";

function xml({ issuerCik, issuerName, symbol, ownerCik, ownerName, officer, date, shares, price, code = "P" }) {
  return `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>${date}</periodOfReport>
  <aff10b5One>0</aff10b5One>
  <issuer><issuerCik>${issuerCik}</issuerCik><issuerName>${issuerName}</issuerName><issuerTradingSymbol>${symbol}</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>${ownerCik}</rptOwnerCik><rptOwnerName>${ownerName}</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>${officer}</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>${date}</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${code}</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${shares}</value></transactionShares>
        <transactionPricePerShare><value>${price}</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>${code === "P" ? "A" : "D"}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>${shares * 10}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;
}

const submission = (acc, body) =>
  `<SEC-DOCUMENT>${acc}.txt : 20261001\n<SEC-HEADER>ACCESSION NUMBER:\t\t${acc}\nCONFORMED SUBMISSION TYPE:\t4\n</SEC-HEADER>\n<DOCUMENT>\n<TYPE>4\n<SEQUENCE>1\n<FILENAME>doc4.xml\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>\n`;

const NV = { issuerCik: "0001045810", issuerName: "NVIDIA CORP", symbol: "NVDA" };
const ACME = { issuerCik: "0009100001", issuerName: "ACME ROBOTICS INC", symbol: "ACMR" };
const BETA = { issuerCik: "0009100002", issuerName: "BETA FOODS CORP", symbol: "BETA" };
const GAMMA = { issuerCik: "0009100003", issuerName: "GAMMA ENERGY LTD", symbol: "GAMM" };

// accession -> { filer cik for the file name, day, xml | null }
const FILINGS = [
  { acc: "0009900001-26-000001", day: "20261001", cik: "1045810", x: { ...NV, ownerCik: "0009000001", ownerName: "Alpha Alice", officer: "CEO", date: "2026-09-30", shares: 1000, price: 180.5, code: "S" } },
  { acc: "0009900001-26-000002", day: "20261001", cik: "9100001", x: { ...ACME, ownerCik: "0009000002", ownerName: "Bravo Bob", officer: "CFO", date: "2026-09-30", shares: 500, price: 12.25 } },
  { acc: "0009900001-26-000003", day: "20261001", cik: "9100001", x: { ...ACME, ownerCik: "0009000003", ownerName: "Charlie Chen", officer: "Director", date: "2026-09-30", shares: 800, price: 12.3 } },
  { acc: "0009900001-26-000004", day: "20261002", cik: "9100002", x: { ...BETA, ownerCik: "0009000004", ownerName: "Delta Dana", officer: "CEO", date: "2026-10-01", shares: 2000, price: 5.5 } },
  { acc: "0009900001-26-000005", day: "20261002", cik: "1045810", x: { ...NV, ownerCik: "0009000005", ownerName: "Echo Eve", officer: "VP", date: "2026-10-01", shares: 300, price: 181.0, code: "S" } },
  { acc: "0001321655-26-000306", day: "20261002", cik: "1321655", x: null /* stored by the seed: never requested */ },
  { acc: "0009900001-26-000007", day: "20261005", cik: "9100003", x: { ...GAMMA, ownerCik: "0009000006", ownerName: "Foxtrot Finn", officer: "CEO", date: "2026-10-02", shares: 4000, price: 3.1 } },
  { acc: "0009900001-26-000008", day: "20261005", cik: "9100003", x: null /* no ownership XML */ },
  { acc: "0009900001-26-000009", day: "20261005", cik: "9100003", x: { ...GAMMA, ownerCik: "0009000007", ownerName: "Golf Gina", officer: "CFO", date: "2026-10-02", shares: 100, price: 3.2 } },
];
const EXTRA_ROWS = [
  { day: "20261005", cik: "9100003", name: "GAMMA ENERGY LTD", form: "4/A", file: "edgar/data/9100003/0009900001-26-000010.txt" },
  { day: "20261005", cik: "9100003", name: "GAMMA ENERGY LTD", form: "144", file: "edgar/data/9100003/0009900001-26-000011.txt" },
];

const DAYS = ["20261001", "20261002", "20261005"];

function master(day) {
  const lines = [
    "Description:           Master Index of EDGAR Dissemination Feed",
    `Last Data Received:    ${day}`,
    "",
    "CIK|Company Name|Form Type|Date Filed|File Name",
    "--------------------------------------------------------------------------------",
  ];
  for (const f of FILINGS.filter((f) => f.day === day)) {
    const name = f.x ? f.x.issuerName : "SOME ISSUER";
    // two rows per accession (issuer and owner), as the real file has
    lines.push(`${f.cik}|${name}|4|${day}|edgar/data/${f.cik}/${f.acc}.txt`);
    lines.push(`9000000|REPORTING OWNER|4|${day}|edgar/data/9000000/${f.acc}.txt`);
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
      item.push({ name: "sitemap.20261001.xml", type: "text" });
      return send(200, JSON.stringify({ directory: { item } }), "application/json");
    }
    let m = /^\/Archives\/edgar\/daily-index\/2026\/QTR4\/master\.(\d{8})\.idx$/.exec(path);
    if (m && DAYS.includes(m[1])) return send(200, master(m[1]));

    m = /^\/Archives\/edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt$/.exec(path);
    if (m) {
      if (SLOW) await sleep(SLOW);
      if (FAIL) return send(500, "server error");
      const f = FILINGS.find((f) => f.acc === m[2]);
      if (!f) return send(404, "not found");
      if (!f.x) return send(200, submission(f.acc, "This filing has no ownership document."));
      return send(200, submission(f.acc, `<XML>\n${xml(f.x)}\n</XML>`));
    }
    return send(404, "not found");
  })
  .listen(port, "127.0.0.1", () => console.log(`fake EDGAR index on http://127.0.0.1:${port}`));
