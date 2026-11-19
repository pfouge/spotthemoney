// A small fake of the SEC EDGAR daily index holding Form 144 notices, for testing the
// sec_form144 source offline. Used only through SEC_EDGAR_BASE; never part of a workflow.
//
//   node scripts/fake-edgar-144.mjs <port>
//
// Serves one quarter (2026 QTR4). Everything else answers 404.
//   Day 2026-10-01  3 notices: NVIDIA (tracked in scripts/seed-local.sql), ACME, and a 144/A
//                   for ACME; the day's master file also lists a Form 4, which must be ignored
//   Day 2026-10-02  3 notices: BETA with two securities lines and a plan date, one submission
//                   with no data file, and one with a date that is not a date
// Env: FAKE_144=noshape (every notice uses element names the parser does not know),
// FAKE_SLOW_MS (delay before every submission answer), FAKE_FAIL_500=1 (every submission
// answers 500). GET /__stats returns the request counts per path.

import http from "node:http";

const port = Number(process.argv[2] ?? 4372);
const SLOW = Number(process.env.FAKE_SLOW_MS ?? 0);
const FAIL = process.env.FAKE_FAIL_500 === "1";
const NOSHAPE = process.env.FAKE_144 === "noshape";

function xml(n) {
  if (NOSHAPE) {
    return `<?xml version="1.0"?>
<edgarSubmission><formData><issuerInfo><companyCik>${n.issuerCik}</companyCik><companyName>${n.issuerName}</companyName>
<sellerName>${n.seller}</sellerName></issuerInfo>
<securitiesInformation><units>${n.lines[0].units}</units></securitiesInformation></formData></edgarSubmission>`;
  }
  const lines = n.lines.map((l) => `
    <securitiesInformation>
      <securitiesClassTitle>${l.cls ?? "Common"}</securitiesClassTitle>
      <brokerOrMarketmakerDetails><name>${l.broker ?? "Example Brokerage &amp; Co"}</name><address><street1>1 Main St</street1><city>New York</city></address></brokerOrMarketmakerDetails>
      <noOfUnitsSold>${l.units}</noOfUnitsSold>
      <aggregateMarketValue>${l.value}</aggregateMarketValue>
      <noOfUnitsOutstanding>${l.outstanding ?? 1000000}</noOfUnitsOutstanding>
      <approxSaleDate>${l.date}</approxSaleDate>
      <securitiesExchangeName>${l.exchange ?? "NASDAQ"}</securitiesExchangeName>
    </securitiesInformation>`).join("");
  const sold = (n.sold ?? []).map((s) => `
    <securitiesSoldInPast3Months>
      <sellerDetails><name>${n.seller}</name><address><street1>9 Private Rd</street1></address></sellerDetails>
      <securitiesClassTitle>Common</securitiesClassTitle>
      <saleDate>${s.date}</saleDate>
      <amountOfSecuritiesSold>${s.amount}</amountOfSecuritiesSold>
      <grossProceeds>${s.proceeds}</grossProceeds>
    </securitiesSoldInPast3Months>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/ownership" xmlns:com="http://www.sec.gov/edgar/common">
  <headerData>
    <submissionType>${n.form}</submissionType>
    <filerInfo><filer><filerCredentials><cik>${n.filerCik}</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer></filerInfo>
  </headerData>
  <formData>
    <issuerInfo>
      <issuerCik>${n.issuerCik}</issuerCik>
      <issuerName>${n.issuerName}</issuerName>
      <secFileNumber>001-00001</secFileNumber>
      <issuerAddress><com:street1>2788 San Tomas Expy</com:street1><com:city>Santa Clara</com:city></issuerAddress>
      <issuerContactPhone>4085550100</issuerContactPhone>
      <nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>${n.seller}</nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>
      <relationshipsToIssuer>${(n.rels ?? ["Officer"]).map((r) => `<relationshipToIssuer>${r}</relationshipToIssuer>`).join("")}</relationshipsToIssuer>
    </issuerInfo>${lines}
    <securitiesToBeSold>
      <securitiesClassTitle>Common</securitiesClassTitle>
      <acquiredDate>03/15/2024</acquiredDate>
      <natureOfAcquisitionTransaction>Restricted stock vesting</natureOfAcquisitionTransaction>
      <nameOfPersonfromWhomAcquired>Issuer</nameOfPersonfromWhomAcquired>
      <isGiftTransaction>N</isGiftTransaction>
      <amountOfSecuritiesAcquired>${n.lines[0].units}</amountOfSecuritiesAcquired>
      <paymentDate>03/15/2024</paymentDate>
      <natureOfPayment>Compensation</natureOfPayment>
    </securitiesToBeSold>${sold}
    ${n.sold ? "" : "<nothingToReportFlagOnSecuritiesSoldInPast3Months>true</nothingToReportFlagOnSecuritiesSoldInPast3Months>"}
    <remarks>${n.remarks ?? ""}</remarks>
    <noticeSignature>
      <noticeDate>${n.noticeDate ?? "10/01/2026"}</noticeDate>
      ${n.plan ? `<planAdoptionDates><planAdoptionDate>${n.plan}</planAdoptionDate></planAdoptionDates>` : ""}
      <signature>/s/ ${n.seller}</signature>
    </noticeSignature>
  </formData>
</edgarSubmission>`;
}

const submission = (acc, form, body) =>
  `<SEC-DOCUMENT>${acc}.txt : 20261001\n<SEC-HEADER>ACCESSION NUMBER:\t\t${acc}\nCONFORMED SUBMISSION TYPE:\t${form}\n</SEC-HEADER>\n<DOCUMENT>\n<TYPE>${form}\n<SEQUENCE>1\n<FILENAME>primary_doc.xml\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>\n`;

const NV = { issuerCik: "1045810", issuerName: "NVIDIA CORP" };
const ACME = { issuerCik: "0009100001", issuerName: "ACME ROBOTICS INC" };
const BETA = { issuerCik: "9100002", issuerName: "BETA FOODS &amp; CO" };

const NOTICES = [
  { acc: "0009900144-26-000001", day: "20261001", cik: "1045810", form: "144",
    n: { ...NV, filerCik: "0009000001", seller: "Alpha Alice", rels: ["Officer", "Director"], lines: [{ units: "12,500", value: "2256250.00", date: "10/01/2026" }],
         sold: [{ date: "08/15/2026", amount: "5000", proceeds: "875000.00" }, { date: "09/02/2026", amount: "2500", proceeds: "450000" }] } },
  { acc: "0009900144-26-000002", day: "20261001", cik: "9100001", form: "144",
    n: { ...ACME, filerCik: "0009000002", seller: "Bravo Bob", lines: [{ units: "800", value: "9840", date: "10/02/2026", exchange: "NYSE" }], remarks: "Sale under a plan &lt;adopted&gt; earlier." } },
  { acc: "0009900144-26-000003", day: "20261001", cik: "9100001", form: "144/A",
    n: { ...ACME, filerCik: "0009000002", seller: "Bravo Bob", lines: [{ units: "900", value: "11070", date: "10/02/2026", exchange: "NYSE" }] } },
  { acc: "0009900144-26-000004", day: "20261002", cik: "9100002", form: "144",
    n: { ...BETA, filerCik: "0009000004", seller: "Delta Dana Family Trust", rels: ["10% Stockholder"], plan: "06/30/2026",
         lines: [{ units: "2000", value: "11000", date: "10/05/2026" }, { units: "3000", value: "16500", date: "10/03/2026", cls: "Class B" }] } },
  { acc: "0009900144-26-000005", day: "20261002", cik: "9100002", form: "144", n: null /* no data file */ },
  { acc: "0009900144-26-000006", day: "20261002", cik: "9100002", form: "144",
    n: { ...BETA, filerCik: "", seller: "Echo Eve", lines: [{ units: "100", value: "550", date: "13/45/2026" }] } },
];
const EXTRA_ROWS = [
  { day: "20261001", cik: "1045810", name: "NVIDIA CORP", form: "4", file: "edgar/data/1045810/0009900001-26-000001.txt" },
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
  for (const f of NOTICES.filter((f) => f.day === day)) {
    // two rows per accession (issuer and filer), as the real file has
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
      const f = NOTICES.find((f) => f.acc === m[2]);
      if (!f) return send(404, "not found");
      if (!f.n) return send(200, submission(f.acc, f.form, "<PDF>\nbegin 644 form144.pdf\nend\n</PDF>"));
      return send(200, submission(f.acc, f.form, `<XML>\n${xml({ ...f.n, form: f.form })}\n</XML>`));
    }
    return send(404, "not found");
  })
  .listen(port, "127.0.0.1", () => console.log(`fake EDGAR (Form 144) on http://127.0.0.1:${port}`));
