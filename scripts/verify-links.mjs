#!/usr/bin/env node
// Checks the site's internal linking on a built or live site (web/src/lib/links.ts,
// lib/entity.ts, the "related" and "guides for this page" blocks).
//
//   1. BROKEN   an internal link that does not answer 200, or whose #anchor is not on the page.
//   2. ORPHAN   a page in the sitemap that no other page links to, or that cannot be reached
//               from the home page by following links (full crawl only).
//   3. DEPTH    a sitemap page more than 4 clicks from the home page (full crawl only).
//   4. ENTITY   a stock, company, insider or member page with trades that lacks its header
//               facts, its links to the guides, or (where it has anchors) working jump links.
//   5. AUTO     an automatic glossary link that points at its own page, at a missing guide,
//               or twice at the same guide from one page.
//   6. FLAG     a "late" or "10b5-1 plan" flag in a trade table that is not a link to its guide.
//   8. SCREEN   a link into the Congress trade screener (/congress-trades/#committee=…, #member=…,
//               #ticker=…) that names a key the screener does not have, a committee, member or
//               ticker with no row in the screener's data file, or a row count beside the link
//               that is not the number of rows the data file holds for it.
//   7. NOTES    a Form 4 "notes" link with no footnote block on its page, a block printed twice,
//               an empty or over-long block, or an XML escape shown as text.
//
//   node scripts/verify-links.mjs http://127.0.0.1:4321            (every sitemap page)
//   node scripts/verify-links.mjs https://spotthemoney.com --sample 40   (40 pages per sitemap)
// No browser needed. With --sample the ORPHAN and DEPTH checks are skipped (they need every page).
import { loadOdIndex } from "./lib/odindex.mjs";
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleN = args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1]) || 40 : 0;
const failures = []; let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); return !!cond; };
const cache = new Map();
async function get(path) {
  if (cache.has(path)) return cache.get(path);
  const p = (async () => { try { const r = await fetch(base + path, { redirect: "manual" }); const html = r.status === 200 && /html/.test(r.headers.get("content-type") ?? "") ? await r.text() : ""; if (!html) await r.arrayBuffer().catch(() => {}); return { status: r.status, html }; } catch (e) { return { status: 0, html: "" }; } })();
  cache.set(path, p);
  return p;
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }
const clean = (href) => { try { const u = new URL(href, base + "/"); if (u.origin !== new URL(base).origin) return null; return { path: u.pathname, hash: decodeURIComponent(u.hash.slice(1)) }; } catch { return null; } };
const mainOf = (html) => html.slice(Math.max(0, html.indexOf("<main")), html.lastIndexOf("</main>") > 0 ? html.lastIndexOf("</main>") : html.length);
const hrefs = (html) => [...html.matchAll(/<a\b[^>]*?\bhref="([^"#][^"]*|#[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const ids = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// The pages to read: every sitemap URL (or a sample of each sitemap), plus the hubs.
const index = (await fetch(`${base}/sitemap-index.xml`).then((r) => r.text()).catch(() => ""));
// The market child sitemaps list pages the Worker renders on request (stage 3a). They are linked from
// nowhere on purpose and a static server has no such pages; scripts/verify-od.mjs checks them.
const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname).filter((m) => !m.startsWith("/sitemaps/market-"));
ok(maps.length > 0, "no sitemaps listed in /sitemap-index.xml");
const sitemapPaths = new Set(); const pages = new Set(["/"]);
for (const map of maps) {
  const xml = await fetch(base + map).then((r) => r.text()).catch(() => "");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  for (const l of locs) sitemapPaths.add(l);
  const step = sampleN ? Math.max(1, Math.floor(locs.length / sampleN)) : 1;
  locs.filter((_, i) => i % step === 0).slice(0, sampleN || locs.length).forEach((l) => pages.add(l));
}
const full = !sampleN;
const od = await loadOdIndex(base);
console.log(`od-index: ${od.size} on-demand entities linked from built pages (${od.isStatic ? "static server: accepted without fetching" : "live server: a sample is fetched"})`);

// Read the pages; collect links.
const linksFrom = new Map(); const inbound = new Map(); const targets = new Map(); // target path → first page that links to it
await pool([...pages], 8, async (path) => {
  const { status, html } = await get(path);
  if (!ok(status === 200 && html, `${path}: HTTP ${status}`)) return;
  const out = new Set();
  for (const h of hrefs(html)) {
    const t = h.startsWith("#") ? { path, hash: decodeURIComponent(h.slice(1)) } : clean(h);
    if (!t || /^\/(cdn-cgi|_astro)\//.test(t.path)) continue;
    if (!targets.has(t.path)) targets.set(t.path, path);
    if (t.hash) { const k = `${t.path}#${t.hash}`; if (!targets.has(k)) targets.set(k, path); }
    if (t.path !== path) out.add(t.path);
  }
  linksFrom.set(path, out);
  for (const t of out) { const s = inbound.get(t); if (s) s.add(path); else inbound.set(t, new Set([path])); }
});

// 1. BROKEN
const plain = [...targets.keys()].filter((k) => !k.includes("#"));
await pool(plain, 8, async (t) => {
  if (od.accept(t)) { ok(true, ""); return; }
  if (/\.(csv|xml|txt|json|png|svg|ico|webmanifest|woff2?)$/.test(t)) { const r = await fetch(base + t, { method: "HEAD" }).catch(() => null); ok(r?.status === 200, `BROKEN ${t} (HTTP ${r?.status ?? 0}), linked from ${targets.get(t)}`); return; }
  const { status } = await get(t);
  ok(status === 200, `BROKEN ${t} (HTTP ${status}), linked from ${targets.get(t)}`);
});
// A hash on the screener that carries one of its keys is a saved view, not an anchor (its own list,
// not the code's: web/src/lib/screener.ts KEYS).
const SCREENER = "/congress-trades/";
const SCREEN_KEYS = ["q", "chamber", "party", "state", "committee", "side", "min", "max", "owner", "asset", "w", "tw", "late", "hist", "member", "ticker", "sort", "dir", "page", "per"];
// The company financials screener's views (its own list too: web/src/lib/finscreen.ts FS_KEYS).
// scripts/verify-finscreen.mjs recounts the number beside each link into it.
const FIN_SCREENER = "/company-financials/";
const FIN_KEYS = ["q", "period", "division", "unit", "rmin", "rmax", "ni", "amin", "sort", "dir", "page", "per"];
const isFinView = (path, hash) => path === FIN_SCREENER && hash.includes("=") && [...new URLSearchParams(hash).keys()].every((key) => FIN_KEYS.includes(key));
const isScreenView = (path, hash) => isFinView(path, hash) || (path === SCREENER && hash.includes("=") && [...new URLSearchParams(hash).keys()].some((key) => SCREEN_KEYS.includes(key)));
for (const k of [...targets.keys()].filter((x) => x.includes("#"))) {
  const [path, hash] = [k.slice(0, k.indexOf("#")), k.slice(k.indexOf("#") + 1)];
  if (isScreenView(path, hash)) continue;   // checked under SCREEN below
  const { status, html } = await get(path);
  if (status !== 200 || !html || !hash || hash === "main") continue;
  ok(ids(html).has(hash), `BROKEN anchor #${hash} on ${path}, linked from ${targets.get(k)}`);
}

// 2 + 3. ORPHAN and DEPTH (need every page)
let maxDepth = 0, thin = 0;
if (full) {
  const depth = new Map([["/", 0]]); const queue = ["/"];
  while (queue.length) {
    const p = queue.shift();
    let out = linksFrom.get(p);
    if (!out) { const { html } = await get(p); out = new Set(hrefs(html).map(clean).filter(Boolean).map((t) => t.path)); linksFrom.set(p, out); }
    for (const t of out) if (!depth.has(t) && (sitemapPaths.has(t) || /\/$/.test(t)) && !/^\/(embed|downloads\/.+)/.test(t)) { depth.set(t, depth.get(p) + 1); queue.push(t); }
  }
  for (const p of sitemapPaths) {
    if (p === "/") continue;
    const n = inbound.get(p)?.size ?? 0;
    ok(n > 0, `ORPHAN ${p}: no other sitemap page links to it`);
    if (n === 1) thin++;
    const d = depth.get(p);
    if (ok(d != null, `ORPHAN ${p}: cannot be reached from the home page by following links`)) { maxDepth = Math.max(maxDepth, d); ok(d <= 4, `DEPTH ${p} is ${d} clicks from the home page`); }
  }
}

// 4–6. Entity pages, automatic links, flags.
let entities = 0, autos = 0, flagLinks = 0, periodTables = 0, noteLinks = 0, noteBlocks = 0, industryFacts = 0;
// The ten divisions of the SIC manual plus "Nonclassifiable", as shared/src/sic.ts names them (kept
// as a separate list on purpose: the verifier must not read the code it checks).
const DIVISIONS = ["Agriculture, forestry and fishing", "Mining", "Construction", "Manufacturing", "Transportation, communications and utilities",
  "Wholesale trade", "Retail trade", "Finance, insurance and real estate", "Services", "Public administration", "Nonclassifiable"];
for (const path of pages) {
  const { html } = await get(path);
  if (!html) continue;
  const main = mainOf(html);
  const kind = /^\/(stocks|companies|insiders|congress)\/[^/]+\/$/.exec(path)?.[1];
  if (kind && !/name="robots" content="[^"]*noindex/.test(html)) {
    entities++;
    ok(/data-(entity|profile)-facts/.test(main), `ENTITY ${path}: no header facts`);
    ok(/href="\/guides\/[a-z0-9-]+\//.test(main), `ENTITY ${path}: no link to any guide`);
    ok(/id="sources"/.test(main), `ENTITY ${path}: no Sources section`);
    const jump = /<nav class="jump"[\s\S]*?<\/nav>/.exec(main)?.[0] ?? "";
    const have = ids(html);
    for (const h of hrefs(jump)) ok(have.has(h.slice(1)), `ENTITY ${path}: jump link ${h} goes nowhere`);
    if (kind !== "congress") ok(/data-learn-more/.test(main), `ENTITY ${path}: no "Guides for this page" block`);
    // Industry fact (company and stock pages): only the SEC's code, its wording and the division.
    // The fact links to the page of its division at the code (lib/industries.ts); the general link
    // check above proves the page and the anchor exist.
    const indM = /<div data-industry[^>]*>\s*<dt[^>]*>[^<]*<\/dt>\s*<dd[^>]*>(?:<a href="([^"]*)"[^>]*>)?([^<]*)(?:<\/a>)?<\/dd>/.exec(main);
    const ind = indM?.[2];
    if (ind != null) {
      industryFacts++;
      const text = ind.replace(/&amp;/g, "&");
      const code = /SIC (\d{4})/.exec(text)?.[1];
      if (/SIC \d{4},/.test(text)) ok(new RegExp(`^/industries/[a-z-]+/#sic-${code}$`).test(indM[1] ?? ""), `INDUSTRY ${path}: fact "${text}" links to "${indM[1] ?? ""}", not to its division's page at #sic-${code}`);
      ok(/^(.+ \()?SIC \d{4}(, [A-Z][a-z, ]+)?\)?$/.test(text), `INDUSTRY ${path}: fact "${text}" is not "wording (SIC ####, division)"`);
      ok(DIVISIONS.some((d) => text.includes(`, ${d}`)) || !/SIC \d{4},/.test(text), `INDUSTRY ${path}: division in "${text}" is not one of the SIC manual's`);
      ok(kind === "stocks" || kind === "companies", `INDUSTRY ${path}: industry fact on a ${kind} page`);
    }
    if (kind === "stocks") {
      // 3 and 12 month summary: there whenever the page lists insiders, and its own sums agree.
      const sec = /<section[^>]*data-entity-periods[\s\S]*?<\/section>/.exec(main)?.[0] ?? "";
      if (/data-entity-insiders/.test(main)) ok(!!sec, `ENTITY ${path}: insiders listed but no 3 and 12 month summary`);
      if (sec) {
        periodTables++;
        const cell = (k) => { const m = new RegExp(`data-k="${k}"[^>]*>([^<]*)<`).exec(sec); return m ? Number(m[1].replace(/[,+]/g, "").replace("\u2212", "-")) : NaN; };
        for (const d of [90, 365]) {
          const bought = cell(`shares-bought-${d}`), sold = cell(`shares-sold-${d}`), net = cell(`net-shares-${d}`);
          ok(Number.isFinite(net) && net === bought - sold, `ENTITY ${path}: ${d}-day net shares ${net} is not bought ${bought} minus sold ${sold}`);
          ok(cell(`buyers-${d}`) <= cell(`buys-${d}`) && cell(`sellers-${d}`) <= cell(`sells-${d}`) && cell(`plan-${d}`) <= cell(`sells-${d}`), `ENTITY ${path}: ${d}-day people or plan count exceeds its trade count`);
        }
        for (const k of ["buys", "sells", "shares-bought", "shares-sold", "buyers", "sellers", "plan"]) ok(cell(`${k}-90`) <= cell(`${k}-365`), `ENTITY ${path}: ${k} is larger over 3 months than over 12`);
      }
    }
  }
  if (path.startsWith("/guides/") && path !== "/guides/") {
    const auto = [...main.matchAll(/<a href="(\/guides\/[a-z0-9-]+\/)" data-auto>/g)].map((m) => m[1]);
    autos += auto.length;
    ok(!auto.includes(path), `AUTO ${path}: an automatic link points at the page itself`);
    ok(new Set(auto).size === auto.length, `AUTO ${path}: two automatic links to the same guide`);
    const byHand = new Set([...main.matchAll(/<a href="(\/guides\/[a-z0-9-]+\/)"(?! data-auto)/g)].map((m) => m[1]));
    const body = /<div class="prose guide-body">[\s\S]*?<h2 id="questions">/.exec(main)?.[0] ?? "";
    const handInBody = new Set([...body.matchAll(/<a href="(\/guides\/[a-z0-9-]+\/)"(?! data-auto)/g)].map((m) => m[1]));
    ok(auto.every((a) => !handInBody.has(a)), `AUTO ${path}: an automatic link repeats a link the guide already makes by hand`);
    void byHand;
  }
  // Form 4 footnotes: every "notes" link on a row lands on a footnote block on the same page,
  // inside the folded list; a block is printed once, has text, and carries no leftover escapes.
  const noteIds = [...main.matchAll(/<section class="fnote" id="(fn\d+)"/g)].map((m) => m[1]);
  if (noteIds.length || /class="flag notes"/.test(main)) {
    ok(new Set(noteIds).size === noteIds.length, `NOTES ${path}: a filing's footnotes are printed twice`);
    const folded = [...main.matchAll(/<details class="fnotes" data-fnotes>[\s\S]*?<\/details>/g)].map((m) => m[0]).join("");
    const have = new Set(noteIds);
    for (const m of main.matchAll(/<a class="flag notes" href="#(fn\d+)"[^>]*>(\d+) notes?<\/a>/g)) {
      noteLinks++;
      if (!ok(have.has(m[1]) && folded.includes(`id="${m[1]}"`), `NOTES ${path}: the notes link #${m[1]} has no footnote block in the folded list`)) break;
    }
    for (const sec of folded.matchAll(/<section class="fnote" id="(fn\d+)"[\s\S]*?<\/section>/g)) {
      noteBlocks++;
      const items = [...sec[0].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
      if (!ok(items.length >= 1 && items.length <= 10 && items.every((t) => t.trim().length > 0), `NOTES ${path}: block #${sec[1]} has ${items.length} footnotes or an empty one`)) break;
      if (!ok(!items.some((t) => /&amp;(amp|quot|apos|lt|gt|#\d+);/.test(t)), `NOTES ${path}: block #${sec[1]} shows an XML escape as text`)) break;
    }
    ok(!/PRE-FLOOR NOTE/.test(main), `NOTES ${path}: a footnote of a filing from before the site's Form 4 start date is shown`);
  }
  for (const m of main.matchAll(/<(a|span) class="flag (late|10b5-1-plan)"([^>]*)>/g)) {
    flagLinks++;
    if (!ok(m[1] === "a" && /href="\/guides\//.test(m[3]), `FLAG ${path}: a "${m[2]}" flag is not linked to its guide`)) break;
  }
}

// 8. SCREEN: links into the Congress trade screener, recounted from the screener's data file.
let screenLinks = 0;
{
  const data = await fetch(`${base}/data/congress-screener.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const count = { committee: new Map(), member: new Map(), ticker: new Map() };
  const add = (m, key) => { if (key) m.set(key, (m.get(key) ?? 0) + 1); };
  for (const r of data?.rows ?? []) {
    const mem = data.members[r[1]];
    for (const c of mem?.c ?? []) add(count.committee, c);
    add(count.member, (mem?.p ?? "").replace(/\/+$/, "").split("/").pop());
    add(count.ticker, String(r[2]).toUpperCase());
  }
  for (const path of pages) {
    const { html } = await get(path);
    if (!html) continue;
    const main = mainOf(html);
    const noted = new Map([...main.matchAll(/<p[^>]*data-screener-link[^>]*data-n="(\d+)"[^>]*>\s*<a[^>]*href="([^"]+)"/g)].map((m) => [m[2].replace(/&amp;/g, "&"), Number(m[1])]));
    for (const h of hrefs(main)) {
      const t = clean(h);
      if (!t || t.path !== SCREENER || !t.hash) continue;
      if (!isScreenView(t.path, t.hash)) continue;
      screenLinks++;
      const q = new URLSearchParams(t.hash);
      if (!ok([...q.keys()].every((key) => SCREEN_KEYS.includes(key)), `SCREEN ${path}: the link ${h} uses a key the screener does not have`)) continue;
      if (!ok(!!data, `SCREEN ${path}: links into the screener but /data/congress-screener.json is not served`)) break;
      let expected = null;
      for (const key of ["committee", "member", "ticker"]) {
        if (!q.has(key)) continue;
        const n = count[key].get(q.get(key)) ?? 0;
        ok(n > 0, `SCREEN ${path}: ${h} names a ${key} with no row in the screener`);
        expected = expected == null ? n : null;   // a count is checked for a link with one such key
      }
      if (noted.has(h) && [...q.keys()].length === 1) ok(noted.get(h) === expected, `SCREEN ${path}: the link ${h} says ${noted.get(h)} rows, the screener's data file has ${expected}`);
    }
    // Where a link belongs: a member page or a stock
    // page whose member or ticker has rows in the screener.
    if (data) {
      const slug = /^\/congress\/([^/]+)\/$/.exec(path)?.[1], tick = /^\/stocks\/([^/]+)\/$/.exec(path)?.[1]?.toUpperCase();
      if (slug && count.member.has(slug)) ok(noted.has(`${SCREENER}#member=${slug}`), `SCREEN ${path}: the member has ${count.member.get(slug)} rows in the screener but the page has no link to them`);
      if (tick && count.ticker.has(tick)) ok(noted.has(`${SCREENER}#ticker=${encodeURIComponent(tick)}`), `SCREEN ${path}: ${tick} has ${count.ticker.get(tick)} rows in the screener but the page has no link to them`);
      // (A committee page's code is not in its address; its link is checked above when present.)
    }
  }
}

if (failures.length) { console.error(`✗ ${failures.length} of ${checks} link checks failed:`); for (const f of [...new Set(failures)].slice(0, 50)) console.error("  " + f); process.exit(1); }
console.log(`✓ ${checks} link checks passed: ${pages.size} pages read, ${plain.length} distinct internal targets all answer, ${entities} entity pages, ${periodTables} period tables, ${industryFacts} industry facts, ${autos} automatic guide links, ${flagLinks} flag links, ${screenLinks} links into the screener, ${noteLinks} footnote links to ${noteBlocks} footnote blocks` + (full ? `; no orphans, deepest sitemap page is ${maxDepth} clicks from home, ${thin} pages have a single inbound link` : "; orphan and depth checks skipped (sample)"));
