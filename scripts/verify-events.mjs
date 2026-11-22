#!/usr/bin/env node
// Company events: Form 8-K reports on stock and company pages, /company-events/, its data file and CSV.
//
//   node scripts/verify-events.mjs <base-url> [--sample N]
//
// The oracle is /downloads/company-events.csv (written by lib/downloads.ts from the stored reports,
// not by the page code). This script has its own copy of the rules (a 365-day window counted back
// from the build day, the order, 9.01 last, the sentence, the table caps) and checks:
//   - the file: columns, one row per accession, items in order with 9.01 last, headings against a
//     small table of its own, filing and event dates, links at sec.gov;
//   - sampled company pages (busiest, quietest with a report in the window, one with an amendment,
//     one with reports only before the window) and the stock page of each one's ticker: the
//     section's count and amendment count, the 15-row cap, every cell, the item order and the soft
//     9.01, the report links, the folded table of reports by item;
//   - /company-events/: the rows it prints are the 30-day window newest first, its data file holds
//     exactly the 365-day rows of the CSV file, stays small, and the item options are recounted;
//   - with Playwright installed: every option of the filters, the address, Reset, sorting, 390 px;
//   - wording: no word about timing or news, no dash used as punctuation, nothing derived.
// With no such file in the catalogue (an empty database) no page may carry the section.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const SAMPLE = args.includes("--sample") && Number(args[args.indexOf("--sample") + 1]) > 0 ? Number(args[args.indexOf("--sample") + 1]) : 8;
const FILE = "company-events.csv";
const COLUMNS = ["company", "cik", "ticker", "form", "filed", "event_date", "items", "item_headings", "accession", "source_url", "page_url"];
const DAY = 86400000, WINDOW = 365, ROWS = 15, HUB_FIRST = 50;
const HEAD = { "1.01": "Entry into a Material Definitive Agreement", "2.02": "Results of Operations and Financial Condition", "5.07": "Submission of Matters to a Vote of Security Holders", "7.01": "Regulation FD Disclosure", "8.01": "Other Events", "9.01": "Financial Statements and Exhibits", "2.03": "Creation of a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement of a Registrant" };

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; if (failures <= 60) console.log(`✗ ${msg}`); } };
const get = async (p) => {
  for (let i = 0; ; i++) {
    try { const r = await fetch(base + p); return { status: r.status, text: await r.text(), len: Number(r.headers.get("content-length") ?? 0) }; }
    catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); }
  }
};
const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
const t0 = (iso) => Date.parse(iso + "T00:00:00Z");
const longShort = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

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
const itemKey = (i) => i.split(".").map((p) => p.padStart(2, "0")).join(".");
const newestFirst = (a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : a.accession < b.accession ? 1 : -1);
const sentenceOfWords = /\b(ahead of|before the news|timed|good news|bad news|bullish|bearish|should buy|should sell|recommend|price target)\b/i;

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
    ok(!p.text.includes("data-company-events") && !p.text.includes('href="#company-events"'), `${c.company}: an events section with no file behind it`);
  }
  const meth = await get("/methodology/");
  ok(!/id="company-events"/.test(meth.text), "methodology has a company events paragraph with no file behind it");
  const hub = await get("/company-events/");
  ok(hub.status === 200 && /noindex/.test(hub.text) && !/data-evhub/.test(hub.text), "an empty hub is noindex and has no table");
  const sm = await get("/sitemaps/pages.xml");
  ok(!sm.text.includes("/company-events/"), "an empty hub is in the sitemap");
  const nv = await get("/data/company-events.json");
  ok(nv.status === 200 && JSON.parse(nv.text).rows.length === 0, "the data file of an empty hub has rows");
  console.log(failures ? `verify-events: ${failures} of ${checks} checks failed (no file state)` : `verify-events: no reports on file; ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}

const hubData = JSON.parse((await get("/data/company-events.json")).text);
const built = hubData.built;
ok(/^\d{4}-\d{2}-\d{2}$/.test(built), `data file built "${built}"`);
const file = await get(`/downloads/${FILE}`);
ok(file.status === 200, `${FILE} answers ${file.status}`);
const csv = parseCsv(file.text);
ok(JSON.stringify(csv.head) === JSON.stringify(COLUMNS), `${FILE} columns are ${csv.head.join(",")}`);
ok(csv.rows.length > 0, `${FILE} has no rows`);
const seen = new Set();
const byCik = new Map();
let amendments = 0;
for (const r of csv.rows) {
  ok(!seen.has(r.accession), `accession ${r.accession} twice in the file`); seen.add(r.accession);
  ok(/^\d{10}$/.test(r.cik) && /^\d{10}-\d{2}-\d{6}$/.test(r.accession), `${r.company}: cik ${r.cik} accession ${r.accession}`);
  ok(r.form === "8-K" || r.form === "8-K/A", `${r.accession}: form ${r.form}`);
  if (r.form === "8-K/A") amendments++;
  ok(/^\d{4}-\d{2}-\d{2}$/.test(r.filed) && (r.event_date === "" || /^\d{4}-\d{2}-\d{2}$/.test(r.event_date)), `${r.accession}: dates ${r.filed} ${r.event_date}`);
  const items = r.items === "" ? [] : r.items.split("; ");
  const sorted = [...items].sort((a, b) => (a === "9.01") - (b === "9.01") || itemKey(a).localeCompare(itemKey(b)));
  ok(items.join() === sorted.join() && new Set(items).size === items.length, `${r.accession}: items "${r.items}" are not in order with 9.01 last`);
  const heads = r.item_headings === "" ? [] : r.item_headings.split(" | ");
  ok(heads.length === items.length, `${r.accession}: ${items.length} items, ${heads.length} headings`);
  items.forEach((i, k) => { if (HEAD[i]) ok(heads[k] === HEAD[i], `${r.accession}: heading for ${i} is "${heads[k]}"`); });
  ok(r.source_url === "" || /^https:\/\/www\.sec\.gov\//.test(r.source_url), `${r.accession}: source_url ${r.source_url}`);
  ok(/^https:\/\/spotthemoney\.com\/companies\/[a-z0-9-]+\/$/.test(r.page_url), `${r.accession}: page_url ${r.page_url}`);
  const xs = byCik.get(r.cik) ?? []; xs.push({ ...r, itemList: items }); byCik.set(r.cik, xs);
}
const end = t0(built);
const inWindow = (r) => t0(r.filed) <= end && t0(r.filed) >= end - WINDOW * DAY;
const win = (cik) => byCik.get(cik).filter(inWindow).sort(newestFirst);

// ── company pages ───────────────────────────────────────────────────────────────────────────
function section(html) {
  const i = html.indexOf("data-company-events");
  if (i < 0) return null;
  const start = html.lastIndexOf("<section", i), end2 = html.indexOf("</section>", i);
  const body = html.slice(start, end2);
  return { tag: body.slice(0, body.indexOf(">") + 1), body };
}
const ciks = [...byCik.keys()];
const pick = new Set();
const addp = (c) => { if (c) pick.add(c); };
const withWin = ciks.filter((c) => win(c).length > 0);
addp([...withWin].sort((a, b) => win(b).length - win(a).length)[0]);
addp([...withWin].sort((a, b) => win(a).length - win(b).length)[0]);
addp(withWin.find((c) => win(c).some((r) => r.form === "8-K/A")));
addp(withWin.find((c) => win(c).length > ROWS));
const onlyOld = ciks.find((c) => win(c).length === 0);
for (let i = 0; pick.size < Math.max(SAMPLE, 4) && i < withWin.length; i += Math.max(1, Math.floor(withWin.length / SAMPLE))) addp(withWin[i]);

const topItems = (rows) => {
  const by = new Map();
  for (const r of rows) for (const i of r.itemList) by.set(i, (by.get(i) ?? 0) + 1);
  return [...by].filter(([i]) => i !== "9.01").sort((a, b) => b[1] - a[1] || itemKey(a[0]).localeCompare(itemKey(b[0])));
};
function compare(where, sec, cik) {
  const rows = win(cik);
  ok(attr(sec.tag, "data-cik") === cik, `${where}: the section is for ${attr(sec.tag, "data-cik")}`);
  ok(Number(attr(sec.tag, "data-reports")) === rows.length, `${where}: section says ${attr(sec.tag, "data-reports")} reports, the file has ${rows.length} in the window`);
  ok(Number(attr(sec.tag, "data-amendments")) === rows.filter((r) => r.form === "8-K/A").length, `${where}: amendments ${attr(sec.tag, "data-amendments")}`);
  const trs = [...sec.body.matchAll(/<tr[^>]*data-event="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)];
  const want = rows.slice(0, ROWS);
  ok(trs.length === want.length, `${where}: ${trs.length} rows, expected ${want.length}`);
  want.forEach((r, i) => {
    const m = trs[i]; if (!m) return;
    ok(m[1] === r.accession, `${where} row ${i + 1}: ${m[1]}, the file says ${r.accession}`);
    const cells = [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
    ok(text(cells[0]?.[2] ?? "") === longShort(r.filed), `${where} ${r.accession}: filed "${text(cells[0]?.[2] ?? "")}"`);
    ok(text(cells[1]?.[2] ?? "") === (r.event_date ? longShort(r.event_date) : "—"), `${where} ${r.accession}: event date "${text(cells[1]?.[2] ?? "")}"`);
    ok(text(cells[2]?.[2] ?? "").startsWith(r.form) && (r.form === "8-K/A") === /amendment/.test(cells[2]?.[2] ?? ""), `${where} ${r.accession}: form cell "${text(cells[2]?.[2] ?? "")}"`);
    const spans = [...(cells[3]?.[2] ?? "").matchAll(/<span[^>]*data-item="([^"]+)"[^>]*>([\s\S]*?)<\/span>/g)];
    ok(spans.map((s) => s[1]).join() === r.itemList.join(), `${where} ${r.accession}: items ${spans.map((s) => s[1]).join()} against ${r.itemList.join()}`);
    spans.forEach((s) => { ok(text(s[2]) === (HEAD[s[1]] ? `${s[1]} ${HEAD[s[1]]}` : text(s[2])) , `${where} ${r.accession}: item label "${text(s[2])}"`); ok((s[1] === "9.01") === /ev-soft/.test(s[0]), `${where} ${r.accession}: soft ink on ${s[1]}`); });
    const href = (cells[4]?.[2] ?? "").match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    ok(href === (r.source_url || undefined), `${where} ${r.accession}: report link ${href} against ${r.source_url}`);
  });
  ok(rows.length > ROWS ? /data-ev-more/.test(sec.body) : !/data-ev-more/.test(sec.body), `${where}: the "newest ${ROWS}" note is wrong for ${rows.length} reports`);
  // The folded table of reports by item.
  const byItem = new Map(); for (const r of rows) for (const i of r.itemList) byItem.set(i, (byItem.get(i) ?? 0) + 1);
  const tbl = [...sec.body.matchAll(/<tr[^>]*data-item="([^"]+)"[^>]*><td[^>]*>[^<]*<\/td><td[^>]*>[^<]*<\/td><td[^>]*data-count[^>]*>(\d+)<\/td>/g)].map((m) => [m[1], Number(m[2])]);
  ok(tbl.length === byItem.size && tbl.every(([i, n]) => byItem.get(i) === n), `${where}: the table of reports by item does not match the file's recount`);
  ok(/<details[^>]*data-ev-by-item/.test(sec.body), `${where}: the by-item table is not folded`);
  // The sentence.
  const sent = text((sec.body.match(/<p[^>]*data-ev-summary[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
  ok(sent.includes(`${rows.length.toLocaleString("en-US")} Form 8-K report${rows.length === 1 ? "" : "s"} in the last 12 months`), `${where}: summary "${sent.slice(0, 90)}"`);
  const tops = topItems(rows).slice(0, 3);
  for (const [i, n] of tops) ok(sent.includes(`${i} ${HEAD[i] ?? ""}`.trim()) && sent.includes(`(${n} report${n === 1 ? "" : "s"})`), `${where}: summary lacks ${i} (${n})`);
  ok(!/9\.01 Financial/.test(sent), `${where}: 9.01 in the top items`);
  const words = text(sec.body);
  ok(/does not read or summarise/.test(words), `${where}: the caveat is missing`);
  ok(!sentenceOfWords.test(words), `${where}: timing, news or advice wording`);
  { const m = sec.body.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/(^|\s)—(?=\s|$)/g, " ").match(/.{0,30}[—–].{0,30}/); ok(!m, `${where}: a dash used as punctuation: "${m?.[0]}"`); }
  ok(sec.body.includes(`/downloads/${FILE}`), `${where}: no link to the file`);
}
let pages = 0, stockPages = 0;
for (const cik of pick) {
  const rows = byCik.get(cik);
  const path = new URL(rows[0].page_url).pathname;
  const page = await get(path);
  ok(page.status === 200, `${path} answers ${page.status}`);
  const sec = section(page.text);
  ok(!!sec, `${path}: no events section, ${win(cik).length} reports in the window`);
  if (!sec) continue;
  pages++;
  ok(page.text.includes('href="#company-events"'), `${path}: no glance tile link to the section`);
  compare(path, sec, cik);
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
let old = 0;
if (onlyOld) {
  const path = new URL(byCik.get(onlyOld)[0].page_url).pathname;
  const p = await get(path);
  old++;
  ok(!p.text.includes("data-company-events") && !p.text.includes('href="#company-events"'), `${path}: a section, and no report in the last 12 months`);
}

// ── the hub ─────────────────────────────────────────────────────────────────────────────────
const hub = await get("/company-events/");
ok(hub.status === 200, `/company-events/ answers ${hub.status}`);
const want365 = csv.rows.filter(inWindow).sort(newestFirst);
ok(hubData.rows.length === want365.length, `data file has ${hubData.rows.length} rows, the file has ${want365.length} in 365 days`);
ok(hubData.rows.map((r) => r[5]).sort().join() === want365.map((r) => r.accession).sort().join(), "data file and CSV file hold different reports");
const dsize = (await get("/data/company-events.json")).text.length;
ok(dsize < 1_500_000, `data file is ${dsize} bytes`);
const comps = hubData.companies;
for (const r of hubData.rows) {
  const c = comps[r[0]]; const csvRow = csv.rows.find((x) => x.accession === r[5]);
  if (!csvRow) { ok(false, `data row ${r[5]} not in the CSV`); continue; }
  ok(csvRow.cik === c[3] && csvRow.filed === r[1] && (csvRow.event_date === (r[2] || "")) && (csvRow.form === "8-K/A") === (r[3] === 1) && csvRow.items === r[4].split(" ").filter(Boolean).join("; "), `data row ${r[5]} differs from the CSV`);
}
const hubTrs = [...hub.text.matchAll(/<tr[^>]*data-event="([^"]+)"/g)].map((m) => m[1]);
const first30 = csv.rows.filter((r) => t0(r.filed) <= end && t0(r.filed) >= end - 30 * DAY).sort(newestFirst);
ok(hubTrs.join() === first30.slice(0, HUB_FIRST).map((r) => r.accession).join(), `the hub prints ${hubTrs.length} rows: ${hubTrs.slice(0, 3).join(" ")} ..., expected ${first30.slice(0, HUB_FIRST).length} of ${first30.length} in 30 days`);
ok(/data-evhub/.test(hub.text) && /data-ev="item"/.test(hub.text), "the hub has no controls");
const opts = [...hub.text.matchAll(/<option value="(\d{1,2}\.\d{2})"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
const cnt = new Map(); for (const r of want365) for (const i of r.itemList ?? (r.items ? r.items.split("; ") : [])) cnt.set(i, (cnt.get(i) ?? 0) + 1);
ok(opts.length === cnt.size && opts.every(([i, label]) => label.includes(`(${cnt.get(i)})`)), `the item options do not match the recount (${opts.length} against ${cnt.size})`);
const hubWords = text(hub.text);
ok(!sentenceOfWords.test(hubWords), "hub: timing, news or advice wording");
const sm = await get("/sitemaps/pages.xml");
ok(sm.text.includes("/company-events/"), "the hub is not in the pages sitemap");
const llms = await get("/llms.txt");
ok(llms.text.includes("/company-events/"), "llms.txt does not name the hub");
const meth = await get("/methodology/");
ok(/id="company-events"/.test(meth.text), "methodology has no #company-events paragraph");
const guide = await get("/guides/form-8-k-company-events/");
ok(guide.status === 200 && /four business days/.test(guide.text), "the guide is missing or does not state the deadline");
const dl = await get("/downloads/");
ok(dl.text.includes(`/downloads/${FILE}`) && /data-dict="events"/.test(dl.text), "the downloads page does not list the file and its columns");
// An insider page carries no events section.
const insiderLink = [...(await get("/insiders/")).text.matchAll(/href="(\/insiders\/[a-z0-9-]+\/)"/g)].map((m) => m[1])[0];
if (insiderLink) ok(!(await get(insiderLink)).text.includes("data-company-events"), `${insiderLink}: an events section on an insider page`);

// ── in a browser, when there is one ─────────────────────────────────────────────────────────
let browserChecks = "no browser";
try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/company-events/", { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-evhub]")?.dataset.ready != null);
  const state = () => page.evaluate(() => { const r = document.querySelector("[data-evhub]"); return { shown: Number(r.dataset.shown), companies: Number(r.dataset.companies), pages: Number(r.dataset.pages), page: Number(r.dataset.page), rows: [...r.querySelectorAll("tbody tr")].map((tr) => tr.dataset.event) }; });
  const oracle = (f) => csv.rows.filter((r) => t0(r.filed) <= end && t0(r.filed) >= end - (f.w ?? 30) * DAY)
    .filter((r) => !f.item || (r.items ? r.items.split("; ") : []).includes(f.item))
    .filter((r) => !f.form || (f.form === "amendment") === (r.form === "8-K/A"))
    .filter((r) => !f.division || divisionOf(r.cik) === f.division)
    .filter((r) => !f.q || `${r.company} ${r.ticker}`.toLowerCase().includes(f.q.toLowerCase()));
  const divisionOf = (cik) => { const k = hubData.companies.find((c) => c[3] === cik); return k && k[4] >= 0 ? hubData.divisions[k[4]].slug : null; };
  let views = 0;
  const tryView = async (f, label) => {
    const set = async (sel, v) => { await page.selectOption(`[data-ev="${sel}"]`, String(v)); };
    await page.click('[data-ev="reset"]', { timeout: 500 }).catch(() => {});
    await set("w", f.w ?? 30);
    if (f.item) await set("item", f.item);
    if (f.division) await set("division", f.division);
    if (f.form) await set("form", f.form);
    if (f.q) await page.fill('[data-ev="q"]', f.q);
    const want = oracle(f), s = await state();
    ok(s.shown === want.length, `hub ${label}: ${s.shown} reports on screen, the CSV recount says ${want.length}`);
    ok(s.companies === new Set(want.map((r) => r.cik)).size, `hub ${label}: ${s.companies} companies, expected ${new Set(want.map((r) => r.cik)).size}`);
    const top = want.sort(newestFirst).slice(0, 50).map((r) => r.accession);
    ok(s.rows.join() === top.join(), `hub ${label}: the rows on screen differ from the recount's first page`);
    views++;
  };
  for (const w of [7, 30, 90, 365]) await tryView({ w }, `window ${w}`);
  for (const [i] of opts) await tryView({ w: 365, item: i }, `item ${i}`);
  for (const d of hubData.divisions) await tryView({ w: 365, division: d.slug }, `division ${d.slug}`);
  await tryView({ w: 365, form: "amendment" }, "amendments");
  await tryView({ w: 365, form: "report" }, "reports");
  await tryView({ w: 365, q: "zzzz" }, "no match");
  ok(await page.locator('[data-ev="empty"]').isVisible(), "hub: the empty state is not shown for no match");
  await tryView({ w: 365, item: opts[0]?.[0], form: "report" }, "combined");
  // The address and a reload.
  const hash = await page.evaluate(() => location.hash);
  ok(/item=/.test(hash) && /w=365/.test(hash) && /form=report/.test(hash), `hub: address "${hash}" lacks the filters`);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-evhub]")?.dataset.ready != null);
  const after = await state();
  ok(after.shown === oracle({ w: 365, item: opts[0]?.[0], form: "report" }).length, "hub: a reload of a filtered address shows another count");
  await page.click('[data-ev="reset"]');
  ok((await page.evaluate(() => location.hash)) === "" , "hub: Reset leaves a hash");
  // Sorting by company, then back.
  await page.selectOption('[data-ev="w"]', "365");
  await page.click('th[data-sort="company"] button');
  const names = await page.evaluate(() => [...document.querySelectorAll("[data-evhub] tbody tr td:nth-child(2) a")].map((a) => a.textContent.trim().toLowerCase()));
  ok(names.join() === [...names].sort().join(), "hub: sorting by company is not in order");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/company-events/", { waitUntil: "load" });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "hub: the page runs off the side at 390 px");
  ok(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  await browser.close();
  browserChecks = `${views} filtered views`;
} catch (e) {
  if (/ERR_MODULE_NOT_FOUND|Cannot find package|Executable doesn.t exist/.test(String(e))) browserChecks = "no browser (playwright missing)";
  else { ok(false, `browser checks crashed: ${e}`); browserChecks = "crashed"; }
}

console.log(failures
  ? `verify-events: ${failures} of ${checks} checks failed`
  : `verify-events: ${checks} checks pass on ${pages} company pages and ${stockPages} stock pages (${csv.rows.length} reports for ${byCik.size} companies, ${amendments} amendments, ${want365.length} in the last 12 months; hub ${hubTrs.length} rows printed; ${old} company with reports only before the window has no section; browser: ${browserChecks})`);
process.exit(failures ? 1 : 0);
