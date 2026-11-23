#!/usr/bin/env node
// Large holders (SEC Schedules 13D and 13G) on stock and company pages.
//
//   node scripts/verify-schedule13.mjs <base-url> [--sample N]
//
// No browser. The site shows statements only once the Schedule 13 load has reached today, so
// this script first reads which state the build is in from /data/coverage.json (newest filing on
// file against the build day, its own copy of the 10-day rule) and then checks that state:
//
//   not shown: no statements file in the catalogue or on disk, no section on sampled stock and
//              company pages, no Schedule 13 section in the methodology or the guide.
//   shown:     the oracle is /downloads/large-holders-13d-13g.csv (written by lib/downloads.ts,
//              not by the page component), which holds EVERY statement on record. For sampled
//              companies this script works out each holder's newest statement itself, and the
//              section's counts, its rows, their order and every cell must agree; the stock
//              page of the company's ticker must show the same; a company with no statement has
//              no section; the wording must state a holding and never a trade or a verdict.
//
// Works against the live site too.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const SAMPLE = Number(args[args.indexOf("--sample") + 1]) > 0 && args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1]) : 12;
const ROWS = 25, THRESHOLD = 5, CAUGHT_UP = 10, DAY = 86400000;
const FILE = "large-holders-13d-13g.csv";
const GUIDE = "/guides/ten-percent-owners-and-joint-filings/";
const FORMS = ["SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A"];
const COLUMNS = ["filed_date", "form_type", "schedule", "amendment", "company", "ticker", "issuer_cik", "holder", "holder_sec_number", "reporting_persons", "security_class", "cusip", "shares_stated", "percent_of_class", "event_date", "rules", "newest_for_holder", "purpose_as_filed", "accession", "sec_url", "page_url"];

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

/** The large-holders section of a page: its opening tag, its text and its table rows; null when absent. */
function section(html) {
  const i = html.indexOf("data-large-holders");
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
const span = (html, name) => text((html.match(new RegExp(`<span[^>]*${name}[^>]*>([\\s\\S]*?)<\\/span>`)) ?? [])[1] ?? "");
const withoutSpans = (html) => text(html.replace(/<span[\s\S]*?<\/span>/g, ""));

// ── which state is this build in? ───────────────────────────────────────────────────────────
const cov = JSON.parse((await get("/data/coverage.json")).text || "{}");
const st = cov.storedNotShown?.schedule13;
const builtDay = String(cov.builtAt ?? "").slice(0, 10);
const built = Date.parse(builtDay + "T00:00:00Z");
ok(!!st && !Number.isNaN(built), "coverage.json states the Schedule 13 counts and a build time");
const current = !!st?.rows && /^\d{4}-\d{2}-\d{2}$/.test(st.lastFiled ?? "") && built - Date.parse(st.lastFiled + "T00:00:00Z") <= CAUGHT_UP * DAY;

const catalog = JSON.parse((await get("/data/catalog.json")).text || "{}");
const listed = (catalog.csv?.files ?? []).find((f) => String(f.path ?? f.name ?? "").endsWith(FILE));
const companiesCsv = parseCsv((await get("/downloads/companies.csv")).text);
const meth = (await get("/methodology/")).text;
const guide = (await get(GUIDE)).text;
const methLine = text((meth.match(/<li [^>]*data-stored="schedule13"[^>]*>[\s\S]*?<\/li>/) ?? [""])[0]);
const path = (u) => u.replace(/^https?:\/\/[^/]+/, "");

if (!current) {
  // ── not shown ─────────────────────────────────────────────────────────────────────────────
  ok(!listed, `the load is not current (newest filing ${st?.lastFiled ?? "none"}, built ${builtDay}), yet the catalogue lists ${FILE}`);
  ok((await get(`/downloads/${FILE}`)).status === 404, `the load is not current, yet /downloads/${FILE} exists`);
  ok(!/id="schedule-13"/.test(meth), "the load is not current, yet the methodology has a Schedule 13 section");
  ok(!/id="large-holders"/.test(guide), "the load is not current, yet the guide has a large-holders section");
  ok(!st?.rows || /not shown on any page yet/.test(methLine), "the methodology's coverage line does not say the statements are not shown yet");
  const pages = companiesCsv.rows.slice(0, SAMPLE).flatMap((c) => [c.page_url, c.ticker ? `/stocks/${c.ticker.toLowerCase()}/` : null]).filter(Boolean).map(path);
  for (const p of pages) {
    const r = await get(p);
    if (r.status !== 200) continue;
    ok(!r.text.includes("data-large-holders") && !/Schedules? 13[DG]/.test(text(r.text.slice(r.text.indexOf("<main"), r.text.indexOf("</main>")))), `${p}: shows Schedule 13 statements while the load is not current`);
  }
  console.log(failures ? `verify-schedule13: ${failures} problem(s)` : `verify-schedule13: statements are not shown (newest filing on file ${st?.lastFiled ?? "none"}, built ${builtDay}); ${checks} checks pass on ${pages.length} pages`);
  process.exit(failures ? 1 : 0);
}

// ── shown ───────────────────────────────────────────────────────────────────────────────────
ok(!!listed, `the load is current (newest filing ${st.lastFiled}), yet the catalogue does not list ${FILE}`);
const file = await get(`/downloads/${FILE}`);
ok(file.status === 200, `/downloads/${FILE} answered ${file.status}`);
const csv = parseCsv(file.text);
ok(COLUMNS.every((c) => csv.head.includes(c)), `the file lacks columns: ${COLUMNS.filter((c) => !csv.head.includes(c)).join(", ")}`);
ok(!csv.head.some((h) => /address|phone|signature|street|zip|email|citizen|legal/i.test(h)), "the file has an address, phone, signature, email, citizenship or legal-proceedings column");
ok(csv.rows.length > 0 && (!listed || listed.rows === csv.rows.length), `the catalogue states ${listed?.rows} rows, the file has ${csv.rows.length}`);
ok(csv.rows.length <= st.trackedRows + 5 && csv.rows.length <= st.rows, `the file has ${csv.rows.length} rows, more than the ${st.trackedRows} on file for tracked companies`);
const seen = new Set();
let badRows = 0, order = true;
csv.rows.forEach((r, i) => {
  if (seen.has(r.accession)) badRows++;
  seen.add(r.accession);
  if (!FORMS.includes(r.form_type) || r.schedule !== r.form_type.slice(9, 12) || (r.amendment === "true") !== r.form_type.endsWith("/A")) badRows++;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.filed_date) || Date.parse(r.filed_date + "T00:00:00Z") > built + DAY) badRows++;
  if (!/^\d{10}$/.test(r.issuer_cik) || !/^\/(?:companies\/[a-z0-9-]+|stocks\/[a-z0-9._-]+)\/$/.test(path(r.page_url))) badRows++;
  if (r.sec_url && !/^https:\/\/www\.sec\.gov\//.test(r.sec_url)) badRows++;
  if ((r.shares_stated && !(Number(r.shares_stated) >= 0)) || (r.percent_of_class && !(Number(r.percent_of_class) >= 0 && Number(r.percent_of_class) <= 100))) badRows++;
  if (r.purpose_as_filed.length > 1000 || (r.purpose_as_filed && r.schedule !== "13D")) badRows++;
  if (!["true", "false"].includes(r.newest_for_holder)) badRows++;
  if (i && (csv.rows[i - 1].filed_date < r.filed_date)) order = false;
});
ok(badRows === 0, `${badRows} rows of the file are malformed (repeat accession, form type, date, company number, page or SEC address, a figure out of range, a purpose on a 13G or over 1,000 characters)`);
ok(order, "the file is not newest filing first");

// Each holder's newest statement per company, worked out here from the whole file.
const holderKey = (r) => (r.holder_sec_number ? `c:${r.holder_sec_number}` : `n:${unguard(r.holder).replace(/\s+/g, " ").trim().toLowerCase()}`);
const pctOf = (r) => (r.percent_of_class === "" ? -1 : Number(r.percent_of_class));
const shOf = (r) => (r.shares_stated === "" ? -1 : Number(r.shares_stated));
const byPage = new Map();
for (const r of csv.rows) { const p = path(r.page_url); if (!byPage.has(p)) byPage.set(p, []); byPage.get(p).push(r); }
let flagWrong = 0;
const ranked = [...byPage.entries()].map(([p, rows]) => {
  const sorted = rows.filter((r) => r.filed_date <= builtDay).sort((a, b) => b.filed_date.localeCompare(a.filed_date) || b.accession.localeCompare(a.accession));
  const by = new Map();
  for (const r of sorted) { const k = holderKey(r); const h = by.get(k); if (h) h.n++; else by.set(k, { r, n: 1 }); }
  const newest = new Set([...by.values()].map((h) => h.r.accession));
  for (const r of rows) if ((r.newest_for_holder === "true") !== newest.has(r.accession)) flagWrong++;
  const holders = [...by.values()].sort((a, b) => pctOf(b.r) - pctOf(a.r) || shOf(b.r) - shOf(a.r) || clean(a.r.holder, 200).localeCompare(clean(b.r.holder, 200)) || b.r.accession.localeCompare(a.r.accession));
  return { p, rows, holders };
});
ok(flagWrong === 0, `${flagWrong} rows of the file have a newest_for_holder value that a recount from the file does not give`);
ranked.sort((a, b) => b.holders.length - a.holders.length || a.p.localeCompare(b.p));
const withRows = ranked.filter((x) => x.holders.length);
const pick = new Map();
for (const x of withRows.slice(0, Math.ceil(SAMPLE / 3))) pick.set(x.p, x);
for (const x of withRows.slice(-Math.ceil(SAMPLE / 3))) pick.set(x.p, x);
for (let i = 0; pick.size < Math.min(SAMPLE, withRows.length) && i < withRows.length; i += Math.max(1, Math.floor(withRows.length / SAMPLE))) pick.set(withRows[i].p, withRows[i]);
// Always include a company with a holder under 5% and one with several statements by one holder, when the file has them.
for (const want of [(x) => x.holders.some((h) => pctOf(h.r) >= 0 && pctOf(h.r) < THRESHOLD), (x) => x.holders.some((h) => h.n > 1), (x) => x.holders.length > ROWS]) { const x = withRows.find(want); if (x) pick.set(x.p, x); }

const pctLabel = (v) => `${Number(Number(v).toFixed(2))}%`;
function checkSection(where, html, x) {
  const sec = section(html);
  ok(!!sec, `${where}: ${x.holders.length} holders in the file and no section`);
  if (!sec) return;
  const below = x.holders.filter((h) => pctOf(h.r) >= 0 && pctOf(h.r) < THRESHOLD).length, noPct = x.holders.filter((h) => pctOf(h.r) < 0).length;
  const above = x.holders.length - below - noPct, statements = x.holders.reduce((a, h) => a + h.n, 0);
  for (const [name, want] of [["data-holders", x.holders.length], ["data-at-or-above", above], ["data-below", below], ["data-no-percent", noPct], ["data-statements", statements]]) {
    ok(Number(attr(sec.tag, name)) === want, `${where}: section states ${name} ${attr(sec.tag, name)}, the file gives ${want}`);
  }
  const summary = text((sec.body.match(/<p[^>]*data-lh-summary[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
  const caveat = text((sec.body.match(/<p[^>]*data-lh-caveat[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
  ok(summary.startsWith(`${nf(x.holders.length)} holder${x.holders.length === 1 ? " has" : "s have"} filed an ownership statement`), `${where}: the summary sentence does not state ${x.holders.length} holders`);
  if (above) ok(new RegExp(`\\b${nf(above)} reports? ${THRESHOLD}% or more`).test(summary), `${where}: the summary does not state ${above} at ${THRESHOLD}% or more`);
  if (below) ok(new RegExp(`\\b${nf(below)} reports? less than ${THRESHOLD}%`).test(summary), `${where}: the summary does not state ${below} under ${THRESHOLD}%`);
  ok(above > 0 || !/or more of a class/.test(summary), `${where}: the summary speaks of holders at ${THRESHOLD}% or more and the file has none`);
  ok(/not a report of a trade/.test(caveat) && /may have changed since/.test(caveat) && /not to be added together/.test(caveat) && /not a full list of shareholders/.test(caveat) && /in any buy or sell total/.test(caveat), `${where}: the section does not say a statement is not a trade, can be out of date, is not to be added up, is not a full list and is outside every total`);
  ok(!/\b(has bought|has sold|is buying|is selling|accumulat\w*|dumping|activist|bullish|bearish|red flag|warning sign|signal)\b/i.test(summary + " " + caveat), `${where}: the section's wording states a trade or gives a verdict`);
  ok(!/—/.test(summary + caveat), `${where}: an em-dash in the section's sentences`);
  ok(sec.body.includes(`href="${GUIDE}#large-holders"`), `${where}: no link to the guide section`);
  const want = x.holders.slice(0, ROWS);
  ok(sec.rows.length === want.length, `${where}: ${sec.rows.length} table rows, expected ${want.length}`);
  ok((x.holders.length > ROWS) === /data-lh-more/.test(sec.body), `${where}: the "${ROWS} holders ... of" note is ${x.holders.length > ROWS ? "missing" : "present without need"}`);
  if (x.holders.length > ROWS) ok(text(sec.body).includes(`of ${nf(x.holders.length)}, are shown`), `${where}: the note does not state ${x.holders.length} holders`);
  sec.rows.forEach((row, i) => {
    const c = want[i]?.r;
    if (!c) return;
    const acc = attr(row.tag, "data-statement");
    ok(acc === c.accession, `${where}: row ${i + 1} is ${acc}, the file's newest statements in order give ${c.accession}`);
    if (acc !== c.accession) return;
    const hc = cellBy(row, "data-lh-holder")?.html ?? "";
    const name = clean(c.holder) || "Not stated";
    ok(withoutSpans(hc) === name, `${where}: ${acc} holder shown "${withoutSpans(hc).slice(0, 50)}", the file has "${name.slice(0, 50)}"`);
    const others = Number(c.reporting_persons) > 1 ? Number(c.reporting_persons) - 1 : 0;
    const oth = span(hc, "data-lh-others");
    ok(others ? oth === `with ${nf(others)} other reporting ${others === 1 ? "person" : "persons"}` : oth === "", `${where}: ${acc} shows "${oth}" for ${c.reporting_persons} reporting persons`);
    const pc = cellBy(row, "data-lh-percent")?.html ?? "";
    ok(withoutSpans(pc) === (c.percent_of_class === "" ? "—" : pctLabel(c.percent_of_class)), `${where}: ${acc} percent shown "${withoutSpans(pc)}" for "${c.percent_of_class}"`);
    const isBelow = c.percent_of_class !== "" && Number(c.percent_of_class) < THRESHOLD;
    ok((span(pc, "data-lh-below") === `below ${THRESHOLD}%`) === isBelow, `${where}: ${acc} with ${c.percent_of_class}% ${isBelow ? "lacks" : "carries"} the "below ${THRESHOLD}%" mark`);
    const sh = text(cellBy(row, "data-lh-shares")?.html ?? "");
    ok(sh === (c.shares_stated === "" ? "—" : nf(c.shares_stated)), `${where}: ${acc} shares shown "${sh}" for "${c.shares_stated}"`);
    for (const [cellName, key] of [["data-lh-event", "event_date"], ["data-lh-filed", "filed_date"]]) {
      const shown = text(cellBy(row, cellName)?.html ?? "");
      ok(c[key] ? shown !== "—" && shown.includes(c[key].slice(0, 4)) : shown === "—", `${where}: ${acc} ${key} shown "${shown}" for "${c[key]}"`);
    }
    const src = cellBy(row, "data-lh-source")?.html ?? "";
    const link = (src.match(/href="(https:\/\/www\.sec\.gov\/[^"]+)"/) ?? [])[1];
    ok((link ?? "").replace(/&amp;/g, "&") === (c.sec_url ?? "") || (!link && !c.sec_url), `${where}: ${acc} links to ${link}, the file has ${c.sec_url}`);
    ok(text(src).startsWith(`Schedule ${c.schedule}${c.amendment === "true" ? "/A (amendment)" : ""}`) && /amendment/.test(text(src)) === (c.amendment === "true"), `${where}: ${acc} is ${c.form_type} and the row reads "${text(src)}"`);
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
  ok(/href="#large-holders"/.test(page.text), `${x.p}: no jump link to the section`);
  ok(attr(section(page.text)?.tag ?? "", "data-cik") === cikOf(x), `${x.p}: the section does not carry the company's SEC number (${cikOf(x)})`);
  const ticker = x.rows.find((r) => r.ticker)?.ticker;
  if (ticker) {
    const sp = `/stocks/${ticker.toLowerCase()}/`;
    const stock = await get(sp);
    if (stock.status !== 200) continue;
    pagesRead++;
    // A ticker's page belongs to the company that issues the security. In the data several
    // companies can carry the same main ticker (a fund whose filings name its sponsor's symbol,
    // say), so the section says whose statements it shows and is compared with THAT company's
    // rows in the file. With no section and a ticker several companies carry, nothing can be said.
    const sec = section(stock.text);
    const shownCik = sec ? attr(sec.tag, "data-cik") : null;
    if (sec && shownCik !== cikOf(x)) {
      const y = byCik.get(shownCik);
      ok(!!y && (tickerCompanies.get(ticker.toUpperCase()) ?? 0) > 1, `${sp}: the section is about SEC number ${shownCik}, not ${cikOf(x)} (${x.p}), and ${y ? "the ticker is the main ticker of one company only" : "that number has no rows in the file"}`);
      if (y) { otherCompany++; checkSection(sp, stock.text, y); }
    } else if (!sec && (tickerCompanies.get(ticker.toUpperCase()) ?? 0) > 1) {
      sharedSkipped++;
    } else {
      checkSection(sp, stock.text, x);
    }
    if (sec) ok(/href="#large-holders"/.test(stock.text), `${sp}: no jump link to the section`);
  }
}
// Companies not in the file have no section.
const inFile = new Set(byPage.keys());
for (const p of companiesCsv.rows.map((c) => path(c.page_url)).filter((p) => !inFile.has(p)).slice(0, 5)) {
  const r = await get(p);
  if (r.status !== 200) continue;
  pagesRead++;
  ok(!r.text.includes("data-large-holders"), `${p}: a section with no statement in the file`);
}
ok(/id="schedule-13"/.test(meth), "the methodology has no Schedule 13 section");
ok(/id="large-holders"/.test(guide), "the guide has no large-holders section");
ok(/are shown on the stock and company pages/.test(methLine) && !/not shown on any page yet/.test(methLine), "the methodology's coverage line still says the statements are not shown");
const dl = (await get("/downloads/")).text;
ok(dl.includes(`/downloads/${FILE}`), `/downloads/ does not list ${FILE}`);


// HUB: /large-holders/ against the same CSV file (newest statement per holder and company), with this script's own copy of the rules.
{
  const HUB_PER = 50;
  const newest = csv.rows.filter((r) => r.newest_for_holder === "true" && r.filed_date <= builtDay);
  const hub = await get("/large-holders/");
  const hubData = await get("/data/large-holders.json");
  ok(hub.status === 200 && !/noindex/.test(hub.text), "HUB: /large-holders/ is indexable");
  let packed = null; try { packed = JSON.parse(hubData.text); } catch { /* reported below */ }
  ok(!!packed && Array.isArray(packed.rows), "HUB: /data/large-holders.json parses");
  if (packed) {
    ok(packed.rows.length === newest.length, `HUB: data file has ${packed.rows.length} holders, the CSV has ${newest.length} newest statements`);
    const byAcc = new Map(newest.map((r) => [r.accession, r]));
    let bad = 0;
    for (const r of packed.rows) {
      const c = byAcc.get(r[9]); if (!c) { bad++; continue; }
      if ((r[5] ?? null) !== (c.percent_of_class === "" ? null : Number(c.percent_of_class))) bad++;
      if ((r[6] ?? null) !== (c.shares_stated === "" ? null : Number(c.shares_stated))) bad++;
      if (r[3] !== c.schedule.slice(2)) bad++;
      if (r[8] !== c.filed_date) bad++;
    }
    ok(bad === 0, `HUB: ${bad} cells of the data file differ from the CSV`);
  }
  const order = [...newest].sort((a, b) => b.filed_date.localeCompare(a.filed_date) || clean(a.company, 200).localeCompare(clean(b.company, 200)) || (a.accession < b.accession ? 1 : -1));
  const trs = [...hub.text.slice(hub.text.indexOf("<tbody")).matchAll(/<tr[^>]*data-statement="([^"]*)"[^>]*>/g)].map((m) => m[1]);
  ok(trs.length === Math.min(HUB_PER, order.length), `HUB: ${trs.length} rows printed, expected ${Math.min(HUB_PER, order.length)}`);
  ok(trs.every((a, i) => a === order[i]?.accession), "HUB: the printed rows are the newest statements, newest filed first");
  const companies = new Set(newest.map((r) => r.issuer_cik)).size;
  const ht = text(hub.text);
  ok(ht.includes(`${nf(newest.length)} ${newest.length === 1 ? "holder" : "holders"} of ${nf(companies)} ${companies === 1 ? "company" : "companies"}`), `HUB: count line should state ${newest.length} holders of ${companies} companies`);
  const below = newest.filter((r) => r.percent_of_class !== "" && Number(r.percent_of_class) < 5).length;
  ok(below === 0 || /below 5%/.test(hub.text), "HUB: a statement under 5% is marked");
  ok(/not a report of a trade/i.test(ht) && /not to be added together/i.test(ht), "HUB: says a statement is not a trade and rows are not added");
  ok(!/total (shares|holding)|in total|combined holding of all/i.test(ht), "HUB: adds nothing up");
  ok(["q", "division", "schedule", "pct", "w"].every((k) => hub.text.includes(`data-hub-ctl="${k}"`)), "HUB: every filter control is on the page");
  ok(/data-hub="download"/.test(hub.text), "HUB: has the client-built download");
  ok((await get("/sitemaps/pages.xml")).text.includes("/large-holders/"), "HUB: in the sitemap");
  ok((await get("/llms.txt")).text.includes("/large-holders/"), "HUB: in llms.txt");
  ok((await get("/data/search.json")).text.includes("/large-holders/"), "HUB: in the search index");
  ok(/href="\/large-holders\/"/.test((await get("/")).text), "HUB: linked in the navigation");
  ok(/large-holders\/"/.test(meth), "HUB: the methodology mentions the hub");
}

const holdersAll = withRows.reduce((a, x) => a + x.holders.length, 0);
console.log(failures ? `verify-schedule13: ${failures} problem(s) in ${checks} checks` : `verify-schedule13: statements are shown; ${checks} checks pass on ${pagesRead} pages (${csv.rows.length} statements in the file for ${byPage.size} companies, ${holdersAll} holders by newest statement; ${otherCompany} stock pages compared with the issuing company's rows, ${sharedSkipped} left out for a shared ticker)`);
process.exit(failures ? 1 : 0);
