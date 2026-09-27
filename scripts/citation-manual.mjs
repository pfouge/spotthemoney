// Records one manual citation check — for the engine API calls can't reach: Google AI
// Overviews / AI Mode has no public API, so that subsample is checked by hand in a
// signed-out Chrome window and logged here. See docs/reference/citation-count-procedure.md
// for the full monthly procedure and which question ids to check.
//
// Usage (repo root):
//   node scripts/citation-manual.mjs --engine manual:google-ai-overview --date 2026-10-02 \
//     --qid q017 --cited yes [--url https://spotthemoney.com/rates/i-bonds/] [--url https://...]
//
// Reads DATABASE_URL from the root .env, same as scripts/db-check.mjs.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (expected in .env or the environment)");
  process.exit(1);
}

function parseArgs(argv) {
  const out = { url: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`--${key} needs a value`);
      process.exit(1);
    }
    if (key === "url") out.url.push(value);
    else out[key] = value;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const required = ["engine", "date", "qid", "cited"];
const missing = required.filter((k) => !args[k]);
if (missing.length > 0) {
  console.error(`Missing required flag(s): ${missing.map((m) => `--${m}`).join(", ")}`);
  console.error(
    "Usage: node scripts/citation-manual.mjs --engine manual:google-ai-overview --date YYYY-MM-DD --qid q017 --cited yes|no [--url ...]",
  );
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
  console.error(`--date "${args.date}" must be YYYY-MM-DD`);
  process.exit(1);
}

const citedNormalized = String(args.cited).toLowerCase();
if (!["yes", "no", "true", "false"].includes(citedNormalized)) {
  console.error(`--cited must be "yes" or "no" (got "${args.cited}")`);
  process.exit(1);
}
const cited = citedNormalized === "yes" || citedNormalized === "true";

const questionsPath = join(root, "scripts", "citation-questions.json");
let question = null;
try {
  const questions = JSON.parse(readFileSync(questionsPath, "utf8"));
  const found = questions.find((q) => q.id === args.qid);
  if (found) question = found.question;
} catch {
  /* fall through — we can still record the row without the question text */
}
if (!question) {
  console.error(`Warning: question id "${args.qid}" not found in ${questionsPath}; recording with a placeholder question text.`);
  question = `(unknown question id ${args.qid})`;
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const result = await sql`
    insert into metrics_citations (run_date, engine, question_id, question, cited, cited_urls, answer_excerpt, error)
    values (${args.date}, ${args.engine}, ${args.qid}, ${question}, ${cited}, ${sql.json(args.url)}, null, null)
    on conflict (run_date, engine, question_id) do update
      set question = excluded.question,
          cited = excluded.cited,
          cited_urls = excluded.cited_urls
  `;
  console.log(
    `✓ recorded ${args.engine} / ${args.qid} / ${args.date}: cited=${cited}` +
      (args.url.length > 0 ? ` urls=${args.url.join(", ")}` : "") +
      ` (${result.count} row written)`,
  );
} finally {
  await sql.end();
}
