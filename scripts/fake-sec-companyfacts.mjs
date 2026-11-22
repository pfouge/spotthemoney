// A local stand-in for the SEC XBRL companyfacts API (data.sec.gov/api/xbrl/companyfacts/CIK##########.json),
// for testing the `sec_company_financials` source without the network. Tests only.
//
//   node scripts/fake-sec-companyfacts.mjs [port] [mode]
//   SEC_DATA_BASE=http://127.0.0.1:8792 SEC_FIN_MIN_GAP_MS=0 SEC_FIN_RETRIES=0 npx tsx ingest/src/index.ts sec_company_financials
//
// mode "ok" (default), answers keyed by the seed's CIKs:
//   0001045810 (NVIDIA)    us-gaap; revenue on Revenues for old periods and on the contract tag for new ones;
//                          a comparative repeated in a later filing with a restated value; an 8-K fact; a
//                          pre-floor period; diluted EPS in USD/shares; a quarter and a year-to-date.
//   0000789019 (Microsoft) ifrs-full in CNY (a 20-F filer)
//   0001321655 (Palantir)  the right layout but only a pre-floor period: no usable figure
//   every other CIK: 404 (the seed's Lockheed among them)
// mode "down":    every request answers 503.
// mode "noshape": every request answers 200 with a body that has no companyfacts layout.
// env FAKE_SLOW_MS: wait this long before each answer (to hit a time budget).
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8792);
const mode = process.argv[3] ?? "ok";
const slow = Number(process.env.FAKE_SLOW_MS ?? 0);

const f = (o) => ({ accn: "0001045810-26-000001", fy: 2026, fp: "FY", form: "10-K", filed: "2026-02-20", ...o });
const tag = (units) => ({ label: "x", description: "y", units });

const KNOWN = {
  "0001045810": { cik: 1045810, entityName: "NVIDIA CORP", facts: {
    "us-gaap": {
      Revenues: tag({ USD: [
        f({ start: "2023-01-01", end: "2023-12-31", val: 26974, accn: "0001045810-24-000001", filed: "2024-02-21", fy: 2023 }),
        f({ start: "2023-01-01", end: "2023-12-31", val: 26900, form: "8-K", accn: "0001045810-24-000009", filed: "2024-03-01" }),
        f({ start: "2021-01-01", end: "2021-12-31", val: 16675, accn: "0001045810-22-000001", filed: "2022-02-18" }),
      ] }),
      RevenueFromContractWithCustomerExcludingAssessedTax: tag({ USD: [
        f({ start: "2023-01-01", end: "2023-12-31", val: 111, accn: "0001045810-24-000002", filed: "2024-02-22" }),
        f({ start: "2024-01-01", end: "2024-12-31", val: 60922, accn: "0001045810-25-000001", filed: "2025-02-26", fy: 2024 }),
      ] }),
      NetIncomeLoss: tag({ USD: [
        f({ start: "2024-01-01", end: "2024-12-31", val: 29760, accn: "0001045810-25-000001", filed: "2025-02-26", fy: 2024 }),
        f({ start: "2024-01-01", end: "2024-12-31", val: 29800, accn: "0001045810-26-000001", filed: "2026-02-20", fy: 2025 }),
        f({ start: "2025-04-01", end: "2025-06-30", val: 7000, form: "10-Q", fp: "Q2", accn: "0001045810-25-000050", filed: "2025-08-27" }),
        f({ start: "2025-01-01", end: "2025-06-30", val: 13000, form: "10-Q", fp: "Q2", accn: "0001045810-25-000050", filed: "2025-08-27" }),
      ] }),
      EarningsPerShareDiluted: tag({ "USD/shares": [
        f({ start: "2024-01-01", end: "2024-12-31", val: 1.19, accn: "0001045810-25-000001", filed: "2025-02-26", fy: 2024 }),
      ] }),
      Assets: tag({ USD: [
        f({ end: "2024-12-31", val: 111601, accn: "0001045810-25-000001", filed: "2025-02-26", fy: 2024 }),
        f({ end: "2024-12-31", val: 111602, accn: "0001045810-26-000001", filed: "2026-02-20", fy: 2025 }),
      ] }),
    },
    dei: { EntityCommonStockSharesOutstanding: tag({ shares: [f({ end: "2026-02-10", val: 24000000000 })] }) },
  } },
  "0000789019": { cik: 789019, entityName: "FOREIGN CO ADR", facts: {
    "ifrs-full": {
      Revenue: tag({ CNY: [
        f({ start: "2024-01-01", end: "2024-12-31", val: 5000000, form: "20-F", accn: "0000789019-25-000001", filed: "2025-04-20", fp: "FY" }),
        f({ start: "2025-01-01", end: "2025-12-31", val: 5600000, form: "20-F", accn: "0000789019-26-000001", filed: "2026-04-20", fp: "FY" }),
      ] }),
      Assets: tag({ CNY: [f({ end: "2025-12-31", val: 9000000, form: "20-F", accn: "0000789019-26-000001", filed: "2026-04-20" })] }),
    },
  } },
  "0001321655": { cik: 1321655, entityName: "OLD FACTS INC", facts: {
    "us-gaap": { Assets: tag({ USD: [f({ end: "2019-12-31", val: 1, accn: "0001321655-20-000001", filed: "2020-02-20" })] }) },
  } },
};

let hits = 0;
createServer((req, res) => {
  hits++;
  const m = /^\/api\/xbrl\/companyfacts\/CIK(\d{10})\.json$/.exec(req.url ?? "");
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const go = () => {
    if (mode === "down") return send(503, { error: "down" });
    if (!m) return send(404, { error: "not found" });
    if (mode === "noshape") return send(200, { message: "something else", facts: {} });
    const hit = KNOWN[m[1]];
    return hit ? send(200, hit) : send(404, { error: "no such CIK" });
  };
  if (slow > 0) setTimeout(go, slow); else go();
}).listen(port, "127.0.0.1", () => console.log(`fake SEC companyfacts on http://127.0.0.1:${port} (${mode})`));
process.on("SIGTERM", () => { console.log(`requests served: ${hits}`); process.exit(0); });
