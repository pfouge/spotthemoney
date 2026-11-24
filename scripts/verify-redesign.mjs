#!/usr/bin/env node
// Before/after regression checker for a presentation-only redesign.
// Usage: node verify-redesign.mjs <before-dir> <after-dir> [--base-before URL --base-after URL] [--pages a,b,c] [--browser]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Explicit allowances (things that may legitimately differ between two builds of the same code):
//  A1. JSON-LD dateModified / datePublished values (build time).
//  A2. head meta article:modified_time / article:published_time / dcterms.modified values (build time).
//  A3. Clock times such as "12:34 UTC" or "12:34:56" in <main> text are ignored for the text check.
//  A4. Browser mode: console "Failed to load resource" errors for other origins (ads, widgets, offline sandbox).
const ALLOWANCES = ["A1 JSON-LD dateModified/datePublished values", "A2 head modified/published time metas", "A3 clock times in main text", "A4 cross-origin resource load errors (browser)"];

const args = process.argv.slice(2);
const pos = [];
const opt = { browser: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--browser") opt.browser = true;
  else if (a === "--base-before") opt.baseBefore = args[++i];
  else if (a === "--base-after") opt.baseAfter = args[++i];
  else if (a === "--pages") opt.pages = args[++i];
  else pos.push(a);
}
if (pos.length < 2) {
  console.error("usage: verify-redesign.mjs <before-dir> <after-dir> [--base-before URL --base-after URL] [--pages a,b,c] [--browser]");
  process.exit(2);
}
const [beforeDir, afterDir] = pos.map((p) => path.resolve(p));
opt.baseAfter ||= "http://127.0.0.1:4810";
opt.baseBefore ||= "http://127.0.0.1:4800";

// ---------- tolerant HTML parser ----------
const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW = new Set(["script", "style", "textarea", "title"]);
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", middot: "·", times: "×", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", bull: "•", larr: "←", rarr: "→", minus: "−", laquo: "«", raquo: "»", deg: "°", euro: "€", pound: "£" };
const decode = (s) => s.indexOf("&") < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});
const IMPLIED = { li: [["li"], ["ul", "ol", "menu"]], tr: [["tr", "td", "th"], ["table", "tbody", "thead", "tfoot"]], td: [["td", "th"], ["tr", "table"]], th: [["td", "th"], ["tr", "table"]], option: [["option"], ["select", "datalist", "optgroup"]], dt: [["dt", "dd"], ["dl"]], dd: [["dt", "dd"], ["dl"]], thead: [["thead", "tbody", "tfoot"], ["table"]], tbody: [["thead", "tbody", "tfoot"], ["table"]], tfoot: [["thead", "tbody", "tfoot"], ["table"]] };

function parse(html) {
  const root = { t: "el", tag: "#root", attrs: {}, kids: [], parent: null };
  let cur = root;
  const stack = [root];
  let i = 0;
  const n = html.length;
  const pushText = (v) => { if (v) cur.kids.push({ t: "tx", v, parent: cur }); };
  const popTo = (idx) => { stack.length = idx; cur = stack[idx - 1]; };
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { pushText(decode(html.slice(i))); break; }
    if (lt > i) pushText(decode(html.slice(i, lt)));
    i = lt;
    if (html.startsWith("<!--", i)) { const e = html.indexOf("-->", i + 4); i = e < 0 ? n : e + 3; continue; }
    if (html[i + 1] === "!" || html[i + 1] === "?") { const e = html.indexOf(">", i); i = e < 0 ? n : e + 1; continue; }
    if (html[i + 1] === "/") {
      const m = /^<\/([a-zA-Z][^\s>]*)[^>]*>/.exec(html.slice(i, i + 200));
      if (!m) { pushText("<"); i++; continue; }
      const tag = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { popTo(k); break; }
      i += m[0].length; continue;
    }
    const rest = html.slice(i, i + 20000);
    const m = /^<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/.exec(rest);
    if (!m) { pushText("<"); i++; continue; }
    const tag = m[1].toLowerCase();
    const attrs = {};
    const ar = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let am;
    while ((am = ar.exec(m[2]))) { const k = am[1].toLowerCase(); if (!(k in attrs)) attrs[k] = decode(am[2] ?? am[3] ?? am[4] ?? ""); }
    i += m[0].length;
    const imp = IMPLIED[tag];
    if (imp) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (imp[1].includes(stack[k].tag)) break;
        if (imp[0].includes(stack[k].tag)) { popTo(k); break; }
      }
    }
    const el = { t: "el", tag, attrs, kids: [], parent: cur };
    cur.kids.push(el);
    if (VOID.has(tag) || m[3] === "/" && !RAW.has(tag)) continue;
    if (RAW.has(tag)) {
      const cl = new RegExp("</" + tag + "\\s*>", "i");
      const sub = html.slice(i);
      const cm = cl.exec(sub);
      const body = cm ? sub.slice(0, cm.index) : sub;
      if (body) el.kids.push({ t: "tx", v: tag === "script" || tag === "style" ? body : decode(body), parent: el });
      i += cm ? cm.index + cm[0].length : sub.length;
      continue;
    }
    stack.push(el); cur = el;
  }
  return root;
}

function* walk(el) { yield el; for (const k of el.kids || []) if (k.t === "el") yield* walk(k); }
const find = (el, tag) => { for (const e of walk(el)) if (e.tag === tag) return e; return null; };
const INLINE = new Set("a span b i em strong small code sup sub abbr time mark u s bdi cite q kbd samp var tspan".split(" "));
const SKIP_TEXT = new Set(["script", "style", "template"]);
function textOf(el) {
  let out = "";
  (function rec(e) {
    for (const k of e.kids) {
      if (k.t === "tx") out += k.v;
      else if (!SKIP_TEXT.has(k.tag)) { const blk = !INLINE.has(k.tag); if (blk) out += " "; rec(k); if (blk) out += " "; }
    }
  })(el);
  return out;
}
const norm = (s) => s.replace(/\s+/g, " ").trim();
const cnt = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m; };
function msDiff(a, b) { // a,b arrays; returns items in a lacking in b, and in b lacking in a
  const ca = cnt(a), cb = cnt(b); const missing = [], extra = [];
  for (const [k, v] of ca) { const d = v - (cb.get(k) || 0); for (let i = 0; i < d; i++) missing.push(k); }
  for (const [k, v] of cb) { const d = v - (ca.get(k) || 0); for (let i = 0; i < d; i++) extra.push(k); }
  return { missing, extra };
}
const cut = (s, n = 80) => (s.length > n ? s.slice(0, n) + "…" : s);
const listFmt = (arr, n = 3) => arr.slice(0, n).map((x) => JSON.stringify(cut(String(x)))).join(", ") + (arr.length > n ? ` (+${arr.length - n} more)` : "");

// ---------- extraction ----------
function extract(html) {
  const root = parse(html);
  const head = find(root, "head") || root;
  const body = find(root, "body") || root;
  const main = find(root, "main");
  const info = { root, body, main };
  // head
  const h = [];
  const title = find(head, "title");
  h.push("title:" + norm(title ? textOf(title) : ""));
  for (const e of walk(root)) {
    if (e.tag === "meta") {
      const name = (e.attrs.name || e.attrs.property || e.attrs["http-equiv"] || "").toLowerCase();
      let c = e.attrs.content ?? "";
      if (name === "description" || name === "robots" || name.startsWith("og:") || name.startsWith("twitter:")) {
        if (/modified_time|published_time|modified/.test(name)) c = "<time>"; // A2
        h.push(`meta[${name}]:${c}`);
      }
    } else if (e.tag === "link") {
      const rel = (e.attrs.rel || "").toLowerCase();
      if (rel === "canonical") h.push("canonical:" + (e.attrs.href ?? ""));
      else if (rel.split(/\s+/).includes("alternate")) h.push(`alternate:${e.attrs.type || ""}|${e.attrs.hreflang || ""}|${e.attrs.title || ""}|${e.attrs.href || ""}`);
    }
  }
  info.head = h;
  // json-ld
  const mask = (v) => {
    if (Array.isArray(v)) return v.map(mask);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = k === "dateModified" || k === "datePublished" ? "<date>" : mask(v[k]); return o; } // A1
    return v;
  };
  info.jsonld = [];
  for (const e of walk(root)) if (e.tag === "script" && /ld\+json/i.test(e.attrs.type || "")) {
    const raw = e.kids.map((k) => k.v).join("").trim();
    try { info.jsonld.push(JSON.stringify(mask(JSON.parse(raw)))); } catch { info.jsonld.push("RAW:" + raw); }
  }
  // headings
  info.headings = [];
  for (const e of walk(body)) if (/^h[1-6]$/.test(e.tag)) info.headings.push(`${e.tag}|${norm(textOf(e))}`);
  const scope = main || body;
  // links
  info.links = new Set();
  for (const e of walk(scope)) if (e.tag === "a" && e.attrs.href != null) info.links.add(`${e.attrs.href}\u0001${norm(textOf(e))}`);
  // tokens
  const text = norm(textOf(scope)).replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:UTC|GMT|[ap]m))?/gi, " "); // A3
  info.tokens = text.match(/[\p{L}\p{N}]+/gu) || [];
  // ids and data-*
  info.ids = new Set();
  for (const e of walk(scope)) {
    if (e.attrs.id) info.ids.add("id=" + e.attrs.id);
    for (const k of Object.keys(e.attrs)) if (k.startsWith("data-")) info.ids.add(`${k}=${e.attrs[k]}`);
  }
  // tables
  info.tables = [];
  let lastHeading = "";
  (function rec(e, idAnc) {
    for (const k of e.kids) {
      if (k.t !== "el") continue;
      const anc = k.attrs.id || idAnc;
      if (/^h[1-6]$/.test(k.tag)) lastHeading = norm(textOf(k));
      if (k.tag === "table") {
        const rows = [...walk(k)].filter((r) => r.tag === "tr" && !(r.parent && r.parent.tag === "thead"));
        let n = 0;
        for (const r of rows) { let p = r.parent; while (p && p !== k && p.tag !== "table") p = p.parent; if (p === k) n++; }
        info.tables.push({ key: anc ? "#" + anc : "h:" + lastHeading, rows: n });
      }
      rec(k, anc);
    }
  })(scope, "");
  // forms
  info.forms = new Set();
  for (const e of walk(body)) if (["form", "input", "select", "button", "textarea"].includes(e.tag)) {
    if (e.attrs.id) info.forms.add(`${e.tag}#${e.attrs.id}`);
    if (e.attrs.name) info.forms.add(`${e.tag}[name=${e.attrs.name}]`);
  }
  return info;
}

// ---------- checks ----------
function compare(b, a) {
  const fails = []; // [check, detail]
  if (!!b.main !== !!a.main) fails.push(["main", b.main ? "<main> vanished" : "<main> appeared"]);
  { const d = msDiff(b.head, a.head); if (d.missing.length || d.extra.length) fails.push(["head", `lost ${listFmt(d.missing)}; added ${listFmt(d.extra)}`]); }
  { const d = msDiff(b.jsonld, a.jsonld); if (d.missing.length || d.extra.length) fails.push(["jsonld", `blocks differ: before-only ${listFmt(d.missing, 2)}; after-only ${listFmt(d.extra, 2)}`]); }
  { const d = msDiff(b.headings, a.headings); if (d.missing.length || d.extra.length) fails.push(["headings", `lost ${listFmt(d.missing)}; added ${listFmt(d.extra)}`]); }
  { const miss = [...b.links].filter((x) => !a.links.has(x)).map((x) => x.replace("\u0001", " => ")); if (miss.length) fails.push(["links", `${miss.length} missing: ${listFmt(miss, 4)}`]); }
  {
    const ca = cnt(a.tokens), cb = cnt(b.tokens), seen = new Set(), lost = [];
    for (let i = 0; i < b.tokens.length && lost.length < 10; i++) {
      const t = b.tokens[i];
      if (seen.has(t)) continue;
      if (cb.get(t) > (ca.get(t) || 0)) { seen.add(t); lost.push(`${t} (…${b.tokens.slice(Math.max(0, i - 3), i).join(" ")} [${t}] ${b.tokens.slice(i + 1, i + 3).join(" ")}…)`); }
    }
    if (lost.length) fails.push(["text", `lost tokens: ${lost.join("; ")}`]);
  }
  { const miss = [...b.ids].filter((x) => !a.ids.has(x)); if (miss.length) fails.push(["ids", `${miss.length} missing: ${miss.slice(0, 10).join(", ")}`]); }
  {
    const probs = [];
    if (b.tables.length !== a.tables.length) probs.push(`table count ${b.tables.length} -> ${a.tables.length}`);
    const idx = (ts) => { const m = new Map(), seen = new Map(); for (const t of ts) { const n = seen.get(t.key) || 0; seen.set(t.key, n + 1); m.set(`${t.key}@${n}`, t.rows); } return m; };
    const mb = idx(b.tables), ma = idx(a.tables);
    for (const [k, v] of mb) { if (!ma.has(k)) probs.push(`table ${k} not found`); else if (ma.get(k) !== v) probs.push(`table ${k} rows ${v} -> ${ma.get(k)}`); }
    if (probs.length) fails.push(["tables", probs.slice(0, 5).join("; ")]);
  }
  { const miss = [...b.forms].filter((x) => !a.forms.has(x)); if (miss.length) fails.push(["forms", `lost ${miss.slice(0, 10).join(", ")}`]); }
  return fails;
}

// ---------- page set ----------
function listPages(dir) {
  const out = new Map();
  (function rec(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) rec(path.join(d, e.name), rel + e.name + "/");
      else if (e.name === "index.html") out.set("/" + rel, path.join(d, e.name));
    }
  })(dir, "");
  return out;
}
const normPage = (p) => { p = p.trim(); if (!p.startsWith("/")) p = "/" + p; if (!p.endsWith("/")) p += "/"; return p; };

const t0 = Date.now();
const pb = listPages(beforeDir), pa = listPages(afterDir);
const failsByPage = new Map();
const counts = {};
const addFail = (page, check, detail) => { counts[check] = (counts[check] || 0) + 1; (failsByPage.get(page) || failsByPage.set(page, []).get(page)).push(`[${check}] ${detail}`); };
let pages;
if (opt.pages) pages = opt.pages.split(",").filter(Boolean).map(normPage);
else pages = [...new Set([...pb.keys(), ...pa.keys()])].sort();
for (const p of pages) {
  if (!pb.has(p) || !pa.has(p)) { addFail(p, "pages", pb.has(p) ? "URL vanished (only in before)" : pa.has(p) ? "URL appeared (only in after)" : "in neither build"); continue; }
  try {
    const b = extract(fs.readFileSync(pb.get(p), "utf8")), a = extract(fs.readFileSync(pa.get(p), "utf8"));
    for (const [c, d] of compare(b, a)) addFail(p, c, d);
  } catch (e) { addFail(p, "error", String(e && e.message || e)); }
}
const staticMs = Date.now() - t0;

// ---------- browser ----------
async function browserChecks() {
  const require = createRequire("/home/claude/wt/rd/package.json");
  const { chromium } = require("playwright");
  const valid = pages.filter((p) => pb.has(p) && pa.has(p));
  let sample;
  if (opt.pages) sample = valid;
  else {
    const types = new Map();
    for (const p of valid) { const t = p.split("/")[1] || "home"; (types.get(t) || types.set(t, []).get(t)).push(p); }
    sample = [];
    for (const [, l] of types) { sample.push(l[Math.floor(l.length / 2)]); }
    if (sample.length > 15) { const step = sample.length / 15; sample = Array.from({ length: 15 }, (_, i) => sample[Math.floor(i * step)]); }
    for (let i = 0; sample.length < 15 && i < valid.length; i++) { const p = valid[Math.floor(i * valid.length / 15)]; if (!sample.includes(p)) sample.push(p); }
  }
  const browser = await chromium.launch({ executablePath: "/home/claude/work/chrome-wrap.sh", args: ["--no-sandbox"] });
  const host = new URL(opt.baseAfter).host;
  try {
    for (const [w, h] of [[390, 844], [1280, 900]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addInitScript(() => {
        window.__cls = 0;
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
      });
      for (const p of sample) {
        const page = await ctx.newPage();
        const errs = [];
        page.on("console", (m) => { if (m.type() !== "error") return; const u = m.location().url || ""; let foreign = false; try { foreign = u && new URL(u).host !== host; } catch {} if (foreign && /Failed to load resource|ERR_/.test(m.text())) return; errs.push(cut(m.text(), 120)); }); // A4
        page.on("pageerror", (e) => errs.push("pageerror: " + cut(String(e.message || e), 120)));
        const tag = `${w}px`;
        try {
          await page.goto(opt.baseAfter.replace(/\/$/, "") + p, { waitUntil: "load", timeout: 30000 });
          await page.waitForTimeout(1500);
          const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, cls: window.__cls || 0 }));
          if (m.sw > m.cw + 1) addFail(p, "overflow", `${tag}: scrollWidth ${m.sw} > ${m.cw}`);
          if (m.cls > 0.05) addFail(p, "cls", `${tag}: CLS ${m.cls.toFixed(3)}`);
          if (errs.length) addFail(p, "console", `${tag}: ${errs.slice(0, 3).join(" | ")}`);
          const n = await page.locator("details").count();
          const bad = [];
          for (let i = 0; i < n; i++) {
            const d = page.locator("details").nth(i);
            if (!(await d.isVisible())) continue; // hidden by layout (e.g. other breakpoint): cannot be opened by a user
            await d.evaluate((el) => { el.open = false; });
            const sum = d.locator("> summary").first();
            if (await sum.count()) { try { await sum.scrollIntoViewIfNeeded({ timeout: 2000 }); await sum.click({ timeout: 3000 }); } catch { await d.evaluate((el) => { el.open = true; }); } }
            else await d.evaluate((el) => { el.open = true; });
            const ok = await d.evaluate((el) => {
              if (!el.open) return false;
              const kids = [...el.children].filter((c) => c.tagName !== "SUMMARY");
              if (!kids.length) return true;
              return kids.some((c) => { const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); return (r.width > 0 && r.height > 0 && cs.visibility !== "hidden") || c.textContent.trim() === ""; });
            });
            if (!ok) bad.push(i);
          }
          if (bad.length) addFail(p, "details", `${tag}: ${bad.length} of ${n} <details> not visible when opened (#${bad.slice(0, 5).join(",")})`);
        } catch (e) { addFail(p, "browser", `${tag}: ${cut(String(e.message || e), 120)}`); }
        await page.close();
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  return sample.length;
}
let sampled = 0;
if (opt.browser) { try { sampled = await browserChecks(); } catch (e) { addFail("(browser)", "browser", cut(String(e.message || e), 200)); } }

// ---------- report ----------
for (const [p, l] of [...failsByPage].sort()) console.log(`FAIL ${p}  ${l.join("  ")}`);
const failN = failsByPage.size;
const cs = Object.keys(counts).sort().map((k) => `${k}=${counts[k]}`).join(" ") || "none";
console.log(`verify-redesign: ${pages.length} pages, ${pages.length - [...failsByPage.keys()].filter((p) => pages.includes(p)).length} pass, ${failN} fail; ${cs}; static ${(staticMs / 1000).toFixed(1)}s${opt.browser ? `; browser sample ${sampled} pages x2 widths` : ""}; allowances: ${ALLOWANCES.map((x) => x.split(" ")[0]).join(",")}`);
process.exit(failN ? 1 : 0);
