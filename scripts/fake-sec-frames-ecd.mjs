// A local stand-in for the SEC XBRL frames API of the `ecd` taxonomy
// (data.sec.gov/api/xbrl/frames/ecd/<Tag>/USD/CY<year>.json), for testing the `sec_exec_pay` source
// without the network. Tests only.
//
//   node scripts/fake-sec-frames-ecd.mjs [port] [mode]
//   SEC_DATA_BASE=http://127.0.0.1:8871 EXEC_PAY_MIN_GAP_MS=0 EXEC_PAY_RETRIES=0 npx tsx ingest/src/index.ts sec_exec_pay
//
// mode "ok" (default): CY2022 to CY2025 answer for the four PvP tags; every other year (CY2026, CY2021)
//   answers 404 (not yet reported). Facts: NVIDIA (1045810), Palantir (1321655), Microsoft (789019),
//   a CIK that is not in `companies` (9999999999), one entry with a bad date, one with a non-numeric
//   value, one repeated company/period with a lower accession, and a negative "actually paid" value.
// mode "empty":   200 with `data: []` (a year with nothing yet).
// mode "down":    every request answers 503.
// mode "noshape": every request answers 200 with a body that has no frames layout.
// env FAKE_SLOW_MS: wait this long before each answer (to hit a time budget).
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8871);
const mode = process.argv[3] ?? "ok";
const slow = Number(process.env.FAKE_SLOW_MS ?? 0);

const TAGS = {
  PeoTotalCompAmt: 1,
  PeoActuallyPaidCompAmt: 2,
  NonPeoNeoAvgTotalCompAmt: 3,
  NonPeoNeoAvgCompActuallyPaidAmt: 4,
};

function frame(tag, year, n) {
  const e = (cik, name, val, extra = {}) => ({
    accn: `${String(cik).padStart(10, "0")}-${String(year + 1).slice(2)}-000001`,
    cik, entityName: name, loc: "US-CA",
    start: `${year}-01-01`, end: `${year}-12-31`, val, ...extra,
  });
  const data = [
    e(1045810, "NVIDIA CORP", 1000000 * n + year),
    e(1321655, "PALANTIR TECHNOLOGIES INC", 2000000 * n + year),
    e(789019, "MICROSOFT CORP", -500000 * n), // negative actually-paid: kept as filed
    e(9999999999, "NOT IN COMPANIES", 5),      // not a known company: not stored
  ];
  if (n === 1) {
    data.push(e(1321655, "PALANTIR (older accession, same period)", 1, { accn: "0001321655-00-000001" })); // loses to the greater accession
    data.push(e(2488, "BAD DATE", 7, { end: "2024-02-30" }));
    data.push({ ...e(936468, "BAD VALUE", 0), val: "n/a" });
  }
  return { taxonomy: "ecd", tag, ccp: `CY${year}`, uom: "USD", label: tag, description: "x", pts: data.length, data };
}

let hits = 0;
createServer((req, res) => {
  hits++;
  const m = /^\/api\/xbrl\/frames\/ecd\/([A-Za-z]+)\/USD\/CY(\d{4})\.json$/.exec(req.url ?? "");
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const go = () => {
    if (mode === "down") return send(503, { error: "down" });
    if (!m) return send(404, { error: "not found" });
    if (mode === "noshape") return send(200, { message: "something else" });
    const tag = m[1];
    const year = Number(m[2]);
    if (!(tag in TAGS) || year < 2022 || year > 2025) return send(404, { error: "no such frame" });
    if (mode === "empty") return send(200, { taxonomy: "ecd", tag, uom: "USD", ccp: `CY${year}`, pts: 0, data: [] });
    return send(200, frame(tag, year, TAGS[tag]));
  };
  if (slow > 0) setTimeout(go, slow); else go();
}).listen(port, "127.0.0.1", () => console.log(`fake SEC ecd frames on http://127.0.0.1:${port} (${mode})`));
process.on("SIGTERM", () => { console.log(`requests served: ${hits}`); process.exit(0); });
