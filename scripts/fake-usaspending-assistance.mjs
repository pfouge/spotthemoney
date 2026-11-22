// Test-only fake of POST /api/v2/search/spending_by_award/ for FINANCIAL ASSISTANCE awards.
// Usage: node scripts/fake-usaspending-assistance.mjs <port>
// Point the job at it with USASPENDING_API_BASE=http://127.0.0.1:<port>.
//
// Behaviour (from the build brief, not observed on the live service):
//   - HTTP 422 when a request mixes award-type groups.
//   - Groups: grant 02-05 (+F001,F002), direct_payment 06,10 (+F006,F007), loan 07,08 (+F003,F004),
//     other 09,11,-1.
//   - Loans answer "Loan Value", "Subsidy Cost", "Issued Date"; the others "Award Amount",
//     "Start Date", "End Date", "Award Type".
// Modes (env FAKE_MODE): ok (default) | noshape | down | reject_field | reject_fcodes | reject_datetype
//   reject_field: HTTP 422 when the request asks for the field named in FAKE_REJECT_FIELD
//   (default "Assistance Listings"). reject_fcodes: 422 when any F-code is present.
//   reject_datetype: 422 when date_type is sent.
// FAKE_SLOW_MS delays every answer. SIGTERM logs the request count.
import http from "node:http";

const port = Number(process.argv[2] ?? 8851);
const mode = process.env.FAKE_MODE ?? "ok";
const rejectField = process.env.FAKE_REJECT_FIELD ?? "Assistance Listings";
const slowMs = Number(process.env.FAKE_SLOW_MS ?? 0);

const GROUPS = {
  grant: ["02", "03", "04", "05", "F001", "F002"],
  direct_payment: ["06", "10", "F006", "F007"],
  loan: ["07", "08", "F003", "F004"],
  other: ["09", "11", "-1"],
};
const groupOf = (code) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(code));

const day = 86_400_000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const today = Date.now();

// Recipients: the first is a tracked-company name (matches the seed company "NVIDIA CORP" style
// names through normalisation), plus masked ones.
const RECIPIENTS = ["NVIDIA CORP", "PALANTIR TECHNOLOGIES INC", "STATE OF OHIO", "MULTIPLE RECIPIENTS", "REDACTED DUE TO PII", "CITY OF AUSTIN", "ACME RESEARCH LLC"];
const TYPE_NAME = { "02": "BLOCK GRANT", "03": "FORMULA GRANT", "04": "PROJECT GRANT", "05": "COOPERATIVE AGREEMENT", "06": "DIRECT PAYMENT FOR SPECIFIED USE", "10": "DIRECT PAYMENT WITH UNRESTRICTED USE", "07": "DIRECT LOAN", "08": "GUARANTEED/INSURED LOAN", "09": "INSURANCE", "11": "OTHER", "-1": "OTHER" };

function makeAwards() {
  const out = [];
  let n = 0;
  for (const [kind, codes] of Object.entries(GROUPS)) {
    for (let age = 3; age < 395; age += 9) {
      const code = codes[n % Math.min(codes.length, kind === "other" ? 3 : 2)];
      const rec = RECIPIENTS[n % RECIPIENTS.length];
      n++;
      out.push({
        id: `ASST_${kind}_${age}_${n}`,
        kind,
        code,
        recipient: rec,
        start: iso(today - age * day),
        end: iso(today + (400 - age) * day),
        amount: 1_000_000 + ((n * 7919) % 90_000) * 100 + (kind === "loan" ? 5_000_000 : 0),
        subsidy: 50_000 + n * 10,
      });
    }
  }
  // Odd rows: a bad date, a missing recipient, a future start.
  out.push({ id: "ASST_grant_baddate", kind: "grant", code: "04", recipient: "ACME RESEARCH LLC", start: "2026-13-45", end: null, amount: 1234, subsidy: 0 });
  out.push({ id: "ASST_grant_norecipient", kind: "grant", code: "04", recipient: "", start: iso(today - 5 * day), end: null, amount: 99, subsidy: 0 });
  out.push({ id: "ASST_grant_future", kind: "grant", code: "04", recipient: "ACME RESEARCH LLC", start: iso(today + 50 * day), end: null, amount: 77, subsidy: 0 });
  return out;
}
const AWARDS = makeAwards();

let requests = 0;

function row(a, fields) {
  const r = { generated_internal_id: a.id };
  const loan = a.kind === "loan";
  const map = {
    "Award ID": `AID-${a.id}`,
    "Recipient Name": a.recipient,
    "Awarding Agency": "Department of Testing",
    "Awarding Sub Agency": "Office of Fixtures",
    Description: `Description of ${a.id}`,
    "Recipient UEI": `UEI${a.id.slice(-6).toUpperCase()}`,
    "Assistance Listings": { cfda_number: "10.001", cfda_program_title: "Test Program" },
    "Award Type": TYPE_NAME[a.code] ?? "OTHER",
    "Award Amount": a.amount,
    "Start Date": a.start,
    "End Date": a.end,
    "Loan Value": a.amount,
    "Subsidy Cost": a.subsidy,
    "Issued Date": a.start,
  };
  for (const f of fields) {
    if (f in map) {
      if (!loan && ["Loan Value", "Subsidy Cost", "Issued Date"].includes(f)) continue;
      if (loan && ["Award Amount", "Start Date", "End Date", "Award Type"].includes(f)) continue;
      r[f] = map[f];
    }
  }
  return r;
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests++;
    const reply = (status, obj) => {
      const send = () => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      slowMs ? setTimeout(send, slowMs) : send();
    };
    if (req.method !== "POST" || !req.url.startsWith("/api/v2/search/spending_by_award")) return reply(404, { detail: "not found" });
    if (mode === "down") return reply(503, { detail: "service unavailable" });
    let q;
    try { q = JSON.parse(body); } catch { return reply(400, { detail: "bad json" }); }
    if (mode === "noshape") return reply(200, { data: "nothing like it", page: 1 });

    const filters = q.filters ?? {};
    const codes = filters.award_type_codes ?? [];
    const groups = new Set(codes.map(groupOf));
    if (groups.size !== 1 || groups.has(undefined)) return reply(422, { detail: "award_type_codes must all belong to one group" });
    const kind = [...groups][0];
    if (mode === "reject_fcodes" && codes.some((c) => c.startsWith("F"))) return reply(422, { detail: "unknown award type code" });
    const period = (filters.time_period ?? [])[0] ?? {};
    if (mode === "reject_datetype" && period.date_type) return reply(422, { detail: "date_type not allowed" });
    const fields = q.fields ?? [];
    if (mode === "reject_field" && fields.includes(rejectField)) return reply(422, { detail: `unknown field ${rejectField}` });
    if (fields.includes("Loan Value") && kind !== "loan") return reply(422, { detail: "Loan Value is for loans only" });
    if (fields.includes("Award Amount") && kind === "loan") return reply(422, { detail: "Award Amount is not for loans" });

    const text = ((filters.recipient_search_text ?? [])[0] ?? "").toLowerCase();
    const lo = period.start_date ?? "0000-00-00";
    const hi = period.end_date ?? "9999-99-99";
    let list = AWARDS.filter((a) => a.kind === kind && (typeof a.start !== "string" || a.start >= lo || a.start.startsWith("2026-13")) && (a.start <= hi || a.id === "ASST_grant_future"));
    if (text) list = list.filter((a) => a.recipient.toLowerCase().includes(text));
    list.sort((x, y) => y.amount - x.amount);
    const limit = q.limit ?? 100;
    const page = q.page ?? 1;
    const slice = list.slice((page - 1) * limit, page * limit);
    return reply(200, {
      results: slice.map((a) => row(a, fields)),
      page_metadata: { page, hasNext: page * limit < list.length },
    });
  });
});

server.listen(port, "127.0.0.1", () => console.log(`fake assistance API on ${port} (mode ${mode})`));
process.on("SIGTERM", () => {
  console.log(`fake assistance API: ${requests} requests`);
  process.exit(0);
});
