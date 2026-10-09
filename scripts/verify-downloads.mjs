#!/usr/bin/env node
// Checks the free CSV downloads (/downloads/, web/src/lib/downloads.ts) on a built or live site.
//   1. Every file the hub lists downloads, is real CSV (BOM, one header, same field count on
//      every line), has exactly the row count the hub states, and is under 20 MB.
//   2. Trade files all share one header; values are well-formed (dates, sources, true/false);
//      a congressional row has a range and no "value"; no cell can run as a spreadsheet formula;
//      no column carries donor or contact details.
//   3. The files agree with the pages: a member's file has as many rows as "Trades on record"
//      on the member's page and contains every row the page's table shows; a ticker file holds
//      only that ticker; congress-trades.csv = the sum of the members file; the quarterly
//      insider files add up to the count published in /llms.txt.
//   4. Each page that should offer a download does, and the link resolves.
//
//   node scripts/verify-downloads.mjs http://127.0.0.1:4321 [--sample 20]
//   node scripts/verify-downloads.mjs https://spotthemoney.com
// No browser needed.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleN = Number(args[args.indexOf("--sample") + 1]) || 20;
const MAX_BYTES = 20 * 1024 * 1024;
const failures = []; let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); return !!cond; };
// Decoded by hand: Response.text() silently drops the byte-order mark this script checks for.
const get = async (path) => { const r = await fetch(base + path); return { status: r.status, text: r.ok ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer()) : "" }; };
const int = (s) => Number(String(s ?? "").replace(/[^\d-]/g, "")) || 0;

function parseCsv(text) {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cache = new Map();
/** Download and check one CSV; returns { head, rows } (rows as objects) or null. */
async function csv(path, expectRows = null) {
  if (cache.has(path)) return cache.get(path);
  const r = await get(path);
  if (!ok(r.status === 200, `${path}: HTTP ${r.status}`)) { cache.set(path, null); return null; }
  ok(r.text.charCodeAt(0) === 0xfeff, `${path}: no UTF-8 byte-order mark`);
  ok(Buffer.byteLength(r.text) < MAX_BYTES, `${path}: ${(Buffer.byteLength(r.text) / 1048576).toFixed(1)} MB — over the 20 MB guard`);
  ok(!/<html|<!doctype/i.test(r.text.slice(0, 300)), `${path}: an HTML page came back instead of a CSV`);
  const table = parseCsv(r.text), head = table[0] ?? [], body = table.slice(1);
  ok(head.length >= 2 && new Set(head).size === head.length && head.every((h) => /^[a-z0-9_]+$/.test(h)), `${path}: bad header (${head.slice(0, 5).join(",")}…)`);
  const ragged = body.findIndex((x) => x.length !== head.length);
  ok(ragged < 0, `${path}: line ${ragged + 2} has ${body[ragged]?.length} fields, the header has ${head.length}`);
  if (expectRows != null) ok(body.length === expectRows, `${path}: ${body.length} rows, the page says ${expectRows}`);
  const risky = body.find((x) => x.some((c) => /^[=+@\t]/.test(c) || /^-(?![\d.]+$)/.test(c)));
  ok(!risky, `${path}: a cell could run as a formula: ${risky?.find((c) => /^[=+@\t-]/.test(c))}`);
  ok(!head.some((h) => /donor|contributor|email|phone|address|ssn/.test(h)), `${path}: a column that must never be published (${head.filter((h) => /donor|contributor|email|phone|address|ssn/.test(h))})`);
  const out = { head, rows: body.map((x) => Object.fromEntries(head.map((h, i) => [h, x[i]]))) };
  cache.set(path, out);
  return out;
}
let tradeHead = null;
function checkTrades(path, t) {
  if (!t) return;
  if (!tradeHead) tradeHead = t.head.join(",");
  ok(t.head.join(",") === tradeHead, `${path}: trade columns differ from the other trade files`);
  const bad = (pred) => t.rows.find(pred);
  let b;
  ok(!(b = bad((r) => !["House PTR", "Senate PTR", "SEC Form 4"].includes(r.source))), `${path}: unknown source "${b?.source}"`);
  ok(!(b = bad((r) => (r.trade_date && !DATE.test(r.trade_date)) || !DATE.test(r.disclosed_date))), `${path}: bad date on trade ${b?.trade_id}`);
  ok(!(b = bad((r) => r.trade_date && r.trade_date > r.disclosed_date)), `${path}: trade ${b?.trade_id} is dated after its report`);
  ok(!(b = bad((r) => !/^\d+$/.test(r.trade_id))), `${path}: bad trade_id "${b?.trade_id}"`);
  ok(new Set(t.rows.map((r) => r.trade_id)).size === t.rows.length, `${path}: a trade_id appears twice`);
  ok(!(b = bad((r) => r.source !== "SEC Form 4" && (r.value !== "" || r.shares !== "" || r.price !== ""))), `${path}: congressional trade ${b?.trade_id} carries a value, shares or price`);
  ok(!(b = bad((r) => r.source === "SEC Form 4" && (r.amount_low !== "" || r.amount_high !== "" || r.chamber !== "" || r.party !== ""))), `${path}: Form 4 trade ${b?.trade_id} carries a range, chamber or party`);
  ok(!(b = bad((r) => !["true", "false"].includes(r.under_review) || !["true", "false"].includes(r.also_in_another_filing) || !["true", "false", ""].includes(r.late))), `${path}: a yes/no column on trade ${b?.trade_id} is not true/false`);
  ok(!(b = bad((r) => !/^https:\/\//.test(r.filing_url ?? "") && r.filing_url !== "")), `${path}: trade ${b?.trade_id} has a filing_url that is not a link`);
  ok(!(b = bad((r) => !r.filer || !/^https?:\/\/[^/]+\/(congress|insiders)\/[^/]+\/$/.test(r.page_url))), `${path}: trade ${b?.trade_id} has no filer or page_url`);
  ok(!(b = bad((r) => r.late === "true" && !(int(r.lag_days) > (r.source === "SEC Form 4" ? 4 : 45)))), `${path}: trade ${b?.trade_id} is marked late with lag ${b?.lag_days}`);
}

// 1. The hub and every file on it.
const hub = await get("/downloads/");
ok(hub.status === 200, `/downloads/: HTTP ${hub.status}`);
const listed = [...hub.text.matchAll(/<li data-file="([^"]+)" data-rows="(\d+)"/g)].map((m) => ({ path: m[1], rows: Number(m[2]) }));
ok(listed.length >= 4, `/downloads/ lists ${listed.length} files`);
for (const need of ["congress-trades.csv", "insider-trades-latest.csv"]) ok(listed.some((f) => f.path.endsWith(need)), `/downloads/ does not list ${need}`);
ok(/13107\(c\)/.test(hub.text), "/downloads/ lost the notice about 5 U.S.C. § 13107(c)");
ok(!/donations?[a-z-]*\.csv/.test(hub.text), "/downloads/ offers a donations file; individual donor data must not be published");
for (const f of listed) {
  const t = await csv(f.path, f.rows);
  if (/(congress-trades|insider-trades-)/.test(f.path)) checkTrades(f.path, t);
  else if (t && /treasury-yields|tips-real-yields/.test(f.path)) ok(t.rows.every((r) => DATE.test(r.date)) && t.head.length >= 3, `${f.path}: expected a date column and one column per maturity`);
}
// The column dictionary on the hub names every trade column.
if (tradeHead) for (const col of tradeHead.split(",")) ok(hub.text.includes(`<code>${col}</code>`), `/downloads/ does not explain the column ${col}`);

// 2. Totals that must agree.
const all = await csv("/downloads/congress-trades.csv"), members = await csv("/downloads/congress-members.csv");
if (all && members) {
  ok(members.rows.reduce((n, r) => n + int(r.trades_on_record), 0) === all.rows.length, `congress-members.csv counts ${members.rows.reduce((n, r) => n + int(r.trades_on_record), 0)} trades, congress-trades.csv has ${all.rows.length}`);
  ok(all.rows.every((r) => r.source !== "SEC Form 4"), "congress-trades.csv holds a Form 4 row");
}
const llms = (await get("/llms.txt")).text;
const insiderTotal = int(llms.match(/\(([\d,]+) transactions on record\)/)?.[1]), congressTotal = int(llms.match(/\(([\d,]+) trades on record\)/)?.[1]);
const quarterly = listed.filter((f) => /insider-trades-(?!latest)/.test(f.path));
if (insiderTotal) ok(quarterly.reduce((n, f) => n + f.rows, 0) === insiderTotal, `the insider files hold ${quarterly.reduce((n, f) => n + f.rows, 0)} rows, the site reports ${insiderTotal} insider transactions`);
if (congressTotal && all) ok(all.rows.length === congressTotal, `congress-trades.csv has ${all.rows.length} rows, the site reports ${congressTotal} congressional trades`);
const latest = await csv("/downloads/insider-trades-latest.csv");
if (latest) { const ids = new Set((await Promise.all(quarterly.map((f) => csv(f.path)))).flatMap((t) => t?.rows.map((r) => r.trade_id) ?? [])); ok(latest.rows.every((r) => ids.has(r.trade_id)), "insider-trades-latest.csv has a row that is in no quarterly file"); }

// 3. Members: the file matches the page.
const withTrades = (members?.rows ?? []).filter((r) => int(r.trades_on_record) > 0);
const step = Math.max(1, Math.floor(withTrades.length / sampleN));
for (const mrow of withTrades.filter((_, i) => i % step === 0).slice(0, sampleN)) {
  const pagePath = new URL(mrow.page_url).pathname, filePath = new URL(mrow.trades_csv).pathname;
  const page = await get(pagePath);
  const total = int(page.text.match(/Trades on record<\/div><div class="v[^"]*">([\d,]+)</)?.[1]);
  ok(page.text.includes(`href="${filePath}"`), `${pagePath}: no link to ${filePath}`);
  const t = await csv(filePath, total);
  checkTrades(filePath, t);
  if (!t) continue;
  const ids = new Set(t.rows.map((r) => r.trade_id));
  const onPage = [...page.text.matchAll(/<tr id="t(\d+)"/g)].map((m) => m[1]);
  ok(onPage.length > 0 && onPage.every((id) => ids.has(id)), `${filePath}: a trade shown on ${pagePath} is missing from the file`);
  ok(t.rows.every((r) => r.page_url === mrow.page_url), `${filePath}: holds a row for another filer`);
  ok(int(mrow.trades_on_record) === total, `congress-members.csv says ${mrow.trades_on_record} trades for ${mrow.member}, the page says ${total}`);
}
ok((await get("/downloads/congress/no-such-member-xyz.csv")).status === 404, "a made-up member file should be a 404");

// 4. Tickers: found through the stocks index.
const stocksIndex = (await get("/stocks/")).text;
const tickers = [...new Set([...stocksIndex.matchAll(/href="\/stocks\/([a-z0-9.\-]+)\/"/g)].map((m) => m[1]))];
const tstep = Math.max(1, Math.floor(tickers.length / sampleN));
let stockFiles = 0;
for (const tk of tickers.filter((_, i) => i % tstep === 0).slice(0, sampleN)) {
  const page = await get(`/stocks/${tk}/`);
  const filePath = `/downloads/stocks/${tk}.csv`;
  if (!page.text.includes(`href="${filePath}"`)) { ok(!/<tr id="t\d+"/.test(page.text), `/stocks/${tk}/ shows trades but has no download link`); continue; }
  stockFiles++;
  const t = await csv(filePath);
  checkTrades(filePath, t);
  if (!t) continue;
  ok(t.rows.length > 0 && t.rows.every((r) => r.ticker.toLowerCase() === tk), `${filePath}: holds a row for another ticker`);
  const ids = new Set(t.rows.map((r) => r.trade_id));
  ok([...page.text.matchAll(/<tr id="t(\d+)"/g)].every((m) => ids.has(m[1])), `${filePath}: a trade shown on /stocks/${tk}/ is missing from the file`);
}
ok(stockFiles > 0 || tickers.length === 0, "no sampled ticker page offers a download");

// 5. Pages that should offer a file.
for (const [pagePath, file] of [["/congress/", "congress-trades.csv"], ["/insiders/", "insider-trades-latest.csv"], ["/contracts/", "federal-contracts.csv"], ["/lobbying/", "lobbying-"], ["/rates/treasury-yields/", "treasury-yields.csv"], ["/rates/tips/", "tips-real-yields.csv"], ["/rates/i-bonds/", "i-bond-rates.csv"]]) {
  const html = (await get(pagePath)).text;
  const href = html.match(new RegExp(`href="(/downloads/${file.replace(".", "\\.")}[^"]*)"`))?.[1];
  if (!listed.some((f) => f.path.includes(file))) continue; // nothing to offer on this build
  if (ok(!!href, `${pagePath}: no download link for ${file}`)) ok(listed.some((f) => f.path === href), `${pagePath}: links to ${href}, which the hub does not list`);
}
ok(/href="\/downloads\/"/.test((await get("/")).text), "the home page footer has no Downloads link");

if (failures.length) { console.error(`✗ ${failures.length} of ${checks} download checks failed:`); for (const f of failures.slice(0, 40)) console.error("  " + f); process.exit(1); }
const totalRows = listed.reduce((n, f) => n + f.rows, 0);
console.log(`✓ ${checks} download checks passed: ${listed.length} site-wide files (${totalRows.toLocaleString("en-US")} rows), ${Math.min(sampleN, withTrades.length)} member files and ${stockFiles} ticker files checked against their pages`);
