#!/usr/bin/env node
// Executive pay (Pay Versus Performance) on stock and company pages, /executive-pay/, its data file and CSV.
//
//   node scripts/verify-execpay.mjs <base-url> [--sample N]
//
// The oracle is /downloads/executive-pay.csv (one row per company and fiscal year, written by
// lib/downloads.ts from the stored figures). This script has its own copy of the rules (the 4 newest
// years, the mark on a figure of $1 billion or more or a total under $1,000, the way an amount is
// printed, the filing folder address, the order of the list) and checks:
//   - the file: columns, one row per company and year, the `marked` column against its own rule,
//     the filing address against the accession; a year with several principal executive figures
//     (peo_figures above 1) has its figures in the `_each` columns, largest first, none of them zero,
//     and an empty single-figure column;
//   - on pages such a cell lists every figure with the mark "b" and one note, and is never a sum;
//     the list shows a count ("2 figures") there, and the data file carries the two counts;
//   - sampled company pages (one with more than 4 years, one with a single year, one with other
//     named officers only, every company with a marked figure) and the stock page of each ticker:
//     the columns, every cell, the dash, the minus sign, the marks and the one note, the Filing row;
//   - no insider page carries the section, and no page names a person beside the figures;
//   - /executive-pay/: the rows it prints, the data file against the CSV, the coverage sentence;
//   - with Playwright installed: every option of the filters, the sort of every column, the address,
//     Reset, 390 px.
// With no such file in the catalogue (an empty database) no page may carry the section.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const SAMPLE = args.includes("--sample") && Number(args[args.indexOf("--sample") + 1]) > 0 ? Number(args[args.indexOf("--sample") + 1]) : 8;
const FILE = "executive-pay.csv";
const COLUMNS = ["company", "cik", "ticker", "fiscal_year_end", "peo_total", "peo_actually_paid", "neo_avg_total", "neo_avg_actually_paid", "marked", "accession", "source_url", "page_url", "peo_figures", "peo_total_each", "peo_actually_paid_each", "read_from"];
const PEO = ["peo_total", "peo_actually_paid"];
const eachOf = (r, m) => (PEO.includes(m) && r[`${m}_each`] ? r[`${m}_each`].split(";").map(Number) : []);
const EACH_NOTE = /reports a figure for each of several people who held the principal executive officer post that year\. Every figure is shown, largest first, and they are never added together\./;
const MEASURES = ["peo_total", "peo_actually_paid", "neo_avg_total", "neo_avg_actually_paid"];
const LABEL = { peo_total: "Principal executive officer: total, Summary Compensation Table", peo_actually_paid: "Principal executive officer: compensation actually paid", neo_avg_total: "Other named executive officers, average: total", neo_avg_actually_paid: "Other named executive officers, average: compensation actually paid" };
const YEARS = 4, LARGE = 1e9, SMALL = 1000, HUB_FIRST = 50;
const NOTE = "Marked figures are unusually large or small. They are shown as the company tagged them; check the filing.";

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; if (failures <= 60) console.log(`✗ ${msg}`); } };
const get = async (p) => {
  for (let i = 0; ; i++) {
    try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; }
    catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); }
  }
};
const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
const num = (s) => (s === "" || s == null ? null : Number(s));
const shortDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fix = (n, d) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
function money(v) {
  const a = Math.abs(v);
  const body = a >= 1e12 ? fix(a / 1e12, 2) + "T" : a >= 1e9 ? fix(a / 1e9, 2) + "B" : a >= 1e6 ? fix(a / 1e6, 1) + "M" : a >= 1e3 ? fix(a / 1e3, 0) + "K" : fix(a, 0);
  return (v < 0 ? "−" : "") + "$" + body;
}
const marked = (m, v) => v != null && (Math.abs(v) >= LARGE || ((m === "peo_total" || m === "neo_avg_total") && v >= 0 && v < SMALL));
const folder = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replaceAll("-", "")}/`;
const words = /\b(overpaid|underpaid|excessive|deserved|bullish|bearish|should buy|should sell|recommend|price target|ahead of|before the news)\b/i;

function parseCsv(src) {
  const out = []; let row = [], cell = "", q = false;
  const s = src.replace(/^﻿/, "");
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

const cat = await get("/data/catalog.json");
ok(cat.status === 200, `/data/catalog.json answers ${cat.status}`);
const catalog = JSON.parse(cat.text);
const listed = (catalog.csv?.files ?? []).find((f) => (f.path ?? f.name ?? "").endsWith(FILE));
const companiesCsv = parseCsv((await get("/downloads/companies.csv")).text).rows.filter((c) => /^https?:/.test(c.page_url ?? ""));

if (!listed) {
  const f = await get(`/downloads/${FILE}`);
  ok(f.status === 404, `no ${FILE} in the catalogue, but the address answers ${f.status}`);
  for (const c of companiesCsv.slice(0, 5)) {
    const p = await get(new URL(c.page_url).pathname);
    ok(!p.text.includes("data-executive-pay") && !p.text.includes('href="#executive-pay"'), `${c.company}: a pay section with no file behind it`);
  }
  const meth = await get("/methodology/");
  ok(!/id="executive-pay"/.test(meth.text), "methodology has an executive pay paragraph with no file behind it");
  const hub = await get("/executive-pay/");
  ok(hub.status === 200 && /noindex/.test(hub.text) && !/data-paycompare/.test(hub.text), "an empty hub is noindex and has no table");
  ok(!(await get("/sitemaps/pages.xml")).text.includes("/executive-pay/"), "an empty hub is in the sitemap");
  console.log(failures ? `verify-execpay: ${failures} of ${checks} checks failed (no file state)` : `verify-execpay: no figures on file; ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}

const file = await get(`/downloads/${FILE}`);
ok(file.status === 200, `${FILE} answers ${file.status}`);
const csv = parseCsv(file.text);
ok(JSON.stringify(csv.head) === JSON.stringify(COLUMNS), `${FILE} columns are ${csv.head.join(",")}`);
ok(csv.rows.length > 0, `${FILE} has no rows`);
const byCik = new Map();
let markedRows = 0, eachYears = 0, eachNewest = 0, proxyOnly = 0;
const eachCos = new Set();
const seen = new Set();
for (const r of csv.rows) {
  ok(!seen.has(r.cik + r.fiscal_year_end), `${r.company} ${r.fiscal_year_end} twice`); seen.add(r.cik + r.fiscal_year_end);
  ok(/^\d{10}$/.test(r.cik) && /^\d{4}-\d{2}-\d{2}$/.test(r.fiscal_year_end), `${r.company}: cik ${r.cik} year ${r.fiscal_year_end}`);
  const any = MEASURES.some((m) => r[m] !== "" || eachOf(r, m).length > 0);
  ok(any, `${r.company} ${r.fiscal_year_end}: a row with no figure`);
  for (const m of PEO) {
    const xs = eachOf(r, m);
    if (!xs.length) continue;
    ok(xs.length >= 2 && xs.every((v) => Number.isFinite(v) && v !== 0), `${r.company} ${r.fiscal_year_end} ${m}_each: "${r[`${m}_each`]}" is not two or more figures, none zero`);
    ok(xs.every((v, i) => i === 0 || xs[i - 1] >= v), `${r.company} ${r.fiscal_year_end} ${m}_each is not largest first`);
    ok(r[m] === "", `${r.company} ${r.fiscal_year_end}: ${m} holds a figure beside ${m}_each`);
  }
  const figs = Math.max(...PEO.map((m) => eachOf(r, m).length || (r[m] !== "" ? 1 : 0)));
  ok(Number(r.peo_figures) === figs, `${r.company} ${r.fiscal_year_end}: peo_figures ${r.peo_figures}, the columns say ${figs}`);
  ok(["frames", "proxy", "both"].includes(r.read_from), `${r.company} ${r.fiscal_year_end}: read_from "${r.read_from}"`);
  if (figs > 1) { eachYears++; eachCos.add(r.cik); }
  const want = MEASURES.some((m) => marked(m, num(r[m])) || eachOf(r, m).some((v) => marked(m, v)));
  ok(r.marked === String(want), `${r.company} ${r.fiscal_year_end}: marked is ${r.marked}, this script says ${want}`);
  if (want) markedRows++;
  ok(r.source_url === (r.accession ? folder(r.cik, r.accession) : ""), `${r.company} ${r.fiscal_year_end}: source_url ${r.source_url}`);
  ok(/^https:\/\/spotthemoney\.com\/(companies\/[a-z0-9-]+|stocks\/[a-z0-9.-]+)\/$/.test(r.page_url), `${r.company}: page_url ${r.page_url}`);
  const xs = byCik.get(r.cik) ?? []; xs.push(r); byCik.set(r.cik, xs);
}
for (const xs of byCik.values()) {
  xs.sort((a, b) => (a.fiscal_year_end < b.fiscal_year_end ? 1 : -1));
  if (Number(xs[0].peo_figures) > 1) eachNewest++;
  if (xs.every((r) => r.read_from === "proxy")) proxyOnly++;
}
ok([...byCik.values()].every((xs) => xs.every((r, i) => i === 0 || xs[i - 1].fiscal_year_end > r.fiscal_year_end)), "years of a company are not strictly newest first");

// ── company pages ───────────────────────────────────────────────────────────────────────────
function section(html) {
  const i = html.indexOf("data-executive-pay");
  if (i < 0) return null;
  const start = html.lastIndexOf("<section", i), end = html.indexOf("</section>", i);
  const body = html.slice(start, end);
  return { tag: body.slice(0, body.indexOf(">") + 1), body };
}
function compare(where, sec, cik) {
  const rows = byCik.get(cik), want = rows.slice(0, YEARS);
  ok(attr(sec.tag, "data-cik") === cik, `${where}: the section is for ${attr(sec.tag, "data-cik")}`);
  ok(Number(attr(sec.tag, "data-years")) === rows.length && Number(attr(sec.tag, "data-shown")) === want.length, `${where}: years ${attr(sec.tag, "data-years")} shown ${attr(sec.tag, "data-shown")}, the file has ${rows.length}`);
  const heads = [...sec.body.matchAll(/<th[^>]*data-fye="([^"]+)"[^>]*>([^<]*)<\/th>/g)].map((m) => [m[1], text(m[2])]);
  ok(heads.map((h) => h[0]).join() === want.map((r) => r.fiscal_year_end).join(), `${where}: columns ${heads.map((h) => h[0]).join()} against ${want.map((r) => r.fiscal_year_end).join()}`);
  ok(heads.every((h) => h[1] === shortDate(h[0])), `${where}: a column title is not the year-end date`);
  const trs = Object.fromEntries([...sec.body.matchAll(/<tr[^>]*data-pay="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [m[1], m[2]]));
  ok(Object.keys(trs).join() === MEASURES.join(), `${where}: lines ${Object.keys(trs).join()}`);
  let marks = 0, eachCells = 0;
  for (const m of MEASURES) {
    const tr = trs[m]; if (!tr) continue;
    ok(text((tr.match(/<th[^>]*>([\s\S]*?)<\/th>/) ?? [])[1] ?? "") === LABEL[m], `${where} ${m}: label "${text((tr.match(/<th[^>]*>([\s\S]*?)<\/th>/) ?? [])[1] ?? "")}"`);
    const cells = [...tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
    ok(cells.length === want.length, `${where} ${m}: ${cells.length} cells for ${want.length} years`);
    want.forEach((r, i) => {
      const c = cells[i]; if (!c) return;
      const v = num(r[m]), t = text(c[2]);
      const each = eachOf(r, m);
      if (each.length) {
        eachCells++;
        const ms = each.filter((x) => marked(m, x)).length; marks += ms;
        ok(attr(c[1], "data-each") === each.map((x) => Math.round(x)).join(";") && attr(c[1], "data-v") === "", `${where} ${m} ${r.fiscal_year_end}: data-each ${attr(c[1], "data-each")} against ${each.join(";")}`);
        const wantText = each.map((x) => money(x) + (marked(m, x) ? " a" : "")).join("") + " b";
        ok(t.replace(/\s+/g, "") === wantText.replace(/\s+/g, ""), `${where} ${m} ${r.fiscal_year_end}: printed "${t}", expected the figures "${wantText}"`);
        ok(!t.includes(money(each.reduce((s, x) => s + x, 0))) || each.some((x) => money(x) === money(each.reduce((s, x2) => s + x2, 0))), `${where} ${m} ${r.fiscal_year_end}: the cell prints the sum of its figures`);
        ok([...c[2].matchAll(/data-one="(-?\d+)"/g)].map((x) => Number(x[1])).join() === each.map((x) => Math.round(x)).join(), `${where} ${m} ${r.fiscal_year_end}: the figures in the cell are not the file's, in its order`);
        ok((c[2].match(/data-pay-mark(?!-)/g) ?? []).length === ms, `${where} ${m} ${r.fiscal_year_end}: ${ms} of the cell's figures should carry the "a" mark`);
        return;
      }
      ok(!/data-each=/.test(c[1]) && !/data-pay-each-mark/.test(c[2]), `${where} ${m} ${r.fiscal_year_end}: a "several figures" cell where the file has one figure or none`);
      if (v == null) { ok(t === "—" && attr(c[1], "data-v") === "", `${where} ${m} ${r.fiscal_year_end}: "${t}" where the file has no figure`); return; }
      const mk = marked(m, v); if (mk) marks++;
      ok(Number(attr(c[1], "data-v")) === Math.round(v), `${where} ${m} ${r.fiscal_year_end}: data-v ${attr(c[1], "data-v")} against ${v}`);
      ok(t === money(v) + (mk ? " a" : ""), `${where} ${m} ${r.fiscal_year_end}: printed "${t}", expected "${money(v)}${mk ? " a" : ""}"`);
      ok(mk === /data-pay-mark/.test(c[2]), `${where} ${m} ${r.fiscal_year_end}: the mark and the rule disagree`);
      ok(v >= 0 || /pay-neg/.test(c[1]) || /class="[^"]*pay-neg/.test(c[1]), `${where} ${m} ${r.fiscal_year_end}: a negative figure without its class`);
      ok(!/[0-9.]e\+?\d/i.test(t), `${where}: scientific notation "${t}"`);
    });
  }
  const fil = (sec.body.match(/<tr[^>]*data-pay-filing[^>]*>([\s\S]*?)<\/tr>/) ?? [])[1] ?? "";
  const links = [...fil.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => (c[1].match(/href="([^"]+)"/) ?? [])[1] ?? null);
  ok(links.join() === want.map((r) => (r.accession ? folder(cik, r.accession) : null)).join(), `${where}: filing links ${links.join(" ")}`);
  const note = /data-pay-mark-note/.test(sec.body);
  ok(note === (marks > 0), `${where}: ${marks} marks, the note is ${note ? "there" : "missing"}`);
  if (note) ok(text(sec.body).includes(NOTE), `${where}: the note's wording`);
  const en = sec.body.match(/<p[^>]*data-pay-each-note[^>]*>/);
  ok(!!en === (eachCells > 0), `${where}: ${eachCells} cells with several figures, the note about them is ${en ? "there" : "missing"}`);
  if (en) { ok(Number(attr(en[0], "data-cells")) === eachCells, `${where}: the note counts ${attr(en[0], "data-cells")} cells, the file has ${eachCells}`); ok(EACH_NOTE.test(text(sec.body)) && /may belong to different people/.test(text(sec.body)), `${where}: the wording of the note about several figures`); }
  eachCellsSeen += eachCells;
  ok(rows.length > YEARS ? /data-pay-more/.test(sec.body) : !/data-pay-more/.test(sec.body), `${where}: the "newest ${YEARS}" note is wrong for ${rows.length} years`);
  const t = text(sec.body);
  ok(/names no person/.test(t) && /not the cash a person received/.test(t), `${where}: the caveat is missing`);
  ok(!words.test(t), `${where}: verdict or timing wording`);
  { const m2 = sec.body.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/(^|\s)—(?=\s|$)/g, " ").match(/.{0,30}[—–].{0,30}/); ok(!m2, `${where}: a dash used as punctuation "${m2?.[0]}"`); }
  ok(sec.body.includes(`/downloads/${FILE}`), `${where}: no link to the file`);
  return marks;
}
const ciks = [...byCik.keys()];
const pick = new Set(), addp = (c) => { if (c) pick.add(c); };
addp(ciks.find((c) => byCik.get(c).length > YEARS));
addp(ciks.find((c) => byCik.get(c).length === 1));
addp(ciks.find((c) => byCik.get(c).every((r) => r.peo_total === "")));
for (const [c, rs] of byCik) if (rs.slice(0, YEARS).some((r) => r.marked === "true")) addp(c);
// Companies with a several-figure year in their table: the first six, two of them with it in the newest year.
{ let n = 0, nn = 0; for (const [c, rs] of byCik) { const inTable = rs.slice(0, YEARS).some((r) => Number(r.peo_figures) > 1), newest1 = Number(rs[0].peo_figures) > 1; if (newest1 && nn < 2) { nn++; addp(c); } else if (inTable && n < 4) { n++; addp(c); } } }
for (let i = 0; pick.size < Math.max(SAMPLE, 4) && i < ciks.length; i += Math.max(1, Math.floor(ciks.length / SAMPLE))) addp(ciks[i]);
let pages = 0, stockPages = 0, marksSeen = 0, noTile = 0, eachCellsSeen = 0;
for (const cik of pick) {
  const rows = byCik.get(cik);
  const path = new URL(rows[0].page_url).pathname;
  const page = await get(path);
  ok(page.status === 200, `${path} answers ${page.status}`);
  const sec = section(page.text);
  ok(!!sec, `${path}: no executive pay section, ${rows.length} years in the file`);
  if (!sec) continue;
  pages++;
  const hasTile = page.text.includes('href="#executive-pay"');
  ok(hasTile === (rows[0].peo_total !== ""), `${path}: the glance tile is ${hasTile ? "there" : "missing"} and the newest year's principal executive total is ${rows[0].peo_total === "" ? "empty" : "filled"}`);
  if (!hasTile) noTile++;
  marksSeen += compare(path, sec, cik);
  const ticker = rows[0].ticker;
  if (!ticker) continue;
  const sp = await get(`/stocks/${ticker.toLowerCase()}/`);
  if (sp.status !== 200) continue;
  const ssec = section(sp.text);
  if (!ssec) continue;
  const scik = attr(ssec.tag, "data-cik");
  if (!byCik.has(scik)) { ok(false, `/stocks/${ticker.toLowerCase()}/: a section for ${scik}, which is not in the file`); continue; }
  stockPages++;
  compare(`/stocks/${ticker.toLowerCase()}/`, ssec, scik);
}
let without = 0;
for (const c of companiesCsv.filter((c) => c.cik && !byCik.has(c.cik.padStart(10, "0"))).slice(0, 4)) {
  const p = await get(new URL(c.page_url).pathname);
  if (p.status !== 200) continue;
  without++;
  ok(!p.text.includes("data-executive-pay") && !p.text.includes('href="#executive-pay"'), `${c.company}: a pay section, and no row in the file`);
}
// No insider page carries the section.
const insiderLinks = new Set([...(await get("/insiders/")).text.matchAll(/href="(\/insiders\/[a-z0-9-]+\/)"/g)].map((m) => m[1]));
for (const co of pick) for (const m of (await get(new URL(byCik.get(co)[0].page_url).pathname)).text.matchAll(/href="(\/insiders\/[a-z0-9-]+\/)"/g)) insiderLinks.add(m[1]);
let insiderPages = 0;
for (const p of [...insiderLinks].slice(0, 12)) { const r = await get(p); if (r.status !== 200) continue; insiderPages++; ok(!r.text.includes("data-executive-pay") && !r.text.includes("Executive pay, as filed"), `${p}: executive pay on an insider page`); }

// ── the hub ─────────────────────────────────────────────────────────────────────────────────
const hub = await get("/executive-pay/");
ok(hub.status === 200, `/executive-pay/ answers ${hub.status}`);
const hubData = JSON.parse((await get("/data/executive-pay.json")).text);
const newest = [...byCik.values()].map((rs) => rs[0]).filter((r) => MEASURES.some((m) => r[m] !== "" || eachOf(r, m).length > 0));
ok(hubData.rows.length === newest.length, `data file has ${hubData.rows.length} rows, the file has ${newest.length} companies`);
const cmp = (a, b) => { const x = num(a.peo_total), y = num(b.peo_total); if (x == null && y == null) return a.company.toLowerCase().localeCompare(b.company.toLowerCase()) || (a.cik < b.cik ? -1 : 1); if (x == null) return 1; if (y == null) return -1; return y - x || a.company.toLowerCase().localeCompare(b.company.toLowerCase()) || (a.cik < b.cik ? -1 : 1); };
const sorted = [...newest].sort(cmp);
const hubCik = hubData.rows.map((r) => hubData.companies[r[0]][3]);
ok(hubData.rows.every((r) => { const csvRow = byCik.get(hubData.companies[r[0]][3])[0]; return csvRow.fiscal_year_end === r[1] && [2, 3, 4, 5].every((k, i) => (num(csvRow[MEASURES[i]]) ?? null) === r[k]) && (csvRow.accession === r[6]); }), "data file differs from the CSV's newest year per company");
ok(hubCik.join() === sorted.map((r) => r.cik).join(), "data file is not in the order the page opens in");
ok(hubData.rows.every((r) => { const c = byCik.get(hubData.companies[r[0]][3])[0]; return (r[7] ?? 0) === eachOf(c, "peo_total").length && (r[8] ?? 0) === eachOf(c, "peo_actually_paid").length; }), "data file: the counts of several figures differ from the CSV");
{
  const trs = [...hub.text.matchAll(/<tr[^>]*data-cik="(\d{10})"[^>]*>([\s\S]*?)<\/tr>/g)];
  for (const [, cik, body] of trs) {
    const c = byCik.get(cik)?.[0]; if (!c) continue;
    for (const m of PEO) {
      const td = body.match(new RegExp(`<td([^>]*data-pay="${m}"[^>]*)>([\\s\\S]*?)<\\/td>`)); if (!td) continue;
      const k = eachOf(c, m).length;
      if (k) ok(attr(td[1], "data-each") === String(k) && text(td[2]) === `${k} figures`, `hub ${c.company} ${m}: "${text(td[2])}" where the file has ${k} figures`);
      else ok(!/data-each=/.test(td[1]), `hub ${c.company} ${m}: a count of figures where the file has one figure or none`);
    }
  }
  const sent = text((hub.text.match(/<p[^>]*data-pay-each-count[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
  ok(eachNewest === 0 ? sent === "" : sent.startsWith(eachNewest === 1 ? "1 of these companies reports" : `${eachNewest.toLocaleString("en-US")} of these companies report`), `hub: the sentence about several figures "${sent.slice(0, 80)}" against ${eachNewest} companies`);
  const methText = text((await get("/methodology/")).text);
  ok(/never adds them or picks one/.test(methText) && /the frames figure is used/.test(methText), "methodology does not state the two sources and the rule for several figures");
}
ok((await get("/data/executive-pay.json")).text.length < 500_000, "data file is large");
const printed = [...hub.text.matchAll(/<tr[^>]*data-cik="(\d{10})"/g)].map((m) => m[1]);
ok(printed.join() === sorted.slice(0, HUB_FIRST).map((r) => r.cik).join(), `the hub prints ${printed.length} rows in another order than the recount`);
const cov = text((hub.text.match(/<p[^>]*data-pay-coverage[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
ok(cov.startsWith(`${newest.length.toLocaleString("en-US")} of the `) && /companies with a page on this site have figures on file/.test(cov), `coverage sentence "${cov.slice(0, 100)}"`);
const pagesN = Number((cov.match(/of the ([\d,]+) companies/) ?? [])[1]?.replace(/,/g, ""));
ok(pagesN >= newest.length && pagesN === hubData.pages, `coverage says ${pagesN} companies with a page, the data file ${hubData.pages}`);
ok(!words.test(text(hub.text)), "hub: verdict wording");
ok((await get("/sitemaps/pages.xml")).text.includes("/executive-pay/"), "the hub is not in the pages sitemap");
ok((await get("/llms.txt")).text.includes("/executive-pay/"), "llms.txt does not name the hub");
ok(/id="executive-pay"/.test((await get("/methodology/")).text), "methodology has no #executive-pay paragraph");
const guide = await get("/guides/executive-pay-pay-versus-performance/");
ok(guide.status === 200 && /compensation actually paid/i.test(guide.text), "the guide is missing");
const dl = await get("/downloads/");
ok(dl.text.includes(`/downloads/${FILE}`) && /data-dict="execpay"/.test(dl.text), "the downloads page does not list the file and its columns");

// ── in a browser, when there is one ─────────────────────────────────────────────────────────
let browserChecks = "no browser";
try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/executive-pay/", { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-paycompare]")?.dataset.ready != null);
  const state = () => page.evaluate(() => { const r = document.querySelector("[data-paycompare]"); return { shown: Number(r.dataset.shown), rows: [...r.querySelectorAll("tbody tr")].map((tr) => tr.dataset.cik) }; });
  const divOf = (cik) => { const c = hubData.companies.find((x) => x[3] === cik); return c && c[4] >= 0 ? hubData.divisions[c[4]].slug : null; };
  const oracle = (f) => newest.filter((r) => !f.division || divOf(r.cik) === f.division).filter((r) => !f.fy || r.fiscal_year_end.slice(0, 4) === f.fy)
    .filter((r) => !f.min || (num(r.peo_total) != null && num(r.peo_total) >= f.min)).filter((r) => !f.q || `${r.company} ${r.ticker}`.toLowerCase().includes(f.q)).sort(cmp);
  let views = 0;
  const tryView = async (f, label) => {
    await page.click('[data-pc="reset"]', { timeout: 300 }).catch(() => {});
    if (f.division) await page.selectOption('[data-pc="division"]', f.division);
    if (f.fy) await page.selectOption('[data-pc="fy"]', f.fy);
    if (f.min) await page.selectOption('[data-pc="min"]', String(f.min));
    if (f.q) await page.fill('[data-pc="q"]', f.q);
    const want = oracle(f), s = await state();
    ok(s.shown === want.length, `hub ${label}: ${s.shown} companies on screen, the CSV recount says ${want.length}`);
    ok(s.rows.join() === want.slice(0, 50).map((r) => r.cik).join(), `hub ${label}: the rows on screen differ from the recount`);
    views++;
  };
  await tryView({}, "no filter");
  for (const d of hubData.divisions) await tryView({ division: d.slug }, `division ${d.slug}`);
  for (const fy of new Set(newest.map((r) => r.fiscal_year_end.slice(0, 4)))) await tryView({ fy }, `year ${fy}`);
  for (const min of [1e6, 1e7, 5e7, 1e8]) await tryView({ min }, `min ${min}`);
  await tryView({ q: "zzzz" }, "no match");
  ok(await page.locator('[data-pc="empty"]').isVisible(), "hub: the empty state is not shown for no match");
  await tryView({ min: 1e7, fy: [...new Set(newest.map((r) => r.fiscal_year_end.slice(0, 4)))][0] }, "combined");
  ok(/min=10000000/.test(await page.evaluate(() => location.hash)), "hub: the address lacks the filter");
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-paycompare]")?.dataset.ready != null);
  ok((await state()).shown === oracle({ min: 1e7, fy: [...new Set(newest.map((r) => r.fiscal_year_end.slice(0, 4)))][0] }).length, "hub: a reload of a filtered address shows another count");
  await page.click('[data-pc="reset"]');
  ok((await page.evaluate(() => location.hash)) === "", "hub: Reset leaves a hash");
  // Sort every column both ways, missing last.
  for (const k of ["peo_actually_paid", "neo_avg_total", "neo_avg_actually_paid", "peo_total"]) {
    await page.click(`th[data-sort="${k}"] button`);
    let order = await page.evaluate((key) => [...document.querySelectorAll(`[data-paycompare] tbody tr`)].map((tr) => tr.querySelector(`td[data-pay="${key}"]`)?.textContent ?? ""), k);
    const idx = MEASURES.indexOf(k);
    const sortedBy = (dir) => [...newest].sort((a, b) => { const x = num(a[k]), y = num(b[k]); if (x == null && y == null) return a.company.toLowerCase().localeCompare(b.company.toLowerCase()); if (x == null) return 1; if (y == null) return -1; return (dir === "asc" ? x - y : y - x) || a.company.toLowerCase().localeCompare(b.company.toLowerCase()); });
    const first = await state();
    const wantD = sortedBy("desc").slice(0, 50).map((r) => r.cik);
    ok(first.rows.join() === wantD.join(), `hub: sorting by ${k} (first click)`);
    await page.click(`th[data-sort="${k}"] button`);
    const second = await state();
    const wantA = sortedBy("asc").slice(0, 50).map((r) => r.cik);
    ok(second.rows.join() === wantA.join(), `hub: sorting by ${k} (second click)`);
    await page.click('[data-pc="reset"]', { timeout: 300 }).catch(() => {});
    void idx; void order;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/executive-pay/", { waitUntil: "load" });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "hub: the page runs off the side at 390 px");
  ok(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  await browser.close();
  browserChecks = `${views} filtered views`;
} catch (e) {
  if (/ERR_MODULE_NOT_FOUND|Cannot find package|Executable doesn.t exist/.test(String(e))) browserChecks = "no browser (playwright missing)";
  else { ok(false, `browser checks crashed: ${e}`); browserChecks = "crashed"; }
}

console.log(failures
  ? `verify-execpay: ${failures} of ${checks} checks failed`
  : `verify-execpay: ${checks} checks pass on ${pages} company pages and ${stockPages} stock pages (${csv.rows.length} company years for ${byCik.size} companies, ${proxyOnly} of them only from proxy statements; several principal executive figures in ${eachYears} company years of ${eachCos.size} companies, ${eachNewest} of them in the newest year, ${eachCellsSeen} such cells read on pages; ${markedRows} rows with a marked figure, ${marksSeen} marks read on pages, ${noTile} page without the glance tile; ${insiderPages} insider pages carry no section; ${without} companies without figures have no section; browser: ${browserChecks})`);
process.exit(failures ? 1 : 0);
