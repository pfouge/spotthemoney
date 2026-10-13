// Offline tests for the deploy checks (2026-10-12): the Cloudflare challenge detector and the
// deployed-version check. Run:  npx tsx --test scripts/deploycheck.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs module
import { isCloudflareChallenge } from "./lib/cf-challenge.mjs";
// @ts-expect-error plain .mjs module
import { versionFromDeployLog, parseStatus, checkVersion } from "./check-deployed-version.mjs";

const CHALLENGE_HTML = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>';

test("challenge detection: header first, then a challenge body on 403/429/503 only", () => {
  assert.equal(isCloudflareChallenge(403, new Headers({ "cf-mitigated": "challenge" }), ""), true);
  assert.equal(isCloudflareChallenge(403, new Headers(), CHALLENGE_HTML), true);
  assert.equal(isCloudflareChallenge(503, { "cf-mitigated": "" }, CHALLENGE_HTML), true);
  assert.equal(isCloudflareChallenge(200, new Headers(), CHALLENGE_HTML), false, "a 200 page that mentions the words is the site");
  assert.equal(isCloudflareChallenge(403, new Headers(), "<h1>Forbidden</h1>"), false, "a plain 403 is a real failure");
  assert.equal(isCloudflareChallenge(500, new Headers(), "Internal error"), false);
  assert.equal(isCloudflareChallenge(404, new Headers(), CHALLENGE_HTML), false);
});

const LOG = `⛅️ wrangler 4.129.0\nTotal Upload: 25000 KiB\nUploaded spotthemoney (12.3 sec)\nDeployed spotthemoney triggers (1.1 sec)\n  spotthemoney.com (custom domain)\nCurrent Version ID: 6F2B8C1A-1D2E-4F50-9A8B-0C1D2E3F4A5B\n`;
const STATUS = (versions: { version_id: string; percentage: number }[]) =>
  `▲ [WARNING] Proxy environment variables detected.\n${JSON.stringify({ id: "dep-1", created_on: "2026-10-12T20:00:00Z", versions })}`;

test("version check: the uploaded version must serve 100% of traffic", () => {
  const v = versionFromDeployLog(LOG);
  assert.equal(v, "6f2b8c1a-1d2e-4f50-9a8b-0c1d2e3f4a5b");
  assert.equal(checkVersion(v, parseStatus(STATUS([{ version_id: v!, percentage: 100 }]))).ok, true);
  assert.match(checkVersion(v, parseStatus(STATUS([{ version_id: "00000000-0000-0000-0000-000000000000", percentage: 100 }]))).why, /not in the active deployment/);
  assert.match(checkVersion(v, parseStatus(STATUS([{ version_id: v!, percentage: 10 }, { version_id: "x", percentage: 90 }]))).why, /only 10%/);
  assert.equal(checkVersion(versionFromDeployLog("Uploaded, no id printed"), parseStatus(STATUS([]))).ok, false);
  assert.throws(() => parseStatus("not json at all"));
});
