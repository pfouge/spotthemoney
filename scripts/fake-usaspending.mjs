// A local stand-in for the USAspending award search, for tests of ingest/src/sources/usaspending.ts
// only (through USASPENDING_API_BASE). Never used in production.
//   node scripts/fake-usaspending.mjs [port]        FAKE_BLANK=1 answers with the details blank
// GET /api/v2/awards/<id>/ answers one award's details for usaspending_details.ts:
//   FAKE_DETAILS=noshape answers {"unexpected": true} for every id; FAKE_DETAILS=down answers 503;
//   an id holding GONE answers 404, ODD answers {}, BARE answers the keys with nothing in them.
// Every search answers one page: three awards that started 10 days ago, keyed by the fields
// the job asks for. A recipient search answers only awards whose recipient holds the text.
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 8791);
const blank = process.env.FAKE_BLANK === "1";
const day = (back) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const awards = () => [
  { generated_internal_id: "CONT_AWD_FAKE1", "Award ID": "FAKE1", "Recipient Name": "LOCKHEED MARTIN CORP", "Award Amount": 900000000, "Awarding Agency": "Department of Defense",
    "Awarding Sub Agency": blank ? null : "Department of the  Navy", "Start Date": day(10), "End Date": blank ? null : "2029-09-30", "Description": blank ? "" : "  F-35 LOT 18\n AIRFRAME\tSUSTAINMENT  ", NAICS: { code: "336411", description: "Aircraft Manufacturing" } },
  { generated_internal_id: "CONT_AWD_FAKE2", "Award ID": "FAKE2", "Recipient Name": "ACME LOGISTICS LLC", "Award Amount": 5000000, "Awarding Agency": "General Services Administration",
    "Awarding Sub Agency": "General Services Administration", "Start Date": day(10), "End Date": "not a date", "Description": "X".repeat(1500), NAICS: "484121" },
  { generated_internal_id: "CONT_AWD_FAKE3", "Award ID": "FAKE3", "Recipient Name": "NO DETAILS INC", "Award Amount": 1000000, "Awarding Agency": "Department of Energy",
    "Awarding Sub Agency": null, "Start Date": day(10), "End Date": null, "Description": null, NAICS: null },
];
let requests = 0;
const detailsMode = process.env.FAKE_DETAILS ?? "ok";
function details(id) {
  if (detailsMode === "down") return [503, { detail: "down" }];
  if (detailsMode === "noshape") return [200, { unexpected: true }];
  if (id.includes("GONE")) return [404, { detail: "No Award matches the given query." }];
  if (id.includes("ODD")) return [200, {}];
  if (id.includes("BARE")) return [200, { description: null, awarding_agency: null, period_of_performance: {} }];
  return [200, {
    generated_unique_award_id: id, description: `  DETAILS FOR\n ${id}  `,
    awarding_agency: { toptier_agency: { name: "Department of Defense" }, subtier_agency: { name: "Department of the Air  Force", code: "5700" } },
    period_of_performance: { start_date: "2026-01-01", end_date: "2031-03-31", potential_end_date: "2033-03-31" },
  }];
}
createServer((req, res) => {
  const m = req.method === "GET" && /^\/api\/v2\/awards\/([^/]+)\/$/.exec(req.url ?? "");
  if (m) {
    requests++;
    const [status, json] = details(decodeURIComponent(m[1]));
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests++;
    let q = {}; try { q = JSON.parse(body || "{}"); } catch { /* empty */ }
    const period = q.filters?.time_period?.[0] ?? {};
    const text = (q.filters?.recipient_search_text?.[0] ?? "").toUpperCase();
    const results = (q.page ?? 1) > 1 ? [] : awards().filter((a) => a["Start Date"] >= (period.start_date ?? "0000") && a["Start Date"] <= (period.end_date ?? "9999") && (!text || a["Recipient Name"].includes(text)));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ results, page_metadata: { hasNext: false } }));
  });
}).listen(port, "127.0.0.1", () => console.log(`fake USAspending on ${port}`));
process.on("SIGTERM", () => { console.log(`requests ${requests}`); process.exit(0); });
