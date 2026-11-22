// Source: the SEC's list of exchange tickers and the filer each belongs to. Keyless.
//
// WHY. A security on this site is found by its ticker alone, and the Form 4 write path points
// it at the company of whichever filing named the ticker last. A fund whose insider filings
// carry no trading symbol falls back to its sponsor's symbol, so a stock page could name the
// wrong company (KKR and IVZ did, 2026-11-20). The SEC publishes who owns each ticker:
//   <base>/files/company_tickers.json  →  { "0": { "cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc." }, "1": … }
// One request. The daily sec_form4 job has resolved its tickers with this file since the
// start, so the shape is known. This job stores the list (table sec_tickers, migration 0031)
// and then calls repair_ticker_owners(), which re-points an active security to the company the
// SEC lists and takes a main ticker away from a company that only borrowed it. The runner
// calls the same function after every run (ingest/src/index.ts).
//
// GUARDS. Nothing is written unless the file holds at least MIN_ROWS usable rows (it holds
// about 10,000): a short or odd answer ends the run as "failed" and the stored list stays.
// The list is replaced in one transaction. The repair refuses, inside the database, to change
// more than 40 rows at once; that shows as `repair.skipped` in the stats and ends the run as
// "failed" (the list itself is stored), so the freshness table shows it and a person looks.
//
// Env: SEC_EDGAR_BASE (tests only: a local fake, shared with the other SEC sources),
// SEC_TICKERS_MIN_ROWS (tests only), SEC_TICKERS_RETRIES (tests only).

import { fetchJson } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";
import { sec } from "./sec_form4.js";

const SOURCE = "sec_company_tickers";
const BASE = (process.env.SEC_EDGAR_BASE ?? "https://www.sec.gov").replace(/\/$/, "");
/** The real file holds about 10,000 rows; fewer usable rows than this is not the real file. */
export const MIN_ROWS = 5000;

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (tested in sec_company_tickers.test.ts)
// ──────────────────────────────────────────────────────────────────────────

export interface TickerRow {
  /** Upper case, as the SEC lists it (BRK-B). */
  ticker: string;
  /** Ten digits, zero-padded. */
  cik: string;
  title: string | null;
  /** Position in the SEC's file. */
  rank: number;
}

export interface ParsedTickers {
  rows: TickerRow[];
  /** Entries in the file, usable or not. */
  entries: number;
  /** Entries left out: no ticker, a ticker that is not a symbol, or no SEC number. */
  unusable: number;
  /** A ticker listed a second time (the first is kept). */
  repeats: number;
}

/** Read the SEC's ticker file. Never throws; an answer in another shape gives no rows. */
export function parseCompanyTickers(json: unknown): ParsedTickers {
  const out: ParsedTickers = { rows: [], entries: 0, unusable: 0, repeats: 0 };
  if (!json || typeof json !== "object") return out;
  const list = Array.isArray(json) ? json : Object.values(json as Record<string, unknown>);
  const seen = new Set<string>();
  for (const item of list) {
    out.entries++;
    if (!item || typeof item !== "object" || Array.isArray(item)) { out.unusable++; continue; }
    const o = item as Record<string, unknown>;
    const ticker = String(o["ticker"] ?? "").trim().toUpperCase();
    const cikRaw = String(o["cik_str"] ?? "").trim();
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(ticker) || !/^\d{1,10}$/.test(cikRaw) || Number(cikRaw) === 0) { out.unusable++; continue; }
    if (seen.has(ticker)) { out.repeats++; continue; }
    seen.add(ticker);
    const title = typeof o["title"] === "string" ? (o["title"] as string).replace(/\s+/g, " ").trim().slice(0, 200) : "";
    out.rows.push({ ticker, cik: cikRaw.padStart(10, "0"), title: title || null, rank: out.rows.length });
  }
  return out;
}

export function tickersUrl(base: string): string {
  return `${base}/files/company_tickers.json`;
}

export interface RepairResult {
  securities_moved: number;
  moved: string[];
  tickers_cleared: number;
  cleared: string[];
  skipped: string[];
}

/** The database function's answer, read defensively (it is jsonb). */
export function readRepair(value: unknown): RepairResult {
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    securities_moved: num(o["securities_moved"]), moved: list(o["moved"]),
    tickers_cleared: num(o["tickers_cleared"]), cleared: list(o["cleared"]),
    skipped: list(o["skipped"]),
  };
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ──────────────────────────────────────────────────────────────────────────
// The job
// ──────────────────────────────────────────────────────────────────────────

export async function ingestSecCompanyTickers(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const minRows = Math.max(1, Math.floor(envNumber("SEC_TICKERS_MIN_ROWS", MIN_ROWS)));
  const retriesEnv = process.env.SEC_TICKERS_RETRIES;
  const retries = retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? Number(retriesEnv) : undefined;

  let parsed: ParsedTickers;
  try {
    parsed = parseCompanyTickers(await fetchJson<unknown>(tickersUrl(BASE), { ...sec(), ...(retries != null ? { retries } : {}) }));
  } catch (err) {
    const error = `the ticker file could not be fetched: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`;
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "failed", error, stats: ctx.stats() };
  }
  ctx.rowsSeen = parsed.entries;
  Object.assign(ctx.extra, { entries: parsed.entries, usable: parsed.rows.length, unusable: parsed.unusable, repeats: parsed.repeats });
  if (parsed.rows.length < minRows) {
    const error = `the ticker file holds ${parsed.rows.length} usable rows of ${parsed.entries}, fewer than ${minRows}: not the file this job expects; the stored list was left as it was`;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: 0, status: "failed", error, stats: ctx.stats() };
  }

  // Replace the list in one transaction, then repair with the new list.
  let repair: RepairResult = readRepair(null);
  let changed = 0; let removed = 0;
  await sql.begin(async (tx) => {
    const [before] = await tx<{ n: number }[]>`select count(*)::int as n from sec_tickers`;
    const stamp = new Date();
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      const chunk = parsed.rows.slice(i, i + 1000).map((r) => ({ ticker: r.ticker, cik: r.cik, title: r.title, rank: r.rank, origin: "sec", checked_at: stamp }));
      const res = await tx`
        insert into sec_tickers ${tx(chunk, "ticker", "cik", "title", "rank", "origin", "checked_at")}
        on conflict (ticker) do update
          set cik = excluded.cik, title = excluded.title, rank = excluded.rank, origin = 'sec', checked_at = excluded.checked_at`;
      changed += res.count ?? 0;
    }
    const gone = await tx`delete from sec_tickers where checked_at < ${stamp}`;
    removed = gone.count ?? 0;
    ctx.extra["rows_before"] = before?.n ?? 0;
    const [row] = await tx<{ r: unknown }[]>`select repair_ticker_owners() as r`;
    repair = readRepair(row?.r);
  });
  ctx.rowsChanged = changed;
  const [tot] = await sql<{ rows: number; ciks: number }[]>`select count(*)::int as rows, count(distinct cik)::int as ciks from sec_tickers`;
  // How many of the site's securities the list knows, for the record.
  const [cover] = await sql<{ active: number; listed: number; other_owner: number }[]>`
    select count(*)::int as active,
           count(st.ticker)::int as listed,
           count(*) filter (where st.ticker is not null and c.id is not null and lpad(c.cik, 10, '0') <> st.cik)::int as other_owner
      from securities s
      left join sec_tickers st on st.ticker = replace(upper(s.ticker::text), '.', '-')
      left join companies c on c.id = s.company_id
     where s.type = 'equity' and s.is_active`;
  Object.assign(ctx.extra, {
    table_rows: tot?.rows ?? 0, table_ciks: tot?.ciks ?? 0, removed,
    active_equities: cover?.active ?? 0, active_equities_listed: cover?.listed ?? 0,
    active_equities_with_another_owner: cover?.other_owner ?? 0,
    repair,
  });
  console.log(`${SOURCE}: ${parsed.rows.length} tickers for ${tot?.ciks ?? 0} filers stored (${parsed.unusable} unusable, ${parsed.repeats} repeats, ${removed} no longer listed); ` +
    `${cover?.listed ?? 0} of ${cover?.active ?? 0} active equities are on the list, ${cover?.other_owner ?? 0} still with a company other than the listed one; ` +
    `repair: ${repair.securities_moved} securities moved${repair.moved.length ? ` (${repair.moved.join(", ")})` : ""}, ` +
    `${repair.tickers_cleared} main tickers cleared${repair.cleared.length ? ` (${repair.cleared.join(", ")})` : ""}` +
    `${repair.skipped.length ? `; SKIPPED: ${repair.skipped.join("; ")}` : ""}`);

  if (repair.skipped.length) {
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed",
      error: `the list was stored, but the repair refused a step: ${repair.skipped.join("; ")}`, stats: ctx.stats() };
  }
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}
