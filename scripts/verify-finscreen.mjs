// Checks the company financials screener (/company-financials/; web/src/lib/finscreen.ts,
// web/src/scripts/finscreen.ts):
//   node scripts/verify-finscreen.mjs <base-url> [--no-browser]     e.g. http://127.0.0.1:4321
// Its oracle is not the screener's data file. It works out every company's newest fiscal year
// and newest quarter from /downloads/company-financials.csv and its industry division from
// /downloads/companies.csv, which other code writes (lib/downloads.ts), with this script's own
// copy of the rules: which period is the newest, which figures are held back, what a dollar
// filter may read, how a column sorts and how an amount is printed.
// Without a browser: the data file against that oracle, company by company and figure by figure;
// that no held-back figure is in the data file; the rows the page prints without JavaScript; the
// counts beside the links from the industry pages; sitemap, llms.txt, search; wording.
// With a browser (Playwright; skipped with --no-browser or when it is not installed): every
// option of every filter in both periods, combined filters paged through and compared company by
// company, every sort key in both directions, the address and its reload, Reset, a jump link,
// junk in the address, the search box, the empty state, the download of the rows on screen, that
// nothing is written to browser storage and no request is sent while filtering, and 390 px.
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const noBrowser = args.includes("--no-browser");
const PATH = "/company-financials/", DATA = "/data/financials-screener.json";
const FIGS = ["revenue", "net_income", "eps_diluted", "assets", "equity"];
const REV_MIN = [1e8, 1e9, 1e10, 1e11], REV_MAX = [1e8, 1e9, 1e10], ASSET_MIN = [1e9, 1e10, 1e11];
const KEYS = ["q", "period", "division", "unit", "rmin", "rmax", "ni", "amin", "pay", "sort", "dir", "page", "per"];
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; if (failures <= 60) console.log(`✗ ${msg}`); } return !!cond; };

function parseCsv(text) {
  const out = []; let row = [], cell = "", q = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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
  return out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i].replace(/^'(?=[=+\-@])/, "")])));
}
const get = async (path) => { try { const r = await fetch(base + path); return { status: r.status, text: r.ok ? await r.text() : "" }; } catch { return { status: 0, text: "" }; } };
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
const strip = (s) => unescape(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const mainOf = (html) => (html.match(/<main[\s\S]*?<\/main>/) ?? [html])[0];

// This script's own way of printing an amount.
const fix = (n, d) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
function money(v, cur) {
  const a = Math.abs(v);
  const body = a >= 1e12 ? fix(a / 1e12, 2) + "T" : a >= 1e9 ? fix(a / 1e9, 2) + "B" : a >= 1e6 ? fix(a / 1e6, 1) + "M" : a >= 1e3 ? fix(a / 1e3, 0) + "K" : fix(a, 0);
  return (v < 0 ? "−" : "") + (cur === "USD" ? "$" : cur + " ") + body;
}
const perShare = (v, cur) => (v < 0 ? "−" : "") + (cur === "USD" ? "$" : cur + " ") + fix(Math.abs(v), 2);
const printed = (fig, v, cur) => (fig === "eps_diluted" ? perShare(v, cur) : money(v, cur));
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── the page ─────────────────────────────────────────────────────────────────────────────
const pageRes = await get(PATH);
if (pageRes.status !== 200) { console.log(`✗ ${PATH} answered ${pageRes.status}`); process.exit(1); }
const html = pageRes.text, main = mainOf(html);
const finCsvRes = await get("/downloads/company-financials.csv");
if (!/data-finscreen/.test(html)) {
  ok(/class="empty-reason"/.test(main), "an empty screener says why");
  ok(/<meta name="robots" content="[^"]*noindex/.test(html), "an empty screener is noindex");
  ok(finCsvRes.status !== 200 || parseCsv(finCsvRes.text).length === 0, "the screener is empty although company-financials.csv has rows");
  ok((await get(DATA)).status === 200, "the data file is served even when empty");
  console.log(failures ? `verify-finscreen: ${failures} problem(s)` : `✓ verify-finscreen: no company financials on file, ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}

// ── the oracle ───────────────────────────────────────────────────────────────────────────
ok(finCsvRes.status === 200, "company-financials.csv is served");
const finCsv = parseCsv(finCsvRes.text);
const coCsv = parseCsv((await get("/downloads/companies.csv")).text);
// Executive pay: the oracle is executive-pay.csv (written by another code path): for each company
// the newest fiscal year that has a principal executive officer total.
const payCsv = parseCsv((await get("/downloads/executive-pay.csv")).text);
const payBy = new Map();
for (const r of payCsv) {
  const peo = r.peo_total === "" || r.peo_total == null ? null : Number(r.peo_total);
  if (peo == null || !Number.isFinite(peo)) continue;
  const k = String(r.cik).padStart(10, "0"), cur = payBy.get(k);
  if (!cur || r.fiscal_year_end > cur.fye) payBy.set(k, { peo, fye: r.fiscal_year_end });
}
const coByCik = new Map(coCsv.map((r) => [String(r.cik).padStart(10, "0"), r]));
const numOrNull = (s) => (s === "" || s == null ? null : Number(s));
function periodOf(r) {
  if (!r || !r.reports) return null;   // a period with none of the printed figures has no report
  const [form, filed, url] = r.reports.split("; ")[0].split(" ");
  const held = new Set((r.not_shown || "").split(";").map((x) => x.trim().split(":")[0]).filter(Boolean));
  const v = {}, h = {};
  for (const f of FIGS) { h[f] = held.has(f); v[f] = h[f] ? null : numOrNull(r[f]); }
  return { end: r.period_end, start: r.period_start || null, form, filed, url, v, held: h, filedValues: Object.fromEntries(FIGS.map((f) => [f, numOrNull(r[f])])) };
}
const byCik = new Map();
for (const r of finCsv) { const k = r.cik; const e = byCik.get(k) ?? { rows: [] }; e.rows.push(r); byCik.set(k, e); }
const oracle = [];
for (const [cik, e] of byCik) {
  const newest = (kind) => e.rows.filter((r) => r.period === kind).sort((a, b) => (a.period_end < b.period_end ? 1 : -1))[0];
  const year = periodOf(newest("fiscal_year")), quarter = periodOf(newest("quarter"));
  if (!year && !quarter) continue;
  const any = e.rows[0], co = coByCik.get(cik);
  oracle.push({ cik, name: any.company, ticker: any.ticker || "", unit: any.currency, path: (any.page_url || "").replace(/^https?:\/\/[^/]+/, ""), division: co?.sic_division || "", sic: co?.sic_code || "", year, quarter, pay: payBy.get(cik) ?? null });
}
const oByCik = new Map(oracle.map((o) => [o.cik, o]));
const rowsOf = (period) => oracle.filter((o) => o[period]).map((o) => ({ o, p: o[period] }));
const usd = (r, f) => (r.o.unit === "USD" ? r.p.v[f] : null);
function matches(r, f) {
  if (f.division && slugOf(r.o.division) !== f.division) return false;
  if (f.unit && r.o.unit !== f.unit) return false;
  if (f.rmin) { const v = usd(r, "revenue"); if (v == null || v < f.rmin) return false; }
  if (f.rmax) { const v = usd(r, "revenue"); if (v == null || v > f.rmax) return false; }
  if (f.amin) { const v = usd(r, "assets"); if (v == null || v < f.amin) return false; }
  if (f.pay && !r.o.pay) return false;
  if (f.ni) { const v = r.p.v.net_income; if (v == null || (f.ni === "pos" ? !(v > 0) : !(v < 0))) return false; }
  if (f.q) { const hay = `${r.o.name} ${r.o.ticker}`.toLowerCase(); if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false; }
  return true;
}
function sorted(rows, key, dir) {
  const val = (r) => (key === "company" ? r.o.name.toLowerCase() : key === "end" ? r.p.end : key === "pay" ? r.o.pay?.peo ?? null : usd(r, key));
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null || y == null) { if (x != null) return -1; if (y != null) return 1; }
    else if (x < y) return -sign; else if (x > y) return sign;
    const an = a.o.name.toLowerCase(), bn = b.o.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : a.o.cik < b.o.cik ? -1 : a.o.cik > b.o.cik ? 1 : 0;
  });
}
const expect = (f = {}, sort = "revenue", dir = "desc") => sorted(rowsOf(f.period ?? "year").filter((r) => matches(r, f)), sort, dir);

// ── the data file against the oracle ─────────────────────────────────────────────────────
const dataRes = await get(DATA);
ok(dataRes.status === 200, `${DATA} is served`);
const data = dataRes.status === 200 ? JSON.parse(dataRes.text) : { built: "", divisions: [], companies: [] };
ok(/^\d{4}-\d{2}-\d{2}$/.test(data.built), `the data file states its build day (${data.built})`);
ok(Object.keys(data).join() === "built,divisions,companies", `the data file's top-level layout is built, divisions, companies (${Object.keys(data).join()})`);
ok(data.companies.length === oracle.length, `the data file has ${data.companies.length} companies, company-financials.csv gives ${oracle.length}`);
ok(new Set(data.companies.map((c) => c[3])).size === data.companies.length, "no company is in the data file twice");
let figures = 0, heldSeen = 0;
for (const c of data.companies) {
  const [name, path, ticker, cik, di, sic, unit, y, q, payPeo, payFye] = c;
  const o = oByCik.get(cik);
  if (!ok(!!o, `${name} (${cik}) is in the data file but has no newest period in company-financials.csv`)) continue;
  ok((payPeo ?? null) === (o.pay?.peo ?? null) && (payFye || "") === (o.pay?.fye ?? ""), `${name}: executive pay ${payPeo} (${payFye}) in the data file, executive-pay.csv gives ${o.pay?.peo ?? null} (${o.pay?.fye ?? ""})`);
  ok(name === o.name && ticker === o.ticker && unit === o.unit && path === o.path, `${name}: name, ticker, currency or page differ from company-financials.csv`);
  ok((data.divisions[di]?.name ?? "") === o.division && sic === o.sic, `${name}: division "${data.divisions[di]?.name ?? ""}" and code ${sic}, companies.csv gives "${o.division}" and ${o.sic}`);
  if (data.divisions[di]) ok(data.divisions[di].slug === slugOf(o.division), `${name}: the division's page name ${data.divisions[di].slug}`);
  for (const [kind, packed] of [["year", y], ["quarter", q]]) {
    const p = o[kind];
    if (!ok(!!packed === !!p, `${name}: ${kind} ${packed ? "is" : "is not"} in the data file, company-financials.csv ${p ? "has" : "has not"} one`) || !p) continue;
    ok(packed[0] === p.end && (packed[1] || null) === p.start, `${name} ${kind}: period ${packed[1]} to ${packed[0]}, the CSV gives ${p.start} to ${p.end}`);
    ok(packed[2] === p.filed && packed[3] === p.form && (p.url || "").includes(packed[4]), `${name} ${kind}: report ${packed[3]} ${packed[2]} ${packed[4]}, the CSV's newest is ${p.form} ${p.filed}`);
    FIGS.forEach((f, i) => {
      figures++;
      const bit = ((packed[10] >> i) & 1) === 1;
      if (p.held[f]) { heldSeen++; ok(bit && packed[5 + i] === null, `${name} ${kind}: ${f} is held back in the CSV (${p.filedValues[f]}) but is in the data file`); }
      else ok(!bit && packed[5 + i] === p.v[f], `${name} ${kind}: ${f} is ${packed[5 + i]} in the data file, ${p.v[f]} in the CSV`);
    });
  }
}
const divisionsUsed = new Set(oracle.map((o) => o.division).filter(Boolean));
ok(data.divisions.length === divisionsUsed.size && data.divisions.every((d) => divisionsUsed.has(d.name)), `the data file lists ${data.divisions.length} divisions, the companies fall in ${divisionsUsed.size}`);

// ── the rows the page prints without JavaScript ──────────────────────────────────────────
const first = expect().slice(0, 50);
const trs = [...main.matchAll(/<tr[^>]*data-cik="(\d{10})"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => ({ cik: m[1], cells: [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]) }));
ok(trs.map((r) => r.cik).join() === first.map((r) => r.o.cik).join(), `the page prints ${trs.length} rows; by revenue of the newest fiscal year the first ${first.length} are others (page starts ${trs.slice(0, 3).map((r) => r.cik).join(", ")}; expected ${first.slice(0, 3).map((r) => r.o.cik).join(", ")})`);
const cellsExpected = (r) => [
  `${r.o.name}${r.o.ticker ? ` ${r.o.ticker}` : ""}`, r.o.division, shortDate(r.p.end),
  ...FIGS.map((f) => (r.p.held[f] ? "not shown" : r.p.v[f] == null ? "" : printed(f, r.p.v[f], r.o.unit))),
  r.o.pay ? money(r.o.pay.peo, "USD") : "", r.o.pay ? shortDate(r.o.pay.fye) : "",
  `${r.p.form} ↗`,
];
trs.forEach((tr, i) => {
  const r = first[i]; if (!r || tr.cik !== r.o.cik) return;
  const got = tr.cells.map(strip), want = cellsExpected(r);
  ok(got.join("|") === want.join("|"), `${r.o.name}: the row reads "${got.join(" | ")}", expected "${want.join(" | ")}"`);
  ok(!r.o.path || tr.cells[0].includes(`href="${r.o.path}"`), `${r.o.name}: the name links to the company's page`);
  ok(!r.o.division || tr.cells[1].includes(`href="/industries/${slugOf(r.o.division)}/"`), `${r.o.name}: the industry links to its division page`);
  ok(tr.cells[10].includes(`href="${r.p.url}"`) && tr.cells[10].includes(`title="Filed ${shortDate(r.p.filed)}"`), `${r.o.name}: the report link is the CSV's newest report, with its filing date`);
  for (const f of FIGS) if (r.p.held[f] && r.p.filedValues[f] != null) ok(!strip(tr.cells.join(" ")).includes(printed(f, r.p.filedValues[f], r.o.unit)), `${r.o.name}: a held-back ${f} is printed`);
});
const years = rowsOf("year"), quarters = rowsOf("quarter");
ok(strip((main.match(/data-fs="count"[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? "").startsWith(`All ${years.length.toLocaleString("en-US")} `), `the count line starts "All ${years.length} ..."`);
const answer = strip((main.match(/class="[^"]*answer[^"]*"[\s\S]*?<\/(?:section|div|aside)>/) ?? [""])[0]);
ok(answer.includes(`${oracle.length.toLocaleString("en-US")} compan`) && answer.includes(`${years.length.toLocaleString("en-US")} with a fiscal year`) && answer.includes(`${quarters.length.toLocaleString("en-US")} with a quarter`), `the answer states ${oracle.length} companies, ${years.length} fiscal years and ${quarters.length} quarters`);

// ── wording, discovery, links in ─────────────────────────────────────────────────────────
const text = strip(main).toLowerCase();
for (const bad of ["undervalued", "overvalued", "cheap", "expensive", "bargain", "top pick", "best compan", "worst compan", "strong buy", "outperform", "quality score", "we recommend", "should buy", "should sell", "price target", "forecast of"]) ok(!text.includes(bad), `the page uses the wording "${bad}"`);
ok(text.includes("not investment advice"), "the page says it is not investment advice");
ok(text.includes("as the company filed") || text.includes("as filed"), "the page says the figures are as filed");
ok(text.includes("converts nothing") || text.includes("nothing here is estimated, converted"), "the page says nothing is converted");
ok(!/—/.test(strip(main)), "no em-dash in the page copy");
ok((await get("/sitemaps/pages.xml")).text.includes(`${PATH}</loc>`), "the pages sitemap lists the screener");
ok((await get("/llms.txt")).text.includes(PATH), "llms.txt lists the screener");
ok((await get("/data/search.json")).text.includes(PATH), "the search index lists the screener");
ok(((await get("/data/catalog.json")).text).includes(DATA), "the data catalogue lists the screener's data file");
const perDivision = new Map();
for (const r of years) if (r.o.division) perDivision.set(slugOf(r.o.division), (perDivision.get(slugOf(r.o.division)) ?? 0) + 1);
let linksIn = 0;
for (const p of ["/industries/", ...data.divisions.map((d) => `/industries/${d.slug}/`)]) {
  const m = mainOf((await get(p)).text);
  for (const x of m.matchAll(/<p[^>]*data-finscreen-link[^>]*data-n="(\d+)"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/g)) {
    linksIn++;
    const href = unescape(x[2]), hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
    const qs = new URLSearchParams(hash);
    ok(href.startsWith(PATH) && [...qs.keys()].every((k) => KEYS.includes(k)), `${p}: the link ${href} is not a view of the screener`);
    const want = qs.get("division") ? perDivision.get(qs.get("division")) ?? 0 : years.length;
    ok(Number(x[1]) === want && want > 0, `${p}: the link ${href} says ${x[1]} companies, the oracle gives ${want}`);
  }
  if (p !== "/industries/" && perDivision.get(p.split("/")[2])) ok(m.includes(`${PATH}#division=${p.split("/")[2]}`), `${p}: no link to its companies in the financials screener`);
}

// ── in a browser ─────────────────────────────────────────────────────────────────────────
let browserNote = "no browser";
let chromium = null;
if (!noBrowser) { try { ({ chromium } = await import("playwright")); } catch { browserNote = "Playwright is not installed: browser checks skipped"; } }
if (chromium) {
  let browser = null;
  try { browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}); } catch { browserNote = "no browser could be started: browser checks skipped"; }
  if (browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const root = page.locator("[data-finscreen]");
  let visit = 0;
  const open = async (hash = "") => { await page.goto(`${base}${PATH}?v=${++visit}${hash}`, { waitUntil: "load" }); await page.waitForFunction(() => document.querySelector("[data-finscreen]")?.dataset.ready === "1"); };
  const shown = async () => Number(await root.getAttribute("data-shown"));
  const pageCiks = () => page.$$eval('[data-fs="rows"] tr', (xs) => xs.map((x) => x.getAttribute("data-cik")));
  const allCiks = async () => {
    const out = [];
    for (let i = 0; i < 200; i++) { out.push(...(await pageCiks())); if (await page.locator('[data-fs="next"]').isDisabled()) break; await page.click('[data-fs="next"]'); }
    return out;
  };
  const optionsOf = (name) => page.$$eval(`[data-fs="${name}"] option`, (os) => os.map((o) => o.value));
  await open();
  ok(await shown() === years.length, `the screener opens on ${await shown()} companies, the oracle has ${years.length} with a fiscal year`);
  const jsFirst = await page.$$eval('[data-fs="rows"] tr', (xs) => xs.map((x) => [...x.querySelectorAll("td")].map((td) => td.textContent.replace(/\s+/g, " ").trim()).join("|")));
  ok(jsFirst.join("\n") === trs.map((r) => r.cells.map(strip).join("|")).join("\n"), "the rows printed without JavaScript are the first page with JavaScript, cell for cell");

  // Every option of every filter, in both periods.
  const offered = { division: await optionsOf("division"), unit: await optionsOf("unit"), rmin: await optionsOf("rmin"), rmax: await optionsOf("rmax"), ni: await optionsOf("ni"), amin: await optionsOf("amin"), pay: await optionsOf("pay") };
  ok(offered.division.filter(Boolean).sort().join() === data.divisions.map((d) => d.slug).sort().join(), "the industry filter offers the divisions in the data file");
  ok(offered.unit.length === 0 || offered.unit.filter(Boolean).sort().join() === [...new Set(oracle.map((o) => o.unit))].sort().join(), "the currency filter offers the currencies companies report in");
  ok(offered.rmin.join() === ["0", ...REV_MIN].join() && offered.rmax.join() === ["0", ...REV_MAX].join() && offered.amin.join() === ["0", ...ASSET_MIN].join() && offered.ni.join() === ",pos,neg" && offered.pay.join() === "0,1", "the amount filters offer the steps this script knows");
  let optionChecks = 0;
  for (const period of ["year", "quarter"]) {
    await page.selectOption('[data-fs="period"]', period);
    ok(await shown() === rowsOf(period).length, `period ${period}: ${await shown()} companies, the oracle has ${rowsOf(period).length}`);
    ok((await page.locator('[data-fs="endhead"]').textContent()) === (period === "quarter" ? "Quarter ended" : "Fiscal year ended"), `period ${period}: the date column is titled for it`);
    for (const [key, values] of Object.entries(offered)) for (const value of values.filter((v) => v && v !== "0")) {
      await page.selectOption(`[data-fs="${key}"]`, value);
      const f = { period, [key]: ["rmin", "rmax", "amin", "pay"].includes(key) ? Number(value) : value };
      const want = expect(f).length, got = await shown();
      optionChecks++;
      ok(got === want, `${period}, ${key}=${value}: ${got} companies on screen, the oracle gives ${want}`);
      if (want > 0 && want <= 100) ok((await pageCiks()).join() === expect(f).slice(0, 50).map((r) => r.o.cik).join(), `${period}, ${key}=${value}: the companies on screen are the oracle's, in order`);
      await page.selectOption(`[data-fs="${key}"]`, ["rmin", "rmax", "amin", "pay"].includes(key) ? "0" : "");
    }
  }
  // Combined views, paged through, company by company.
  const div0 = data.divisions[0]?.slug ?? "";
  const combos = [
    { f: {}, sort: "revenue", dir: "desc" },
    { f: { ni: "pos", rmin: 1e9 }, sort: "net_income", dir: "desc" },
    { f: { ni: "neg" }, sort: "net_income", dir: "asc" },
    { f: { division: div0 }, sort: "company", dir: "asc" },
    { f: { period: "quarter", unit: "USD" }, sort: "assets", dir: "desc" },
    { f: { rmin: 1e8, rmax: 1e10 }, sort: "end", dir: "desc" },
    { f: { rmin: 1e11, rmax: 1e8 }, sort: "revenue", dir: "desc" },
    { f: { amin: 1e10, ni: "pos" }, sort: "equity", dir: "asc" },
    { f: { period: "quarter" }, sort: "eps_diluted", dir: "desc" },
    { f: { pay: 1 }, sort: "pay", dir: "desc" },
    { f: {}, sort: "pay", dir: "asc" },
    { f: { period: "quarter", pay: 1, ni: "pos" }, sort: "pay", dir: "desc" },
  ];
  const hashOf = (c) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(c.f)) p.set(k, String(v)); if (c.sort !== "revenue" || c.dir !== "desc") { p.set("sort", c.sort); p.set("dir", c.dir); } const s = p.toString(); return s ? `#${s}` : ""; };
  for (const c of combos) {
    await open(hashOf(c));
    const want = expect(c.f, c.sort, c.dir).map((r) => r.o.cik), got = await allCiks();
    ok(got.join() === want.join(), `view ${hashOf(c) || "(opening view)"}: ${got.length} companies paged through, the oracle gives ${want.length} in another order or number`);
    if (!want.length) ok(await page.locator('[data-fs="empty"]').isVisible() && await page.locator('[data-fs="download"]').isDisabled(), `view ${hashOf(c)}: the empty state shows and the download is off`);
  }
  // Sorting by clicking a column title: first click, second click, third click.
  await open();
  for (const key of ["company", "end", "net_income", "assets", "pay"]) {
    const firstDir = key === "company" ? "asc" : "desc", other = firstDir === "asc" ? "desc" : "asc";
    await page.click(`th[data-sort="${key}"] button`);
    ok((await pageCiks()).join() === expect({}, key, firstDir).slice(0, 50).map((r) => r.o.cik).join(), `sort by ${key}: first click is ${firstDir}`);
    await page.click(`th[data-sort="${key}"] button`);
    ok((await pageCiks()).join() === expect({}, key, other).slice(0, 50).map((r) => r.o.cik).join(), `sort by ${key}: second click is ${other}`);
    ok((await page.locator(`th[data-sort="${key}"]`).getAttribute("aria-sort")) === (other === "asc" ? "ascending" : "descending"), `sort by ${key}: the column says its direction`);
    await page.click(`th[data-sort="${key}"] button`);
    ok((await pageCiks()).join() === first.map((r) => r.o.cik).join(), `sort by ${key}: a third click returns to the opening order`);
  }
  // The address, a reload, Reset, a jump link, junk.
  await page.selectOption('[data-fs="ni"]', "neg");
  await page.selectOption('[data-fs="per"]', "25");
  ok(new URL(page.url()).hash === "#ni=neg&per=25", `a view writes its address (${new URL(page.url()).hash})`);
  const before = await shown();
  await open("#ni=neg&per=25");
  ok(await shown() === before && (await page.inputValue('[data-fs="ni"]')) === "neg" && (await page.inputValue('[data-fs="per"]')) === "25", "opening the address restores the view and the controls");
  ok(await page.locator('[data-fs="reset"]').isVisible(), "Reset shows when a filter is set");
  await page.click('[data-fs="reset"]');
  ok(await shown() === years.length && (await page.inputValue('[data-fs="ni"]')) === "" && !(await page.locator('[data-fs="reset"]').isVisible()), "Reset clears the filters");
  await open("#ni=pos");
  const kept = await shown();
  await page.evaluate(() => { location.hash = "#about"; });
  await page.waitForTimeout(150);
  ok(await shown() === kept && (await page.inputValue('[data-fs="ni"]')) === "pos", "a jump link leaves the view alone");
  await open("#period=decade&division=%3Cscript%3E&unit=zzz&rmin=7&ni=maybe&amin=-1&sort=quality&page=0&per=7");
  ok(await shown() === years.length && (await pageCiks()).join() === first.map((r) => r.o.cik).join(), "junk in the address opens the opening view");
  await open("#division=no-such-division");
  ok(await shown() === years.length, "a division the table does not hold falls back to any industry");
  // Search.
  const probe = years.find((r) => r.o.ticker)?.o ?? years[0]?.o;
  if (probe) {
    await open();
    const word = (probe.ticker || probe.name.split(" ")[0]).toLowerCase();
    await page.fill('[data-fs="q"]', word);
    ok(await shown() === expect({ q: word }).length && (await shown()) > 0, `searching "${word}" finds ${await shown()} companies, the oracle gives ${expect({ q: word }).length}`);
    await page.fill('[data-fs="q"]', "zzzz no such company");
    ok(await shown() === 0 && await page.locator('[data-fs="empty"]').isVisible() && !(await page.locator('[data-fs="pager"]').isVisible()), "a search with no match shows the empty state and hides the pager");
    await page.click('[data-fs="reset2"]');
    ok(await shown() === years.length, "Clear the filters brings every company back");
  }
  // Download these rows.
  {
    const grab = async () => { const [d] = await Promise.all([page.waitForEvent("download"), page.click('[data-fs="download"]')]); return { name: d.suggestedFilename(), rows: parseCsv(await readFile(await d.path(), "utf8")) }; };
    await open();
    const every = await grab();
    ok(every.rows.length === years.length && every.name === `company-financials-fiscal-year-${data.built}.csv`, `with no filter the download has every company (${every.rows.length} of ${years.length}) and is named ${every.name}`);
    ok(every.rows.map((r) => r.cik).join() === expect().map((r) => r.o.cik).join(), "the download is in the order shown, every page");
    ok(every.rows.every((r) => { const o = oByCik.get(r.cik); const p = o?.year; return p && r.company === o.name && r.currency === o.unit && r.period === "fiscal_year" && r.period_end === p.end && FIGS.every((f) => r[f] === (p.v[f] == null ? "" : String(p.v[f]))) && r.not_shown === FIGS.filter((f) => p.held[f]).join("; ") && r.report_url === p.url && r.sic_division === o.division && numOrNull(r.ceo_pay_total) === (o.pay?.peo ?? null) && (r.ceo_pay_fiscal_year_end || "") === (o.pay?.fye ?? ""); }), "each downloaded row equals the oracle's newest fiscal year, held-back figures blank and named, and executive pay as executive-pay.csv has it");
    // A filtered, sorted quarter view that has rows (the first of these that matches anything).
    const pickNi = ["neg", "pos"].find((ni) => expect({ period: "quarter", ni }).length > 0);
    if (pickNi) {
      await open(`#period=quarter&ni=${pickNi}&sort=net_income&dir=asc`);
      const some = await grab();
      ok(some.rows.map((r) => r.cik).join() === expect({ period: "quarter", ni: pickNi }, "net_income", "asc").map((r) => r.o.cik).join() && some.rows.every((r) => r.period === "quarter"), "the download of a filtered, sorted quarter view has the same companies in the same order");
      ok(/quarter/.test(some.name) && some.name.includes(`ni-${pickNi}`), `a filtered download is named for its filters (${some.name})`);
    }
  }
  // Nothing stored, nothing sent.
  ok((await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)].flat())).every((k) => k === "theme" || k.startsWith("stm.screens.") || /^(_ga|google|goog)/i.test(k)), "the screener writes nothing to browser storage");
  requests.length = 0;
  await page.selectOption('[data-fs="ni"]', "pos"); await page.selectOption('[data-fs="rmin"]', "1000000000"); await page.fill('[data-fs="q"]', "a");
  ok(requests.filter((u) => u.startsWith(base) && !/favicon|apple-touch-icon/.test(u)).length === 0, `filtering sends no request to the site (${requests.filter((u) => u.startsWith(base) && !/favicon|apple-touch-icon/.test(u)).slice(0, 2).join(", ")})`);
  // Without JavaScript the controls are hidden; at 390 px nothing runs off the side.
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const np = await plain.newPage();
  await np.goto(base + PATH, { waitUntil: "load" });
  ok(!(await np.locator(".fs-controls").isVisible()) && !(await np.locator(".fs-pager").isVisible()) && !(await np.locator('[data-fs="download"]').isVisible()), "without JavaScript the controls, the pager and the row download are hidden");
  await plain.close();
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneCtx.newPage();
  await phone.goto(base + PATH, { waitUntil: "load" });
  await phone.waitForFunction(() => document.querySelector("[data-finscreen]")?.dataset.ready === "1");
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, `at 390 px the page is ${over}px wider than the screen`);
  await phoneCtx.close();
  ok(errors.length === 0, `page errors: ${errors.slice(0, 2).join(" | ")}`);
  await browser.close();
  browserNote = `browser checks run (${optionChecks} filter options, ${combos.length} combined views)`;
  }
}

console.log(failures
  ? `verify-finscreen: ${failures} problem(s) in ${checks} checks`
  : `✓ verify-finscreen: ${checks} checks pass: ${oracle.length} companies (${years.length} with a fiscal year, ${quarters.length} with a quarter) and ${figures} figures against company-financials.csv, ${heldSeen} held back, ${linksIn} links in from the industry pages; ${browserNote}`);
process.exit(failures ? 1 : 0);
