#!/usr/bin/env node
// Fails the build if a secret was written into the output (web/dist): the Worker bundle or any
// static file. Run after `npm run build`, before `wrangler deploy`.
//
// Why it exists: until 2026-11-17 web/src/lib/db.ts read `import.meta.env.DATABASE_URL`, which the
// bundler replaces with the value, so the database connection string sat in the deployed Worker.
//
// Checks: the literal value of every secret-looking environment variable present in this job
// (never printed), plus the shapes of credentials that must never ship. Prints file and rule only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] ?? "web/dist";
const SECRET_ENV = /(DATABASE_URL|SERVICE_ROLE|SECRET|PASSWORD|API_KEY|API_TOKEN|ACCESS_TOKEN|PRIVATE_KEY|SERVICE_ACCOUNT)/;
const values = Object.entries(process.env)
  .filter(([k, v]) => SECRET_ENV.test(k) && !k.startsWith("PUBLIC_") && typeof v === "string" && v.length >= 12)
  .map(([k, v]) => ({ rule: `value of $${k}`, needle: v }));
// The password alone, in case the URL is rebuilt with different options around it.
for (const name of ["DATABASE_URL", "BUILD_DATABASE_URL"]) {
  try {
    const pw = decodeURIComponent(new URL(process.env[name] ?? "").password);
    if (pw.length >= 8) values.push({ rule: `password inside $${name}`, needle: pw });
  } catch { /* not set or unparsable */ }
}

const SHAPES = [
  ["Postgres URL with a password", /postgres(?:ql)?:\/\/[^\s:/@"'`$]+:[^\s@"'`$<>{}[\]]{6,}@[A-Za-z0-9.-]+/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["WorkOS API key", /sk_(?:live|test)_[A-Za-z0-9]{10,}/],
  ["private key block with a body", /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=\\n\s]{200,}/],
];
// A legacy Supabase service-role key is a JWT whose payload names the role.
const JWT = /eyJ[A-Za-z0-9_-]{15,}\.(eyJ[A-Za-z0-9_-]{15,})\.[A-Za-z0-9_-]{10,}/g;

const TEXT = /\.(m?js|cjs|json|html|css|txt|xml|map|csv|svg|webmanifest)$|(^|\/)_headers$|(^|\/)_redirects$/;
let files = 0;
const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!TEXT.test(p) || st.size > 40 * 1024 * 1024) continue;
    files++;
    const s = readFileSync(p, "utf8");
    const rel = relative(root, p);
    for (const v of values) if (s.includes(v.needle)) hits.push(`${rel}: ${v.rule}`);
    for (const [rule, rx] of SHAPES) if (rx.test(s)) hits.push(`${rel}: ${rule}`);
    for (const m of s.matchAll(JWT)) {
      try { if (Buffer.from(m[1], "base64url").toString("utf8").includes("service_role")) hits.push(`${rel}: service-role JWT`); } catch { /* not a JWT */ }
    }
  }
}
walk(root);
if (hits.length) {
  console.error(`✗ secrets in the build output (${hits.length}):`);
  for (const h of [...new Set(hits)].slice(0, 40)) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`✓ no secrets in ${files} build files (${values.length} secret values and ${SHAPES.length + 1} shapes checked)`);
