#!/usr/bin/env node
// Mechanical post-deploy verifier (session rule: a verifier that must pass clean beats a
// model re-reading the work). Runs in deploy.yml after the live check, and locally against
// a static server on web/dist/client:
//
//   node scripts/verify-live.mjs https://spotthemoney.com
//   node scripts/verify-live.mjs http://127.0.0.1:8787 --sample 4
//
// Checks: robots.txt (text, AI allow lines, Sitemap line) · llms.txt (text) · /sitemap-index.xml
// and /sitemap.xml (XML, children resolve, URL counts) · a sample of pages per child sitemap
// (200, JSON-LD parses, BreadcrumbList on every page, Person/Organization/Dataset per page
// type, an answer block, a last-updated stamp, no data table without rows, the disclaimer).
// Exit code 1 on any failure; prints a summary either way.

const base = (process.argv[2] ?? "https://spotthemoney.com").replace(/\/$/, "");
const sampleArg = process.argv.indexOf("--sample");
const SAMPLE = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : 3;

const failures = [];
const notes = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); return cond; };

async function get(path) {
  const url = path.startsWith("http") ? path : base + path;
  const res = await fetch(url, { headers: { "user-agent": "spotthemoney verify-live (pfouge@gmail.com)" }, redirect: "follow" });
  const text = await res.text();
  return { url, status: res.status, type: res.headers.get("content-type") ?? "", text };
}

function locs(xml) { return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()); }
function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const parsed = JSON.parse(m[1]); out.push(...(Array.isArray(parsed) ? parsed : [parsed])); }
    catch (e) { out.push({ __parseError: String(e) }); }
  }
  return out;
}
const expectedType = (path) =>
  /^\/insiders\/[^/]+\/$/.test(path) || /^\/congress\/[^/]+\/$/.test(path) ? "Person"
  : /^\/companies\/[^/]+\/$/.test(path) ? "Organization"
  : /^\/stocks\/[^/]+\/$/.test(path) || /^\/(insiders|congress|donations|lobbying|contracts|disclosures)\/$/.test(path) || /^\/rates\/(i-bonds|tips)\/$/.test(path) ? "Dataset"
  : /^\/(stocks|companies|washington)\/$/.test(path) || path === "/" ? "DataCatalog"
  : null;

// 1. robots.txt
{
  const r = await get("/robots.txt");
  ok(r.status === 200, `robots.txt status ${r.status}`);
  ok(/^text\/plain/.test(r.type), `robots.txt content-type ${r.type}`);
  for (const ua of ["GPTBot", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "CCBot"]) ok(new RegExp(`User-agent: ${ua}\\s+Allow: /`).test(r.text), `robots.txt missing allow for ${ua}`);
  ok(/Sitemap: .*\/sitemap-index\.xml/.test(r.text), "robots.txt missing Sitemap line");
}
// 2. llms.txt
{
  const r = await get("/llms.txt");
  ok(r.status === 200, `llms.txt status ${r.status}`);
  ok(/^text\/plain/.test(r.type), `llms.txt content-type ${r.type}`);
  ok(r.text.startsWith("# Spot the Money"), "llms.txt does not start with the site heading");
  ok(r.text.includes("/methodology/"), "llms.txt does not mention the methodology page");
}
// 3. sitemaps
const sampled = [];
{
  const idx = await get("/sitemap-index.xml");
  ok(idx.status === 200, `sitemap-index.xml status ${idx.status}`);
  ok(/xml/.test(idx.type), `sitemap-index.xml content-type ${idx.type}`);
  ok(idx.text.includes("<sitemapindex"), "sitemap-index.xml is not a sitemapindex");
  const alias = await get("/sitemap.xml");
  ok(alias.status === 200 && alias.text.includes("<sitemapindex"), `sitemap.xml status ${alias.status} / not an index`);
  const children = locs(idx.text);
  ok(children.length >= 1, `sitemap index lists ${children.length} children`);
  if (children.length < 2) notes.push("WARNING: only the static-pages sitemap exists — entity tables are empty (no insiders/congress/companies/stocks yet)");
  let total = 0;
  for (const c of children) {
    const child = await get(c.replace(/^https?:\/\/[^/]+/, ""));
    const urls = locs(child.text);
    ok(child.status === 200 && child.text.includes("<urlset"), `child ${c} status ${child.status} / not a urlset`);
    ok(urls.length > 0, `child ${c} has no URLs`);
    ok(urls.every((u) => /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(child.text)), `child ${c} missing lastmod`);
    total += urls.length;
    notes.push(`${c.split("/").pop()}: ${urls.length} URLs`);
    const paths = urls.map((u) => u.replace(/^https?:\/\/[^/]+/, ""));
    // deterministic spread: first, last, and evenly spaced middles
    const pick = new Set();
    if (SAMPLE >= paths.length) paths.forEach((p) => pick.add(p));
    else for (let i = 0; i < SAMPLE; i++) pick.add(paths[Math.floor((i * (paths.length - 1)) / (SAMPLE - 1))]);
    for (const p of pick) sampled.push(p);
  }
  notes.push(`total URLs in sitemaps: ${total}`);
}
// 4. sample pages
for (const path of sampled) {
  const r = await get(path);
  if (!ok(r.status === 200, `${path} status ${r.status}`)) continue;
  const html = r.text;
  const ld = jsonLdBlocks(html);
  ok(ld.length > 0, `${path} has no JSON-LD`);
  ok(!ld.some((b) => b.__parseError), `${path} JSON-LD parse error`);
  if (path !== "/") ok(ld.some((b) => b["@type"] === "BreadcrumbList" && Array.isArray(b.itemListElement) && b.itemListElement.length > 0), `${path} missing BreadcrumbList`);
  const want = expectedType(path);
  if (want) ok(ld.some((b) => b["@type"] === want && b.name && b.url), `${path} missing ${want} JSON-LD with name+url`);
  if (path !== "/" && !/^\/(methodology|corrections|rates\/treasury-yields|rates)\/$/.test(path)) {
    ok(html.includes('data-answer'), `${path} missing the answer block`);
    ok(/Last updated/.test(html), `${path} missing the last-updated stamp`);
  }
  ok(/Not investment advice|Draft — needs review/.test(html), `${path} missing the disclaimer`);
  // no data table without a body row
  for (const t of html.matchAll(/<table class="data[^"]*">([\s\S]*?)<\/table>/g)) {
    ok(/<tbody>[\s\S]*?<tr/.test(t[1]), `${path} has an empty data table`);
  }
  ok(!/>Soon</.test(html), `${path} still shows a "Soon" tag`);
}

console.log(`verify-live against ${base}`);
for (const n of notes) console.log(`  · ${n}`);
console.log(`  · sampled ${sampled.length} pages`);
if (failures.length) {
  console.log(`✗ ${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("✓ all checks passed");
