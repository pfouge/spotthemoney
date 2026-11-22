// A local stand-in for the Senate LDA contributions API (<base>/contributions/), for testing the
// `senate_lda_contributions` source without the network. Tests only.
//
//   node scripts/fake-lda-contributions.mjs [port] [mode]
//   LDA_API_BASE=http://127.0.0.1:8811 LDA_KEYLESS_SLEEP_MS=0 LDA_CONTRIB_NOW=2026-11-22 npx tsx ingest/src/index.ts senate_lda_contributions
//
// 60 filings, newest first by dt_posted (one hour apart from 2026-11-10T12:00:00-05:00):
//   every 5th is a no-contributions organization filing; the rest are lobbyist filings with 1-3 items;
//   filing 3 has a non-numeric amount, a future date and an impossible date (2026-02-30), and a name with
//   control characters; filing 7 is filing_year 2024 (a year-end 2024 report posted late: skipped);
//   filing 9 is an amendment (MA) with its own uuid.
// Honours filing_dt_posted_after / filing_dt_posted_before (wall-clock text compare), page, page_size.
// A page past the end answers 404 like the real pager. env FAKE_TOTAL (default 60), FAKE_SLOW_MS.
// mode "ok" (default); "down": 503 on every request; "noshape": 200 with a body that has no page layout;
// "wrongshape": a page layout whose results are not contribution filings.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8811);
const mode = process.argv[3] ?? "ok";
const slow = Number(process.env.FAKE_SLOW_MS ?? 0);
const total = Number(process.env.FAKE_TOTAL ?? 60);

const BASE = Date.parse("2026-11-10T17:00:00Z"); // 12:00 at -05:00
const pad = (n) => String(n).padStart(2, "0");
function posted(i) {
  const d = new Date(BASE - i * 3600_000 - 5 * 3600_000); // wall-clock at -05:00
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}-05:00`;
}
const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function filing(i) {
  const none = i % 5 === 0;
  const org = none;
  const items = none ? [] : Array.from({ length: 1 + (i % 3) }, (_, k) => ({
    contribution_type: k % 2 ? "he" : "feca",
    contribution_type_display: k % 2 ? "Honorary Expenses" : "FECA",
    contributor_name: `Contributor ${i}`,
    payee_name: `Payee ${i}-${k}`,
    honoree_name: `Honoree ${i}`,
    amount: `${(i + 1) * 100 + k}.50`,
    date: "2026-03-24",
  }));
  if (i === 3) {
    items[0].amount = "abc";
    items[1] = { ...items[1], date: "2099-01-01", honoree_name: "Honoree\u0000 with\tcontrol\u0007  chars" };
    items[2] = { ...items[2], date: "2026-02-30" };
    while (items.length < 3) items.push({ ...items[0], amount: "5.00", date: "2026-02-30" });
  }
  return {
    url: `https://lda.gov/api/v1/contributions/${uuid(i)}/`,
    filing_uuid: uuid(i),
    filing_type: i === 9 ? "MA" : "MM",
    filing_type_display: i === 9 ? "Mid-Year Amendment" : "Mid-Year Report",
    filing_year: i === 7 ? 2024 : 2026,
    filing_period: "mid_year",
    filer_type: org ? "organization" : "lobbyist",
    dt_posted: posted(i),
    filing_document_url: i === 11 ? null : `https://lda.gov/filings/public/contribution/${uuid(i)}/print/`,
    registrant: { id: 1000 + (i % 7), name: `Registrant ${i % 7} LLC` },
    lobbyist: org ? null : { id: 5000 + i, prefix: null, first_name: `First${i}`, middle_name: "", last_name: `Last${i}`, suffix: null },
    no_contributions: none,
    pacs: i % 4 === 0 ? [`PAC ${i}`] : [],
    contribution_items: items,
  };
}
const ALL = Array.from({ length: total }, (_, i) => filing(i));

let hits = 0;
createServer((req, res) => {
  hits++;
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const go = () => {
    const u = new URL(req.url ?? "/", "http://x");
    if (mode === "down") return send(503, { error: "down" });
    if (u.pathname !== "/contributions/") return send(404, { detail: "Not found." });
    if (mode === "noshape") return send(200, { message: "something else" });
    if (mode === "wrongshape") return send(200, { count: 2, next: null, previous: null, results: [{ a: 1 }, { b: 2 }] });
    const after = u.searchParams.get("filing_dt_posted_after");
    const before = u.searchParams.get("filing_dt_posted_before");
    const size = Number(u.searchParams.get("page_size") ?? 25);
    const page = Number(u.searchParams.get("page") ?? 1);
    let list = ALL.filter((f) => {
      const w = f.dt_posted.slice(0, 19);
      if (after && w < (after.length === 10 ? `${after}T00:00:00` : after)) return false;
      if (before && w >= (before.length === 10 ? `${before}T00:00:00` : before)) return false;
      return true;
    });
    const count = list.length;
    const start = (page - 1) * size;
    if (page > 1 && start >= count) return send(404, { detail: "Invalid page." });
    list = list.slice(start, start + size);
    const next = start + size < count ? `http://127.0.0.1:${port}${u.pathname}?page=${page + 1}` : null;
    return send(200, { count, next, previous: null, results: list });
  };
  if (slow > 0) setTimeout(go, slow); else go();
}).listen(port, "127.0.0.1", () => console.log(`fake LDA contributions on http://127.0.0.1:${port} (${mode})`));
process.on("SIGTERM", () => { console.log(`requests served: ${hits}`); process.exit(0); });
