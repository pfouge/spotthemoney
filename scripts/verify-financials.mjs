#!/usr/bin/env node
// "Financials, as filed" on stock and company pages.
//
//   node scripts/verify-financials.mjs <base-url> [--sample N]
//
// No browser. The oracle is /downloads/company-financials.csv (written by lib/downloads.ts; one
// row per company and period, the figures as filed). This script has its own copy of the rules
// (period lengths, the three checks that hold a figure back, the number of columns, the way an
// amount is printed) and checks:
//   - the file: columns, period lengths, order, no two periods of a kind too close together,
//     the `not_shown` and `on_page` columns against its own recount;
//   - sampled company pages and the stock page of each one's ticker: the section's columns are
//     the periods marked on_page, every cell is the file's figure (or a dash, or "not shown"),
//     the printed amount, the report links, the notes;
//   - a company with no row in the file has no section;
//   - wording: figures "as filed", no advice, no long-term debt line;
//   - the methodology and the guide have their sections.
// With no such file in the catalogue (an empty database), no page may carry the section.
// Works against the live site too.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const SAMPLE = args.includes("--sample") && Number(args[args.indexOf("--sample") + 1]) > 0 ? Number(args[args.indexOf("--sample") + 1]) : 12;
const FILE = "company-financials.csv";
const FIGS = ["revenue", "net_income", "eps_diluted", "operating_cash_flow", "capex", "cash", "assets", "liabilities", "equity"];
const ANNUAL_ONLY = new Set(["operating_cash_flow", "capex"]);
const LABEL = { revenue: "Revenue", net_income: "Net income", eps_diluted: "Diluted earnings per share", operating_cash_flow: "Cash from operations", capex: "Capital expenditure", cash: "Cash and equivalents", assets: "Total assets", liabilities: "Total liabilities", equity: "Shareholders' equity" };
const COLUMNS = ["company", "ticker", "cik", "period", "period_start", "period_end", "currency", ...FIGS, "liabilities_and_equity", "not_shown", "on_page", "reports", "page_url"];
const YEARS = 3, QUARTERS = 4, Q = [80, 100], Y = [350, 380], MIN_SHARES = 100000, MAX_EPS_ALONE = 10000, TOL = 0.005, DAY = 86400000;

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; if (failures <= 60) console.log(`✗ ${msg}`); } };
const get = async (p) => {
  for (let i = 0; ; i++) {
    try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; }
    catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); }
  }
};
const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const num = (s) => (s === "" || s == null ? null : Number(s));

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

// This script's own way of printing an amount.
const fix = (n, d) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
function money(v, cur) {
  const a = Math.abs(v);
  const body = a >= 1e12 ? fix(a / 1e12, 2) + "T" : a >= 1e9 ? fix(a / 1e9, 2) + "B" : a >= 1e6 ? fix(a / 1e6, 1) + "M" : a >= 1e3 ? fix(a / 1e3, 0) + "K" : fix(a, 0);
  return (v < 0 ? "−" : "") + (cur === "USD" ? "$" : cur + " ") + body;
}
const perShare = (v, cur) => (v < 0 ? "−" : "") + (cur === "USD" ? "$" : cur + " ") + fix(Math.abs(v), 2);
const printed = (fig, v, cur) => (fig === "eps_diluted" ? perShare(v, cur) : money(v, cur));

/** The figures of a row a page must hold back, by this script's own copy of the three checks. */
function heldOf(r) {
  const held = {};
  const eps = num(r.eps_diluted), ni = num(r.net_income), assets = num(r.assets), le = num(r.liabilities_and_equity), cash = num(r.cash);
  if (eps != null && eps !== 0) {
    if (ni != null ? ni !== 0 && Math.abs(ni / eps) < MIN_SHARES : Math.abs(eps) > MAX_EPS_ALONE) held.eps_diluted = "implied_shares";
  }
  if (assets != null && le != null && Math.abs(assets - le) > TOL * Math.max(Math.abs(assets), 1)) held.assets = "balance";
  if (assets != null && cash != null && cash > assets * 1.001) { held.cash = "cash_over_assets"; if (!held.assets) held.assets = "cash_over_assets"; }
  return held;
}
const heldText = (h) => FIGS.filter((f) => h[f]).map((f) => `${f}:${h[f]}`).join("; ");

function section(html) {
  const i = html.indexOf("data-financials");
  if (i < 0) return null;
  const start = html.lastIndexOf("<section", i);
  const end = html.indexOf("</section>", i);
  const body = html.slice(start, end);
  const tag = body.slice(0, body.indexOf(">") + 1);
  const tables = {};
  for (const m of body.matchAll(/<table[^>]*data-fin-table="(year|quarter)"[^>]*>([\s\S]*?)<\/table>/g)) {
    const t = m[2];
    const cols = [...t.matchAll(/<th[^>]*data-fin-col="([^"]*)"[^>]*>([\s\S]*?)<\/th>/g)].map((c) => ({ end: c[1], start: attr(c[0], "data-start") ?? "", text: text(c[2]) }));
    const rows = {};
    for (const r of t.matchAll(/<tr[^>]*data-fin-row="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g)) {
      rows[r[1]] = { head: text((r[2].match(/<th[^>]*>([\s\S]*?)<\/th>/) ?? [])[1] ?? ""), cells: [...r[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ tag: c[1], html: c[2], text: text(c[2]) })) };
    }
    tables[m[1]] = { cols, rows };
  }
  return { tag, body, tables };
}

// ── the file ────────────────────────────────────────────────────────────────────────────────
const cat = await get("/data/catalog.json");
ok(cat.status === 200, `/data/catalog.json answers ${cat.status}`);
const catalog = JSON.parse(cat.text);
const listed = (catalog.csv?.files ?? []).find((f) => (f.path ?? f.name ?? "").endsWith(FILE));
const companiesCsv = parseCsv((await get("/downloads/companies.csv")).text).rows;

if (!listed) {
  const f = await get(`/downloads/${FILE}`);
  ok(f.status === 404, `no ${FILE} in the catalogue, but the address answers ${f.status}`);
  for (const c of companiesCsv.slice(0, 5)) {
    const p = await get(new URL(c.page_url).pathname);
    ok(!p.text.includes("data-financials"), `${c.company}: a financials section with no file behind it`);
  }
  const meth = await get("/methodology/");
  ok(!/id="financials"/.test(meth.text), "methodology has a financials paragraph with no file behind it");
  console.log(failures ? `verify-financials: ${failures} of ${checks} checks failed (no file state)` : `verify-financials: no figures on file; ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}

const file = await get(`/downloads/${FILE}`);
ok(file.status === 200, `${FILE} answers ${file.status}`);
const csv = parseCsv(file.text);
ok(JSON.stringify(csv.head) === JSON.stringify(COLUMNS), `${FILE} columns are ${csv.head.join(",")}`);
ok(csv.rows.length > 0, `${FILE} has no rows`);
const byCik = new Map();
for (const r of csv.rows) { const xs = byCik.get(r.cik); if (xs) xs.push(r); else byCik.set(r.cik, [r]); }

let heldRows = 0, heldFigures = 0, nonUsd = 0;
for (const [cik, rows] of byCik) {
  ok(/^\d{10}$/.test(cik), `cik "${cik}" is not ten digits`);
  ok(new Set(rows.map((r) => r.currency)).size === 1 && /^[A-Z]{3}$/.test(rows[0].currency), `${rows[0].company}: more than one currency, or an odd one`);
  ok(new Set(rows.map((r) => r.page_url)).size === 1 && rows[0].page_url.includes("/companies/"), `${rows[0].company}: page_url`);
  if (rows[0].currency !== "USD") nonUsd++;
  for (const kind of ["fiscal_year", "quarter"]) {
    const ps = rows.filter((r) => r.period === kind);
    const [lo, hi] = kind === "quarter" ? Q : Y;
    ps.forEach((r, i) => {
      if (r.period_start) { const d = days(r.period_start, r.period_end); ok(d >= lo && d <= hi, `${r.company} ${kind} to ${r.period_end}: ${d} days long`); }
      if (i > 0) ok(days(r.period_end, ps[i - 1].period_end) >= (kind === "quarter" ? 60 : 300), `${r.company}: two ${kind} rows ending ${r.period_end} and ${ps[i - 1].period_end}`);
      ok((r.on_page === "true") === (i < (kind === "quarter" ? QUARTERS : YEARS)), `${r.company} ${kind} to ${r.period_end}: on_page is ${r.on_page} at position ${i + 1}`);
      if (kind === "quarter") ok(r.operating_cash_flow === "" && r.capex === "", `${r.company} quarter to ${r.period_end} carries a cash-flow figure`);
      ok(FIGS.some((f) => r[f] !== ""), `${r.company} ${kind} to ${r.period_end}: a row with no figure`);
      const want = heldText(heldOf(r));
      ok(r.not_shown === want, `${r.company} ${kind} to ${r.period_end}: not_shown is "${r.not_shown}", this script works out "${want}"`);
      if (want) { heldRows++; heldFigures += want.split("; ").length; }
      ok(r.reports !== "" && r.reports.split("; ").every((x) => /^\S+ \d{4}-\d{2}-\d{2} \S+$/.test(x)), `${r.company} ${kind} to ${r.period_end}: reports "${r.reports}"`);
    });
  }
  ok(rows.every((r) => r.period === "fiscal_year" || r.period === "quarter"), `${rows[0].company}: a period that is neither a fiscal year nor a quarter`);
}

// ── pages ───────────────────────────────────────────────────────────────────────────────────
const sizeOf = (cik) => byCik.get(cik).length;
const ciks = [...byCik.keys()];
const pick = new Set();
const add = (c) => { if (c) pick.add(c); };
for (const [cik, rows] of byCik) if (rows.some((r) => r.on_page === "true" && r.not_shown)) add(cik);     // every company with a held figure on its page
add(ciks.find((c) => byCik.get(c)[0].currency !== "USD"));
add([...ciks].sort((a, b) => sizeOf(b) - sizeOf(a))[0]);
add([...ciks].sort((a, b) => sizeOf(a) - sizeOf(b))[0]);
add(ciks.find((c) => !byCik.get(c).some((r) => r.period === "quarter")));
add(ciks.find((c) => !byCik.get(c).some((r) => r.period === "fiscal_year")));
const heldPicks = pick.size;
for (let i = 0; pick.size < Math.max(SAMPLE, Math.min(heldPicks + 6, 40)) && i < ciks.length; i += Math.max(1, Math.floor(ciks.length / SAMPLE))) add(ciks[i]);

function compare(where, sec, rows) {
  const cur = rows[0].currency;
  ok(attr(sec.tag, "data-unit") === cur, `${where}: the section says ${attr(sec.tag, "data-unit")}, the file ${cur}`);
  let held = 0, changedSeen = 0;
  for (const [kind, key] of [["year", "fiscal_year"], ["quarter", "quarter"]]) {
    const want = rows.filter((r) => r.period === key && r.on_page === "true");
    const t = sec.tables[kind];
    if (!want.length) { ok(!t, `${where}: a ${kind} table with no ${key} row in the file`); continue; }
    ok(!!t, `${where}: no ${kind} table, the file has ${want.length} ${key} rows for the page`);
    if (!t) continue;
    ok(t.cols.map((c) => c.end).join() === want.map((r) => r.period_end).join(), `${where} ${kind}: columns end ${t.cols.map((c) => c.end).join()}, the file says ${want.map((r) => r.period_end).join()}`);
    ok(t.cols.every((c, i) => c.start === (want[i]?.period_start ?? "")), `${where} ${kind}: a column's first day differs from the file`);
    ok(t.cols.every((c) => new RegExp(`^${kind === "year" ? "Year" : "Quarter"} to [A-Z][a-z]+ \\d{1,2}, \\d{4}$`).test(c.text)), `${where} ${kind}: column titles ${t.cols.map((c) => c.text).join(" | ")}`);
    const figs = FIGS.filter((f) => !(kind === "quarter" && ANNUAL_ONLY.has(f)));
    ok(Object.keys(t.rows).join() === [...figs, "source"].join(), `${where} ${kind}: lines are ${Object.keys(t.rows).join()}`);
    for (const f of figs) {
      const line = t.rows[f];
      if (!line) continue;
      ok(line.head.startsWith(LABEL[f]), `${where} ${kind}: line "${line.head}" for ${f}`);
      want.forEach((r, i) => {
        const c = line.cells[i];
        if (!c) { ok(false, `${where} ${kind} ${f}: no cell for ${r.period_end}`); return; }
        const v = num(r[f]), h = heldOf(r)[f];
        if (v == null) ok(c.text === "—" && attr(c.tag, "data-v") === "", `${where} ${kind} ${f} ${r.period_end}: "${c.text}" where the file has no figure`);
        else if (h) { held++; ok(c.text === "not shown" && attr(c.tag, "data-held") === h && attr(c.tag, "data-v") === "" && !c.html.includes(String(v)), `${where} ${kind} ${f} ${r.period_end}: a figure the checks hold back reads "${c.text}"`); }
        else {
          ok(Number(attr(c.tag, "data-v")) === v, `${where} ${kind} ${f} ${r.period_end}: ${attr(c.tag, "data-v")} on the page, ${v} in the file`);
          const mark = /data-tag-changed/.test(c.tag);
          if (mark) changedSeen++;
          ok(c.text === printed(f, v, cur) + (mark ? "a" : ""), `${where} ${kind} ${f} ${r.period_end}: printed "${c.text}", expected "${printed(f, v, cur)}"`);
        }
      });
    }
    const src = t.rows.source;
    if (src) want.forEach((r, i) => {
      const accs = [...(src.cells[i]?.html ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      const wantUrls = r.reports.split("; ").map((x) => x.split(" ")[2]).filter((u) => /^https:/.test(u));
      const shownOnly = new Set(accs);
      ok(accs.length > 0 && accs.every((u) => wantUrls.includes(u)) && accs.every((u) => /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\/\d{10}-\d{2}-\d{6}-index\.htm$/.test(u)), `${where} ${kind} ${r.period_end}: report links ${[...shownOnly].join(" ")} against ${wantUrls.join(" ")}`);
    });
  }
  const note = sec.body.match(/<p[^>]*data-fin-held-note[^>]*data-held="(\d+)"/) ?? sec.body.match(/<p[^>]*data-held="(\d+)"[^>]*data-fin-held-note/);
  ok(held === 0 ? !note : note && Number(note[1]) === held, `${where}: ${held} figures held back, the note says ${note ? note[1] : "nothing"}`);
  ok((changedSeen > 0) === /data-fin-tag-note/.test(sec.body), `${where}: the changed-label note and the marks do not agree`);
  const words = text(sec.body);
  ok(/as filed/.test(words) && /not advice/.test(words), `${where}: the section does not say the figures are as filed and not advice`);
  ok(!/\b(undervalued|overvalued|cheap|expensive|bullish|bearish|outperform|price target|rating|score|recommend|should buy|should sell)\b/i.test(words), `${where}: advice or verdict wording in the section`);
  ok(!/long-term debt/i.test(words), `${where}: a long-term debt line`);
  return held;
}

let pages = 0, heldOnPages = 0, stockPages = 0;
for (const cik of pick) {
  const rows = byCik.get(cik);
  const path = new URL(rows[0].page_url).pathname;
  const page = await get(path);
  ok(page.status === 200, `${path} answers ${page.status}`);
  const sec = section(page.text);
  ok(!!sec, `${path}: no financials section, the file has ${rows.length} rows`);
  if (!sec) continue;
  pages++;
  ok(attr(sec.tag, "data-cik") === cik, `${path}: the section is for ${attr(sec.tag, "data-cik")}`);
  ok(page.text.includes('href="#financials"'), `${path}: no jump link to the section`);
  ok(sec.body.includes(`/downloads/${FILE}`), `${path}: no link to the file`);
  heldOnPages += compare(path, sec, rows);
  const ticker = rows[0].ticker;
  if (!ticker) continue;
  const sp = await get(`/stocks/${ticker.toLowerCase()}/`);
  if (sp.status !== 200) continue;
  const ssec = section(sp.text);
  if (!ssec) { ok(!sp.text.includes(`data-cik="${cik}"`), `/stocks/${ticker.toLowerCase()}/: names this company and has no financials section`); continue; }
  const scik = attr(ssec.tag, "data-cik");
  if (!byCik.has(scik)) { ok(false, `/stocks/${ticker.toLowerCase()}/: a section for ${scik}, which is not in the file`); continue; }
  stockPages++;
  compare(`/stocks/${ticker.toLowerCase()}/`, ssec, byCik.get(scik));
}

// A company with a page and no row in the file has no section.
let without = 0;
for (const c of companiesCsv.filter((c) => c.cik && !byCik.has(c.cik.padStart(10, "0"))).slice(0, 4)) {
  const p = await get(new URL(c.page_url).pathname);
  if (p.status !== 200) continue;
  without++;
  ok(!p.text.includes("data-financials") && !p.text.includes('href="#financials"'), `${c.company}: a financials section, and no row in the file`);
}

const meth = await get("/methodology/");
ok(/id="financials"/.test(meth.text), "methodology has no #financials paragraph");
ok(/fewer than 100,000 shares/.test(text(meth.text)), "methodology does not state the earnings-per-share check");
const guide = await get("/guides/what-is-form-4/");
ok(/id="financials"/.test(guide.text), "guide what-is-form-4 has no #financials section");
const dl = await get("/downloads/");
ok(dl.text.includes(`/downloads/${FILE}`) && /data-dict="financials"/.test(dl.text), "the downloads page does not list the file and its columns");

console.log(failures
  ? `verify-financials: ${failures} of ${checks} checks failed`
  : `verify-financials: ${checks} checks pass on ${pages} company pages and ${stockPages} stock pages (${csv.rows.length} rows in the file for ${byCik.size} companies, ${nonUsd} not in dollars; ${heldFigures} figures in ${heldRows} rows held back by the checks, ${heldOnPages} of them on a page read; ${without} companies without figures have no section)`);
process.exit(failures ? 1 : 0);
