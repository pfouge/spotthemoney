// Source: the Phase-1 tracked-ticker universe (ingest/data/tracked-tickers.json). No network.
//
// Why a job and not a seed migration: the universe is data, not schema, and it changes.
// Upserting it on every ingest run keeps `securities` in step with the JSON file, and the
// sec_form4 job (contract §4.2, ticker-scoped) reads its universe from `securities`, so this
// job must run FIRST in the daily sequence (index.ts REGISTRY order). Never deletes: a ticker
// removed from the file stays in the table (flip is_active by hand if it should stop).
//
// Ticker spelling: EDGAR uses a hyphen for class shares (BRK-B); we store the same spelling
// so sec_form4's CIK lookup needs no translation.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, closeDb } from "../lib/db.js";
import { createRunContext } from "../lib/run.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "universe";

interface UniverseFile {
  equities: string[];
  etfs: string[];
}

export function loadUniverseFile(): UniverseFile {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "..", "..", "data", "tracked-tickers.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<UniverseFile>;
  const clean = (xs: unknown) =>
    Array.isArray(xs) ? [...new Set(xs.map((t) => String(t).trim().toUpperCase()).filter(Boolean))] : [];
  return { equities: clean(parsed.equities), etfs: clean(parsed.etfs) };
}

export async function ingestUniverse(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const file = loadUniverseFile();

  for (const [type, tickers] of [["equity", file.equities], ["etf", file.etfs]] as const) {
    for (const ticker of tickers) {
      if (!ctx.markSeen(`${type}:${ticker}`)) continue;
      ctx.rowsSeen++;
      try {
        const res = await sql`
          insert into securities (ticker, type, is_active)
          values (${ticker}, ${type}, true)
          on conflict (ticker, type) do update set is_active = true, updated_at = now()
        `;
        ctx.rowsChanged += res.count ?? 0;
      } catch (err) {
        ctx.quarantine(ticker, err instanceof Error ? err.message : String(err));
      }
    }
  }

  ctx.extra["equities"] = file.equities.length;
  ctx.extra["etfs"] = file.etfs.length;
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestUniverse()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
