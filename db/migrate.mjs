// Minimal forward-only migration runner.
// Applies db/migrations/*.sql in filename order, once each, inside a transaction,
// tracking applied files in a schema_migrations table.
//
// Usage: node db/migrate.mjs
// Requires: DATABASE_URL (from .env or the environment) — the Supabase **Session pooler
// (port 5432)** or a direct connection. Never the Transaction pooler (6543): it cannot run
// multi-statement migration files or hold a transaction across statements (nsnexplorer
// lesson, 2026-09). The guard below refuses to run against it.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Load .env if present. Safe to ignore if unavailable.
try {
  process.loadEnvFile?.(".env");
} catch {
  /* no .env file — rely on real environment */
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

try {
  if (new URL(DATABASE_URL).port === "6543") {
    console.error(
      "✗ DATABASE_URL points at the Transaction pooler (port 6543). Migrations need the " +
        "Session pooler (port 5432) or a direct connection — see SETUP.md §2.",
    );
    process.exit(1);
  }
} catch {
  /* unparsable URL — let the driver report it */
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "migrations");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = postgres(DATABASE_URL, { max: 1 });

try {
  await sql`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql`select filename from schema_migrations`).map((r) => r.filename),
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const ddl = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`→ applying ${file} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      await tx`insert into schema_migrations (filename) values (${file})`;
    });
    console.log("done");
    count++;
  }

  console.log(count === 0 ? "✓ already up to date" : `✓ applied ${count} migration(s)`);
} catch (err) {
  console.error("✗ migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
