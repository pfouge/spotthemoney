// A local stand-in for the SEC's ticker file (www.sec.gov/files/company_tickers.json), for
// testing the `sec_company_tickers` source without the network. Tests only.
//
//   node scripts/fake-sec-tickers.mjs [port] [mode]
//   SEC_EDGAR_BASE=http://127.0.0.1:8793 SEC_TICKERS_MIN_ROWS=5 SEC_TICKERS_RETRIES=0 npm run ingest -- sec_company_tickers
//
// mode "ok" (default): the seed's companies with their own tickers, plus filler rows.
// mode "short": two rows only (fewer than the job accepts).
// mode "noshape": 200 with a body in another shape.
// mode "down": every request answers 503.
// mode "wild": every seed ticker listed under one company (the repair must refuse).
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8793);
const mode = process.argv[3] ?? "ok";
const SEED = [
  [1045810, "NVDA", "NVIDIA CORP"], [789019, "MSFT", "MICROSOFT CORP"], [1321655, "PLTR", "Palantir Technologies Inc."],
  [936468, "LMT", "LOCKHEED MARTIN CORP"], [320193, "AAPL", "Apple Inc."], [2488, "AMD", "ADVANCED MICRO DEVICES INC"],
  [9996702, "SWAP", "SEED SWAPPED PARENT CORP"],
];
function body() {
  if (mode === "noshape") return { message: "something else" };
  const rows = mode === "short" ? SEED.slice(0, 2) : SEED;
  const out = {};
  let i = 0;
  for (const [cik, ticker, title] of rows) out[String(i++)] = { cik_str: mode === "wild" ? 1045810 : cik, ticker, title };
  if (mode !== "short") for (let n = 0; n < 40; n++) out[String(i++)] = { cik_str: 8000000 + n, ticker: `ZZ${String.fromCharCode(65 + (n % 26))}${n}`, title: `Filler ${n}` };
  return out;
}
let hits = 0;
createServer((req, res) => {
  hits++;
  const send = (code, b) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (mode === "down") return send(503, { error: "down" });
  if ((req.url ?? "").split("?")[0] !== "/files/company_tickers.json") return send(404, { error: "not found" });
  return send(200, body());
}).listen(port, "127.0.0.1", () => console.log(`fake SEC ticker file on http://127.0.0.1:${port} (${mode})`));
process.on("SIGTERM", () => { console.log(`requests served: ${hits}`); process.exit(0); });
