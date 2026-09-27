#!/usr/bin/env node
// IndexNow ping after a deploy (roadmap B.2). Reads the child sitemaps from the BUILT site
// (web/dist/client/sitemaps/*.xml), selects URLs whose <lastmod> is within the last
// INDEXNOW_DAYS days (default 2 — i.e. pages whose data changed since the previous daily
// deploy, not the whole site every time), and POSTs them in one batch to api.indexnow.org,
// which fans out to Bing, Yandex, Seznam, Naver and any other IndexNow engine.
//
// Key: the file name of web/public/<key>.txt (IndexNow keys are public by design — the
// engine fetches https://spotthemoney.com/<key>.txt to confirm ownership). Override with
// INDEXNOW_KEY. Never fails the deploy: a non-2xx is reported and exit code stays 0, because
// indexing hints are best-effort and the site is already live at this point.
//
//   node scripts/indexnow-ping.mjs                 # after `npm run build`
//   node scripts/indexnow-ping.mjs --dry-run       # print the URL list only

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "web", "dist", "client");
const dryRun = process.argv.includes("--dry-run");
const days = Number(process.env.INDEXNOW_DAYS ?? 2);
const host = (process.env.PUBLIC_SITE_URL ?? "https://spotthemoney.com").replace(/^https?:\/\//, "").replace(/\/$/, "");

const keyFromPublic = readdirSync(join(root, "web", "public")).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
const key = process.env.INDEXNOW_KEY ?? (keyFromPublic ? keyFromPublic.replace(/\.txt$/, "") : null);
if (!key) { console.log("indexnow: no key file in web/public (expected <32 hex>.txt) — skipping"); process.exit(0); }

const sitemapDir = join(dist, "sitemaps");
if (!existsSync(sitemapDir)) { console.log(`indexnow: ${sitemapDir} not found — build first; skipping`); process.exit(0); }

const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
const urls = new Set();
for (const f of readdirSync(sitemapDir).filter((f) => f.endsWith(".xml"))) {
  const xml = readFileSync(join(sitemapDir, f), "utf8");
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)) {
    if (m[2] >= cutoff) urls.add(m[1].trim());
  }
}
const list = [...urls].slice(0, 10000);
console.log(`indexnow: ${list.length} URL(s) with lastmod ≥ ${cutoff} (key …${key.slice(-6)})`);
if (dryRun || list.length === 0) { for (const u of list.slice(0, 20)) console.log("  ", u); process.exit(0); }

try {
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: list }),
  });
  console.log(`indexnow: HTTP ${res.status} ${res.status === 200 ? "OK" : res.status === 202 ? "accepted (key will be validated)" : await res.text()}`);
} catch (err) {
  console.log(`indexnow: request failed (${err instanceof Error ? err.message : err}) — non-fatal`);
}
