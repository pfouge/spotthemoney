#!/usr/bin/env node
// Keeps the guides in step with the site. Run it after ANY change to the site, and before
// every push that touches web/, ingest/ or shared/:
//
//   node scripts/verify-guides.mjs http://127.0.0.1:4321      (a local build being served)
//   node scripts/verify-guides.mjs https://spotthemoney.com   (the live site)
//
// It fails when:
//   1. STALE   a source file (or one named function/constant in it) that a guide describes has
//              changed since the guide was last reviewed against it. Re-read the guide, fix the
//              wording if the behaviour it describes changed, then record the review:
//                  node scripts/verify-guides.mjs --accept <slug>      (or: --accept all)
//   2. LABEL   an on-screen label a guide quotes is no longer on the page it names.
//   3. LINK    an internal link in a guide does not resolve, or its #anchor is gone.
//   4. FACT    a dated outside fact (web/src/lib/guides/facts.ts) is past its re-check date.
//   5. SHAPE   a guide is missing parts or is too thin.
// With --external it also requests every outside link (needs open network access).
//
// The review record is web/src/lib/guides/reviewed.json: for each guide, a short hash of each
// thing it covers. Hashes ignore line endings, so Windows and Linux checkouts agree.
// What each guide covers is declared on the guide (`covers`, `ui`, `facts` in lib/guides/*.ts)
// and published at /data/guides.json, which is what this script reads.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWED = join(ROOT, "web/src/lib/guides/reviewed.json");
const args = process.argv.slice(2);
const acceptIdx = args.indexOf("--accept");
const accept = acceptIdx >= 0 ? args[acceptIdx + 1] : null;
const external = args.includes("--external");
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");

const DECL = /^(export\s+)?(default\s+)?(async\s+)?(function\*?|const|let|var|class|interface|type|enum|def)\s+/;
/** Hash of a whole file, or of one top-level declaration when the cover is "file#name". */
function coverHash(cover) {
  const [file, symbol] = cover.split("#");
  const path = join(ROOT, file);
  if (!existsSync(path)) return { error: `${file} does not exist` };
  let text = readFileSync(path, "utf8").replace(/\r/g, "");
  if (symbol) {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => DECL.test(l) && new RegExp(`^(export\\s+)?(default\\s+)?(async\\s+)?(function\\*?|const|let|var|class|interface|type|enum|def)\\s+${symbol}\\b`).test(l));
    if (start < 0) return { error: `${symbol} is no longer declared in ${file}` };
    let end = start + 1;
    while (end < lines.length && !DECL.test(lines[end])) end++;
    text = lines.slice(start, end).join("\n").replace(/\s+$/, "");
  }
  return { hash: createHash("sha256").update(text).digest("hex").slice(0, 16) };
}

async function get(path) {
  const url = path.startsWith("http") ? path : base + path;
  try { const r = await fetch(url, { redirect: "follow" }); return { status: r.status, text: r.status === 200 ? await r.text() : "" }; }
  catch (e) { return { status: 0, text: "", error: String(e).slice(0, 100) }; }
}

const index = await get("/data/guides.json");
if (index.status !== 200) { console.error(`Could not read ${base}/data/guides.json (HTTP ${index.status}${index.error ? ", " + index.error : ""}). Is the site built and served?`); process.exit(2); }
const { guides, facts } = JSON.parse(index.text);
const reviewed = existsSync(REVIEWED) ? JSON.parse(readFileSync(REVIEWED, "utf8")) : {};
const today = new Date().toISOString().slice(0, 10);

// ── --accept: record that a guide was re-read against the current code ────────────────────
if (accept) {
  const targets = accept === "all" ? guides : guides.filter((g) => g.slug === accept);
  if (targets.length === 0) { console.error(`No guide with slug "${accept}". Slugs: ${guides.map((g) => g.slug).join(", ")}`); process.exit(2); }
  for (const g of targets) {
    const covers = {};
    for (const c of g.covers) { const h = coverHash(c); if (h.error) { console.error(`✗ ${g.slug}: ${h.error}. Fix the guide's "covers" list first.`); process.exit(1); } covers[c] = h.hash; }
    reviewed[g.slug] = { reviewed: today, covers };
  }
  for (const slug of Object.keys(reviewed)) if (!guides.some((g) => g.slug === slug)) delete reviewed[slug];
  const sorted = Object.fromEntries(Object.keys(reviewed).sort().map((k) => [k, reviewed[k]]));
  writeFileSync(REVIEWED, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`✓ recorded review of ${targets.length} guide(s) on ${today} in web/src/lib/guides/reviewed.json`);
  process.exit(0);
}

const fail = { STALE: [], LABEL: [], LINK: [], FACT: [], SHAPE: [], EXTERNAL: [] };

// 1. STALE
for (const g of guides) {
  const rec = reviewed[g.slug];
  if (!rec) { fail.STALE.push(`${g.slug}: never reviewed (run --accept ${g.slug} after reading it against the site)`); continue; }
  for (const c of g.covers) {
    const h = coverHash(c);
    if (h.error) fail.STALE.push(`${g.slug}: ${h.error}`);
    else if (rec.covers?.[c] !== h.hash) fail.STALE.push(`${g.slug}: ${c} changed since the guide was reviewed on ${rec.reviewed}`);
  }
}

// 2. LABEL and 3. LINK share page fetches
const pages = new Map();
const page = async (path) => { const p = path.split("#")[0]; if (!pages.has(p)) pages.set(p, await get(p)); return pages.get(p); };
const decode = (s) => s.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
for (const g of guides) {
  for (const u of g.ui) {
    const p = await page(u.on);
    if (p.status !== 200) fail.LABEL.push(`${g.slug}: page ${u.on} returned ${p.status}`);
    else if (!decode(p.text).includes(u.text)) fail.LABEL.push(`${g.slug}: "${u.text.replace(/^>|<$/g, "")}" is no longer on ${u.on}`);
  }
  for (const href of g.internal) {
    const p = await page(href);
    if (p.status !== 200) { fail.LINK.push(`${g.slug}: ${href} returned ${p.status}`); continue; }
    const anchor = href.split("#")[1];
    if (anchor && !new RegExp(`\\bid="${anchor}"`).test(p.text)) fail.LINK.push(`${g.slug}: ${href} — no element with id "${anchor}"`);
  }
  // the guide page itself
  const self = await page(g.path);
  if (self.status !== 200) fail.SHAPE.push(`${g.slug}: its own page returned ${self.status}`);
  else {
    if (!self.text.includes('"@type":"FAQPage"')) fail.SHAPE.push(`${g.slug}: no FAQPage markup on the page`);
    if (!self.text.includes('"@type":"Article"')) fail.SHAPE.push(`${g.slug}: no Article markup on the page`);
  }
  if (g.words < 450) fail.SHAPE.push(`${g.slug}: only ${g.words} words`);
  if (g.sections < 4) fail.SHAPE.push(`${g.slug}: only ${g.sections} sections`);
  if (g.faqs < 3) fail.SHAPE.push(`${g.slug}: only ${g.faqs} questions`);
  if (g.internal.length < 4) fail.SHAPE.push(`${g.slug}: only ${g.internal.length} internal links`);
  if (g.external.length < 2) fail.SHAPE.push(`${g.slug}: only ${g.external.length} outside sources`);
}

// 4. FACT
for (const [key, f] of Object.entries(facts)) {
  if (f.recheckBy < today) fail.FACT.push(`${key}: checked ${f.asOf}, re-check was due ${f.recheckBy} — confirm against ${f.source}, then update facts.ts (used by: ${guides.filter((g) => g.facts.includes(key)).map((g) => g.slug).join(", ") || "no guide"})`);
}
for (const g of guides) for (const k of g.facts) if (!facts[k]) fail.SHAPE.push(`${g.slug}: uses unknown fact "${k}"`);

// 5. --external
if (external) {
  const urls = [...new Set(guides.flatMap((g) => g.external))];
  for (const url of urls) {
    try { const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "spotthemoney.com link check (contact@spotthemoney.com)" } }); if (r.status >= 400 && r.status !== 403 && r.status !== 429) fail.EXTERNAL.push(`${url} returned ${r.status}`); }
    catch (e) { fail.EXTERNAL.push(`${url} — ${String(e).slice(0, 80)}`); }
    await new Promise((r) => setTimeout(r, 400));
  }
}

const total = Object.values(fail).reduce((n, a) => n + a.length, 0);
if (total) {
  console.error(`✗ guides are out of step with the site (${total} finding${total === 1 ? "" : "s"}):`);
  for (const [kind, items] of Object.entries(fail)) for (const m of items) console.error(`  [${kind}] ${m}`);
  if (fail.STALE.length) console.error(`\n  For each STALE guide: read it against the changed file, edit the guide if its wording is now wrong\n  (and set its "updated" date), then run:  node scripts/verify-guides.mjs --accept <slug>`);
  process.exit(1);
}
const nextFact = Object.entries(facts).sort((a, b) => a[1].recheckBy.localeCompare(b[1].recheckBy))[0];
console.log(`✓ ${guides.length} guides in step with the site: ${guides.reduce((n, g) => n + g.covers.length, 0)} covered files unchanged since review, ${guides.reduce((n, g) => n + g.ui.length, 0)} on-screen labels present, ${guides.reduce((n, g) => n + g.internal.length, 0)} internal links resolve, ${Object.keys(facts).length} dated facts current${nextFact ? ` (next re-check: ${nextFact[0]} by ${nextFact[1].recheckBy})` : ""}${external ? ", outside links answered" : ""}`);
