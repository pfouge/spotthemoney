// Checks outside spending (the hub /outside-spending/ and the "Outside spending" section of member
// pages; web/src/lib/outsidespending.ts) against the CSV file(s) other code writes:
//   node scripts/verify-outside.mjs <base-url> [--sample N]
// No browser. Oracle: /downloads/independent-expenditures*.csv, with THIS script's own copy of the
// counted rule: the file's `counted` column must equal its recomputation on every row. Then every
// hub table is recounted, sampled member sections (most spending, one with only opposition, one
// with only notice rows, and a spread) are compared cell for cell, and the wording rule is checked:
// "received", "donated to", "gave to" never describe these rows and "net" never appears.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 12;
const HUB = "/outside-spending/";
const MEMBER_ROWS = 25, SIDE_ROWS = 10, DESC = 80, CAND_MIN = 5, CAND_MAX = 400, SPENDERS = 100, NEWEST = 100;
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } return !!cond; };
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const rowsOf = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => ({ tag: m[0].slice(0, m[0].indexOf(">") + 1), cells: [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]) })).filter((r) => r.cells.length);
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;
const nf = (n) => Number(n).toLocaleString("en-US");
const cut = (s, max) => { const t = (s ?? "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim(); if (!t) return null; if (t.length <= max) return t; const c = t.slice(0, max - 1), sp = c.lastIndexOf(" "); return (sp > max * 0.6 ? c.slice(0, sp) : c).trimEnd().replace(/[,;:.\s]+$/, "") + "…"; };
const OFFICE = { H: "House", S: "Senate", P: "President" }, SIDE = { S: "Support", O: "Oppose" };

function parseCsv(txt) {
  const out = []; let row = [], cell = "", q = false;
  const s = txt.replace(/^﻿/, "");
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

const hub = await get(HUB);
if (hub.status !== 200) { console.log(`✗ ${HUB} answered ${hub.status}`); process.exit(1); }
const cat = JSON.parse((await get("/data/catalog.json")).text);
const files = cat.csv.files.filter((f) => /^\/downloads\/independent-expenditures/.test(f.path));
if (files.length === 0) {
  ok(hub.text.includes("empty-reason"), "an empty outside spending page says why");
  ok(/<meta name="robots" content="[^"]*noindex/.test(hub.text), "an empty outside spending page is noindex");
  ok(!/<table[^>]*data-os-/.test(hub.text), "an empty page has no tables");
  ok(!(await get("/sitemaps/pages.xml")).text.includes(HUB), "an empty page is not in the sitemap");
  const all = await get("/congress/");
  let n = 0;
  for (const href of [...all.text.matchAll(/href="(\/congress\/[a-z0-9-]+\/)"/g)].map((m) => m[1]).slice(0, 15)) if ((await get(href)).text.includes("data-outside-spending")) n++;
  ok(n === 0, "no member page has an outside spending section when there are no expenditures");
  console.log(failures ? `verify-outside: ${failures} problem(s)` : `verify-outside: no expenditures on record, nothing shown, ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}
let csv = [];
for (const f of files) csv.push(...parseCsv((await get(f.path)).text));
ok(csv.length === files.reduce((a, f) => a + f.rows, 0), "the CSV rows add up to the catalogue's row counts");
const COLS = ["sub_id", "spender", "spender_fec_id", "candidate", "candidate_fec_id", "office", "state", "district", "party", "support_oppose", "amount", "date", "disseminated", "purpose", "is_notice", "counted", "member_page_url", "source_url"];
ok(Object.keys(csv[0]).join(",") === COLS.join(","), "the CSV has the documented columns in order");
ok(!Object.keys(csv[0]).some((k) => /payee/i.test(k)), "the CSV has no payee column");
ok(new Set(csv.map((r) => r.sub_id)).size === csv.length, "sub_id is unique");

// ── the counted rule, restated ───────────────────────────────────────────────────────────────
const ckey = (r) => r.spender_fec_id || `name:${r.spender}`;
const newestReport = new Map();
for (const r of csv) if (r.is_notice !== "true" && r.date) { const k = ckey(r); if (!newestReport.has(k) || r.date > newestReport.get(k)) newestReport.set(k, r.date); }
const counted = (r) => r.is_notice !== "true" || !newestReport.has(ckey(r)) || (r.date !== "" && r.date > newestReport.get(ckey(r)));
let wrong = 0;
for (const r of csv) if ((r.counted === "true") !== counted(r)) wrong++;
ok(wrong === 0, `${wrong} rows have a counted column that differs from the rule`);
ok(csv.some((r) => r.counted === "false"), "(seed) at least one row does not count");
const live = csv.filter((r) => r.counted === "true");
const amt = (r) => (r.amount === "" ? null : Number(r.amount));
const inTotals = (r) => r.counted === "true" && amt(r) != null && (r.support_oppose === "S" || r.support_oppose === "O");
ok(csv.every((r) => !r.date || r.date <= new Date().toISOString().slice(0, 10)), "no spending date is in the future");

// ── the hub ───────────────────────────────────────────────────────────────────────────────────
const spenderKeys = new Set(live.map(ckey));
const candKey = (r) => r.candidate_fec_id || (r.candidate ? `name:${r.candidate}` : null);
const candKeys = new Set(live.map((r) => r.candidate_fec_id || r.candidate).filter(Boolean));
const strip = Object.fromEntries([...hub.text.matchAll(/data-os="(\w+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()]));
ok(strip.counted === nf(live.length) && strip.spenders === nf(spenderKeys.size) && strip.candidates === nf(candKeys.size), `the strip says ${strip.counted}/${strip.spenders}/${strip.candidates}; the CSV gives ${nf(live.length)}/${nf(spenderKeys.size)}/${nf(candKeys.size)}`);
const lastSpent = csv.map((r) => r.date).filter(Boolean).sort().at(-1);
const cycle = lastSpent ? (Number(lastSpent.slice(0, 4)) % 2 === 0 ? Number(lastSpent.slice(0, 4)) : Number(lastSpent.slice(0, 4)) + 1) : null;
ok(strip.cycle === String(cycle), `the strip says cycle ${strip.cycle}, the CSV gives ${cycle}`);
const tbl = (name) => { const i = hub.text.indexOf(name); const j = hub.text.indexOf("</table>", i); return i < 0 ? [] : rowsOf(hub.text.slice(i, j)); };

// by candidate
const cm = new Map();
for (const r of live) {
  const k = candKey(r); if (!k) continue;
  const c = cm.get(k) ?? { name: r.candidate || k, office: r.office, state: r.state, support: 0, oppose: 0, rows: 0, sp: new Set(), page: r.member_page_url };
  c.rows++; c.sp.add(ckey(r)); if (!c.page && r.member_page_url) c.page = r.member_page_url;
  if (inTotals(r)) { if (r.support_oppose === "S") c.support += amt(r); else c.oppose += amt(r); }
  cm.set(k, c);
}
const expCand = [...cm.values()].filter((c) => c.rows >= CAND_MIN).sort((a, b) => b.support + b.oppose - (a.support + a.oppose) || a.name.localeCompare(b.name)).slice(0, CAND_MAX);
const gotCand = tbl("data-os-candidates");
ok(gotCand.length === expCand.length, `the candidate table has ${gotCand.length} rows, the CSV gives ${expCand.length}`);
gotCand.forEach((r, i) => {
  const e = expCand[i]; if (!e) return; const c = r.cells.map(text);
  ok(c[0] === e.name && c[1] === (e.office ? OFFICE[e.office] : "—") && c[2] === (e.state || "—") && c[3] === usd(e.support) && c[4] === usd(e.oppose) && c[5] === nf(e.sp.size), `candidate row ${i + 1} (${c.join(" | ")}) differs from the CSV (${e.name}, ${usd(e.support)}, ${usd(e.oppose)}, ${e.sp.size})`);
  const href = (r.cells[0].match(/href="([^"]+)"/) ?? [])[1];
  ok((href ?? "") === (e.page ? new URL(e.page).pathname : ""), `candidate ${e.name}: page link ${href ?? "none"} differs from the CSV's member_page_url`);
});
// largest spenders
const sm = new Map();
for (const r of live) {
  const k = ckey(r); const s = sm.get(k) ?? { id: r.spender_fec_id, name: r.spender, support: 0, oppose: 0, c: new Set() };
  const ck = r.candidate_fec_id || r.candidate; if (ck) s.c.add(ck);
  if (inTotals(r)) { if (r.support_oppose === "S") s.support += amt(r); else s.oppose += amt(r); }
  sm.set(k, s);
}
const expSp = [...sm.values()].sort((a, b) => b.support + b.oppose - (a.support + a.oppose) || a.name.localeCompare(b.name)).slice(0, SPENDERS);
const gotSp = tbl("data-os-spenders");
ok(gotSp.length === expSp.length, `the spender table has ${gotSp.length} rows, the CSV gives ${expSp.length}`);
gotSp.forEach((r, i) => {
  const e = expSp[i]; if (!e) return; const c = r.cells.map(text);
  ok(c[0] === e.name && c[1] === usd(e.support) && c[2] === usd(e.oppose) && c[3] === nf(e.c.size), `spender row ${i + 1} (${c.join(" | ")}) differs from the CSV (${e.name} ${usd(e.support)} ${usd(e.oppose)} ${e.c.size})`);
  const href = (r.cells[0].match(/href="([^"]+)"/) ?? [])[1];
  ok((href ?? "") === (/^C\d{8}$/.test(e.id) ? `https://www.fec.gov/data/committee/${e.id}/` : ""), `spender ${e.name}: link ${href}`);
});
// newest
const newest = (xs, n) => [...xs].sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : (a.date || "") > (b.date || "") ? -1 : a.sub_id < b.sub_id ? 1 : -1)).slice(0, n);
const expNew = newest(live, NEWEST), gotNew = tbl("data-os-newest");
ok(gotNew.length === expNew.length, `the newest table has ${gotNew.length} rows, the CSV gives ${expNew.length}`);
gotNew.forEach((r, i) => {
  const e = expNew[i]; if (!e) return; const c = r.cells.map(text);
  ok(attr(r.tag, "data-expenditure") === e.sub_id, `newest row ${i + 1}: ${attr(r.tag, "data-expenditure")}, the CSV gives ${e.sub_id}`);
  ok(c[0] === (e.date ? longDate(e.date) : "—") && c[1] === e.spender && c[2] === (e.candidate || "—") && c[3] === (SIDE[e.support_oppose] ?? "Not stated") && c[4] === (amt(e) != null ? usd(amt(e)) : "—") && c[5] === (cut(e.purpose, DESC) ?? "—"), `newest row ${e.sub_id} differs from the CSV: ${c.join(" | ")}`);
});

// ── member sections ──────────────────────────────────────────────────────────────────────────
const bySlug = new Map();
for (const r of csv) { if (!r.member_page_url) continue; const slug = new URL(r.member_page_url).pathname.split("/").filter(Boolean).pop(); (bySlug.get(slug) ?? bySlug.set(slug, []).get(slug)).push(r); }
const stats = [...bySlug].map(([slug, rows]) => { const l = rows.filter((r) => r.counted === "true"); let s = 0, o = 0; for (const r of l) if (inTotals(r)) { if (r.support_oppose === "S") s += amt(r); else o += amt(r); } return { slug, rows, l, s, o, noticeOnly: l.length > 0 && l.every((r) => r.is_notice === "true") }; });
const pick = new Map();
const add = (m) => m && pick.set(m.slug, m);
add([...stats].sort((a, b) => b.s + b.o - (a.s + a.o))[0]);
add(stats.find((m) => m.s === 0 && m.o > 0));
add(stats.find((m) => m.noticeOnly));
add(stats.find((m) => m.l.length === 0));
for (let i = 0; i < stats.length && pick.size < sample; i += Math.max(1, Math.floor(stats.length / sample))) add(stats[i]);
const bad = /\b(received|donated to|gave to|net|netted)\b/i;
let sections = 0;
for (const m of pick.values()) {
  const page = await get(`/congress/${m.slug}/`);
  if (!ok(page.status === 200, `/congress/${m.slug}/ answers ${page.status}`)) continue;
  const i = page.text.indexOf("data-outside-spending");
  if (m.l.length === 0) { ok(i < 0, `${m.slug}: no counted expenditure and a section is shown`); continue; }
  if (!ok(i >= 0, `${m.slug}: has ${m.l.length} counted expenditures and no section`)) continue;
  sections++;
  const sec = page.text.slice(i, page.text.indexOf("</section>", i));
  const tag = (page.text.match(/<section[^>]*data-outside-spending[^>]*>/) ?? [""])[0];
  ok(Number(attr(tag, "data-counted")) === m.l.length && Number(attr(tag, "data-support")) === Math.round(m.s) && Number(attr(tag, "data-oppose")) === Math.round(m.o), `${m.slug}: the section states ${attr(tag, "data-counted")}/${attr(tag, "data-support")}/${attr(tag, "data-oppose")}, the CSV gives ${m.l.length}/${Math.round(m.s)}/${Math.round(m.o)}`);
  const sup = new Set(), opp = new Set();
  for (const r of m.l) if (inTotals(r)) (r.support_oppose === "S" ? sup : opp).add(ckey(r));
  const sum = text((sec.match(/data-os-summary[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
  ok(sum.includes(`${usd(m.s)} reported in support by ${sup.size} committee`) && sum.includes(`${usd(m.o)} reported in opposition by ${opp.size} committee`), `${m.slug}: the summary is wrong: ${sum}`);
  ok(sec.includes("The member did not receive this money.") && sec.includes("Independent expenditures are made by outside groups without coordination with the candidate"), `${m.slug}: the caveat is not on the section`);
  // by spender, per side
  for (const side of ["S", "O"]) {
    const g = new Map();
    for (const r of m.l) if (inTotals(r) && r.support_oppose === side) { const k = ckey(r); const e = g.get(k) ?? { name: r.spender, amount: 0, rows: 0 }; e.amount += amt(r); e.rows++; g.set(k, e); }
    const exp = [...g.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, SIDE_ROWS);
    const t = sec.match(new RegExp(`<table[^>]*data-side="${side}"[\\s\\S]*?</table>`));
    const got = t ? rowsOf(t[0]) : [];
    ok(got.length === exp.length, `${m.slug}: ${got.length} ${side} spender rows, expected ${exp.length}`);
    got.forEach((r, k) => { const c = r.cells.map(text); const e = exp[k]; if (e) ok(c[0] === e.name && c[1] === usd(e.amount) && c[2] === nf(e.rows), `${m.slug} ${side} spender ${k + 1}: ${c.join(" | ")} vs ${e.name} ${usd(e.amount)} ${e.rows}`); });
  }
  // newest rows
  const exp = newest(m.l, MEMBER_ROWS);
  const nt = sec.match(/<table[^>]*data-os-rows[\s\S]*?<\/table>/);
  const got = nt ? rowsOf(nt[0]) : [];
  ok(got.length === exp.length, `${m.slug}: ${got.length} newest rows, expected ${exp.length}`);
  got.forEach((r, k) => {
    const e = exp[k]; if (!e) return; const c = r.cells.map(text);
    ok(attr(r.tag, "data-expenditure") === e.sub_id, `${m.slug} row ${k + 1}: ${attr(r.tag, "data-expenditure")}, expected ${e.sub_id}`);
    ok(c[0] === (e.date ? longDate(e.date) : "—") && c[1] === e.spender && c[2] === (SIDE[e.support_oppose] ?? "Not stated") && c[3] === (amt(e) != null ? usd(amt(e)) : "—") && c[4] === (cut(e.purpose, DESC) ?? "—"), `${m.slug} ${e.sub_id}: ${c.join(" | ")} differs from the CSV`);
    const href = (r.cells[5].match(/href="([^"]+)"/) ?? [])[1];
    ok((href ?? "") === (e.source_url ?? ""), `${m.slug} ${e.sub_id}: filing link differs`);
  });
  ok(!bad.test(text(sec).replace(/The member did not receive this money\./, "")), `${m.slug}: wording says received, donated, gave or net: ${(text(sec).match(bad) ?? [])[0]}`);
  const tile = (page.text.match(/<a href="#outside-spending">[\s\S]*?<\/a>/) ?? [""])[0];
  if (page.text.includes("data-glance")) ok(text(tile).includes("Outside spending") && text(tile).includes(String(new Set(m.l.map(ckey)).size)), `${m.slug}: the "Outside spending" tile is wrong (${text(tile)})`);
  const v = page.text.indexOf('id="votes"'), o = page.text.indexOf('id="outside-spending"'), c = page.text.indexOf('id="committees"');
  ok(o > 0 && (c < 0 || o > c) && (v < 0 || o > v), `${m.slug}: the section is not after votes and committees in the Washington group`);
}
const hubMain = text((hub.text.match(/<main[\s\S]*?<\/main>/) ?? [hub.text])[0]);
ok(!/\b(received|donated to|gave to)\b/i.test(hubMain), "the hub says received, donated to or gave to");
ok(/never added together or netted/.test(hubMain) && !/\bnet (support|total|spending)\b/i.test(hubMain), "the hub says totals are never netted and shows no net figure");
ok(hub.text.includes("data-answer"), "the hub has an answer block");
ok(hubMain.includes("without coordination with the candidate") && hubMain.includes("The candidate does not receive it"), "the hub defines an independent expenditure and says the candidate does not receive it");
ok((await get("/sitemaps/pages.xml")).text.includes(`${HUB}</loc>`), "the sitemap lists the hub");
ok((await get("/llms.txt")).text.includes(HUB), "llms.txt lists the hub");
ok((await get("/data/search.json")).text.includes(HUB), "the search index lists the hub");
ok((await get("/methodology/")).text.includes('id="outside-spending"'), "the methodology has #outside-spending");
const g = await get("/guides/campaign-donations-fec-data/");
ok(g.status === 200 && g.text.includes('id="independent-expenditures"'), "the FEC guide has #independent-expenditures");
console.log(`${failures === 0 ? "✓" : "✗"} outside: ${csv.length} expenditures (${live.length} counted), ${expCand.length} candidates, ${expSp.length} spenders, ${sections} member sections; ${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
