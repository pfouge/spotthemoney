// Source: Twelve Data end-of-day (EOD) bars (api.twelvedata.com/time_series).
// Contract: integration contract §4.7 (security_prices upsert; no market-cap target table).
//
// AUTH: required. TWELVEDATA_API_KEY. If unset, this is a staging-safe no-op — return
// success with rowsSeen 0 rather than failing the whole ingest run.
//
// UNIVERSE: securities rows with is_active and type in ('equity','etf','adr'), UNION
// env TWELVEDATA_TICKERS (comma-separated). Tickers named in the env var that are not
// already in `securities` get a (ticker, type='equity') upsert so they have a
// security_id to write prices against.
//
// RATE LIMITS: Twelve Data's free/low tiers have tight daily credit limits. lib/http's
// 1.5s per-host gap is the pacing mechanism (tickers are fetched strictly sequentially,
// never in parallel). If the API itself reports a rate-limit (status "error", code 429,
// or a message mentioning credits/limit), we STOP THE WHOLE RUN early rather than
// poll/retry — submit-and-exit posture: whatever has already been written stays
// written, and the run reports "partial" so the scheduler knows to resume later.
//
// INCOMPLETE-CANDLE RULE (contract §4.7, binding): the newest bar in the response can
// be today's still-forming candle. Any bar whose datetime date-part equals today (UTC)
// is dropped before it ever reaches scrubDeep/SQL.
//
// SECURITY: the API key must never leak into a log line, thrown error, or stats value.
// lib/http's own error messages only ever include host+path (no query string), so we
// rely on that for HTTP-level failures; every error WE throw or record here is built
// from fixed strings / ticker symbols only — never from the request URL.

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import { optionalEnv } from "@stm/shared";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "twelvedata_eod";
const BASE_URL = "https://api.twelvedata.com/time_series";
const DEFAULT_OUTPUTSIZE = 30;

interface TimeSeriesValue {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

interface TimeSeriesSuccess {
  meta?: Record<string, unknown>;
  values?: TimeSeriesValue[];
  status?: string;
}

interface TimeSeriesError {
  status: "error";
  code?: number;
  message?: string;
}

type TimeSeriesResponse = TimeSeriesSuccess | TimeSeriesError;

function isErrorResponse(resp: TimeSeriesResponse): resp is TimeSeriesError {
  return resp.status === "error";
}

/** True when a Twelve Data error response indicates a rate/credit limit, not e.g. a bad symbol. */
function isRateLimitError(err: TimeSeriesError): boolean {
  if (err.code === 429) return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("credit") || msg.includes("limit");
}

function timeSeriesUrl(symbol: string, outputsize: number, apiKey: string): string {
  const u = new URL(BASE_URL);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("interval", "1day");
  u.searchParams.set("outputsize", String(outputsize));
  u.searchParams.set("apikey", apiKey);
  return u.toString();
}

function todayUtcDatePart(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Twelve Data's `datetime` is either "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS"; take the date part. */
function datePartOf(datetime: string): string {
  return datetime.slice(0, 10);
}

function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function ingestTwelvedataEod(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);

  const apiKey = optionalEnv("TWELVEDATA_API_KEY");
  if (!apiKey) {
    ctx.warn("TWELVEDATA_API_KEY not set — skipped (staging-safe no-op)");
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }

  const outputsize = Number(optionalEnv("TWELVEDATA_OUTPUTSIZE") ?? String(DEFAULT_OUTPUTSIZE));

  // ── Universe: securities table (equity/etf/adr, active) UNION env TWELVEDATA_TICKERS.
  const tickerToId = new Map<string, number>();

  const existing = await sql<{ id: number; ticker: string }[]>`
    select id, ticker
    from securities
    where is_active and type in ('equity', 'etf', 'adr')
  `;
  for (const row of existing) {
    tickerToId.set(String(row.ticker).toUpperCase(), row.id);
  }

  const envTickers = (optionalEnv("TWELVEDATA_TICKERS") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);

  for (const ticker of envTickers) {
    if (tickerToId.has(ticker)) continue;
    const [security] = await sql`
      insert into securities (ticker, type)
      values (${ticker}, 'equity')
      on conflict (ticker, type) do update
        set ticker = excluded.ticker
      returning id
    `;
    tickerToId.set(ticker, security!.id as number);
  }

  if (tickerToId.size === 0) {
    ctx.warn("no active equity/etf/adr securities and no TWELVEDATA_TICKERS configured — nothing to fetch");
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }

  const tickers = [...tickerToId.keys()].sort();
  const today = todayUtcDatePart();

  let tickersProcessed = 0;
  let tickersQuarantined = 0;
  let barsDroppedIncomplete = 0;
  let stoppedEarly = false;

  for (const ticker of tickers) {
    const securityId = tickerToId.get(ticker)!;
    let resp: TimeSeriesResponse;
    try {
      resp = await fetchJson<TimeSeriesResponse>(timeSeriesUrl(ticker, outputsize, apiKey));
    } catch (err) {
      // lib/http errors carry only host+path, never the query string — safe to record verbatim.
      const message = err instanceof Error ? err.message : String(err);
      ctx.quarantine(ticker, message);
      tickersQuarantined++;
      continue;
    }

    if (isErrorResponse(resp)) {
      if (isRateLimitError(resp)) {
        ctx.warn(`rate-limited by Twelve Data at ticker ${ticker} — stopping run early (submit-and-exit)`);
        ctx.extra["stopped_early_at"] = ticker;
        stoppedEarly = true;
        break;
      }
      // Non-rate-limit API error (e.g. unknown symbol): quarantine and continue.
      ctx.quarantine(ticker, resp.message ?? `Twelve Data error (code ${resp.code ?? "unknown"})`);
      tickersQuarantined++;
      continue;
    }

    tickersProcessed++;

    const values = resp.values ?? [];
    for (const bar of values) {
      if (!bar.datetime) {
        ctx.quarantine(`${ticker}: bar with no datetime`, "missing datetime");
        continue;
      }
      if (datePartOf(bar.datetime) === today) {
        // Today's candle is still forming — never write it (contract §4.7).
        barsDroppedIncomplete++;
        continue;
      }
      ctx.rowsSeen++;

      const clean = scrubDeep({
        priceDate: datePartOf(bar.datetime),
        open: parseNum(bar.open),
        high: parseNum(bar.high),
        low: parseNum(bar.low),
        close: parseNum(bar.close),
      });

      const result = await sql`
        insert into security_prices (security_id, price_date, open, high, low, close, last, source)
        values (
          ${securityId}, ${clean.priceDate}, ${clean.open}, ${clean.high}, ${clean.low}, ${clean.close},
          ${clean.close}, 'twelvedata'
        )
        on conflict (security_id, price_date) do update
          set open = excluded.open,
              high = excluded.high,
              low = excluded.low,
              close = excluded.close,
              last = excluded.last,
              source = excluded.source
      `;
      ctx.rowsChanged += result.count ?? 0;
    }
  }

  ctx.extra["tickers_processed"] = tickersProcessed;
  ctx.extra["tickers_quarantined"] = tickersQuarantined;
  ctx.extra["tickers_total"] = tickers.length;
  ctx.extra["outputsize"] = outputsize;
  ctx.extra["bars_dropped_incomplete"] = barsDroppedIncomplete;

  if (stoppedEarly) {
    return {
      source: SOURCE,
      rowsSeen: ctx.rowsSeen,
      rowsChanged: ctx.rowsChanged,
      status: "partial",
      error: "rate-limited by Twelve Data — partial run",
      stats: ctx.stats(),
    };
  }

  return {
    source: SOURCE,
    rowsSeen: ctx.rowsSeen,
    rowsChanged: ctx.rowsChanged,
    status: "success",
    stats: ctx.stats(),
  };
}

// Allow running directly: `npm run ingest -- twelvedata_eod`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestTwelvedataEod()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => {
      console.error(`✗ ${SOURCE} failed:`, e.message);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
