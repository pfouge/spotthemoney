import postgres from "postgres";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "@stm/shared";

// Load the repo-root .env if present. npm runs this workspace with cwd = ingest/, so resolve
// the file relative to this module (ingest/src/lib → repo root) rather than the cwd.
try {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const envFile = join(root, ".env");
  if (existsSync(envFile)) process.loadEnvFile?.(envFile);
} catch {
  /* rely on real environment */
}

let _sql: ReturnType<typeof postgres> | null = null;

/** Lazily create a single shared Postgres client for the process. */
export function getDb() {
  if (!_sql) {
    _sql = postgres(requireEnv("DATABASE_URL"), { max: 1 });
  }
  return _sql;
}

export async function closeDb() {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}
