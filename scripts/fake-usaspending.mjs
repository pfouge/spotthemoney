// A local stand-in for the USAspending award search, for tests of ingest/src/sources/usaspending.ts
// only (through USASPENDING_API_BASE). Never used in production.
//   node scripts/fake-usaspending.mjs [port]        FAKE_BLANK=1 answers with the details blank
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
createServer((req, res) => {
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
