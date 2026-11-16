#!/usr/bin/env node
// Check of the on-demand entity pages (stage 3a) against the real Worker under `wrangler dev`.
//
//   node scripts/od-dev.mjs <local-db-url>            (starts the fake Supabase and two Workers)
//   node scripts/verify-od.mjs http://localhost:8787 --parity http://localhost:8788 \
//        --static http://127.0.0.1:4371 --db <local-db-url>
//
// 1. parity: a tracked insider, ticker and company rendered by the static build and by the Worker
//    (through /od-parity/, which answers only with the test switch on) must show the same facts,
//    figures and trade rows.
// 2. market entities (from the bulk fixture): status, one h1, title and description length,
//    canonical, robots rule, JSON-LD, source link on every trade row, internal links, no sideways
//    scroll at 390 and 1100 px, axe, share dialog.
// 3. unknown slug or ticker: 404 with the site's page; a tracked entity is not rendered without
//    the switch; second request a cache hit.
// Needs playwright and axe-core (npm i --no-save playwright axe-core); PW_CHROMIUM for Chrome.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const base = (args[0] ?? "http://localhost:8787").replace(/\/$/, "");
const parityBase = (opt("--parity") ?? "http://localhost:8788").replace(/\/$/, "");
const staticBase = (opt("--static") ?? "http://127.0.0.1:4371").replace(/\/$/, "");
const dbUrl = opt("--db");
if (!dbUrl || /supabase\.(co|com)/.test(dbUrl)) { console.error("--db <local database url> is required (never production)"); process.exit(2); }
const require = createRequire(import.meta.url);
const { chromium } = await import("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

let ran = 0, failed = 0;
const out = [];
const ok = (cond, label, extra = "") => { ran++; if (!cond) { failed++; console.log("  x", label, extra); } else if (process.env.VERBOSE) console.log("  ok", label); return cond; };
const section = (t) => console.log(`\n${t}`);
const parity = [];

// ---------- extraction shared by the two renderings ----------
const extract = () => {
  const txt = (e) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
  const tableAfter = (id) => {
    const h = document.getElementById(id); if (!h) return null;
    let el = h.nextElementSibling;
    while (el && !(el.matches("table") || el.querySelector("table"))) el = el.nextElementSibling;
    return el ? (el.matches("table") ? el : el.querySelector("table")) : null;
  };
  const rowsOf = (t, n = 100) => !t ? [] : [...t.querySelectorAll("tbody tr")].slice(0, n).map((tr) => ({
    cells: [...tr.children].map((c) => txt(c)),
    hrefs: [...tr.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).sort(),
  }));
  const facts = {};
  document.querySelectorAll("[data-entity-facts] > div").forEach((d) => { facts[txt(d.querySelector("dt"))] = txt(d.querySelector("dd")); });
  const periods = {};
  document.querySelectorAll("[data-entity-periods] [data-k]").forEach((c) => { periods[c.getAttribute("data-k")] = txt(c); });
  const q = (sel) => document.querySelector(sel);
  return {
    h1: txt(q("h1")),
    facts, periods,
    txRows: rowsOf(tableAfter("insider-transactions") ?? tableAfter("transactions")),
    codes: rowsOf(q("[data-entity-codes]"), 50),
    years: rowsOf(q("[data-entity-years]"), 50),
    who: rowsOf(q("[data-entity-insiders] table"), 25),
    datastrip: [...document.querySelectorAll(".datastrip .cell")].map((c) => txt(c)),
  };
};
const grab = async (url) => {
  const page = await browser.newPage();
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  const status = res?.status();
  const data = status === 200 ? await page.evaluate(extract) : null;
  await page.close();
  return { status, data };
};

// ---------- 1. parity ----------
section("parity: static page vs Worker rendering of the same tracked entity");
const [pi] = await sql`select p.slug::text as k, count(*) n from transactions t join people p on p.id = t.person_id join filings f on f.id = t.filing_id where f.source = 'sec_form4' and f.scope = 'tracked' group by 1 order by 2 desc, 1 limit 1`;
const [ps] = await sql`select lower(s.ticker::text) as k from securities s join transactions t on t.security_id = s.id join filings f on f.id = t.filing_id where f.source = 'sec_form4' and f.scope = 'tracked' group by 1 order by count(*) desc, 1 limit 1`;
const [pc] = await sql`select c.slug::text as k from companies c join securities s on s.company_id = c.id join transactions t on t.security_id = s.id join filings f on f.id = t.filing_id where f.source = 'sec_form4' and f.scope = 'tracked' group by 1 order by count(*) desc, 1 limit 1`;
for (const [kind, dir, key] of [["insider", "insiders", pi.k], ["stock", "stocks", ps.k], ["company", "companies", pc.k]]) {
  const s = await grab(`${staticBase}/${dir}/${key}/`);
  const w = await grab(`${parityBase}/od-parity/${kind}/${key}/`);
  const tag = `${kind} ${key}`;
  if (!ok(s.status === 200 && w.status === 200, `${tag}: both render`, `static ${s.status}, worker ${w.status}`)) continue;
  const a = s.data, b = w.data;
  ok(a.h1 === b.h1, `${tag}: h1`, `${a.h1} | ${b.h1}`);
  const shared = Object.keys(b.facts).filter((k) => k in a.facts);
  ok(shared.length > 0 && shared.every((k) => a.facts[k] === b.facts[k]), `${tag}: shared header facts (${shared.join(", ")})`, JSON.stringify(shared.filter((k) => a.facts[k] !== b.facts[k]).map((k) => [k, a.facts[k], b.facts[k]])));
  const onlyStatic = Object.keys(a.facts).filter((k) => !(k in b.facts)), onlyWorker = Object.keys(b.facts).filter((k) => !(k in a.facts));
  const n = Math.min(100, a.txRows.length, b.txRows.length);
  ok(a.txRows.length === b.txRows.length || a.txRows.length > 100 || b.txRows.length > 100, `${tag}: trade row count`, `${a.txRows.length} vs ${b.txRows.length}`);
  let cellDiff = 0;
  for (let i = 0; i < n; i++) {
    const x = a.txRows[i], y = b.txRows[i];
    if (JSON.stringify(x.cells) !== JSON.stringify(y.cells) || JSON.stringify(x.hrefs) !== JSON.stringify(y.hrefs)) { if (cellDiff++ < 3) console.log("   row", i, "\n    static", JSON.stringify(x), "\n    worker", JSON.stringify(y)); }
  }
  ok(n > 0 && cellDiff === 0, `${tag}: first ${n} trade rows cell by cell, with their links`, `${cellDiff} rows differ`);
  const pk = Object.keys(a.periods).filter((k) => k in b.periods);
  if (kind === "stock") ok(pk.length > 0 && pk.every((k) => a.periods[k] === b.periods[k]), `${tag}: 3 and 12 month summary (${pk.length} cells)`, JSON.stringify(pk.filter((k) => a.periods[k] !== b.periods[k]).map((k) => [k, a.periods[k], b.periods[k]])));
  const sp = (rows, code) => JSON.stringify((rows.find((r) => r.cells[0] === code) ?? {}).cells ?? null);
  if (a.codes.length) ok(sp(a.codes, "P") === sp(b.codes, "P") && sp(a.codes, "S") === sp(b.codes, "S"), `${tag}: open-market purchase and sale rows, shares and dollars (codes P and S)`, `${sp(a.codes, "P")} ${sp(b.codes, "P")} | ${sp(a.codes, "S")} ${sp(b.codes, "S")}`);
  if (a.codes.length) ok(JSON.stringify(a.codes.map((r) => r.cells)) === JSON.stringify(b.codes.map((r) => r.cells)), `${tag}: rows by code table`);
  if (a.years.length) ok(JSON.stringify(a.years.map((r) => r.cells)) === JSON.stringify(b.years.map((r) => r.cells)), `${tag}: rows by year table`);
  const wn = Math.min(a.who.length, b.who.length);
  if (kind !== "insider") ok(a.who.length === 0 || (wn > 0 && JSON.stringify(a.who.slice(0, wn).map((r) => r.cells)) === JSON.stringify(b.who.slice(0, wn).map((r) => r.cells))), `${tag}: insiders table (${wn} rows)`, `${JSON.stringify(a.who.slice(0, 2))} | ${JSON.stringify(b.who.slice(0, 2))}`);
  parity.push({ tag, rows: n, factsShared: shared.length, onlyStatic, onlyWorker, cellDiff });
}

// ---------- 2. market entities ----------
section("market entities from the bulk fixture");
const SITE = (process.env.PUBLIC_SITE_URL ?? "http://127.0.0.1:4371").replace(/\/$/, "");
const insiders = (await sql`select distinct p.slug::text k from people p join transactions t on t.person_id = p.id join filings f on f.id = t.filing_id where f.scope = 'market' and f.is_published order by 1`).map((r) => r.k);
const stocks = (await sql`select distinct s.ticker::text k from securities s join transactions t on t.security_id = s.id join filings f on f.id = t.filing_id where f.scope = 'market' and f.is_published order by 1`).map((r) => r.k);
const companies = (await sql`select distinct c.slug::text k from companies c join securities s on s.company_id = c.id join transactions t on t.security_id = s.id join filings f on f.id = t.filing_id where f.scope = 'market' and f.is_published and c.slug is not null order by 1`).map((r) => r.k);
ok(insiders.length > 0 && stocks.length > 0 && companies.length > 0, "the fixture gives market insiders, tickers and companies", `${insiders.length}/${stocks.length}/${companies.length}`);
const openMarket = async (kind, key) => {
  const col = kind === "insider" ? sql`p.slug::text = ${key}` : kind === "stock" ? sql`s.ticker::text = ${key}` : sql`c.slug::text = ${key}`;
  const [r] = await sql`select count(*)::int n from transactions t join filings f on f.id = t.filing_id join people p on p.id = t.person_id left join securities s on s.id = t.security_id left join companies c on c.id = s.company_id
    where f.scope = 'market' and f.is_published and t.txn_code in ('P','S') and not coalesce(t.is_derivative, false) and ${col}`;
  return r.n > 0;
};
const targets = [...insiders.map((k) => ["insider", "insiders", k]), ...stocks.map((k) => ["stock", "stocks", k.toLowerCase()]), ...companies.map((k) => ["company", "companies", k])];
const axeRun = async (page) => {
  await page.evaluate(axeSource);
  return page.evaluate(async () => (await axe.run({ exclude: [["iframe"], [".tv"], [".ad-slot"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
};
for (const [kind, dir, key] of targets) {
  const url = `${base}/${dir}/${key}/`, tag = `${kind} ${key}`;
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const res = await page.goto(url, { waitUntil: "load" });
  if (!ok(res?.status() === 200, `${tag}: 200`, res?.status())) { await page.close(); continue; }
  const m = await page.evaluate(() => ({
    h1: document.querySelectorAll("h1").length,
    title: document.title, desc: document.querySelector('meta[name="description"]')?.content ?? "",
    canonical: document.querySelector('link[rel="canonical"]')?.href ?? "",
    robots: document.querySelector('meta[name="robots"]')?.content ?? "",
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent)["@type"] ?? "?"; } catch { return null; } }),
    rows: [...document.querySelectorAll("#insider-transactions ~ * table tbody tr, #insider-transactions + .tablewrap tbody tr, #insider-transactions + * tbody tr")].length,
    badRows: [...document.querySelectorAll("table.txns tbody tr, table.data tbody tr[id^='t']")].filter((tr) => ![...tr.querySelectorAll("a[href]")].some((a) => /sec\.gov/.test(a.href))).length,
    hrefs: [...new Set([...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && (h.startsWith("/") || h.startsWith("#"))))],
    ids: new Set([...document.querySelectorAll("[id]")].map((e) => e.id)).size,
  }));
  ok(m.h1 === 1, `${tag}: one h1`, m.h1);
  ok(m.title.length > 0 && m.title.length <= 60, `${tag}: title length ${m.title.length}`, m.title);
  ok(m.desc.length >= 50 && m.desc.length <= 155, `${tag}: description length ${m.desc.length}`);
  ok(m.canonical === `${SITE}/${dir}/${key}/`, `${tag}: canonical`, m.canonical);
  const expectIndex = await openMarket(kind, kind === "stock" ? key.toUpperCase() : key);
  ok(m.robots.includes("noindex") === !expectIndex, `${tag}: robots rule (${expectIndex ? "indexable" : "noindex"})`, m.robots);
  ok(m.ld.length >= 2 && m.ld.every((x) => x), `${tag}: JSON-LD parses (${m.ld.join(", ")})`);
  ok(m.badRows === 0, `${tag}: every trade row has a source link`, m.badRows);
  const hashes = m.hrefs.filter((h) => h.startsWith("#")), paths = m.hrefs.filter((h) => h.startsWith("/") && !h.startsWith("//"));
  const missing = []; for (const h of hashes) if (h.length > 1 && !(await page.$(`[id="${h.slice(1)}"]`))) missing.push(h);
  ok(missing.length === 0, `${tag}: in-page links resolve`, missing.join(" "));
  const dead = []; await Promise.all(paths.slice(0, 80).map(async (h) => { const r = await fetch(new URL(h.split("#")[0], base), { redirect: "manual" }).catch(() => null); if (!r || r.status >= 400) dead.push(`${h} ${r?.status}`); }));
  ok(dead.length === 0, `${tag}: internal links resolve (${Math.min(paths.length, 80)} checked)`, dead.slice(0, 5).join(", "));
  for (const w of [390, 1100]) {
    await page.setViewportSize({ width: w, height: 900 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, `${tag}: no sideways scroll at ${w}px`, `+${over}px`);
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  const viol = await axeRun(page);
  ok(viol.length === 0, `${tag}: axe clean`, viol.join(", "));
  const btn = await page.$("[data-share='page']");
  if (ok(!!btn, `${tag}: share button present`)) { await btn.click(); await page.waitForTimeout(150); ok(await page.evaluate(() => !!document.querySelector("#shareDlg")?.open), `${tag}: share dialog opens`); }
  await page.close();
}

// market sitemaps list exactly the indexable market entities
{
  const idx = await (await fetch(`${staticBase}/sitemap-index.xml`)).text();
  const files = [...idx.matchAll(/<loc>[^<]*(\/sitemaps\/market-[^<]+)<\/loc>/g)].map((m) => m[1]);
  const listed = new Set();
  for (const f of files) { const x = await (await fetch(staticBase + f)).text(); for (const m of x.matchAll(/<loc>[^<]*(\/(?:insiders|stocks|companies)\/[^<]+)<\/loc>/g)) listed.add(m[1]); }
  const want = new Set();
  for (const [kind, dir, key] of targets) if (await openMarket(kind, kind === "stock" ? key.toUpperCase() : key)) want.add(`/${dir}/${key}/`);
  ok(files.length > 0 && listed.size === want.size && [...want].every((u) => listed.has(u)), `market sitemaps (${files.length} files) list exactly the ${want.size} indexable market pages`, `listed ${[...listed].join(" ")} wanted ${[...want].join(" ")}`);
  ok(files.every((f) => /market-(companies|stocks|insiders-\d+)\.xml$/.test(f)), "market sitemap file names");
  for (const u of listed) { const r = await fetch(base + u); ok(r.status === 200, `sitemap URL renders: ${u}`, r.status); }
}
// the publishing floor reaches the page: a later floor removes the older rows
{
  const [a] = await sql`select od_company(${companies[0]}, false, '2025-10-01') r`; const [b] = await sql`select od_company(${companies[0]}, false, '2027-01-01') r`;
  ok(a.r.stats.rowCount > 0 && b.r.stats.rowCount === 0, "floor: rows filed before p_floor are not returned", `${a.r.stats.rowCount} -> ${b.r.stats.rowCount}`);
}

// ---------- 3. unknown, tracked, cache ----------
section("404, tracked entities, cache");
for (const p of ["/insiders/no-such-person/", "/stocks/zzzzq/", "/companies/no-such-company/", "/insiders/a/b/", "/stocks/%00/"]) {
  const r = await fetch(base + p); const t = await r.text();
  ok(r.status === 404 && /<h1[^>]*>Page not found/.test(t) && /noindex/.test(t), `404 with the site page: ${p}`, r.status);
}
for (const [kind, key] of [["insider", pi.k], ["stock", ps.k], ["company", pc.k]]) {
  const r = await fetch(`${base}/od-parity/${kind}/${key}/`);
  ok(r.status === 404, `tracked ${kind} ${key} is not rendered on demand without the switch`, r.status);
}
{ const r = await fetch(`${staticBase}/od-parity/insider/${pi.k}/`); ok(r.status === 404, "the static build has no od-parity file", r.status); }
for (const fn of [["od_insider", pi.k], ["od_stock", ps.k.toUpperCase()], ["od_company", pc.k]]) {
  const [r] = await sql.unsafe(`select ${fn[0]}($1, false, '2025-10-01') as r`, [fn[1]]);
  ok(r.r === null, `${fn[0]}(${fn[1]}, p_any=false) returns null for a tracked entity`);
}
{
  const u = `${base}/insiders/${insiders[0]}/`;
  await fetch(u); const r = await fetch(u);
  ok(r.headers.get("x-od-cache") === "hit", "second request is a Cache API hit", r.headers.get("x-od-cache"));
  ok(/s-maxage=86400/.test(r.headers.get("cache-control") ?? ""), "found pages carry s-maxage=86400", r.headers.get("cache-control"));
  const nf = `${base}/insiders/never-heard-of-them/`; await fetch(nf); const r2 = await fetch(nf);
  ok(r2.headers.get("x-od-cache") === "hit", "an unknown slug is cached too (5 minutes)", r2.headers.get("x-od-cache"));
  ok((r2.headers.get("set-cookie") ?? "") === "", "no Set-Cookie on an on-demand page");
}

console.log("\nparity summary:", JSON.stringify(parity));
console.log(failed ? `\nFAILED ${failed} of ${ran} checks` : `\nok: ${ran} checks`);
await browser.close(); await sql.end();
process.exit(failed ? 1 : 0);
