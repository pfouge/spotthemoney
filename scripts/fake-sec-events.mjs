// A local stand-in for the SEC submissions data (data.sec.gov/submissions/CIK##########.json),
// for testing the `sec_company_events` source without the network. Tests only.
//
//   node scripts/fake-sec-events.mjs [port] [mode]
//   SEC_DATA_BASE=http://127.0.0.1:8821 SEC_EVENTS_MIN_GAP_MS=0 SEC_EVENTS_RETRIES=0 npx tsx ingest/src/index.ts sec_company_events
//
// mode "ok" (default): NVIDIA (8-K, 8-K/A, a 10-Q, a Form 4, an 8-K before the floor, comma
//   separated items, an empty reportDate), Microsoft (one 8-K), Lockheed (valid layout, no 8-K),
//   every other CIK: 404.
// mode "changed": as ok, but NVIDIA's 2026-02-26 8-K lists items "2.02,7.01,9.01" (was "2.02,9.01").
// mode "down": every request answers 503.
// mode "noshape": every request answers 200 with a body that has no filings.recent layout.
// FAKE_SLOW_MS=<ms>: delay every answer (budget tests).
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8821);
const mode = process.argv[3] ?? "ok";
const slow = Number(process.env.FAKE_SLOW_MS ?? 0);

function recent(rows) {
  const col = (k) => rows.map((r) => r[k] ?? "");
  return {
    accessionNumber: col("a"), filingDate: col("f"), reportDate: col("r"), acceptanceDateTime: col("t"),
    form: col("form"), items: col("items"), primaryDocument: col("doc"),
  };
}
const nvidiaItems = mode === "changed" ? "2.02,7.01,9.01" : "2.02,9.01";
const KNOWN = {
  "0001045810": [
    { a: "0001045810-26-000010", f: "2026-02-26", r: "2026-02-25", t: "2026-02-26T16:05:11.000Z", form: "8-K", items: nvidiaItems, doc: "nvda-8k.htm" },
    { a: "0001045810-26-000011", f: "2026-03-05", r: "", t: "2026-03-05T21:10:00.000Z", form: "8-K/A", items: "5.02", doc: "nvda-8ka.htm" },
    { a: "0001045810-26-000012", f: "2026-02-27", r: "2026-01-25", t: "2026-02-27T13:00:00.000Z", form: "10-Q", items: "", doc: "nvda-10q.htm" },
    { a: "0001045810-26-000013", f: "2026-03-01", r: "2026-02-27", t: "2026-03-01T13:00:00.000Z", form: "4", items: "", doc: "form4.xml" },
    { a: "0001045810-25-000099", f: "2025-09-30", r: "2025-09-29", t: "2025-09-30T13:00:00.000Z", form: "8-K", items: "1.01", doc: "old.htm" },
    { a: "0001045810-25-000100", f: "2025-10-01", r: "2025-09-30", t: "2025-10-01T13:00:00.000Z", form: "8-K", items: "8.01,9.01", doc: "" },
  ],
  "0000789019": [
    { a: "0000789019-26-000020", f: "2026-01-15", r: "2026-01-14", t: "2026-01-15T14:00:00.000Z", form: "8-K", items: "8.01", doc: "msft-8k.htm" },
  ],
  "0000936468": [
    { a: "0000936468-26-000030", f: "2026-01-20", r: "", t: "2026-01-20T14:00:00.000Z", form: "10-K", items: "", doc: "lmt-10k.htm" },
  ],
};
let hits = 0;
createServer((req, res) => {
  hits++;
  const m = /^\/submissions\/CIK(\d{10})\.json$/.exec(req.url ?? "");
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const go = () => {
    if (mode === "down") return send(503, { error: "down" });
    if (!m) return send(404, { error: "not found" });
    if (mode === "noshape") return send(200, { message: "something else" });
    const rows = KNOWN[m[1]];
    return rows ? send(200, { cik: String(Number(m[1])), name: "FAKE", filings: { recent: recent(rows), files: [] } }) : send(404, { error: "no such CIK" });
  };
  if (slow > 0) setTimeout(go, slow); else go();
}).listen(port, "127.0.0.1", () => console.log(`fake SEC events on http://127.0.0.1:${port} (${mode})`));
process.on("SIGTERM", () => { console.log(`requests served: ${hits}`); process.exit(0); });
