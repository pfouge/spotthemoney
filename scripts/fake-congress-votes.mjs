// A local stand-in for the House Clerk roll-call XML, the Senate LIS roll-call XML and the
// congress-legislators JSON files, for testing the `congress_votes` source without the network. Tests only.
//
//   node scripts/fake-congress-votes.mjs [port] [mode]
//   HOUSE_VOTES_BASE=http://127.0.0.1:8831 SENATE_VOTES_BASE=http://127.0.0.1:8831 \
//   CONGRESS_ROSTER_URL=http://127.0.0.1:8831/legislators-current.json \
//   CONGRESS_ROSTER_HISTORICAL_URL=http://127.0.0.1:8831/legislators-historical.json \
//   VOTES_MIN_GAP_MS=0 VOTES_RETRIES=0 npx tsx ingest/src/index.ts congress_votes
//
// mode "ok" (default):
//   House 2025: rolls 1-5 (roll 3 answers "Aye"/"No" and has a bill; roll 5 holds a member with an
//   unknown vote word), House 2026: rolls 1-4 (2026 roll 4 has an unmatched member). Every other
//   roll answers 404.
//   Senate (119, 1): menu lists 1-4; (119, 2): menu lists 1-3 (and 9, which has no file: 404).
//   The legislators files carry LIS ids for S428 and S300.
// mode "down":    every request answers 503.
// mode "noshape": every request answers 200 with a body that has none of the vote layouts.
// env FAKE_SLOW_MS: wait this long before each answer (to hit a time budget).
// GET /__hits answers a JSON map of request path -> count.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8831);
const mode = process.argv[3] ?? "ok";
const slow = Number(process.env.FAKE_SLOW_MS ?? 0);
const hits = {};

const HOUSE = { 2025: 5, 2026: 4 };
const SENATE = { "1": [1, 2, 3, 4], "2": [1, 2, 3, 9] };
const SENATE_FILES = { "1": [1, 2, 3, 4], "2": [1, 2, 3] };

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n, w) => String(n).padStart(w, "0");

function houseXml(year, roll) {
  const congress = 119;
  const session = year === 2025 ? 1 : 2;
  const aye = year === 2025 && roll === 3;
  const y = aye ? "Aye" : "Yea";
  const n = aye ? "No" : "Nay";
  const members = [
    ["A000001", "Adams", "D", "NC", y],
    ["B000002", "Brown &amp; Sons", "R", "TX", n],
    ["C000003", "Cruz", "R", "TX", "Not Voting"],
    ["D000004", "Diaz", "D", "CA", "Present"],
  ];
  if (year === 2025 && roll === 5) members.push(["E000005", "Evans", "R", "OH", "Recused"]);
  if (year === 2026 && roll === 4) members.push(["Z999999", "Nobody", "I", "VT", y]);
  const count = (w) => members.filter((m) => m[4] === w).length;
  const rows = members.map(([id, name, party, state, vote]) =>
    `<recorded-vote><legislator name-id="${id}" sort-field="${name}" unaccented-name="${name}" party="${party}" state="${state}" role="legislator">${name}</legislator><vote>${vote}</vote></recorded-vote>`).join("");
  const day = 3 + roll;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rollcall-vote><vote-metadata><majority>R</majority><congress>${congress}</congress><session>${session === 1 ? "1st" : "2nd"}</session><chamber>U.S. House of Representatives</chamber><rollcall-num>${roll}</rollcall-num><legis-num>${aye ? "H R 1" : "QUORUM"}</legis-num><vote-question>On Passage</vote-question><vote-type>YEA-AND-NAY</vote-type><vote-result>Passed</vote-result><action-date>${day}-${MONTH[(roll + 1) % 12]}-${year}</action-date><action-time time-etz="13:00">1:00 PM</action-time><vote-desc>Test &amp; description ${year}-${roll}</vote-desc><vote-totals><totals-by-vote><yea-total>${count(y)}</yea-total><nay-total>${count(n)}</nay-total><present-total>${count("Present")}</present-total><not-voting-total>${count("Not Voting")}</not-voting-total></totals-by-vote></vote-totals></vote-metadata><vote-data>${rows}</vote-data></rollcall-vote>`;
}

function senateXml(session, roll) {
  const year = session === "1" ? 2025 : 2026;
  const members = [
    ["Alsobrooks (D-MD)", "Yea", "S428"],
    ["Barrasso (R-WY)", "Nay", "S300"],
    ["Ghost (I-VT)", "Not Voting", "S999"],
  ];
  const rows = members.map(([full, cast, lis]) => `<member><member_full>${full}</member_full><vote_cast>${cast}</vote_cast><lis_member_id>${lis}</lis_member_id></member>`).join("");
  const mm = LONG[(roll + 1) % 12];
  return `<?xml version="1.0" encoding="UTF-8"?>
<roll_call_vote><congress>119</congress><session>${session}</session><congress_year>${year}</congress_year><vote_number>${pad(roll, 5)}</vote_number><vote_date>${mm} ${3 + roll}, ${year}, 02:54 PM</vote_date><vote_question_text>On the Motion</vote_question_text><question>On the Motion</question><vote_document_text>Senate test description ${year}-${roll}</vote_document_text><vote_result>Agreed to</vote_result><majority_requirement>1/2</majority_requirement><document><document_congress>119</document_congress><document_type>S.</document_type><document_number>${roll}</document_number><document_name>S. ${roll}</document_name></document><count><yeas>1</yeas><nays>1</nays><present></present><absent>1</absent></count><members>${rows}</members></roll_call_vote>`;
}

function menuXml(session) {
  const year = session === "1" ? 2025 : 2026;
  const rows = [...SENATE[session]].reverse().map((n) => `<vote><vote_number>${pad(n, 5)}</vote_number><vote_date>18-Dec</vote_date><issue>S. ${n}</issue><question>On the Motion</question><result>Agreed to</result><vote_tally><yeas>1</yeas><nays>1</nays></vote_tally><title>Test</title></vote>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<vote_summary><congress>119</congress><session>${session}</session><congress_year>${year}</congress_year><votes>${rows}</votes></vote_summary>`;
}

const legislators = JSON.stringify([
  { id: { bioguide: "A000360", lis: "S428" }, name: { last: "Alsobrooks" } },
  { id: { bioguide: "B001261", lis: "S300" }, name: { last: "Barrasso" } },
]);

const server = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  if (path === "/__hits") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(hits)); return; }
  hits[path] = (hits[path] ?? 0) + 1;
  const send = (code, body, type = "text/xml") => {
    const go = () => { res.writeHead(code, { "content-type": type }); res.end(body); };
    if (slow > 0) setTimeout(go, slow); else go();
  };
  if (mode === "down") return send(503, "unavailable", "text/plain");
  if (mode === "noshape") return send(200, "<html><body>maintenance</body></html>", "text/html");

  if (path === "/legislators-current.json") return send(200, legislators, "application/json");
  if (path === "/legislators-historical.json") return send(200, "[]", "application/json");

  let m = /^\/evs\/(\d{4})\/roll(\d{3,4})\.xml$/.exec(path);
  if (m) {
    const year = Number(m[1]);
    const roll = Number(m[2]);
    return HOUSE[year] && roll >= 1 && roll <= HOUSE[year] ? send(200, houseXml(year, roll)) : send(404, "not found", "text/plain");
  }
  m = /^\/legislative\/LIS\/roll_call_lists\/vote_menu_119_([12])\.xml$/.exec(path);
  if (m) return send(200, menuXml(m[1]));
  m = /^\/legislative\/LIS\/roll_call_votes\/vote119([12])\/vote_119_([12])_(\d{5})\.xml$/.exec(path);
  if (m && m[1] === m[2]) {
    const roll = Number(m[3]);
    return SENATE_FILES[m[1]].includes(roll) ? send(200, senateXml(m[1], roll)) : send(404, "not found", "text/plain");
  }
  return send(404, "not found", "text/plain");
});
server.listen(port, "127.0.0.1", () => console.log(`fake congress votes (${mode}) on ${port}`));
