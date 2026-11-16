#!/usr/bin/env node
// After a deploy: does the Worker render the on-demand pages (stage 3a) on the live site?
//   node scripts/probe-od-live.mjs <site url> [<built sitemap dir>]
// Picks the first URL of each kind (insider, stock, company) from the build's market child
// sitemaps (web/dist/client/sitemaps/market-*.xml), requests it on the live site, and requires
// HTTP 200 and an <h1>. No market sitemap in the build (no market data yet) = nothing to probe, exit 0.
// A Cloudflare challenge is inconclusive (warning, exit 0), never a failure (lib/cf-challenge.mjs).
// Retries a few times: a page is rendered by the Worker from the database on its first request.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isCloudflareChallenge, warn } from "./lib/cf-challenge.mjs";

const site = (process.argv[2] ?? "https://spotthemoney.com").replace(/\/$/, "");
const dir = process.argv[3] ?? join(new URL("../web/dist/client/sitemaps", import.meta.url).pathname);
if (!existsSync(dir)) { console.log(`probe-od: ${dir} not found; nothing to probe`); process.exit(0); }
const first = (prefix, re) => {
  for (const f of readdirSync(dir).filter((x) => x.startsWith(prefix)).sort()) {
    const m = readFileSync(join(dir, f), "utf8").match(re);
    if (m) return m[1];
  }
  return null;
};
const picks = [first("market-insiders-", /<loc>[^<]*(\/insiders\/[^<]+)<\/loc>/), first("market-stocks", /<loc>[^<]*(\/stocks\/[^<]+)<\/loc>/), first("market-companies", /<loc>[^<]*(\/companies\/[^<]+)<\/loc>/)].filter(Boolean);
if (picks.length === 0) { console.log("probe-od: the build has no market sitemaps; nothing to probe"); process.exit(0); }

let failed = 0, challenged = 0;
for (const path of picks) {
  const url = site + path;
  let verdict = "";
  for (let n = 1; n <= 4; n++) {
    if (n > 1) await new Promise((r) => setTimeout(r, 15_000));
    try {
      const res = await fetch(url, { headers: { "user-agent": "spotthemoney-deploy-check (+https://spotthemoney.com)" }, signal: AbortSignal.timeout(30_000) });
      const body = await res.text();
      if (isCloudflareChallenge(res.status, res.headers, body)) { verdict = "challenge"; break; }
      if (res.status === 200 && /<h1[ >]/.test(body)) { verdict = "ok"; break; }
      verdict = `HTTP ${res.status}${/<h1[ >]/.test(body) ? "" : ", no h1"}`;
    } catch (e) { verdict = `network error: ${e.message}`; }
  }
  if (verdict === "ok") console.log(`ok on-demand page: ${url}`);
  else if (verdict === "challenge") { challenged++; warn(`${url} answered with a Cloudflare challenge; the on-demand page could not be read from this runner`); }
  else { failed++; console.log(`FAIL on-demand page ${url}: ${verdict}`); }
}
if (challenged) console.log("INCONCLUSIVE for the challenged pages (not a failure)");
process.exit(failed ? 1 : 0);
