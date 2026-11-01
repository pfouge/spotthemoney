#!/usr/bin/env node
// scripts/check-articles.mjs — check every article and author file before opening a pull request.
//
//   npm run check:articles
//
// Plain Node, no dependencies. It repeats the rules of web/src/content.config.ts (the build
// enforces those too) and adds checks the build cannot make: that links in the article body
// point at articles, authors and images that exist. One line per article (OK, or each error);
// a WARN does not fail the run; exit code 1 when any file has an error. Contributor guide:
// PUBLISHING-ARTICLES.md.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLES = join(ROOT, "web/src/content/articles");
const AUTHORS = join(ROOT, "web/src/content/authors");
const PUBLIC = join(ROOT, "web/public");
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ARTICLE_KEYS = ["title", "deck", "published", "updated", "author", "tags", "original", "image", "draft"];
const AUTHOR_KEYS = ["name", "bio", "url", "x", "linkedin", "github"];

// ── A tiny parser for the simple YAML used in article front matter ─────────────────────────
// Supports: `key: value` with plain, "double-quoted" and 'single-quoted' strings, true/false,
// dates (2026-11-01), numbers, inline lists [a, "b"], dash lists on the following lines, and
// # comments. Anything else (multi-line values, nesting) is reported as unsupported.
function splitInline(s) {
  const out = [];
  let cur = "", q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ",") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (q) throw new Error("unterminated quote in list");
  if (cur.trim() !== "" || out.length) out.push(cur.trim());
  return out.filter((x) => x !== "");
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "") return { type: "null", value: null };
  if (s[0] === '"') {
    const m = s.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/);
    if (!m) throw new Error(`bad double-quoted string: ${s}`);
    let v;
    try { v = JSON.parse(`"${m[1]}"`); } catch { throw new Error(`bad escape in quoted string: ${s}`); }
    return { type: "string", value: v };
  }
  if (s[0] === "'") {
    const m = s.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
    if (!m) throw new Error(`bad single-quoted string: ${s}`);
    return { type: "string", value: m[1].replace(/''/g, "'") };
  }
  const v = s.replace(/\s+#.*$/, "").trim(); // trailing comment on a plain value
  if (/^[\[{*&!|>%@`]/.test(v)) throw new Error(`a value cannot start with "${v[0]}" unless it is quoted: ${v}`);
  if (/:\s/.test(v) || v.endsWith(":")) throw new Error(`the value contains ": ", which YAML reads as a new key. Wrap the whole value in double quotes: ${v}`);
  if (v === "true") return { type: "bool", value: true };
  if (v === "false") return { type: "bool", value: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { type: "date", value: v };
  if (/^-?\d+(\.\d+)?$/.test(v)) return { type: "number", value: Number(v) };
  return { type: "string", value: v };
}

function parseFrontMatter(text) {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = src.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { error: 'no front matter: the file must start with a line of "---", the fields, then another line of "---"' };
  const body = src.slice(m[0].length);
  const fields = new Map();
  const errors = [];
  const failed = new Set(); // keys whose value could not be read (reported once, not also as missing)
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 2; // file line number (line 1 is the opening ---)
    if (/^\s*(#.*)?$/.test(line)) continue;
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/);
    if (!kv) { errors.push(`line ${n}: cannot read "${line.trim()}" (expected "key: value"; nested or multi-line values are not supported)`); continue; }
    const [, key, rest = ""] = kv;
    if (fields.has(key)) { errors.push(`line ${n}: "${key}" appears twice`); continue; }
    try {
      const r = rest.trim();
      if (r === "" || r.startsWith("#")) {
        const items = [];
        while (i + 1 < lines.length && /^\s*-(\s|$)/.test(lines[i + 1])) {
          i++;
          const item = parseScalar(lines[i].replace(/^\s*-\s*/, ""));
          items.push(item.value);
        }
        if (items.length) fields.set(key, { type: "list", value: items });
        else fields.set(key, { type: "null", value: null });
      } else if (r[0] === "[") {
        const mm = r.match(/^\[(.*)\]\s*(?:#.*)?$/);
        if (!mm) throw new Error(`bad list: ${r}`);
        fields.set(key, { type: "list", value: splitInline(mm[1]).map((x) => parseScalar(x).value) });
      } else {
        fields.set(key, parseScalar(r));
      }
    } catch (e) {
      errors.push(`line ${n}: ${key}: ${e.message}`);
      failed.add(key);
    }
  }
  return { fields, errors, body, failed };
}

// ── Checks ────────────────────────────────────────────────────────────────────────────────
const isRealDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const dateText = (f) => (f && (f.type === "date" || f.type === "string") ? f.value : null);
const today = new Date().toISOString().slice(0, 10);

function readAuthor(slug) {
  const file = join(AUTHORS, `${slug}.json`);
  if (!existsSync(file)) return { error: `author "${slug}" has no file web/src/content/authors/${slug}.json (add it in the same pull request)` };
  try {
    const a = JSON.parse(readFileSync(file, "utf8"));
    if (!a || typeof a !== "object" || Array.isArray(a)) return { error: `web/src/content/authors/${slug}.json must contain a JSON object` };
    if (typeof a.name !== "string" || a.name.trim() === "") return { error: `web/src/content/authors/${slug}.json has no "name"` };
    return { author: a };
  } catch (e) {
    return { error: `web/src/content/authors/${slug}.json is not valid JSON (${e.message})` };
  }
}

const listDir = (dir, ext) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext) && !f.startsWith(".")).sort() : []);
const articleSlugs = new Set(listDir(ARTICLES, ".md").map((f) => f.replace(/\.md$/, "")));

function checkArticle(file) {
  const errors = [];
  const warns = [];
  const slug = file.replace(/\.md$/, "");
  if (!SLUG_RE.test(slug)) errors.push(`file name "${file}" must be lowercase letters, digits and single hyphens, like my-first-article.md (it becomes the URL)`);

  const fm = parseFrontMatter(readFileSync(join(ARTICLES, file), "utf8"));
  if (fm.error) return { errors: [fm.error, ...errors], warns };
  errors.push(...fm.errors);
  const f = fm.fields;

  for (const k of f.keys()) if (!ARTICLE_KEYS.includes(k)) warns.push(`unknown field "${k}" is ignored by the build (check the spelling)`);
  for (const k of ["title", "deck", "published", "author"]) if (!fm.failed.has(k) && (!f.has(k) || f.get(k).type === "null")) errors.push(`missing required field "${k}"`);

  const str = (k) => (f.has(k) && f.get(k).type !== "null" ? f.get(k) : null);
  const title = str("title");
  if (title) {
    if (title.type !== "string") errors.push(`title must be text, got ${title.type}; wrap it in quotes`);
    else if (title.value.length > 60) errors.push(`title is ${title.value.length} characters; the limit is 60`);
  }
  const deck = str("deck");
  if (deck) {
    if (deck.type !== "string") errors.push(`deck must be text, got ${deck.type}; wrap it in quotes`);
    else if (deck.value.length < 70 || deck.value.length > 155) errors.push(`deck is ${deck.value.length} characters; it must be 70 to 155`);
  }

  let published = null;
  if (str("published")) {
    published = dateText(f.get("published"));
    if (!published || !isRealDate(published)) { errors.push(`published must be a real date written YYYY-MM-DD, got "${f.get("published").value}"`); published = null; }
  }
  if (str("updated")) {
    const updated = dateText(f.get("updated"));
    if (!updated || !isRealDate(updated)) errors.push(`updated must be a real date written YYYY-MM-DD, got "${f.get("updated").value}"`);
    else if (published && updated < published) errors.push(`updated (${updated}) is before published (${published})`);
  }

  const author = str("author");
  if (author) {
    if (author.type !== "string" || !SLUG_RE.test(author.value)) errors.push(`author must be an author file name without .json (lowercase letters, digits, hyphens), got "${author.value}"`);
    else { const r = readAuthor(author.value); if (r.error) errors.push(r.error); }
  }

  if (f.has("tags") && f.get("tags").type !== "null") {
    const t = f.get("tags");
    if (t.type !== "list") errors.push('tags must be a list, like tags: [congress, disclosure]');
    else for (const x of t.value) {
      if (typeof x !== "string" || x.trim() === "") errors.push(`tags must be non-empty text, got "${x}"`);
      else if (x !== x.toLowerCase()) errors.push(`tag "${x}" must be lowercase`);
    }
  }

  const original = str("original");
  if (original) {
    let ok = false;
    try { ok = original.type === "string" && /^https?:$/.test(new URL(original.value).protocol); } catch { /* not a URL */ }
    if (!ok) errors.push(`original must be an http(s) URL, got "${original.value}"`);
  }

  const image = str("image");
  if (image) {
    if (image.type !== "string" || !/^\/writing\/\S+$/.test(image.value)) errors.push(`image must be a site path starting with /writing/, got "${image.value}"`);
    else if (image.value.includes("..") || !existsSync(join(PUBLIC, image.value))) errors.push(`image file not found: web/public${image.value}`);
  }

  if (f.has("draft") && f.get("draft").type !== "null" && f.get("draft").type !== "bool") errors.push(`draft must be true or false, got "${f.get("draft").value}"`);

  // Links in the body: to other articles, author pages and files under /writing/.
  const targets = new Set();
  for (const m of fm.body.matchAll(/(?:\]\(\s*<?|href\s*=\s*["']|src\s*=\s*["'])((?:https?:\/\/(?:www\.)?spotthemoney\.com)?\/writing\/[^\s)"'>]*)/g)) targets.add(m[1]);
  for (const t of targets) {
    const path = t.replace(/^https?:\/\/(?:www\.)?spotthemoney\.com/, "").replace(/[#?].*$/, "");
    let m;
    if (path === "/writing/" || path === "/writing/rss.xml") continue;
    if ((m = path.match(/^\/writing\/authors\/([^/]+)\/?$/))) {
      if (!existsSync(join(AUTHORS, `${m[1]}.json`))) errors.push(`link ${t} points to an author with no file (web/src/content/authors/${m[1]}.json)`);
    } else if ((m = path.match(/^\/writing\/([^/]+)\/?$/))) {
      if (!articleSlugs.has(m[1])) errors.push(`link ${t} points to an article with no file (web/src/content/articles/${m[1]}.md)`);
    } else if (/^\/writing\/[^/]+\/.+/.test(path)) {
      if (!existsSync(join(PUBLIC, path))) errors.push(`file not found for ${t}: web/public${path}`);
    }
  }

  if (fm.body.trim() === "") warns.push("the article body is empty");
  const isDraft = f.has("draft") && f.get("draft").value === true;
  if (published && published > today && !isDraft) warns.push(`published ${published} is in the future: it goes live on the first deploy on or after ${published}`);
  return { errors, warns, isDraft };
}

function checkAuthor(file) {
  const errors = [];
  const warns = [];
  const slug = file.replace(/\.json$/, "");
  if (!SLUG_RE.test(slug)) errors.push(`file name "${file}" must be lowercase letters, digits and single hyphens, like jane-doe.json (it becomes the URL)`);
  let a;
  try { a = JSON.parse(readFileSync(join(AUTHORS, file), "utf8")); } catch (e) { return { errors: [`not valid JSON (${e.message})`, ...errors], warns }; }
  if (!a || typeof a !== "object" || Array.isArray(a)) return { errors: ["must contain a JSON object", ...errors], warns };
  if (typeof a.name !== "string" || a.name.trim() === "") errors.push('missing required field "name"');
  if (a.bio !== undefined && (typeof a.bio !== "string" || a.bio.length > 300)) errors.push(`bio must be text of at most 300 characters${typeof a.bio === "string" ? ` (it is ${a.bio.length})` : ""}`);
  for (const k of ["url", "x", "linkedin", "github"]) if (a[k] !== undefined && typeof a[k] !== "string") errors.push(`${k} must be text`);
  for (const k of Object.keys(a)) if (!AUTHOR_KEYS.includes(k)) warns.push(`unknown field "${k}" is ignored by the build (check the spelling)`);
  return { errors, warns };
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────
let failed = 0;
const report = (label, r, okNote = "") => {
  if (r.errors.length === 0) console.log(`OK    ${label}${okNote}`);
  for (const e of r.errors) console.log(`ERROR ${label}: ${e}`);
  for (const w of r.warns) console.log(`WARN  ${label}: ${w}`);
  if (r.errors.length) failed++;
};

const articleFiles = listDir(ARTICLES, ".md");
const authorFiles = listDir(AUTHORS, ".json");
if (articleFiles.length === 0) console.log("No articles yet (web/src/content/articles/ has no .md files).");
for (const f of articleFiles) { const r = checkArticle(f); report(`articles/${f}`, r, r.isDraft ? " (draft: hidden until draft is removed)" : ""); }
if (authorFiles.length === 0) console.log("No authors yet (web/src/content/authors/ has no .json files).");
for (const f of authorFiles) report(`authors/${f}`, checkAuthor(f));

console.log(failed ? `\n${failed} file(s) with errors.` : `\nChecked ${articleFiles.length} article(s) and ${authorFiles.length} author(s): no errors.`);
process.exit(failed ? 1 : 0);
