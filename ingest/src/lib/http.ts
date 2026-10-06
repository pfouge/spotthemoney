// Polite HTTP client for all ingest jobs. Scraping etiquette is policy here
// (gratisglobal lesson + IIF connector practice, adopted 2026-07-06):
//
//   1. Descriptive User-Agent with a contact email on every request.
//   2. >= 1.5s minimum gap between requests to the same host. One exception, recorded
//      2026-10-05: a source may pass `minGapMs` where the host PUBLISHES a rate limit and
//      we stay well under it (SEC EDGAR: 10 requests/second published, we use 4). Never
//      below MIN_GAP_FLOOR_MS, and never for a host with no published limit.
//   3. Exponential backoff on 429/5xx (honors Retry-After when present).
//   4. NEVER spoof a browser UA to get around a block. If a source's WAF rejects
//      our honest client (403 after retries), the job fails with a clear message
//      and the source is re-routed (e.g. to the IIF-based Python job) or dropped —
//      recorded as a decision, not worked around silently.
//
// All source modules go through fetchJson/fetchText; do not call fetch() directly.

const DEFAULT_UA =
  process.env.INGEST_USER_AGENT ??
  "spotthemoney.com ingest (Peter Fougerousse <pfouge@gmail.com>)";

const MIN_HOST_GAP_MS = 1500;
const MIN_GAP_FLOOR_MS = 200;
const MAX_RETRIES = 3;
// A server may answer 429 with "Retry-After: 3600". Sleeping that long inside a job only
// gets the job killed by its timeout (the FEC history pass, 2026-10-06). Past this limit the
// request fails at once and the caller decides what to do.
const MAX_RETRY_AFTER_MS = 90_000;

const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function politeDelay(host: string, minGapMs?: number): Promise<void> {
  const gap = minGapMs == null || !Number.isFinite(minGapMs) ? MIN_HOST_GAP_MS : Math.max(MIN_GAP_FLOOR_MS, minGapMs);
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

export interface PoliteFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** JSON-serializable POST body. */
  body?: unknown;
  /** Override the default User-Agent (must still be descriptive + contactable). */
  userAgent?: string;
  /** Per-host gap for this call, only for hosts with a published rate limit (see header, rule 2). */
  minGapMs?: number;
  /** Fail a 429 at once instead of backing off — for callers that pace themselves. */
  noRetryOn429?: boolean;
}

async function politeFetch(url: string | URL, opts: PoliteFetchOptions = {}): Promise<Response> {
  const u = new URL(String(url));
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await politeDelay(u.host, opts.minGapMs);
    let res: Response;
    try {
      res = await fetch(u, {
        method: opts.method ?? "GET",
        headers: {
          "user-agent": opts.userAgent ?? DEFAULT_UA,
          accept: "application/json, text/csv, text/plain, */*",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      // Network-level failure: retry with backoff.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) await sleep(backoffMs(attempt));
      continue;
    }

    if (res.ok) return res;

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
      lastError = new Error(`HTTP ${res.status} from ${u.host}${u.pathname}`);
      if (wait > MAX_RETRY_AFTER_MS || (res.status === 429 && opts.noRetryOn429)) {
        throw new Error(`HTTP ${res.status} from ${u.host}${u.pathname} (retry-after ${Math.round(wait / 1000)}s — not waiting)`);
      }
      if (attempt < MAX_RETRIES) await sleep(wait);
      continue;
    }

    if (res.status === 403) {
      throw new Error(
        `HTTP 403 from ${u.host}${u.pathname} — likely a WAF rejecting our honest client. ` +
          `Policy: do NOT spoof a browser UA to get around this. Re-route this source ` +
          `(IIF Python job) or drop it, and record the decision.`,
      );
    }

    throw new Error(`HTTP ${res.status} from ${u.host}${u.pathname}`);
  }

  throw new Error(
    `Exhausted ${MAX_RETRIES + 1} attempts for ${u.host}${u.pathname}: ${lastError?.message ?? "unknown error"}`,
  );
}

function backoffMs(attempt: number): number {
  const base = [2000, 8000, 30000][Math.min(attempt, 2)]!;
  return base + Math.floor(Math.random() * 1000); // jitter
}

export async function fetchJson<T = unknown>(url: string | URL, opts: PoliteFetchOptions = {}): Promise<T> {
  const res = await politeFetch(url, opts);
  return (await res.json()) as T;
}

export async function fetchText(url: string | URL, opts: PoliteFetchOptions = {}): Promise<string> {
  const res = await politeFetch(url, opts);
  return await res.text();
}
