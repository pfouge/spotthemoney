// A local stand-in for the three SEC answers the `sec_proxy_pay` source reads, for testing it
// without the network. Tests only.
//
//   node scripts/fake-sec-proxy.mjs [port] [mode]
//   SEC_DATA_BASE=http://127.0.0.1:8842 SEC_EDGAR_BASE=http://127.0.0.1:8842 SEC_PROXY_MIN_GAP_MS=0 \
//     SEC_PROXY_RETRIES=0 npx tsx ingest/src/index.ts sec_proxy_pay
//
// One server answers /submissions/CIK<10 digits>.json, /Archives/edgar/data/<cik>/<accession>/index.json
// and the instance file in that folder.
//
// mode "ok" (default):
//   NVIDIA 0001045810    one DEF 14A; figures with no dimension for two fiscal years
//   Microsoft 0000789019 newest DEF 14A is for a special meeting (instance without pay tags), the one
//                        before has the principal executive per person: two people in the newest year
//   Lockheed 0000936468  one DEF 14A whose folder has no extracted instance
//   Palantir 0001321655  files no DEF 14A
//   Apple 0000320193     one DEF 14A whose folder answers 404
//   every other CIK: 404
// mode "newer": NVIDIA has a newer DEF 14A that restates the newest year and adds one.
// mode "noshape": instances are served without any pay tag (a changed layout).
// mode "down": every request answers 503.
// FAKE_SLOW_MS=<ms>: delay every answer (budget tests).
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8842);
const mode = process.argv[3] ?? "ok";
const slow = Number(process.env.FAKE_SLOW_MS ?? 0);

const recent = (rows) => ({
  accessionNumber: rows.map((r) => r.a), filingDate: rows.map((r) => r.f), form: rows.map((r) => r.form),
  primaryDocument: rows.map((r) => r.doc ?? ""), items: rows.map(() => ""), reportDate: rows.map(() => ""),
});
const ctx = (id, cik, start, end, dims = {}) => {
  const seg = Object.entries(dims).map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join("");
  return `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${cik}</identifier>${seg ? `<segment>${seg}</segment>` : ""}</entity><period><startDate>${start}</startDate><endDate>${end}</endDate></period></context>`;
};
const fact = (tag, c, v) => `<ecd:${tag} contextRef="${c}" decimals="0" unitRef="usd">${v}</ecd:${tag}>`;
const xbrl = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:ecd="http://xbrl.sec.gov/ecd/2025" xmlns:dei="http://xbrl.sec.gov/dei/2025">${body}</xbrl>`;
const four = (c, a, b, d, e) => fact("PeoTotalCompAmt", c, a) + fact("PeoActuallyPaidCompAmt", c, b) + fact("NonPeoNeoAvgTotalCompAmt", c, d) + fact("NonPeoNeoAvgCompActuallyPaidAmt", c, e);

const NV = "0001045810", MS = "0000789019", LM = "0000936468", PL = "0001321655", AP = "0000320193";
const SUBS = {
  [NV]: [
    ...(mode === "newer" ? [{ a: "0001045810-27-000050", f: "2027-05-10", form: "DEF 14A" }] : []),
    { a: "0001045810-26-000040", f: "2026-05-12", form: "DEF 14A" },
    { a: "0001045810-26-000041", f: "2026-05-13", form: "DEFA14A" },
    { a: "0001045810-26-000042", f: "2026-05-20", form: "8-K" },
  ],
  [MS]: [
    { a: "0000789019-26-000070", f: "2026-10-20", form: "DEF 14A" },
    { a: "0000789019-25-000060", f: "2025-10-21", form: "DEF 14A" },
  ],
  [LM]: [{ a: "0000936468-26-000030", f: "2026-03-10", form: "DEF 14A" }],
  [PL]: [{ a: "0001321655-26-000001", f: "2026-02-18", form: "10-K" }],
  [AP]: [{ a: "0000320193-26-000009", f: "2026-01-08", form: "DEF 14A" }],
};
// accession (no dashes) → { files: [names], instance: xml }
const FOLDERS = {
  "000104581026000040": {
    name: "nvda-20260512_htm.xml",
    xml: xbrl(ctx("y1", NV, "2025-01-27", "2026-01-25") + ctx("y0", NV, "2024-01-29", "2025-01-26") +
      ctx("adj", NV, "2025-01-27", "2026-01-25", { "ecd:AdjToCompAxis": "ecd:EqtyAwrdsAdjsMember" }) +
      four("y1", "49866251", "121000000", "11200000", "25300000") + four("y0", "34167902", "234000000", "9800000", "57000000") +
      fact("PeoTotalCompAmt", "adj", "-38000000") + `<ecd:PeoName contextRef="y1">A Person</ecd:PeoName>`),
  },
  "000104581027000050": {
    name: "nvda-20270510_htm.xml",
    xml: xbrl(ctx("y2", NV, "2026-01-26", "2027-01-31") + ctx("y1", NV, "2025-01-27", "2026-01-25") +
      four("y2", "60000000", "90000000", "12000000", "20000000") + four("y1", "49866999", "121000000", "11200000", "25300000")),
  },
  "000078901926000070": { name: "msft-special_htm.xml", xml: xbrl(ctx("d", MS, "2025-07-01", "2026-06-30") + `<dei:EntityCentralIndexKey contextRef="d">${MS}</dei:EntityCentralIndexKey>`) },
  "000078901925000060": {
    name: "msft-20251021_htm.xml",
    xml: xbrl(ctx("a1", MS, "2024-07-01", "2025-06-30", { "ecd:IndividualAxis": "msft:FirstPersonMember" }) +
      ctx("a2", MS, "2024-07-01", "2025-06-30", { "ecd:IndividualAxis": "msft:SecondPersonMember" }) +
      ctx("b1", MS, "2023-07-01", "2024-06-30", { "ecd:IndividualAxis": "msft:FirstPersonMember" }) +
      ctx("n1", MS, "2024-07-01", "2025-06-30") + ctx("n0", MS, "2023-07-01", "2024-06-30") +
      fact("PeoTotalCompAmt", "a1", "30000000") + fact("PeoTotalCompAmt", "a2", "79100000") + fact("PeoTotalCompAmt", "b1", "48500000") +
      fact("PeoActuallyPaidCompAmt", "a2", "105000000") + fact("PeoActuallyPaidCompAmt", "b1", "-2500000") +
      fact("NonPeoNeoAvgTotalCompAmt", "n1", "21000000") + fact("NonPeoNeoAvgTotalCompAmt", "n0", "19000000")),
  },
  "000093646826000030": { name: null },
};

let hits = 0;
createServer((req, res) => {
  hits++;
  const url = (req.url ?? "").split("?")[0];
  const send = (code, body, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  const go = () => {
    if (mode === "down") return send(503, { error: "down" });
    let m = /^\/submissions\/CIK(\d{10})\.json$/.exec(url);
    if (m) {
      const rows = SUBS[m[1]];
      return rows ? send(200, { cik: String(Number(m[1])), name: "FAKE", filings: { recent: recent(rows), files: [] } }) : send(404, { error: "no such CIK" });
    }
    m = /^\/Archives\/edgar\/data\/\d+\/(\d{18})\/(.+)$/.exec(url);
    if (m) {
      const folder = FOLDERS[m[1]];
      if (!folder) return send(404, { error: "no such folder" });
      if (m[2] === "index.json") {
        const item = [{ name: "proxy.htm" }, { name: "proxy.xsd" }, { name: "proxy_def.xml" }, { name: "FilingSummary.xml" }];
        if (folder.name) item.push({ name: folder.name });
        return send(200, { directory: { item, name: url.replace(/index\.json$/, ""), "parent-dir": "/" } });
      }
      if (folder.name && m[2] === folder.name) {
        return send(200, mode === "noshape" ? xbrl(ctx("d", "1", "2025-01-01", "2025-12-31")) : folder.xml, "application/xml");
      }
    }
    return send(404, { error: "not found" });
  };
  if (slow > 0) setTimeout(go, slow); else go();
}).listen(port, "127.0.0.1", () => console.log(`fake SEC proxy statements on http://127.0.0.1:${port} (${mode})`));
process.on("SIGTERM", () => { console.log(`requests served: ${hits}`); process.exit(0); });
