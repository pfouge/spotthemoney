// Checks lobbying by issue (/lobbying-issues/ and one page per issue; web/src/lib/lobbyissues.ts)
// against the lobbying CSV files, which other code writes from the same rows:
//   node scripts/verify-lobbying.mjs <base-url> [--sample N]      e.g. http://127.0.0.1:4321
// No browser. For every issue (or N of them) it recounts filings, filings that list no other
// issue, clients, registrants and the reported total from the CSV rows of the current year and
// compares them with the list row and with the issue page's facts; checks the page's tables
// (caps, order, every row lists the issue, links resolve), the "Issues" cells on /lobbying/,
// and the wording rule: an amount is never described as spent on one issue.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : Infinity;
const HUB = "/lobbying-issues/";
const TOP_ROWS = 25, FILING_ROWS = 100, INLINE = 6;
const year = new Date().getUTCFullYear();
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } };
const int = (s) => Number(String(s ?? "").replace(/[^0-9-]/g, "") || 0);
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
const unescape = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const rowsOf = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => ({ tag: m[0].slice(0, m[0].indexOf(">") + 1), cells: [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]) })).filter((r) => r.cells.length);
const section = (html, attr) => { const i = html.indexOf(attr); if (i < 0) return ""; const j = html.indexOf("</section>", i); return html.slice(i, j < 0 ? undefined : j); };
// The site's compact money format, to compare a page figure with a recount.
const money = (n) => { const a = Math.abs(n); return a >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : a >= 1e4 ? `$${Math.round(n / 1e3)}K` : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); };

function parseCsv(text) {
  const out = []; let row = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const head = out.shift() ?? [];
  return out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const hubRes = await get(HUB);
if (hubRes.status !== 200) { console.log(`✗ ${HUB} answered ${hubRes.status}`); process.exit(1); }
const hub = rowsOf(section(hubRes.text, "data-issues-list")).map((r) => ({
  code: (r.tag.match(/data-code="([^"]+)"/) ?? [])[1], name: unescape(r.cells[0]), href: (r.cells[0].match(/href="([^"]+)"/) ?? [])[1],
  filings: int(unescape(r.cells[1])), only: int(unescape(r.cells[2])), clients: int(unescape(r.cells[3])), registrants: int(unescape(r.cells[4])), amount: unescape(r.cells[5]),
}));
if (hub.length === 0) {
  ok(hubRes.text.includes("empty-reason"), "an empty issue list says why");
  ok(/<meta name="robots" content="[^"]*noindex/.test(hubRes.text), "an empty issue list is noindex");
  console.log(failures ? `verify-lobbying: ${failures} problem(s)` : `verify-lobbying: no lobbying filings on record, ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}
ok(hubRes.text.includes("data-answer"), "the list has an answer block");
ok(new Set(hub.map((r) => r.href)).size === hub.length && hub.every((r) => r.href?.startsWith(HUB) && r.href !== HUB), "every issue links to its own page");
ok(new Set(hub.map((r) => r.code)).size === hub.length, "no issue code is listed twice");
ok(hub.every((r) => r.only <= r.filings && r.clients <= Math.max(r.filings, 0) && r.registrants <= Math.max(r.filings, 0)), "only-issue, client and registrant counts never exceed filings");

// Recount from the CSV files (downloads.ts writes them; a different code path from lobbyissues.ts).
const dl = await get("/downloads/");
const files = [...new Set([...dl.text.matchAll(/href="(\/downloads\/lobbying-[^"]+\.csv)"/g)].map((m) => m[1]))];
ok(files.length > 0, "the downloads page lists lobbying files");
const csv = [];
for (const f of files) { const r = await get(f); ok(r.status === 200, `${f} downloads`); csv.push(...parseCsv(r.text)); }
ok(csv.length > 0 && "all_issue_codes" in csv[0] && "all_issues" in csv[0], "lobbying files carry all_issue_codes and all_issues");
ok(csv.every((r) => (r.all_issue_codes ? r.all_issue_codes.split(";")[0] === r.issue_code : !r.issue_code)), "the first of all_issue_codes is issue_code on every row");
ok(csv.every((r) => (r.all_issue_codes ? r.all_issue_codes.split(";").length : 0) === (r.all_issues ? r.all_issues.split("; ").length : 0)), "all_issues has one name per code");
const want = new Map();
const everListed = new Map();
for (const r of csv) {
  const codes = r.all_issue_codes ? [...new Set(r.all_issue_codes.split(";"))] : [];
  for (const c of codes) {
    everListed.set(c, (everListed.get(c) ?? 0) + 1);
    if (Number(r.year) !== year) continue;
    const w = want.get(c) ?? { filings: 0, only: 0, clients: new Set(), registrants: new Set(), amount: 0 };
    w.filings++; if (codes.length === 1) w.only++;
    if (r.client) w.clients.add(r.client); if (r.registrant) w.registrants.add(r.registrant);
    w.amount += Number(r.amount || 0); want.set(c, w);
  }
}
ok(hub.length === everListed.size, `the list has one row per issue code in the files (${hub.length} against ${everListed.size})`);
for (const r of hub) {
  const w = want.get(r.code) ?? { filings: 0, only: 0, clients: new Set(), registrants: new Set(), amount: 0 };
  ok(r.filings === w.filings && r.only === w.only && r.clients === w.clients.size && r.registrants === w.registrants.size,
    `${r.code}: list row ${r.filings}/${r.only}/${r.clients}/${r.registrants} against the files ${w.filings}/${w.only}/${w.clients.size}/${w.registrants.size}`);
  ok(r.amount === money(w.amount), `${r.code}: reported ${r.amount} against the files ${money(w.amount)}`);
}

// /lobbying/: the Issues cell of the newest-filings table, and the browse block.
const lob = await get("/lobbying/");
const cells = [...lob.text.matchAll(/<span data-issues="(\d+)">([\s\S]*?)<\/span>(?=<\/td>)/g)];
ok(cells.length > 0, "/lobbying/ has Issues cells");
ok(cells.every((m) => { const n = Number(m[1]); const links = (m[2].match(/<a /g) ?? []).length; const more = int((m[2].match(/and (\d+) more/) ?? [])[1]); return links === Math.min(n, INLINE) && links + more === n; }), "an Issues cell prints every issue, or the first six and a count of the rest");
ok(cells.some((m) => Number(m[1]) > 1), "/lobbying/ shows a filing with more than one issue");
ok(!/Primary issue/.test(lob.text), "/lobbying/ no longer has a first-issue-only column");
const hrefs = new Set(hub.map((r) => r.href));
ok([...lob.text.matchAll(/href="(\/lobbying-issues\/[^"]+)"/g)].every((m) => hrefs.has(m[1]) || m[1] === HUB), "every issue link on /lobbying/ resolves");
ok(lob.text.includes("data-lobbying-issues"), "/lobbying/ has the browse-by-issue block");

const BAD = /spent on (this issue|[A-Z][a-z]+ lobbying)|lobbying spend on this issue/;
const pick = hub.length <= sample ? hub : hub.filter((_, i) => i % Math.ceil(hub.length / sample) === 0).slice(0, sample);
for (const r of pick) {
  const p = await get(r.href);
  if (p.status !== 200) { ok(false, `${r.href} answered ${p.status}`); continue; }
  const html = p.text;
  const fact = (k) => unescape((html.match(new RegExp(`data-fact="${k}"[^>]*>([\\s\\S]*?)</dd>`)) ?? [])[1] ?? "");
  ok(html.includes("data-answer"), `${r.href} has an answer block`);
  ok(int(fact("filings")) === r.filings && int(fact("only")) === r.only && int(fact("clients")) === r.clients && int(fact("registrants")) === r.registrants && fact("amount") === r.amount, `${r.href}: facts equal the list row`);
  for (const [attr, total] of [["clients", r.clients], ["registrants", r.registrants]]) {
    const rows = rowsOf(section(html, `data-issue-table="${attr}"`));
    ok(rows.length === Math.min(total, TOP_ROWS), `${r.href}: ${attr} table has ${rows.length} rows, expected ${Math.min(total, TOP_ROWS)}`);
    ok(rows.every((x) => int(unescape(x.cells[2])) >= 1), `${r.href}: every ${attr} row has a filing`);
  }
  const filings = rowsOf(section(html, "data-issue-filings"));
  ok(filings.length === Math.min(everListed.get(r.code) ?? 0, FILING_ROWS), `${r.href}: newest table has ${filings.length} rows, expected ${Math.min(everListed.get(r.code) ?? 0, FILING_ROWS)}`);
  // Every row lists this issue, unless its list was cut at six.
  ok(filings.every((x) => unescape(x.cells[4]).split("; ").includes(r.name) || /and \d+ more/.test(x.cells[4])), `${r.href}: every row in the newest table lists ${r.name}`);
  ok(filings.every((x) => !x.cells[4].includes(`href="${r.href}"`)), `${r.href}: the page does not link to itself from its own rows`);
  ok(!BAD.test(unescape(html)), `${r.href}: no amount is described as spent on one issue`);
  ok(/not this one alone|not what was spent on/.test(unescape(html)), `${r.href}: says the amount covers every issue on the filings`);
}
console.log(failures ? `verify-lobbying: ${failures} problem(s) in ${checks} checks` : `verify-lobbying: ${hub.length} issues, ${pick.length} pages read, ${csv.length} CSV rows, ${checks} checks pass`);
process.exit(failures ? 1 : 0);
