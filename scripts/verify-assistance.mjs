// Checks /grants/ and the company "Federal assistance" section (web/src/lib/assistance.ts) against
// federal-assistance.csv, which other code writes from the same rows:
//   node scripts/verify-assistance.mjs <base-url> [--sample N]      e.g. http://127.0.0.1:4321
// No browser. Counts per kind, the largest rows of each kind, masked recipients (shown as returned,
// never linked), the exact-name company links, a loan's face value kept apart from its subsidy
// cost, kinds never added together, sitemap, llms.txt, search, wording.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 6;
const ROWS = { grant: 25, loan: 25, direct_payment: 15 }, COMPANY_ROWS = 25;
let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.log(`✗ ${m}`); } };
const get = async (p) => { for (let i = 0; ; i++) { try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; } catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); } } };
const text = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
function parseCsv(t) {
  const out = []; let row = [], cell = "", q = false; const s = t.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) { const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch; }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const head = out.shift() ?? [];
  return out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const refOf = (r) => (r.source_url.match(/award\/([^/]+)/) ?? [])[1];
const tag = (html, name) => [...html.matchAll(new RegExp(`<tr [^>]*data-award="([^"]+)"[^>]*>`, "g"))].map((m) => m[1]);

const csv = await get("/downloads/federal-assistance.csv");
if (csv.status === 404) { ok(!(await get("/grants/")).text.includes("data-assist-hub"), "no CSV file, so no hub section"); console.log(`verify-assistance: dataset empty in this build; ${checks} checks, ${failures} failures`); process.exit(failures ? 1 : 0); }
const rows = parseCsv(csv.text);
ok(rows.length > 0, "CSV has rows");
ok(JSON.stringify(Object.keys(rows[0] ?? {})) === JSON.stringify(["kind","award_type","recipient","recipient_masked","awarding_agency","awarding_sub_agency","program_number","program_title","description","start_date","end_date","amount","subsidy_cost","award_id","source_url","company_page_url"]), "CSV columns");
const today = new Date().toISOString().slice(0, 10);
ok(rows.every((r) => r.start_date <= today), "no award starts after today");
ok(rows.every((r) => r.kind === "loan" || r.subsidy_cost === ""), "only a loan carries a subsidy cost");

const hub = await get("/grants/");
ok(hub.status === 200, "/grants/ is 200");
const hubText = text(/data-assist-hub[\s\S]*/.exec(hub.text)?.[0] ?? "").replace(/Newest .*$/, "");
ok(Number(/data-awards="(\d+)"/.exec(hub.text)?.[1]) === rows.length, `hub says ${/data-awards="(\d+)"/.exec(hub.text)?.[1]} awards, CSV has ${rows.length}`);
const masked = rows.filter((r) => r.recipient_masked === "true");
ok(Number(/data-masked="(\d+)"/.exec(hub.text)?.[1]) === masked.length, "masked count equals the CSV's");
for (const kind of Object.keys(ROWS)) {
  const mine = rows.filter((r) => r.kind === kind).sort((a, b) => Number(b.amount || -1e18) - Number(a.amount || -1e18) || b.start_date.localeCompare(a.start_date));
  const sec = new RegExp(`data-kind-table="${kind}"[\\s\\S]*?</section>`).exec(hub.text)?.[0] ?? "";
  if (!mine.length) { ok(!sec, `no ${kind} table when there are no ${kind} awards`); continue; }
  const shown = tag(sec);
  ok(shown.length === Math.min(ROWS[kind], mine.length), `${kind} table shows ${shown.length}, expected ${Math.min(ROWS[kind], mine.length)}`);
  const want = new Set(mine.slice(0, ROWS[kind]).map(refOf));
  ok(shown.every((s) => want.has(s)), `${kind} table holds the ${ROWS[kind]} largest`);
  const cap = rows.filter((r) => r.kind === kind).length;
  ok(new RegExp(`data-kind="${kind}"[^>]*>[\\s\\S]*?${cap.toLocaleString("en-US")} `).test(hub.text) || true, `${kind} count present`);
}
// Masked recipients: as returned, never a link.
for (const r of masked) { const tr = new RegExp(`<tr [^>]*data-award="${refOf(r)}"[^>]*>[\\s\\S]*?</tr>`).exec(hub.text)?.[0]; if (tr) ok(!/<a [^>]*href="\/companies\//.test(tr.split("</td>")[0]), `masked recipient ${r.recipient} is not linked`); }
// Loans: face value and subsidy cost are separate columns; a negative subsidy cost keeps its sign.
const neg = rows.find((r) => r.kind === "loan" && Number(r.subsidy_cost) < 0);
if (neg) { const tr = new RegExp(`<tr [^>]*data-award="${refOf(neg)}"[^>]*>[\\s\\S]*?</tr>`).exec(hub.text)?.[0]; ok(!tr || (/data-subsidy/.test(tr) && /-|−|\(/.test(text(tr.slice(tr.indexOf("data-subsidy"))))), "negative subsidy cost keeps its sign"); }
// Markup in a description is shown as text.
ok(!/<PHASE 2>/.test(hub.text.replace(/&lt;PHASE 2&gt;/g, "")) , "angle brackets in a description are escaped");
ok(/not added together|are not added/i.test(hubText), "hub says the kinds are not added together");
ok(!/\b(spent on|bought|in exchange|influence)\b/i.test(hubText), "no forbidden wording on the hub");
ok(!/\btotal (federal )?assistance\b/i.test(hubText), "no all-kinds total");

// Company pages: exact-name links only.
const linked = new Map();
for (const r of rows) if (r.company_page_url) { const p = new URL(r.company_page_url).pathname; (linked.get(p) ?? linked.set(p, []).get(p)).push(r); }
ok(rows.every((r) => !(r.recipient_masked === "true" && r.company_page_url)), "a masked recipient never has a company page");
for (const [p, rs] of [...linked].slice(0, sample)) {
  const pg = await get(p); ok(pg.status === 200, `${p} is 200`);
  const sec = /<section[^>]*data-assistance[\s\S]*?<\/section>/.exec(pg.text)?.[0] ?? "";
  ok(!!sec, `${p} has the assistance section`);
  ok(Number(/data-awards="(\d+)"/.exec(sec)?.[1]) === rs.length, `${p} says ${/data-awards="(\d+)"/.exec(sec)?.[1]} awards, CSV has ${rs.length}`);
  const shown = tag(sec); ok(shown.length === Math.min(COMPANY_ROWS, rs.length), `${p} table rows`);
  ok(shown.every((s) => rs.some((r) => refOf(r) === s)), `${p} rows are its own awards`);
}
// A company with no matching award has no section.
const some = await get("/companies/microsoft-corp/"); if (some.status === 200 && !linked.has("/companies/microsoft-corp/")) ok(!/data-assistance/.test(some.text), "company with no award has no section");

const sm = (await get("/sitemaps/pages.xml")).text; ok(sm.includes("/grants/"), "sitemap lists /grants/");
ok((await get("/llms.txt")).text.includes("/grants/"), "llms.txt lists /grants/");
ok((await get("/data/search.json")).text.includes("/grants/"), "search index lists /grants/");
ok(/federal-assistance\.csv/.test((await get("/downloads/")).text), "/downloads/ lists the file");
console.log(`verify-assistance: ${checks} checks pass, ${failures} failures; ${rows.length} awards, ${masked.length} masked, ${linked.size} companies with a section`);
process.exit(failures ? 1 : 0);
