// A local stand-in for the SEC submissions data (data.sec.gov/submissions/CIK##########.json),
// for testing the `sec_company_sic` source without the network. Tests only.
//
//   node scripts/fake-sec-submissions.mjs [port] [mode]
//   SEC_DATA_BASE=http://127.0.0.1:8791 SEC_SIC_MIN_GAP_MS=0 SEC_SIC_RETRIES=0 npm run ingest -- sec_company_sic
//
// mode "ok" (default): the seed's companies answer as the SEC would (one with a code and
//   wording, one with a code, one with an empty code, every other CIK: 404).
// mode "down": every request answers 503.
// mode "noshape": every request answers 200 with a body that has no `sic` key.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8791);
const mode = process.argv[3] ?? "ok";
const KNOWN = {
  "0001045810": { cik: "1045810", entityType: "operating", sic: "3674", sicDescription: "Semiconductors & Related Devices", name: "NVIDIA CORP" },
  "0000789019": { cik: "789019", entityType: "operating", sic: "7372", sicDescription: "Services-Prepackaged Software", name: "MICROSOFT CORP" },
  "0000936468": { cik: "936468", entityType: "operating", sic: "", sicDescription: "", name: "LOCKHEED MARTIN CORP" },
};
let hits = 0;
createServer((req, res) => {
  hits++;
  const m = /^\/submissions\/CIK(\d{10})\.json$/.exec(req.url ?? "");
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (mode === "down") return send(503, { error: "down" });
  if (!m) return send(404, { error: "not found" });
  if (mode === "noshape") return send(200, { message: "something else" });
  const hit = KNOWN[m[1]];
  return hit ? send(200, hit) : send(404, { error: "no such CIK" });
}).listen(port, "127.0.0.1", () => console.log(`fake SEC submissions on http://127.0.0.1:${port} (${mode})`));
process.on("SIGTERM", () => { console.log(`requests served: ${hits}`); process.exit(0); });
