// Checks the contract award details on /contracts/ and on company pages (web/src/lib/contracts.ts)
// against federal-contracts.csv, which other code writes from the same rows:
//   node scripts/verify-contracts.mjs <base-url> [--sample N]      e.g. http://127.0.0.1:4321
// No browser. The description shown is the CSV's description (whole, or its start followed by
// an ellipsis), a sub-agency is shown only when it differs from the agency, an end date is shown
// when the CSV has one, and the sub-agency table is recounted from the CSV rows with this
// script's own grouping. Also the wording rule: nothing is said to be worked out from a description.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 5;
const SHOWN = 140, AWARD_ROWS = 100, SUB_ROWS = 25, STORED_MAX = 1000;
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } };
const get = async (p) => {
  for (let i = 0; ; i++) {
    try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; }
    catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); }
  }
};
const unescape = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const int = (s) => Number(String(s ?? "").replace(/[^0-9-]/g, "") || 0);
const money = (n) => { const a = Math.abs(n); return a >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : a >= 1e4 ? `$${Math.round(n / 1e3)}K` : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); };
const up = (s) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
// csv.ts puts an apostrophe before a text cell that starts like a formula.
const unguard = (s) => (/^'[=+\-@]/.test(s ?? "") ? s.slice(1) : (s ?? ""));

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
  return { head, rows: out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))) };
}

/** Rows of the first table that follows `marker`, as { tag, cells: [{ html, tag }] }. */
function tableRows(html, marker) {
  const i = html.indexOf(marker); if (i < 0) return null;
  const j = html.indexOf("</table>", i);
  const t = html.slice(i, j < 0 ? undefined : j);
  const body = t.slice(Math.max(0, t.indexOf("<tbody")));
  return [...body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => ({ tag: m[1], cells: [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ tag: c[1], html: c[2] })) })).filter((r) => r.cells.length);
}
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
const cellBy = (row, name) => row.cells.find((c) => new RegExp(`\\b${name}\\b`).test(c.tag));

/** One table row against its CSV row. `where` names the page for messages. */
function checkAwardRow(row, byId, where) {
  const id = unescape(attr(row.tag, "data-award") ?? "");
  const c = byId.get(id);
  ok(!!c, `${where}: row ${id || "(no id)"} is in federal-contracts.csv`);
  if (!c) return;
  const want = unguard(c.description).replace(/\s+/g, " ").trim();
  const shown = unescape(cellBy(row, "data-desc")?.html ?? "");
  if (!want) ok(shown === "—", `${where}: ${id} has no description on file and shows a dash (shows "${shown.slice(0, 40)}")`);
  else if (shown.endsWith("…")) ok(shown.length <= SHOWN + 1 && want.length > SHOWN && want.startsWith(shown.slice(0, -1)), `${where}: ${id} shows the start of its description, at most ${SHOWN} characters`);
  else ok(shown === want && want.length <= SHOWN, `${where}: ${id} shows its whole description ("${shown.slice(0, 40)}" vs "${want.slice(0, 40)}")`);
  const subCell = row.cells.find((x) => /data-sub/.test(x.html));
  const sub = subCell ? unescape((subCell.html.match(/<span[^>]*data-sub[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? "") : "";
  const wantSub = c.awarding_sub_agency && up(c.awarding_sub_agency) !== up(c.awarding_agency) ? c.awarding_sub_agency.replace(/\s+/g, " ").trim() : "";
  ok(sub === wantSub, `${where}: ${id} sub-agency shown "${sub}" should be "${wantSub}"`);
  const end = unescape(cellBy(row, "data-end")?.html ?? "");
  ok(c.end_date ? end !== "—" && end.includes(c.end_date.slice(0, 4)) : end === "—", `${where}: ${id} end date shown "${end}" for "${c.end_date}"`);
}

const page = await get("/contracts/");
if (page.status !== 200) { console.log(`✗ /contracts/ answered ${page.status}`); process.exit(1); }
const csvPath = (page.text.match(/href="(\/downloads\/federal-contracts\.csv)"/) ?? [])[1];
const awardRows = tableRows(page.text, "data-awards");
if (!csvPath) {
  ok(page.text.includes("empty-reason") && !awardRows, "with no awards on record the page says so and has no table");
  console.log(failures ? `verify-contracts: ${failures} problem(s)` : `verify-contracts: no contract awards on record, ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}
const csvRes = await get(csvPath);
ok(csvRes.status === 200, `${csvPath} downloads`);
const { head, rows: csv } = parseCsv(csvRes.text);
for (const col of ["awarding_sub_agency", "end_date", "description"]) ok(head.includes(col), `federal-contracts.csv has the column ${col}`);
ok(head.indexOf("awarding_sub_agency") === head.indexOf("awarding_agency") + 1, "awarding_sub_agency follows awarding_agency");
ok(csv.every((r) => (r.description ?? "").length <= STORED_MAX + 1), `no description in the CSV is longer than ${STORED_MAX} characters`);
ok(csv.every((r) => !r.end_date || /^\d{4}-\d{2}-\d{2}$/.test(r.end_date)), "every end_date is a date");
ok(csv.every((r) => !/\s{2,}|[\r\n\t]/.test(r.description ?? "")), "descriptions have their white space collapsed");
const byId = new Map(csv.map((r) => [r.award_id, r]));

// The largest-awards table.
ok(!!awardRows && awardRows.length === Math.min(AWARD_ROWS, csv.length), `the awards table has ${Math.min(AWARD_ROWS, csv.length)} rows (has ${awardRows?.length})`);
for (const r of awardRows ?? []) checkAwardRow(r, byId, "/contracts/");
const shownIds = new Set((awardRows ?? []).map((r) => unescape(attr(r.tag, "data-award") ?? "")));
const top = [...csv].sort((a, b) => Number(b.award_value || 0) - Number(a.award_value || 0)).slice(0, AWARD_ROWS);
const cutValue = Number(top[top.length - 1]?.award_value || 0);
ok([...shownIds].every((id) => Number(byId.get(id)?.award_value || 0) >= cutValue), "the awards shown are the largest by award value");
ok(/<th[^>]*>Description, as reported<\/th>/.test(page.text) && /<th[^>]*>End date<\/th>/.test(page.text), "the awards table has the Description and End date columns");

// The sub-agency table, recounted.
const groups = new Map();
let withSub = 0;
for (const r of csv) {
  const sub = (r.awarding_sub_agency ?? "").replace(/\s+/g, " ").trim();
  if (!sub) continue;
  withSub++;
  const k = `${up(r.awarding_agency)}|${up(sub)}`;
  const g = groups.get(k) ?? { awards: 0, total: 0 };
  g.awards++; g.total += Number(r.award_value || 0); groups.set(k, g);
}
const secAt = page.text.indexOf("data-sub-agencies");
if (groups.size === 0) {
  ok(secAt < 0, "with no sub-agency on record there is no sub-agency table");
} else {
  ok(secAt >= 0, "the page has the sub-agency table");
  const secTag = page.text.slice(page.text.lastIndexOf("<section", secAt), page.text.indexOf(">", secAt) + 1);
  ok(int(attr(secTag, "data-with")) === withSub, `awards with a sub-agency: page ${attr(secTag, "data-with")}, CSV ${withSub}`);
  ok(int(attr(secTag, "data-awards-total")) === csv.length, `awards on record: page ${attr(secTag, "data-awards-total")}, CSV ${csv.length}`);
  const subRows = tableRows(page.text.slice(secAt), "<table") ?? [];
  ok(subRows.length === Math.min(SUB_ROWS, groups.size), `the sub-agency table has ${Math.min(SUB_ROWS, groups.size)} rows (has ${subRows.length})`);
  let prev = Infinity;
  for (const r of subRows) {
    const name = unescape(r.cells[0].html), agency = unescape(r.cells[1].html);
    const g = groups.get(`${up(agency === "—" ? "" : agency)}|${up(name)}`);
    ok(!!g, `sub-agency row "${name}" (${agency}) exists in the CSV`);
    if (!g) continue;
    ok(int(unescape(r.cells[3].html)) === g.awards, `${name}: awards page ${unescape(r.cells[3].html)}, CSV ${g.awards}`);
    ok(unescape(r.cells[2].html) === money(g.total), `${name}: award value page ${unescape(r.cells[2].html)}, CSV ${money(g.total)}`);
    ok(g.total <= prev + 0.5, `${name}: rows are in order of award value`); prev = g.total;
  }
  const want = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, SUB_ROWS);
  ok(subRows.length === 0 || Math.abs((want[want.length - 1]?.total ?? 0) - prev) < 1, "the sub-agencies shown are the largest by award value");
  const said = page.text.slice(secAt).match(/([\d,]+) of ([\d,]+) awards carry one/);
  ok(!!said && int(said[1]) === withSub && int(said[2]) === csv.length, "the sentence above the table states how many awards carry a sub-agency");
}

// Wording: a description is the agency's text; nothing is derived from it.
const text = unescape(page.text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " "));
ok(/agency's (own )?word/i.test(text), "the page says the description is the agency's wording");
ok(!/\b(suspicious|red flag|favou?ritism|rewarded|payback|quid pro quo)\b/i.test(text), "no verdict wording on the contracts page");

// Company pages that list awards.
const companyLinks = [...new Set((awardRows ?? []).flatMap((r) => [...r.cells.map((c) => (c.html.match(/href="(\/companies\/[^"#]+\/)"/) ?? [])[1])].filter(Boolean)))].slice(0, sample);
let companyRows = 0;
for (const href of companyLinks) {
  const res = await get(href);
  ok(res.status === 200, `${href} opens`);
  const at = res.text.indexOf('id="contracts"');
  const rows = at >= 0 ? tableRows(res.text.slice(at, res.text.indexOf("<h2", at + 20) > 0 ? res.text.indexOf("<h2", at + 20) : undefined), "<table") : null;
  ok(!!rows && rows.length > 0, `${href} has a contracts table`);
  for (const r of rows ?? []) { checkAwardRow(r, byId, href); companyRows++; }
  ok(/<th[^>]*>Description, as reported<\/th>/.test(res.text), `${href} has the Description column`);
}

const withDesc = csv.filter((r) => r.description).length, withEnd = csv.filter((r) => r.end_date).length;
console.log(`verify-contracts: ${csv.length} awards in the CSV (${withDesc} with a description, ${withSub} with a sub-agency, ${withEnd} with an end date), ${awardRows?.length ?? 0} rows on /contracts/, ${groups.size} sub-agencies, ${companyLinks.length} company pages (${companyRows} rows)`);
console.log(failures ? `verify-contracts: ${failures} problem(s) in ${checks} checks` : `verify-contracts: ${checks} checks pass`);
process.exit(failures ? 1 : 0);
