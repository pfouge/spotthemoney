#!/usr/bin/env node
// Local rig for the on-demand entity pages (stage 3a): the real Worker under `wrangler dev`
// against the fake Supabase of scripts/accounts-fakes.mjs, which runs every /rest/v1/rpc/od_*
// call as `select od_*()` in a local Postgres under role anon. Starts two Workers from the same
// build: 8787 as production would run (no parity switch) and 8788 with OD_PARITY=1 (test only).
// Stays up until killed. Never point it at production.
//
//   (build first, with DATABASE_URL set to the same local database)
//   node scripts/od-dev.mjs postgres://postgres@127.0.0.1:5433/stm_od
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { startFakes } from "./accounts-fakes.mjs";

const dbUrl = process.argv[2];
if (!dbUrl || /supabase\.(co|com)/.test(dbUrl)) { console.error("usage: node scripts/od-dev.mjs <local-database-url>"); process.exit(2); }
const fakes = await startFakes({ dbUrl });
const web = new URL("../web/", import.meta.url).pathname;
const devVars = web + "dist/server/.dev.vars";
writeFileSync(devVars, Object.entries({
  WORKOS_CLIENT_ID: "client_test", WORKOS_API_KEY: "sk_test_fake", WORKOS_COOKIE_PASSWORD: "x".repeat(40),
  SUPABASE_URL: "http://localhost:8702", SUPABASE_ANON_KEY: "anon-test-key", WORKOS_API_HOSTNAME: "localhost:8701",
}).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n");
const start = (port, inspector, extra) => spawn("npx", ["wrangler", "dev", "--config", "dist/server/wrangler.json", "--port", String(port), "--ip", "127.0.0.1",
  "--inspector-port", String(inspector), "--local-upstream", `localhost:${port}`, ...extra],
  { cwd: web, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
const a = start(8787, 9330, []);
let b;
for (const p of [a]) { p.stdout.on("data", () => {}); p.stderr.on("data", () => {}); }
const stop = async () => { a.kill("SIGTERM"); b?.kill("SIGTERM"); rmSync(devVars, { force: true }); await fakes.close(); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
// two workers starting at once get in each other's way: wait for the first, then start the second
async function ready(port) {
  for (let i = 0, good = 0; i < 120; i++) {
    try { const r = await fetch(`http://localhost:${port}/api/me`); good = r.status === 200 ? good + 1 : 0; } catch { good = 0; }
    if (good >= 3) return;
    await sleep(1000);
  }
  console.error(`worker on ${port} did not start`); await stop();
}
await ready(8787);
b = start(8788, 9331, ["--var", "OD_PARITY:1"]);
b.stdout.on("data", () => {}); b.stderr.on("data", () => {});
await ready(8788);
console.log("od-dev ready: worker http://localhost:8787 (production behaviour), http://localhost:8788 (parity switch)");
setInterval(() => {}, 1 << 30);
