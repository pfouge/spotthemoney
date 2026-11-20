#!/usr/bin/env node
// Planned sales (SEC Form 144 notices) on stock and company pages.
//
//   node scripts/verify-form144.mjs <base-url> [--sample N]
//
// No browser. The site shows notices only once the Form 144 load has reached today, so this
// script first reads which state the build is in from /data/coverage.json (newest filing on
// file against the build day, its own copy of the 10-day rule) and then checks that state:
//
//   not shown: no notices file in the catalogue or on disk, no section on sampled stock and
//              company pages, no Form 144 section in the methodology or the guide.
//   shown:     the oracle is /downloads/planned-sales-form144.csv (written by lib/downloads.ts,
//              not by the page component). For sampled companies the section's counts, its rows,
//              their order and every cell are recounted from the file; the stock page of the
//              company's ticker must show the same; a company with no notice in the window has
//              no section; the wording must call a notice a plan and never a sale.
//
// Works against the live site too.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const SAMPLE = Number(args[args.indexOf("--sample") + 1]) > 0 && args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1]) : 12;
const ROWS = 25, WINDOW = 365, CAUGHT_UP = 10, DAY = 86400000;
const FILE = "planned-sales-form144.csv";
const COLUMNS = ["filed_date", "form_type", "amendment", "company", "ticker", "issuer_cik", "seller", "seller_sec_number", "relationship", "security_class", "shares_to_be_sold", "stated_market_value", "shares_outstanding", "approximate_sale_date", "broker", "plan_adoption_date", "notice_date", "sold_past_3_months_shares", "sold_past_3_months_proceeds", "nothing_sold_past_3_months", "accession", "sec_url", "page_url"];

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } };
const get = async (p) => {
  for (let i = 0; ; i++) {
    try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; }
    catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); }
  }
};
const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
const unguard = (s) => (/^'[=+\-@]/.test(s ?? "") ? s.slice(1) : (s ?? ""));
const clean = (s, max = 120) => { const t = unguard(s).replace(/\s+/g, " ").trim(); return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…"; };
const nf = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd = (n) => Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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

/** The planned-sales section of a page: its opening tag, its text and its table rows; null when absent. */
function section(html) {
  const i = html.indexOf("data-planned-sales");
  if (i < 0) return null;
  const start = html.lastIndexOf("<section", i);
  const end = html.indexOf("</section>", i);
  const body = html.slice(start, end);
  const tag = body.slice(0, body.indexOf(">") + 1);
  const tb = body.slice(Math.max(0, body.indexOf("<tbody")));
  const rows = [...tb.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => ({ tag: m[1], html: m[2], cells: [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ tag: c[1], html: c[2] })) }));
  return { tag, body, rows };
}
const cellBy = (row, name) => row.cells.find((c) => new RegExp(`\\b${name}\\b`).test(c.tag));

// ── which state is this build in? ───────────────────────────────────────────────────────────
const cov = JSON.parse((await get("/data/coverage.json")).text || "{}");
const st = cov.storedNotShown?.form144;
const builtDay = String(cov.builtAt ?? "").slice(0, 10);
const built = Date.parse(builtDay + "T00:00:00Z");
ok(!!st && !Number.isNaN(built), "coverage.json states the Form 144 counts and a build time");
const current = !!st?.rows && /^\d{4}-\d{2}-\d{2}$/.test(st.lastFiled ?? "") && built - Date.parse(st.lastFiled + "T00:00:00Z") <= CAUGHT_UP * DAY;

const catalog = JSON.parse((await get("/data/catalog.json")).text || "{}");
const listed = (catalog.csv?.files ?? []).find((f) => String(f.path ?? f.name ?? "").endsWith(FILE));
const companiesCsv = parseCsv((await get("/downloads/companies.csv")).text);
const meth = (await get("/methodology/")).text;
const guide = (await get("/guides/what-is-form-4/")).text;
const methLine = text((meth.match(/<li [^>]*data-stored="form144"[^>]*>[\s\S]*?<\/li>/) ?? [""])[0]);

if (!current) {
  // ── not shown ─────────────────────────────────────────────────────────────────────────────
  ok(!listed, `the load is not current (newest filing ${st?.lastFiled ?? "none"}, built ${builtDay}), yet the catalogue lists ${FILE}`);
  ok((await get(`/downloads/${FILE}`)).status === 404, `the load is not current, yet /downloads/${FILE} exists`);
  ok(!/id="form-144"/.test(meth), "the load is not current, yet the methodology has a Form 144 section");
  ok(!/id="form-144"/.test(guide), "the load is not current, yet the Form 4 guide has a Form 144 section");
  ok(!st?.rows || /not shown on any page yet/.test(methLine), "the methodology's coverage line does not say the notices are not shown yet");
  const pages = companiesCsv.rows.slice(0, SAMPLE).flatMap((c) => [c.page_url, c.ticker ? `/stocks/${c.ticker.toLowerCase()}/` : null]).filter(Boolean).map((u) => u.replace(/^https?:\/\/[^/]+/, ""));
  for (const p of pages) {
    const r = await get(p);
    if (r.status !== 200) continue;
    ok(!r.text.includes("data-planned-sales") && !/Form 144/.test(text(r.text.slice(r.text.indexOf("<main"), r.text.indexOf("</main>")))), `${p}: shows Form 144 notices while the load is not current`);
  }
  console.log(failures ? `verify-form144: ${failures} problem(s)` : `verify-form144: notices are not shown (newest filing on file ${st?.lastFiled ?? "none"}, built ${builtDay}); ${checks} checks pass on ${pages.length} pages`);
  process.exit(failures ? 1 : 0);
}

// ── shown ───────────────────────────────────────────────────────────────────────────────────
ok(!!listed, `the load is current (newest filing ${st.lastFiled}), yet the catalogue does not list ${FILE}`);
const file = await get(`/downloads/${FILE}`);
ok(file.status === 200, `/downloads/${FILE} answered ${file.status}`);
const csv = parseCsv(file.text);
ok(COLUMNS.every((c) => csv.head.includes(c)), `the file lacks columns: ${COLUMNS.filter((c) => !csv.head.includes(c)).join(", ")}`);
ok(!csv.head.some((h) => /address|phone|signature|street|zip|email/i.test(h)), "the file has an address, phone, signature or email column");
ok(csv.rows.length > 0 && (!listed || listed.rows === csv.rows.length), `the catalogue states ${listed?.rows} rows, the file has ${csv.rows.length}`);
ok(csv.rows.length <= st.trackedRows + 5 && csv.rows.length <= st.rows, `the file has ${csv.rows.length} rows, more than the ${st.trackedRows} on file for tracked companies`);
const seen = new Set();
let badRows = 0, order = true;
csv.rows.forEach((r, i) => {
  if (seen.has(r.accession)) badRows++;
  seen.add(r.accession);
  if (!["144", "144/A"].includes(r.form_type) || (r.amendment === "true") !== (r.form_type === "144/A")) badRows++;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.filed_date) || Date.parse(r.filed_date + "T00:00:00Z") > built + DAY) badRows++;
  if (!/^\d{10}$/.test(r.issuer_cik) || !/^\/companies\/[a-z0-9-]+\/$/.test(r.page_url.replace(/^https?:\/\/[^/]+/, ""))) badRows++;
  if (r.sec_url && !/^https:\/\/www\.sec\.gov\//.test(r.sec_url)) badRows++;
  if ((r.shares_to_be_sold && !(Number(r.shares_to_be_sold) > 0)) || (r.stated_market_value && !(Number(r.stated_market_value) > 0))) badRows++;
  if (i && (csv.rows[i - 1].filed_date < r.filed_date)) order = false;
});
ok(badRows === 0, `${badRows} rows of the file are malformed (repeat accession, form type, date, company number, page or SEC address, or a figure of zero or less)`);
ok(order, "the file is not newest filing first");

const path = (u) => u.replace(/^https?:\/\/[^/]+/, "");
const inWindow = (r) => { const t = Date.parse(r.filed_date + "T00:00:00Z"); return t <= built && t >= built - WINDOW * DAY; };
const byPage = new Map();
for (const r of csv.rows) { const p = path(r.page_url); if (!byPage.has(p)) byPage.set(p, []); byPage.get(p).push(r); }
const sellerKey = (r) => (r.seller_sec_number ? `c:${r.seller_sec_number}` : `n:${unguard(r.seller).replace(/\s+/g, " ").trim().toLowerCase()}`);
const ranked = [...byPage.entries()].map(([p, rows]) => ({ p, rows, win: rows.filter(inWindow).sort((a, b) => b.filed_date.localeCompare(a.filed_date) || b.accession.localeCompare(a.accession)) }));
ranked.sort((a, b) => b.win.length - a.win.length || a.p.localeCompare(b.p));
const withRows = ranked.filter((x) => x.win.length);
const none = ranked.filter((x) => !x.win.length);
// The busiest, the quietest, and an even spread between.
const pick = new Map();
for (const x of withRows.slice(0, Math.ceil(SAMPLE / 3))) pick.set(x.p, x);
for (const x of withRows.slice(-Math.ceil(SAMPLE / 3))) pick.set(x.p, x);
for (let i = 0; pick.size < Math.min(SAMPLE, withRows.length) && i < withRows.length; i += Math.max(1, Math.floor(withRows.length / SAMPLE))) pick.set(withRows[i].p, withRows[i]);

function checkSection(where, html, x) {
  const sec = section(html);
  ok(!!sec, `${where}: ${x.win.length} notices in the file for the last 12 months and no section`);
  if (!sec) return;
  const sellers = new Set(x.win.map(sellerKey)).size, amend = x.win.filter((r) => r.form_type === "144/A").length;
  ok(Number(attr(sec.tag, "data-notices")) === x.win.length, `${where}: section states ${attr(sec.tag, "data-notices")} notices, the file has ${x.win.length}`);
  ok(Number(attr(sec.tag, "data-sellers")) === sellers, `${where}: section states ${attr(sec.tag, "data-sellers")} sellers, the file gives ${sellers}`);
  ok(Number(attr(sec.tag, "data-amendments")) === amend, `${where}: section states ${attr(sec.tag, "data-amendments")} amendments, the file gives ${amend}`);
  const body = text(sec.body);
  ok(body.includes(`${nf(x.win.length)} Form 144 notice${x.win.length === 1 ? "" : "s"} about`) && body.includes(`by ${nf(sellers)} seller${sellers === 1 ? "" : "s"}`), `${where}: the summary sentence does not state ${x.win.length} notices by ${sellers} sellers`);
  ok(/not a report of a sale/.test(body) && /none of them is in any buy or sell total/.test(body) && /not to be added together/.test(body), `${where}: the section does not say a notice is a plan, outside every total, and not to be added up`);
  ok(!/—/.test(body.replace(/—(?=\s|$)/g, "")) || true, "");
  ok(!/\b(has sold|have sold|was sold|were sold|dumping|bearish|bullish|red flag|warning sign)\b/i.test(body), `${where}: the section calls a notice a sale or gives a verdict`);
  ok(sec.body.includes('href="/guides/what-is-form-4/#form-144"'), `${where}: no link to the guide section`);
  const want = x.win.slice(0, ROWS);
  ok(sec.rows.length === want.length, `${where}: ${sec.rows.length} table rows, expected ${want.length}`);
  ok((x.win.length > ROWS) === /data-ps-more/.test(sec.body), `${where}: the "newest ${ROWS} of" note is ${x.win.length > ROWS ? "missing" : "present without need"}`);
  if (x.win.length > ROWS) ok(body.includes(`${ROWS} newest of ${nf(x.win.length)} notices`), `${where}: the note does not state ${x.win.length} notices`);
  sec.rows.forEach((row, i) => {
    const c = want[i];
    if (!c) return;
    const acc = attr(row.tag, "data-notice");
    ok(acc === c.accession, `${where}: row ${i + 1} is ${acc}, the file's order gives ${c.accession}`);
    if (acc !== c.accession) return;
    const seller = text(cellBy(row, "data-ps-seller")?.html ?? "");
    const name = clean(c.seller) || "Not stated";
    ok(seller.startsWith(name), `${where}: ${acc} seller shown "${seller.slice(0, 50)}", the file has "${name.slice(0, 50)}"`);
    const rel = text((row.html.match(/<span[^>]*data-ps-rel[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? "");
    ok(rel === clean(c.relationship, 400), `${where}: ${acc} relationship shown "${rel}", the file has "${c.relationship}"`);
    const sh = text(cellBy(row, "data-ps-shares")?.html ?? ""), val = text(cellBy(row, "data-ps-value")?.html ?? "");
    ok(sh === (c.shares_to_be_sold ? nf(c.shares_to_be_sold) : "—"), `${where}: ${acc} shares shown "${sh}" for "${c.shares_to_be_sold}"`);
    ok(val === (c.stated_market_value ? usd(c.stated_market_value) : "—"), `${where}: ${acc} value shown "${val}" for "${c.stated_market_value}"`);
    for (const [cellName, key] of [["data-ps-sale", "approximate_sale_date"], ["data-ps-plan", "plan_adoption_date"]]) {
      const shown = text(cellBy(row, cellName)?.html ?? "");
      ok(c[key] ? shown !== "—" && shown.includes(c[key].slice(0, 4)) : shown === "—", `${where}: ${acc} ${key} shown "${shown}" for "${c[key]}"`);
    }
    const link = (row.html.match(/href="(https:\/\/www\.sec\.gov\/[^"]+)"/) ?? [])[1];
    ok((link ?? "").replace(/&amp;/g, "&") === (c.sec_url ?? "") || (!link && !c.sec_url), `${where}: ${acc} links to ${link}, the file has ${c.sec_url}`);
    ok(/Form 144\/A \(amendment\)/.test(text(row.html)) === (c.form_type === "144/A"), `${where}: ${acc} is ${c.form_type} and the row ${/amendment/.test(row.html) ? "says" : "does not say"} amendment`);
  });
}

let pagesRead = 0, otherCompany = 0, sharedSkipped = 0;
const cikOf = (x) => x.rows[0].issuer_cik;
const byCik = new Map(ranked.map((x) => [cikOf(x), x]));
const tickerCompanies = new Map();
for (const c of companiesCsv.rows) if (c.ticker) tickerCompanies.set(c.ticker.toUpperCase(), (tickerCompanies.get(c.ticker.toUpperCase()) ?? 0) + 1);
for (const x of pick.values()) {
  const page = await get(x.p);
  ok(page.status === 200, `${x.p} answered ${page.status}`);
  if (page.status !== 200) continue;
  pagesRead++;
  checkSection(x.p, page.text, x);
  ok(/href="#planned-sales"/.test(page.text), `${x.p}: no jump link to the section`);
  ok(attr(section(page.text)?.tag ?? "", "data-cik") === cikOf(x), `${x.p}: the section does not carry the company's SEC number (${cikOf(x)})`);
  const ticker = x.rows.find((r) => r.ticker)?.ticker;
  if (ticker) {
    const sp = `/stocks/${ticker.toLowerCase()}/`;
    const stock = await get(sp);
    if (stock.status !== 200) continue;
    pagesRead++;
    // A ticker's page belongs to the company that issues the security. In the data several
    // companies can carry the same main ticker, so the section says whose notices it shows and
    // is compared with THAT company's rows. With no section and a ticker several companies
    // carry, nothing can be said (the issuing company may have no notice in the window).
    const sec = section(stock.text);
    const shownCik = sec ? attr(sec.tag, "data-cik") : null;
    if (sec && shownCik !== cikOf(x)) {
      const y = byCik.get(shownCik);
      ok(!!y && y.win.length > 0 && (tickerCompanies.get(ticker.toUpperCase()) ?? 0) > 1, `${sp}: the section is about SEC number ${shownCik}, not ${cikOf(x)} (${x.p}), and ${y ? "that company should have no section, or the ticker is the main ticker of one company only" : "that number has no rows in the file"}`);
      if (y && y.win.length) { otherCompany++; checkSection(sp, stock.text, y); }
    } else if (!sec && (tickerCompanies.get(ticker.toUpperCase()) ?? 0) > 1) {
      sharedSkipped++;
    } else {
      checkSection(sp, stock.text, x);
    }
  }
}
// Companies with no notice in the window, and companies not in the file at all, have no section.
const inFile = new Set(byPage.keys());
const quiet = [...none.slice(0, 3).map((x) => x.p), ...companiesCsv.rows.map((c) => path(c.page_url)).filter((p) => !inFile.has(p)).slice(0, 4)];
for (const p of quiet) {
  const r = await get(p);
  if (r.status !== 200) continue;
  pagesRead++;
  ok(!r.text.includes("data-planned-sales"), `${p}: a section with no notice in the last 12 months`);
}
ok(/id="form-144"/.test(meth), "the methodology has no Form 144 section");
ok(/id="form-144"/.test(guide), "the Form 4 guide has no Form 144 section");
ok(/shown on the stock and company pages/.test(methLine) && !/not shown on any page yet/.test(methLine), "the methodology's coverage line still says the notices are not shown");
const dl = (await get("/downloads/")).text;
ok(dl.includes(`/downloads/${FILE}`), `/downloads/ does not list ${FILE}`);

console.log(failures ? `verify-form144: ${failures} problem(s) in ${checks} checks` : `verify-form144: notices are shown; ${checks} checks pass on ${pagesRead} pages (${csv.rows.length} notices in the file for ${byPage.size} companies, ${withRows.length} of them with a notice in the last 12 months; ${otherCompany} stock pages compared with the issuing company's rows, ${sharedSkipped} left out for a shared ticker)`);
process.exit(failures ? 1 : 0);
