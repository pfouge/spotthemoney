// Checks the developers page (/developers/) and the catalogue of public data files
// (/data/catalog.json; web/src/lib/datafiles.ts) against the files the site actually serves:
//   node scripts/verify-developers.mjs <base-url> [--sample N]      e.g. http://127.0.0.1:4321
// No browser. The oracle is the served files themselves, read with this script's own parsers:
//   - every CSV file in the catalogue downloads, its header line is the catalogue's column list
//     in order, and its row count and byte size are the catalogue's;
//   - the one-member files are exactly the members that congress-members.csv says have a trade
//     file, and a sample of member and ticker files (default 12 each) match their row counts,
//     share the trade header, and (ticker files) hold only that ticker; a made-up name is a 404;
//   - every feed holds the stated number of items, at most its limit;
//   - every working JSON file is served and its top-level layout is the one the page states;
//   - the page lists the same files, counts and layouts as the catalogue, the /downloads/ page
//     lists the same site-wide files, and the page is in the sitemap, llms.txt and the footer;
//   - wording: no advice, no promise of an API key or a query API.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 12;
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } };
async function get(p) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(base + p);
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, bytes: buf.length, text: buf.toString("utf8"), type: r.headers.get("content-type") ?? "" };
    } catch (e) { if (attempt >= 2) return { status: 0, bytes: 0, text: "", type: "", error: String(e) }; await new Promise((res) => setTimeout(res, 1500)); }
  }
}
function parseCsv(text) {
  const out = []; let row = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return { head: out[0] ?? [], rows: out.slice(1) };
}
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
const tags = (html, re) => [...html.matchAll(re)].map((m) => m[0]);
const pick = (xs, n) => { if (xs.length <= n) return xs; const step = xs.length / n; return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]); };
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

// ── the catalogue ──────────────────────────────────────────────────────────────────────────
const cr = await get("/data/catalog.json");
ok(cr.status === 200, `/data/catalog.json answers ${cr.status}`);
let cat;
try { cat = JSON.parse(cr.text); } catch { cat = null; }
ok(!!cat, "the catalogue is JSON");
if (!cat) { console.log(`✗ cannot go on without the catalogue`); process.exit(1); }
ok(cat.version === 1, `catalogue version is ${cat.version}`);
ok(/^\d{4}-\d{2}-\d{2}T/.test(cat.built ?? ""), "the catalogue states when it was built");
ok(/\/developers\/$/.test(cat.docs ?? "") && /\/terms\/#reuse$/.test(cat.terms ?? ""), "the catalogue links the page and the reuse terms");
ok(Array.isArray(cat.csv?.files) && cat.csv.files.length > 0, "the catalogue lists CSV files");

// ── site-wide CSV files: header, rows and size as stated ───────────────────────────────────
let tradeHead = null, csvRows = 0;
const memberCsv = { rows: [] , head: [] };
for (const f of cat.csv.files) {
  const r = await get(f.path);
  ok(r.status === 200, `${f.path} answers ${r.status}`);
  if (r.status !== 200) continue;
  const c = parseCsv(r.text);
  ok(JSON.stringify(c.head) === JSON.stringify(f.columns.map((x) => x.key)), `${f.path}: the header line is not the catalogue's column list`);
  ok(c.rows.length === f.rows, `${f.path}: ${c.rows.length} rows in the file, ${f.rows} in the catalogue`);
  ok(r.bytes === f.bytes, `${f.path}: ${r.bytes} bytes served, ${f.bytes} in the catalogue`);
  ok(f.url === `${cat.site}${f.path}`, `${f.path}: url is ${f.url}`);
  ok(f.columns.every((x) => x.key && x.about && x.about.length > 5), `${f.path}: a column has no meaning written`);
  ok(c.rows.every((row) => row.length === c.head.length), `${f.path}: a row has a different number of cells from the header`);
  if (f.updated) ok(/^\d{4}-\d{2}-\d{2}$/.test(f.updated), `${f.path}: updated is ${f.updated}`);
  csvRows += c.rows.length;
  if (f.kind === "trades") { if (!tradeHead) tradeHead = c.head; else ok(JSON.stringify(tradeHead) === JSON.stringify(c.head), `${f.path}: trade files do not share one header`); }
  if (f.name === "congress-members.csv") { memberCsv.head = c.head; memberCsv.rows = c.rows; }
}
ok(new Set(cat.csv.files.map((f) => f.path)).size === cat.csv.files.length, "a CSV file is listed twice");

// ── one member, one ticker ─────────────────────────────────────────────────────────────────
const pm = cat.csv.perMember, pt = cat.csv.perTicker;
ok(pm.count === pm.files.length && pt.count === pt.files.length, "the per-member or per-ticker count is not the length of its list");
ok(pm.pattern.includes("{member-page-name}") && pt.pattern.includes("{ticker}"), "an address pattern lacks its placeholder");
if (memberCsv.rows.length) {
  const iCsv = memberCsv.head.indexOf("trades_csv");
  const want = new Set(memberCsv.rows.map((r) => r[iCsv]).filter(Boolean).map((u) => u.replace(/^https?:\/\/[^/]+/, "")));
  const have = new Set(pm.files.map((f) => f.path));
  ok(want.size === have.size && [...want].every((p) => have.has(p)), `per-member files: ${have.size} in the catalogue, ${want.size} members with a trade file in congress-members.csv`);
  const iPage = memberCsv.head.indexOf("page_url"), iN = memberCsv.head.indexOf("trades_on_record");
  const byPath = new Map(memberCsv.rows.filter((r) => r[iCsv]).map((r) => [r[iCsv].replace(/^https?:\/\/[^/]+/, ""), r]));
  for (const f of pm.files) {
    const row = byPath.get(f.path);
    if (!row) continue;
    ok(Number(row[iN]) === f.rows, `${f.path}: ${f.rows} rows in the catalogue, ${row[iN]} trades on record in congress-members.csv`);
    ok(row[iPage].endsWith(`/congress/${f.key}/`), `${f.path}: key ${f.key} is not the member's page name`);
  }
}
for (const f of pick(pm.files, sample)) {
  const r = await get(f.path); const c = parseCsv(r.text);
  ok(r.status === 200 && c.rows.length === f.rows, `${f.path}: answers ${r.status} with ${c.rows.length} rows, catalogue says ${f.rows}`);
  if (tradeHead) ok(JSON.stringify(c.head) === JSON.stringify(tradeHead), `${f.path}: not the trade header`);
}
for (const f of pick(pt.files, sample)) {
  const r = await get(f.path); const c = parseCsv(r.text);
  ok(r.status === 200 && c.rows.length === f.rows, `${f.path}: answers ${r.status} with ${c.rows.length} rows, catalogue says ${f.rows}`);
  if (tradeHead) ok(JSON.stringify(c.head) === JSON.stringify(tradeHead), `${f.path}: not the trade header`);
  const iT = c.head.indexOf("ticker");
  ok(f.key === f.key.toLowerCase() && c.rows.every((row) => row[iT].toLowerCase() === f.key), `${f.path}: holds a row for another ticker`);
}
ok(pm.files.every((f, i) => i === 0 || pm.files[i - 1].key < f.key) && pt.files.every((f, i) => i === 0 || pt.files[i - 1].key < f.key), "the per-member or per-ticker list is not in order");
ok((await get("/downloads/congress/no-such-member-zz.csv")).status === 404, "a made-up member file does not answer 404");
ok((await get("/downloads/stocks/zzzzqq.csv")).status === 404, "a made-up ticker file does not answer 404");

// ── feeds ──────────────────────────────────────────────────────────────────────────────────
ok(Array.isArray(cat.feeds) && cat.feeds.length === 3, `the catalogue lists ${cat.feeds?.length} feeds`);
for (const f of cat.feeds ?? []) {
  const r = await get(f.path);
  const items = (r.text.match(/<item>/g) ?? []).length;
  ok(r.status === 200 && r.text.includes("<rss"), `${f.path} answers ${r.status}`);
  ok(items === f.items, `${f.path}: ${items} items in the feed, ${f.items} in the catalogue`);
  ok(f.items <= f.limit, `${f.path}: more items than its limit`);
  if (f.items) ok(/^\d{4}-\d{2}-\d{2}$/.test(f.newest ?? ""), `${f.path}: newest is ${f.newest}`);
}
for (const o of cat.other ?? []) ok((await get(o.path)).status === 200, `${o.path} is not served`);

// ── working files: served, and laid out as stated ──────────────────────────────────────────
const layouts = new Map();
for (const w of cat.workingFiles ?? []) {
  ok(w.stable === false, `${w.path} is not marked as unstable`);
  const r = await get(w.path);
  ok(r.status === 200, `${w.path} answers ${r.status}`);
  let j = null; try { j = JSON.parse(r.text); } catch { /* reported below */ }
  ok(j !== null, `${w.path} is not JSON`);
  if (j !== null) layouts.set(w.path, Array.isArray(j) ? "array" : Object.keys(j).join(","));
  if (w.instead) ok(cat.csv.files.some((f) => f.path === w.instead), `${w.path}: the stable alternative ${w.instead} is not a listed CSV file`);
}

// ── the page ───────────────────────────────────────────────────────────────────────────────
const page = await get("/developers/");
ok(page.status === 200, `/developers/ answers ${page.status}`);
const html = page.text;
ok(/<a [^>]*data-catalog-link/.test(html) && html.includes('href="/data/catalog.json"'), "the page does not link the catalogue");
const fileRows = tags(html, /<li [^>]*data-file="[^"]*"[^>]*>/g);
ok(fileRows.length === cat.csv.files.length, `the page lists ${fileRows.length} CSV files, the catalogue ${cat.csv.files.length}`);
for (const f of cat.csv.files) {
  const tr = fileRows.find((x) => attr(x, "data-file") === f.path);
  ok(!!tr && Number(attr(tr, "data-rows")) === f.rows && Number(attr(tr, "data-cols")) === f.columns.length, `the page's row for ${f.path} does not state ${f.rows} rows and ${f.columns.length} columns`);
}
const totals = tags(html, /<p [^>]*data-csv-totals[^>]*>/g)[0] ?? "";
ok(Number(attr(totals, "data-files")) === cat.csv.files.length && Number(attr(totals, "data-rows")) === csvRows, `the page's totals (${attr(totals, "data-files")} files, ${attr(totals, "data-rows")} rows) are not the files' (${cat.csv.files.length}, ${csvRows})`);
for (const [kind, list] of [["member", pm], ["ticker", pt]]) {
  const li = tags(html, new RegExp(`<li [^>]*data-per="${kind}"[^>]*>`, "g"))[0] ?? "";
  ok(Number(attr(li, "data-count")) === list.count, `the page states ${attr(li, "data-count")} ${kind} files, the catalogue ${list.count}`);
}
const feedRows = tags(html, /<li [^>]*data-feed="[^"]*"[^>]*>/g);
for (const f of cat.feeds ?? []) {
  const tr = feedRows.find((x) => attr(x, "data-feed") === f.path);
  ok(!!tr && Number(attr(tr, "data-items")) === f.items, `the page's row for ${f.path} does not state ${f.items} items`);
}
const work = tags(html, /<li [^>]*data-working="[^"]*"[^>]*>/g);
ok(work.length === (cat.workingFiles ?? []).length, `the page lists ${work.length} working files, the catalogue ${(cat.workingFiles ?? []).length}`);
for (const li of work) {
  const p = attr(li, "data-working");
  ok(layouts.has(p), `${p} is on the page and not in the catalogue`);
  ok(layouts.get(p) === attr(li, "data-top"), `${p}: the page states the top level "${attr(li, "data-top")}", the file has "${layouts.get(p)}"`);
}
const words = text((html.match(/<main[\s\S]*?<\/main>/) ?? [html])[0]);
ok(/<main/.test(html), "the page has no main element");
ok(/no query API/i.test(words) && /no API key/i.test(words), "the page does not say there is no query API and no key");
ok(/can change without notice/i.test(words), "the page does not say the working files can change");
ok(/13107/.test(words), "the page does not name the limit on congressional reports");
ok(/Just a moment/.test(words), "the page does not say automated requests can be challenged");
ok(!/—/.test(words), "an em-dash in the page copy");
ok(!/should (buy|sell)|recommend|bullish|bearish|smart money|outperform|beat the market/i.test(words), "advice or verdict wording on the page");
ok(!/real[- ]time|guarantee|unlimited/i.test(words), "the page promises something the files do not give");
for (const id of ["catalog", "csv", "feeds", "stable", "working", "fetching", "not-offered", "reuse"]) ok(html.includes(`id="${id}"`), `the page has no section #${id}`);

// ── the downloads page lists the same site-wide files ──────────────────────────────────────
const dl = await get("/downloads/");
const dlFiles = new Map(tags(dl.text, /<li [^>]*data-file="[^"]*"[^>]*>/g).map((x) => [attr(x, "data-file"), Number(attr(x, "data-rows"))]));
ok(dlFiles.size === cat.csv.files.length && cat.csv.files.every((f) => dlFiles.get(f.path) === f.rows), `the downloads page lists ${dlFiles.size} files; the catalogue ${cat.csv.files.length}, or a row count differs`);
ok(dl.text.includes('href="/developers/"'), "the downloads page does not link the developers page");
ok((await get("/feeds/")).text.includes('href="/developers/"'), "the feeds page does not link the developers page");

// ── found from elsewhere ───────────────────────────────────────────────────────────────────
ok((await get("/sitemaps/pages.xml")).text.includes("/developers/</loc>"), "/developers/ is not in the pages sitemap");
const llms = (await get("/llms.txt")).text;
ok(llms.includes("/developers/") && llms.includes("/data/catalog.json"), "llms.txt does not name the developers page and the catalogue");
ok((await get("/")).text.includes('href="/developers/"'), "the footer does not link the developers page");
const search = (await get("/data/search.json")).text;
ok(search.includes('"/developers/"'), "the search index does not hold the developers page");

console.log(`${failures === 0 ? "✓" : "✗"} developers: ${cat.csv.files.length} CSV files (${csvRows} rows), ${pm.count} member files, ${pt.count} ticker files, ${(cat.feeds ?? []).length} feeds, ${(cat.workingFiles ?? []).length} working files; ${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
