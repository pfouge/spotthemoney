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
//
//   node scripts/verify-links.mjs http://127.0.0.1:4321            (every sitemap page)
//   node scripts/verify-links.mjs https://spotthemoney.com --sample 40   (40 pages per sitemap)
// No browser needed. With --sample the ORPHAN and DEPTH checks are skipped (they need every page).
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
const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
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
  if (/\.(csv|xml|txt|json|png|svg|ico|webmanifest|woff2?)$/.test(t)) { const r = await fetch(base + t, { method: "HEAD" }).catch(() => null); ok(r?.status === 200, `BROKEN ${t} (HTTP ${r?.status ?? 0}), linked from ${targets.get(t)}`); return; }
  const { status } = await get(t);
  ok(status === 200, `BROKEN ${t} (HTTP ${status}), linked from ${targets.get(t)}`);
});
for (const k of [...targets.keys()].filter((x) => x.includes("#"))) {
  const [path, hash] = [k.slice(0, k.indexOf("#")), k.slice(k.indexOf("#") + 1)];
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
let entities = 0, autos = 0, flagLinks = 0;
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
  for (const m of main.matchAll(/<(a|span) class="flag (late|10b5-1-plan)"([^>]*)>/g)) {
    flagLinks++;
    if (!ok(m[1] === "a" && /href="\/guides\//.test(m[3]), `FLAG ${path}: a "${m[2]}" flag is not linked to its guide`)) break;
  }
}

if (failures.length) { console.error(`✗ ${failures.length} of ${checks} link checks failed:`); for (const f of [...new Set(failures)].slice(0, 50)) console.error("  " + f); process.exit(1); }
console.log(`✓ ${checks} link checks passed: ${pages.size} pages read, ${plain.length} distinct internal targets all answer, ${entities} entity pages, ${autos} automatic guide links, ${flagLinks} flag links` + (full ? `; no orphans, deepest sitemap page is ${maxDepth} clicks from home, ${thin} pages have a single inbound link` : "; orphan and depth checks skipped (sample)"));
