#!/usr/bin/env node
// Did the version we just uploaded become the live one?
//   node scripts/check-deployed-version.mjs <wrangler-deploy.log> <deployments-status.json>
//
// The first file is the output of `wrangler deploy` (it prints "Current Version ID: <uuid>"); the
// second is `wrangler deployments status --json` run right after, which asks Cloudflare's API for
// the Worker's active deployment. Passes when that deployment sends 100% of traffic to our
// version. This is the proof the deploy worked, and unlike fetching the website it cannot be
// blocked by Bot Fight Mode (deploy.yml, 2026-10-12).
import { readFileSync } from "node:fs";

export function versionFromDeployLog(text) {
  const m = String(text).match(/Current Version ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}
/** The JSON may be preceded by wrangler's warnings on the same stream; take the outermost object. */
export function parseStatus(text) {
  const s = String(text), i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("no JSON object in the deployments status output");
  return JSON.parse(s.slice(i, j + 1));
}
export function checkVersion(version, status) {
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const hit = versions.find((v) => String(v.version_id).toLowerCase() === version);
  if (!version) return { ok: false, why: "no \"Current Version ID\" in the wrangler deploy output" };
  if (!hit) return { ok: false, why: `version ${version} is not in the active deployment (${versions.map((v) => `${v.version_id} ${v.percentage}%`).join(", ") || "no versions"})` };
  if (Number(hit.percentage) !== 100) return { ok: false, why: `version ${version} has only ${hit.percentage}% of traffic` };
  return { ok: true, why: `version ${version} serves 100% of traffic (deployment ${status.id ?? "?"}, created ${status.created_on ?? "?"})` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [logFile, statusFile] = process.argv.slice(2);
  if (!logFile || !statusFile) { console.error("usage: check-deployed-version.mjs <deploy.log> <status.json>"); process.exit(2); }
  let res;
  try { res = checkVersion(versionFromDeployLog(readFileSync(logFile, "utf8")), parseStatus(readFileSync(statusFile, "utf8"))); }
  catch (e) { res = { ok: false, why: e.message }; }
  console.log(`${res.ok ? "✓" : "✗"} ${res.why}`);
  process.exit(res.ok ? 0 : 1);
}
