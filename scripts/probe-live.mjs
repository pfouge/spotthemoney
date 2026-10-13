#!/usr/bin/env node
// Is the new build serving on the public domain?   node scripts/probe-live.mjs <url> <expected text>
//
// deploy.yml's "Verify the live site" step. Retries for up to ~2 minutes (edge propagation is not
// instant; 2026-09-27 a one-shot check failed 15 s after a deploy that was in fact live) and ends
// with one of three results:
//   PASS          HTTP 200 and the expected text is on the page                 → exit 0
//   INCONCLUSIVE  Cloudflare answered with a challenge instead of the page      → exit 0 + warning
//                 (Bot Fight Mode challenges GitHub's runners; see lib/cf-challenge.mjs). The
//                 deploy itself is proven separately by the version check in deploy.yml.
//   FAIL          anything else after every attempt (5xx, 404, wrong content)   → exit 1
// Options: --attempts N (default 8), --interval S (default 15), --fail-on-challenge.
import { isCloudflareChallenge, warn } from "./lib/cf-challenge.mjs";

const [url, expected] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const opt = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const attempts = opt("--attempts", 8), interval = opt("--interval", 15);
if (!url || !expected) { console.error("usage: probe-live.mjs <url> <expected text> [--attempts N] [--interval S]"); process.exit(2); }

let challenges = 0, last = "";
for (let n = 1; n <= attempts; n++) {
  if (n > 1 || interval > 0) await new Promise((r) => setTimeout(r, interval * 1000));
  let status = 0, body = "", headers = new Headers();
  try {
    const res = await fetch(url, { headers: { "user-agent": "spotthemoney-deploy-check (+https://spotthemoney.com)" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    status = res.status; headers = res.headers; body = await res.text();
  } catch (e) { last = `network error: ${e.message}`; console.log(`… attempt ${n}: ${last}`); continue; }
  if (status === 200 && body.includes(expected)) { console.log(`✓ live (attempt ${n}): ${url}`); process.exit(0); }
  if (isCloudflareChallenge(status, headers, body)) {
    challenges++;
    console.log(`… attempt ${n}: HTTP ${status}, Cloudflare challenge (cf-mitigated: ${headers.get("cf-mitigated") ?? "—"}, ray ${headers.get("cf-ray") ?? "—"})`);
    // A challenge does not go away on retry from the same network; two in a row is enough to know.
    if (challenges >= 2 && !process.argv.includes("--fail-on-challenge")) {
      warn(`${url} answered with a Cloudflare challenge (Bot Fight Mode) — the live content could not be read from this runner. The deployed version was checked through the Cloudflare API instead.`);
      console.log("INCONCLUSIVE — not a failure");
      process.exit(0);
    }
    continue;
  }
  last = `HTTP ${status}, expected text ${body.includes(expected) ? "found" : "not found"}`;
  console.log(`… attempt ${n}: ${last}`);
}
console.log(`✗ live check failed for ${url} after ${attempts} attempts (${challenges ? `${challenges} challenged, ` : ""}last: ${last || "challenge"})`);
process.exit(1);
