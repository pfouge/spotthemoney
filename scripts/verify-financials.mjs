#!/usr/bin/env node
// "Financials, as filed" on stock and company pages.
//
//   node scripts/verify-financials.mjs <base-url> [--sample N]
//
// No browser. The oracle is /downloads/company-financials.csv (written by lib/downloads.ts; one
// row per company and period, the figures as filed). This script has its own copy of the rules
// (period lengths, the checks that hold a figure back, the long-term debt rule, the number of
// columns, the way an amount is printed) and checks:
//   - the file: columns, period lengths, order, no two periods of a kind too close together,
//     the `not_shown` and `on_page` columns against its own recount;
//   - sampled company pages and the stock page of each one's ticker: the section's columns are
//     the periods marked on_page, every cell is the file's figure (or a dash, or "not shown"),
//     the printed amount, the report links, the notes;
//   - a company with no row in the file has no section;
//   - long-term debt: a line only for a company whose rows in the file all carry one heading,
//     named after that heading; a sentence and no line when they carry several; no line and no
//     sentence when the file has no debt figure for it;
//   - ratios (net margin, liabilities to equity): the file's two ratio columns against this
//     script's own arithmetic on the row's figures; on a page, a line only when some column has
//     a value or an "n/a", every cell's status, number and printed text, the heading row above
//     the lines and the sentence under the tables;
//   - wording: figures "as filed", no advice;
//   - the methodology and the guide have their sections.
// With no such file in the catalogue (an empty database), no page may carry the section.
// Works against the live site too.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const SAMPLE = args.includes("--sample") && Number(args[args.indexOf("--sample") + 1]) > 0 ? Number(args[args.indexOf("--sample") + 1]) : 12;
const FILE = "company-financials.csv";
const DEBT = "long_term_debt";
const FIGS = ["revenue", "net_income", "eps_diluted", "operating_cash_flow", "capex", "cash", "assets", "liabilities", "equity", DEBT];
// This script's own list of what the debt line is called, by the heading in the file.
const DEBT_LABEL = { LongTermDebt: "Long-term debt", LongTermDebtNoncurrent: "Long-term debt, not counting the part due within a year", LongTermDebtAndCapitalLeaseObligations: "Long-term debt and lease obligations", Borrowings: "Borrowings" };
const ANNUAL_ONLY = new Set(["operating_cash_flow", "capex"]);
const LABEL = { revenue: "Revenue", net_income: "Net income", eps_diluted: "Diluted earnings per share", operating_cash_flow: "Cash from operations", capex: "Capital expenditure", cash: "Cash and equivalents", assets: "Total assets", liabilities: "Total liabilities", equity: "Shareholders' equity" };
// This script's own copy of the two ratios: column in the file, the two figures, how it is printed.
const RATIOS = [
  { key: "net_margin", col: "net_margin_pct", num: "net_income", den: "revenue", pct: true, cap: 1000, label: "Net margin", inputs: "net income ÷ revenue" },
  { key: "liabilities_to_equity", col: "liabilities_to_equity", num: "liabilities", den: "equity", pct: false, cap: 100, label: "Liabilities to equity", inputs: "total liabilities ÷ shareholders' equity" },
];
const COLUMNS = ["company", "ticker", "cik", "period", "period_start", "period_end", "currency", ...FIGS, "long_term_debt_heading", "liabilities_and_equity", ...RATIOS.map((r) => r.col), "not_shown", "on_page", "reports", "page_url"];
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

/** The headings a company's debt figures carry across all its rows in the file. */
const headingsOf = (rows) => [...new Set(rows.filter((r) => r[DEBT] !== "").map((r) => r.long_term_debt_heading))].sort();
/** The figures of a row a page must hold back, by this script's own copy of the checks. `several` = the company's debt figures carry more than one heading. */
function heldOf(r, several) {
  const held = {};
  const debt = num(r[DEBT]), liab = num(r.liabilities);
  if (debt != null) { if (several) held[DEBT] = "several_headings"; else if (liab != null && debt > liab * 1.001) held[DEBT] = "debt_over_liabilities"; }
  const eps = num(r.eps_diluted), ni = num(r.net_income), assets = num(r.assets), le = num(r.liabilities_and_equity), cash = num(r.cash);
  if (eps != null && eps !== 0) {
    if (ni != null ? ni !== 0 && Math.abs(ni / eps) < MIN_SHARES : Math.abs(eps) > MAX_EPS_ALONE) held.eps_diluted = "implied_shares";
  }
  if (assets != null && le != null && Math.abs(assets - le) > TOL * Math.max(Math.abs(assets), 1)) held.assets = "balance";
  if (assets != null && cash != null && cash > assets * 1.001) { held.cash = "cash_over_assets"; if (!held.assets) held.assets = "cash_over_assets"; }
  return held;
}
/** A ratio of a row, by this script's own arithmetic: { status: ok|none|base, value }. */
function ratioOf(r, held, def) {
  const a = num(r[def.num]), b = num(r[def.den]);
  if (a == null || b == null || held[def.num] || held[def.den]) return { status: "none", value: null };
  if (!(b > 0)) return { status: "base", value: null };
  const v = def.pct ? Math.round((a / b) * 1000) / 10 : Math.round((a / b) * 100) / 100;
  return { status: "ok", value: v === 0 ? 0 : v };
}
function ratioPrinted(def, v) {
  if (def.pct) return v > def.cap ? "over 1,000%" : v < -def.cap ? "under −1,000%" : (v < 0 ? "−" : "") + fix(Math.abs(v), 1) + "%";
  return v > def.cap ? "over 100" : (v < 0 ? "−" : "") + fix(Math.abs(v), 2);
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
    const ratios = {};
    for (const r of t.matchAll(/<tr[^>]*data-fin-ratio="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g)) {
      ratios[r[1]] = { head: text((r[2].match(/<th[^>]*>([\s\S]*?)<\/th>/) ?? [])[1] ?? ""), cells: [...r[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ tag: c[1], html: c[2], text: text(c[2]) })) };
    }
    const calc = t.match(/<tr[^>]*data-fin-calc[^>]*>([\s\S]*?)<\/tr>/);
    tables[m[1]] = { cols, rows, ratios, calc: calc ? text(calc[1]) : null, order: [...t.matchAll(/<tr[^>]*data-fin-(row|ratio|calc)(?:="([^"]*)")?/g)].map((x) => x[1] === "calc" ? "calc" : `${x[1]}:${x[2]}`) };
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
const ratioCount = Object.fromEntries(RATIOS.map((d) => [d.key, { ok: 0, base: 0, capped: 0, companies: new Set() }]));
let debtOne = 0, debtSeveral = 0, debtNone = 0;
const several = new Map();
for (const [cik, rows] of byCik) {
  const hs = headingsOf(rows);
  several.set(cik, hs.length > 1);
  if (hs.length === 1) debtOne++; else if (hs.length > 1) debtSeveral++; else debtNone++;
  ok(hs.every((h) => DEBT_LABEL[h]), `${rows[0].company}: a debt heading this script does not know: ${hs.join(",")}`);
  ok(rows.every((r) => (r[DEBT] === "") === (r.long_term_debt_heading === "")), `${rows[0].company}: a debt figure without a heading, or a heading without a figure`);
  ok(/^\d{10}$/.test(cik), `cik "${cik}" is not ten digits`);
  ok(new Set(rows.map((r) => r.currency)).size === 1 && /^[A-Z]{3}$/.test(rows[0].currency), `${rows[0].company}: more than one currency, or an odd one`);
  ok(new Set(rows.map((r) => r.page_url)).size === 1 && /\/(companies|stocks)\/[^/]+\/$/.test(rows[0].page_url), `${rows[0].company}: page_url`);
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
      const want = heldText(heldOf(r, several.get(cik)));
      ok(r.not_shown === want, `${r.company} ${kind} to ${r.period_end}: not_shown is "${r.not_shown}", this script works out "${want}"`);
      for (const d of RATIOS) {
        const x = ratioOf(r, heldOf(r, several.get(cik)), d);
        ok(x.status === "ok" ? r[d.col] !== "" && Number(r[d.col]) === x.value : r[d.col] === "", `${r.company} ${kind} to ${r.period_end}: ${d.col} is "${r[d.col]}", this script works out ${x.status === "ok" ? x.value : "no value (" + x.status + ")"}`);
        const n = ratioCount[d.key];
        if (x.status === "ok") { n.ok++; n.companies.add(cik); if (Math.abs(x.value) > d.cap) n.capped++; } else if (x.status === "base") n.base++;
      }
      const doubted = want ? want.split("; ").filter((x) => !x.endsWith(":several_headings")).length : 0;
      if (doubted) { heldRows++; heldFigures += doubted; }
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
for (const [cik, rows] of byCik) if (rows.some((r) => r.on_page === "true" && r.not_shown.split("; ").some((x) => x && !x.endsWith(":several_headings")))) add(cik);     // every company with a doubted figure on its page
add(ciks.find((c) => several.get(c)));                                                   // one with several debt headings (no line, a sentence)
for (const h of Object.keys(DEBT_LABEL)) add(ciks.find((c) => !several.get(c) && headingsOf(byCik.get(c))[0] === h)); // one per heading
add(ciks.find((c) => headingsOf(byCik.get(c)).length === 0));                            // one with no debt figure
add(ciks.find((c) => byCik.get(c)[0].currency !== "USD"));
for (const d of RATIOS) {                                                                 // per ratio: a page with an "n/a", one beyond the cap, one with no line
  const onPage = (c) => byCik.get(c).filter((r) => r.on_page === "true").map((r) => ratioOf(r, heldOf(r, several.get(c)), d));
  add(ciks.find((c) => onPage(c).some((x) => x.status === "base")));
  add(ciks.find((c) => onPage(c).some((x) => x.status === "ok" && Math.abs(x.value) > d.cap)));
  add(ciks.find((c) => onPage(c).every((x) => x.status === "none")));
  add(ciks.find((c) => onPage(c).some((x) => x.status === "ok" && x.value < 0)));
}
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
  const ratioLines = new Set();
  const hs = headingsOf(rows), sev = hs.length > 1, debtLine = hs.length === 1;
  const dd = attr(sec.tag, "data-debt") ?? "";
  ok(debtLine ? dd.endsWith(":" + hs[0]) : dd === (sev ? "several" : ""), `${where}: data-debt is "${dd}" for headings ${hs.join(",") || "none"}`);
  ok(sev === /data-fin-debt-note/.test(sec.body), `${where}: ${sev ? "several debt headings and no sentence saying so" : "a sentence about debt headings, and the file has " + hs.length}`);
  for (const [kind, key] of [["year", "fiscal_year"], ["quarter", "quarter"]]) {
    const want = rows.filter((r) => r.period === key && r.on_page === "true");
    const t = sec.tables[kind];
    if (!want.length) { ok(!t, `${where}: a ${kind} table with no ${key} row in the file`); continue; }
    ok(!!t, `${where}: no ${kind} table, the file has ${want.length} ${key} rows for the page`);
    if (!t) continue;
    ok(t.cols.map((c) => c.end).join() === want.map((r) => r.period_end).join(), `${where} ${kind}: columns end ${t.cols.map((c) => c.end).join()}, the file says ${want.map((r) => r.period_end).join()}`);
    ok(t.cols.every((c, i) => c.start === (want[i]?.period_start ?? "")), `${where} ${kind}: a column's first day differs from the file`);
    ok(t.cols.every((c) => new RegExp(`^${kind === "year" ? "Year" : "Quarter"} to [A-Z][a-z]+ \\d{1,2}, \\d{4}$`).test(c.text)), `${where} ${kind}: column titles ${t.cols.map((c) => c.text).join(" | ")}`);
    const figs = FIGS.filter((f) => !(kind === "quarter" && ANNUAL_ONLY.has(f)) && (f !== DEBT || debtLine));
    ok(Object.keys(t.rows).join() === [...figs, "source"].join(), `${where} ${kind}: lines are ${Object.keys(t.rows).join()}`);
    for (const f of figs) {
      const line = t.rows[f];
      if (!line) continue;
      if (f === DEBT) ok(line.head === DEBT_LABEL[hs[0]] + "at the end of the period" || line.head === DEBT_LABEL[hs[0]] + " at the end of the period", `${where} ${kind}: the debt line reads "${line.head}" for heading ${hs[0]}`);
      else ok(line.head.startsWith(LABEL[f]), `${where} ${kind}: line "${line.head}" for ${f}`);
      want.forEach((r, i) => {
        const c = line.cells[i];
        if (!c) { ok(false, `${where} ${kind} ${f}: no cell for ${r.period_end}`); return; }
        const v = num(r[f]), h = heldOf(r, sev)[f];
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
    // ratios: a line only when some column has a value or an "n/a"; each cell by this script's arithmetic
    const wantLines = [];
    for (const d of RATIOS) {
      const xs = want.map((r) => ratioOf(r, heldOf(r, sev), d));
      const line = t.ratios[d.key];
      if (xs.every((x) => x.status === "none")) { ok(!line, `${where} ${kind}: a ${d.key} line, and no column has both figures`); continue; }
      wantLines.push(d.key); ratioLines.add(d.key);
      ok(!!line, `${where} ${kind}: no ${d.key} line, and the file gives both figures for a column`);
      if (!line) continue;
      ok(line.head === d.label + d.inputs || line.head === d.label + " " + d.inputs, `${where} ${kind}: the ${d.key} line reads "${line.head}"`);
      xs.forEach((x, i) => {
        const c = line.cells[i], r = want[i];
        if (!c) { ok(false, `${where} ${kind} ${d.key}: no cell for ${r.period_end}`); return; }
        ok(attr(c.tag, "data-status") === x.status, `${where} ${kind} ${d.key} ${r.period_end}: status ${attr(c.tag, "data-status")}, this script works out ${x.status}`);
        if (x.status === "ok") { ratioCells++; ok(Number(attr(c.tag, "data-v")) === x.value && attr(c.tag, "data-v") !== "" && c.text === ratioPrinted(d, x.value) && Number(r[d.col]) === x.value, `${where} ${kind} ${d.key} ${r.period_end}: "${c.text}" (${attr(c.tag, "data-v")}), expected "${ratioPrinted(d, x.value)}" (${x.value}); the file has ${r[d.col]}`); }
        else ok(c.text === (x.status === "base" ? "n/a" : "—") && (attr(c.tag, "data-v") ?? "") === "", `${where} ${kind} ${d.key} ${r.period_end}: "${c.text}" for status ${x.status}`);
      });
    }
    ok(Object.keys(t.ratios).join() === wantLines.join(), `${where} ${kind}: ratio lines are ${Object.keys(t.ratios).join() || "none"}, expected ${wantLines.join() || "none"}`);
    ok(wantLines.length ? t.calc === "Worked out by this site from the lines above" : t.calc == null, `${where} ${kind}: the heading over the ratio lines reads ${JSON.stringify(t.calc)}`);
    ok(t.order.join() === [...figs.map((f) => "row:" + f), ...(wantLines.length ? ["calc"] : []), ...wantLines.map((k) => "ratio:" + k), "row:source"].join(), `${where} ${kind}: the lines are in the order ${t.order.join()}`);
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
  const rnote = sec.body.match(/<p[^>]*data-fin-ratio-note[^>]*>([\s\S]*?)<\/p>/);
  ok(ratioLines.size ? !!rnote : !rnote, `${where}: ${ratioLines.size} ratio lines and ${rnote ? "a" : "no"} sentence about them`);
  if (rnote) {
    const rt = text(rnote[1]);
    ok(attr(rnote[0], "data-ratios") === RATIOS.filter((d) => ratioLines.has(d.key)).map((d) => d.key).join(" "), `${where}: the ratio sentence is for "${attr(rnote[0], "data-ratios")}"`);
    ok(/this site's arithmetic/.test(rt) && /not (a figure|figures) the company filed/.test(rt) && RATIOS.every((d) => ratioLines.has(d.key) === rt.toLowerCase().includes(d.inputs)), `${where}: the ratio sentence does not name its inputs or say it is this site's arithmetic: "${rt.slice(0, 120)}"`);
  }
  const words = text(sec.body);
  ok(/as filed/.test(words) && /not advice/.test(words), `${where}: the section does not say the figures are as filed and not advice`);
  ok(!/\b(undervalued|overvalued|cheap|expensive|bullish|bearish|outperform|price target|rating|score|recommend|should buy|should sell)\b/i.test(words), `${where}: advice or verdict wording in the section`);
  if (!debtLine && !sev) ok(!/long-term debt|borrowings/i.test(words), `${where}: long-term debt is mentioned, and the file has no debt figure for the company`);
  return held;
}

let pages = 0, heldOnPages = 0, stockPages = 0, ratioCells = 0;
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
ok(/more than one heading/.test(text(meth.text)) && /larger than total liabilities/.test(text(meth.text)), "methodology does not state the long-term debt rule");
ok(/id="financial-ratios"/.test(meth.text) && /net income divided by revenue/.test(text(meth.text)) && /total liabilities divided by shareholders' equity/.test(text(meth.text)), "methodology does not state the two ratios (#financial-ratios)");
const guide = await get("/guides/what-is-form-4/");
ok(/id="financials"/.test(guide.text), "guide what-is-form-4 has no #financials section");
const dl = await get("/downloads/");
ok(dl.text.includes(`/downloads/${FILE}`) && /data-dict="financials"/.test(dl.text), "the downloads page does not list the file and its columns");

console.log(failures
  ? `verify-financials: ${failures} of ${checks} checks failed`
  : `verify-financials: ${checks} checks pass on ${pages} company pages and ${stockPages} stock pages (${csv.rows.length} rows in the file for ${byCik.size} companies, ${nonUsd} not in dollars; ${heldFigures} figures in ${heldRows} rows held back by the checks, ${heldOnPages} of them on a page read; long-term debt: ${debtOne} companies with one heading, ${debtSeveral} with several, ${debtNone} with none; ratios: ${RATIOS.map((d) => `${d.label.toLowerCase()} worked out for ${ratioCount[d.key].ok} periods of ${ratioCount[d.key].companies.size} companies (${ratioCount[d.key].capped} beyond ${d.cap}${d.pct ? "%" : ""}), n/a for ${ratioCount[d.key].base}`).join("; ")}, ${ratioCells} ratio cells read on pages; ${without} companies without figures have no section)`);
process.exit(failures ? 1 : 0);
