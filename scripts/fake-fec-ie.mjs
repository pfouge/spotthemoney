// Test fake for the OpenFEC Schedule E endpoint and the congress-legislators roster.
// Used only through FEC_API_BASE and CONGRESS_ROSTER_URL (never in production).
//
//   node scripts/fake-fec-ie.mjs <port> [mode]
//
// Modes: ok (default), down (HTTP 503 on schedule_e), noshape (200 with rows that lack the fields),
//        notlist (200 with results as an object), limited (HTTP 429 after the first N schedule_e calls, FAKE_LIMIT_AFTER).
// Env:   FAKE_ROWS (default 250), FAKE_SLOW_MS.
// Routes: /schedules/schedule_e/, /roster.json, /candidates/search/ and /totals/pac/ (fec_committees)
// Seek paging as OpenFEC does it: pagination.last_indexes = { last_index, last_expenditure_date },
// sent back as ?last_index=...&last_expenditure_date=...
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8841);
const mode = process.argv[3] ?? "ok";
const N = Number(process.env.FAKE_ROWS ?? 250);
const SLOW = Number(process.env.FAKE_SLOW_MS ?? 0);
const LIMIT_AFTER = Number(process.env.FAKE_LIMIT_AFTER ?? 2);

const base = Date.parse("2026-11-10T00:00:00Z");
const day = (i) => new Date(base - i * 86_400_000).toISOString().slice(0, 10);

function rowFor(i) {
  const cand = i % 5 === 0 ? "H4PA00001" : i % 5 === 1 ? "S0TX00002" : i % 5 === 2 ? "P00003" : "H8NY00099";
  const r = {
    sub_id: `4${String(1000000 + i)}`,
    committee_id: `C0000${i % 7}`,
    committee: { name: `  Fake   PAC ${i % 7}\u0000 `, committee_id: `C0000${i % 7}` },
    candidate_id: cand,
    candidate_name: `Candidate ${cand}`,
    candidate_office: cand.startsWith("H") ? "H" : cand.startsWith("S") ? "S" : "P",
    candidate_office_state: "pa",
    candidate_office_district: "04",
    candidate_party: "DEM",
    support_oppose_indicator: i % 3 === 0 ? "O" : "S",
    expenditure_amount: 1000 + i + (i % 4 === 0 ? 0.55 : 0),
    expenditure_date: `${day(i)}T00:00:00`,
    dissemination_date: day(i),
    expenditure_description: `Mailers   and\n digital ${i}`,
    payee_name: `Payee ${i}`,
    is_notice: i % 2 === 0,
    pdf_url: `https://docquery.fec.gov/pdf/${i}/x.pdf`,
  };
  if (i === 3) r.expenditure_date = "2099-01-01T00:00:00";
  if (i === 7) r.expenditure_date = "2026-02-30T00:00:00";
  if (i === 11) r.support_oppose_indicator = null;
  if (i === 14) r.expenditure_description = "x".repeat(400);
  if (i === 16) delete r.sub_id; // quarantined
  if (i === 18) r.candidate_id = null;
  return r;
}

let hits = 0;
let ieCalls = 0;
const server = createServer(async (req, res) => {
  hits++;
  const u = new URL(req.url, `http://127.0.0.1:${port}`);
  if (SLOW) await new Promise((r) => setTimeout(r, SLOW));
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

  if (u.pathname === "/roster.json") {
    return send(200, [
      { id: { bioguide: "A000001", fec: ["H4PA00001", "S9XX00009"] } },
      { id: { bioguide: "B000002", fec: ["S0TX00002"] } },
      { id: { bioguide: "NOPE999", fec: ["H8NY00099"] } }, // bioguide not in people: no link
      { id: { bioguide: "C000003" } },
    ]);
  }
  // fec_committees: /candidates/search/ (members' principal committees) and /totals/pac/.
  if (u.pathname === "/candidates/search/") {
    const office = u.searchParams.get("office");
    const cands = office === "H"
      ? [{ candidate_id: "H4PA00001", name: "Fake A", party: "DEM", principal_committees: [{ committee_id: "CFAKE0001", name: "A FOR CONGRESS", committee_type: "H", party: "DEM" }] },
         { candidate_id: "H8NY00099", name: "Fake Nope", party: "REP", principal_committees: [{ committee_id: "CFAKE0002", name: "NOPE FOR NEW YORK", committee_type: "H", party: "REP" }] }]
      : [{ candidate_id: "S0TX00002", name: "Fake B", party: "REP", principal_committees: [{ committee_id: "CFAKE0003", name: "B FOR SENATE", committee_type: "S", party: "REP" }] }];
    return send(200, { results: cands, pagination: { count: cands.length, per_page: 100, pages: 1 } });
  }
  if (u.pathname === "/totals/pac/") {
    const pacs = [{ committee_id: "CFAKEPAC1", committee_name: "FAKE BIG PAC", committee_type: "Q", party: null }, { committee_id: "CFAKEPAC2", committee_name: "FAKE OTHER PAC", committee_type: "N", party: null }];
    return send(200, { results: pacs, pagination: { count: pacs.length, per_page: 100, pages: 1 } });
  }
  if (u.pathname !== "/schedules/schedule_e/") return send(404, { error: "not found" });
  ieCalls++;
  if (mode === "down") return send(503, { error: "down" });
  if (mode === "limited" && ieCalls > LIMIT_AFTER) return send(429, { error: "over limit" });
  if (mode === "notlist") return send(200, { results: { a: 1 }, pagination: {} });
  if (mode === "noshape") return send(200, { results: [{ foo: 1 }, { bar: 2 }], pagination: { last_indexes: { last_index: "1" } } });

  const per = Number(u.searchParams.get("per_page") ?? 100);
  const minDate = u.searchParams.get("min_date");
  const lastIndex = u.searchParams.get("last_index");
  const all = [];
  for (let i = 0; i < N; i++) if (!minDate || day(i) >= minDate) all.push(i);
  let start = 0;
  if (lastIndex != null) {
    const pos = all.indexOf(Number(lastIndex));
    start = pos >= 0 ? pos + 1 : all.length;
  }
  const slice = all.slice(start, start + per);
  const last = slice[slice.length - 1];
  return send(200, {
    pagination: {
      count: all.length,
      per_page: per,
      pages: Math.ceil(all.length / per),
      last_indexes: slice.length ? { last_index: String(last), last_expenditure_date: `${day(last)}T00:00:00` } : null,
    },
    results: slice.map(rowFor),
  });
});
server.listen(port, "127.0.0.1", () => console.log(`fake-fec-ie ${mode} on ${port}`));
process.on("SIGTERM", () => { console.log(`fake-fec-ie hits=${hits} schedule_e=${ieCalls}`); process.exit(0); });
