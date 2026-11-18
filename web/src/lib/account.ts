// Accounts and watchlists (2026-10-10, suggestions item 4) — the pure parts, shared by the
// Worker routes (src/pages/api/[action].ts, src/pages/auth/*) and tested without a Worker
// (scripts/account.test.ts). Nothing here talks to the network.
//
// How the pieces fit:
//   sign-in      WorkOS AuthKit's hosted page → /auth/callback → an encrypted session cookie
//                (COOKIE, HttpOnly) plus a harmless SIGNED_IN flag cookie that page scripts can
//                read, so anonymous visitors never call the Worker at all.
//   data         Supabase, through the functions in db/migrations/0017_accounts_watchlists.sql,
//                called with the visitor's own WorkOS access token: row-level security decides
//                what each call can touch. The Worker never holds a key that bypasses it.
//   pages        stay static. A Follow button and the header's Watchlist link are filled in by
//                src/scripts/account.ts from GET /api/me.

/**
 * Master switch for the Follow buttons and the header's Watchlist link. Turn on only once the
 * Worker has its WorkOS and Supabase settings (src/lib/server/session.ts); the API also answers
 * "available: false" without them, so a wrong switch shows nothing worse than hidden buttons.
 */
export const ACCOUNTS_ENABLED = true;

/**
 * Email digests (parity queue item 7). TWO switches, both off:
 *   this one    shows the digest control on /watchlist/, opens /api/alerts and /api/alerts-save,
 *               and swaps the wording on the privacy page, the terms and the follow guide;
 *   the database's (app_settings 'alerts_enabled', migration 0025) decides whether anyone can
 *               actually turn a digest on. The control stays hidden while that one is false.
 * ALERTS_LIVE is the production value. A local build with PUBLIC_ALERTS_PREVIEW=1 turns the
 * site switch on so the verifiers can exercise the "on" state; no workflow sets that variable.
 *
 * Before ALERTS_LIVE becomes true (stage 4, with Peter): name the delivery provider in
 * ALERTS_PROVIDER and set ALERTS_SINCE to that day; alertsLaunchProblem() makes the build fail
 * otherwise. The privacy page promises that opens and clicks are not tracked: switch the
 * provider's open and click tracking off. /alerts/unsubscribe/ works whatever these say.
 */
const ALERTS_LIVE = false;
export const ALERTS_ENABLED: boolean = ALERTS_LIVE || import.meta.env?.PUBLIC_ALERTS_PREVIEW === "1";
/** The company that delivers the emails, as the privacy page names it. */
export const ALERTS_PROVIDER: { name: string; url: string } = { name: "", url: "" };
/** The day digests were first offered (YYYY-MM-DD); the privacy page and terms take it as their date. */
export const ALERTS_SINCE = "";
/** Days an unsent digest is kept, and days the text of a sent one is kept (ingest/src/jobs/alerts_digest.ts). */
export const ALERT_PENDING_DAYS = 3;
export const ALERT_BODY_DAYS = 30;
/** A digest lists trades disclosed within this many days (MAX_AGE_DAYS in the same job). */
export const ALERT_MAX_AGE_DAYS = 30;
/**
 * A trade on the watchlist page counts as "new" only when it was disclosed within this many days
 * (watch_feed_rows, migration 0026). A backfill loads old filings; they go under "Earlier trades".
 */
export const FEED_NEW_MAX_AGE_DAYS = 30;

/** Why the live switch may not be on yet, or null. Called by the privacy page at build time. */
export function alertsLaunchProblem(live = ALERTS_LIVE, provider = ALERTS_PROVIDER, since = ALERTS_SINCE): string | null {
  if (!live) return null;
  if (!provider.name.trim() || !/^https:\/\//.test(provider.url)) return "ALERTS_LIVE is on but ALERTS_PROVIDER does not name the email delivery company and its privacy page.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) return "ALERTS_LIVE is on but ALERTS_SINCE is not a date (YYYY-MM-DD).";
  return null;
}

export type Digest = "off" | "daily" | "weekly";
export const DIGESTS: readonly Digest[] = ["off", "daily", "weekly"];
export const DIGEST_LABEL: Record<Digest, string> = { off: "Off", daily: "Daily", weekly: "Weekly, on Mondays" };
export const isDigest = (v: unknown): v is Digest => typeof v === "string" && (DIGESTS as readonly string[]).includes(v);
/** The code in an unsubscribe link: 64 lower-case hex characters (alert_prefs.unsub_token). */
export const isUnsubToken = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** What alert_state() returns for the signed-in visitor. `available` is the database switch. */
export interface AlertState {
  available: boolean; email: string | null; digest: Digest;
  opted_in_at: string | null; unsubscribed_at: string | null; last_digest_at: string | null;
}

export const COOKIE = "stm_session";
export const SIGNED_IN = "stm_signed_in";
export const STATE_COOKIE = "stm_oauth_state";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;   // 30 days; WorkOS refreshes the tokens inside it

export type Kind = "member" | "insider" | "stock" | "company";
export const KINDS: readonly Kind[] = ["member", "insider", "stock", "company"];
export const KIND_LABEL: Record<Kind, string> = { member: "Member of Congress", insider: "Insider", stock: "Stock", company: "Company" };

/** The page a watchlist item points to. Keys are the same slugs and tickers the URLs use. */
export function itemPath(kind: Kind, key: string): string {
  const k = encodeURIComponent(key);
  return kind === "member" ? `/congress/${k}/` : kind === "insider" ? `/insiders/${k}/` : kind === "stock" ? `/stocks/${k}/` : `/companies/${k}/`;
}

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
export const isKey = (v: unknown): v is string => typeof v === "string" && KEY_RE.test(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
export const isSlug = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]{12}$/.test(v);

/**
 * Where to send someone after sign-in or sign-out. Only a path on this site: an absolute URL,
 * a protocol-relative "//evil.example" or a backslash trick falls back to the watchlist page.
 */
export function safeReturnPath(raw: string | null | undefined, fallback = "/watchlist/"): string {
  if (!raw || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  if (raw.startsWith("/auth/") || raw.startsWith("/api/")) return fallback;
  return raw;
}

/** Read one cookie from a Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

export interface CookieOpts { maxAge: number; httpOnly?: boolean; path?: string }
/** A Set-Cookie value. Always Secure and SameSite=Lax: a cross-site POST never carries it. */
export function setCookie(name: string, value: string, o: CookieOpts): string {
  return `${name}=${encodeURIComponent(value)}; Path=${o.path ?? "/"}; Max-Age=${Math.max(0, Math.floor(o.maxAge))}; Secure; SameSite=Lax${o.httpOnly === false ? "" : "; HttpOnly"}`;
}
export const clearCookie = (name: string, httpOnly = true): string => setCookie(name, "", { maxAge: 0, httpOnly });

/**
 * A POST that changes something must come from the page's own origin (scheme + host of the
 * request itself, so www and the bare domain each pass for themselves). Browsers send Origin on every POST;
 * a request without one, or from another origin, is refused (the session cookie is
 * SameSite=Lax already, so this is the second lock on the same door).
 */
export function sameOrigin(origin: string | null, own: string): boolean {
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(own).origin; } catch { return false; }
}

/**
 * The site-wide cross-site check, run by src/middleware.ts for every on-demand route in place of
 * Astro's own (security.checkOrigin is off in astro.config.mjs because it cannot exempt a route).
 * Every POST, PUT, PATCH and DELETE must carry this site's Origin, whatever its content type.
 * One address is exempt: the unsubscribe link of an email digest, which mail programs POST to
 * with no Origin (RFC 8058) and whose 64-character token is its whole authority.
 */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ORIGIN_EXEMPT = /^\/alerts\/unsubscribe\/?$/;
export const crossSiteRefused = (method: string, pathname: string, origin: string | null, own: string): boolean =>
  UNSAFE_METHODS.has(method.toUpperCase()) && !ORIGIN_EXEMPT.test(pathname) && !sameOrigin(origin, own);

/**
 * The API actions the site's scripts may call, each mapped to one database function and the
 * only arguments it may pass. Anything not listed is a 404; any argument that fails its check
 * is a 400 before the database is asked.
 */
export type Action = { method: "GET" | "POST"; fn: string; args: (body: Record<string, unknown>) => Record<string, unknown> | string; alerts?: true };

/**
 * Whether an email-digest action may run. While the site switch is off both are a 404, with one
 * exception: turning a digest OFF is always allowed (a way out never depends on a switch).
 */
export function alertActionAllowed(action: string, args: Record<string, unknown>, enabled: boolean = ALERTS_ENABLED): boolean {
  if (enabled) return true;
  return action === "alerts-save" && args.p_digest === "off";
}
const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.trim().slice(0, max) : null);
export const ACTIONS: Record<string, Action> = {
  me: { method: "GET", fn: "my_state", args: () => ({}) },
  feed: { method: "GET", fn: "watch_feed", args: () => ({ p_limit: 200 }) },
  follow: {
    method: "POST", fn: "follow", args: (b) => {
      if (!isKind(b.kind)) return "Unknown kind.";
      const key = typeof b.key === "string" ? b.key.trim().toLowerCase() : "";
      if (!isKey(key)) return "Bad key.";
      if (b.list != null && !isUuid(b.list)) return "Bad list.";
      return { p_kind: b.kind, p_key: key, p_label: str(b.label, 160), p_on: b.on !== false, p_list: b.list ?? null };
    },
  },
  list: {
    method: "POST", fn: "list_save", args: (b) => {
      if (b.id != null && !isUuid(b.id)) return "Bad list.";
      const name = str(b.name, 80);
      if (b.id == null && !name) return "A new list needs a name.";
      return { p_id: b.id ?? null, p_name: name, p_public: typeof b.public === "boolean" ? b.public : null, p_delete: b.delete === true };
    },
  },
  move: {
    method: "POST", fn: "item_move", args: (b) => {
      if (!isKind(b.kind) || !isKey(b.key) || !isUuid(b.from) || !isUuid(b.to)) return "Bad move.";
      return { p_kind: b.kind, p_key: b.key, p_from: b.from, p_to: b.to };
    },
  },
  copy: { method: "POST", fn: "list_copy", args: (b) => (isSlug(b.slug) ? { p_slug: b.slug } : "Bad link.") },
  seen: { method: "POST", fn: "mark_feed_seen", args: () => ({}) },
  // email digests (migration 0025); see alertActionAllowed
  alerts: { method: "GET", fn: "alert_state", args: () => ({}), alerts: true },
  "alerts-save": {
    method: "POST", fn: "alert_save", alerts: true,
    args: (b) => (isDigest(b.digest) ? { p_digest: b.digest } : "Choose off, daily or weekly."),
  },
};

/** One row of the watchlist feed, as watch_feed() returns it. */
export interface FeedRow {
  txn_id: number; kind: Kind; key: string; is_new: boolean; disclosed_at: string; txn_date: string | null;
  side: string; txn_code: string | null; is_derivative: boolean | null; amount_low: number | null; amount_high: number | null;
  shares: number | null; price: number | null; owner_type: string | null; person_name: string | null; person_slug: string | null;
  ticker: string | null; security_name: string | null; source: string; source_url: string | null;
}

const money = (v: number): string => {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`;
};

/**
 * How a feed row's size is shown, as filed: a congressional range, or an insider's shares and
 * price. No value is computed for an insider row here — the stock page applies the site's
 * rules for derivative rows and price boxes holding a total, which the feed does not repeat.
 */
export function feedAmount(r: Pick<FeedRow, "amount_low" | "amount_high" | "shares" | "price">): string {
  if (r.amount_low != null || r.amount_high != null) {
    const lo = r.amount_low ?? 0, hi = r.amount_high;
    return hi == null ? `over ${money(lo)}` : lo === hi ? money(hi) : `${money(lo)}–${money(hi)}`;
  }
  if (r.shares != null) {
    const sh = Number(r.shares).toLocaleString("en-US", { maximumFractionDigits: 0 });
    return r.price != null && Number(r.price) > 0 ? `${sh} sh at $${Number(r.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `${sh} sh`;
  }
  return "";
}

/** "bought" / "sold" only for plain purchases and sales; anything else says what it is. */
export function feedVerb(r: Pick<FeedRow, "side" | "is_derivative" | "txn_code">): string {
  if (r.is_derivative) return "option or conversion";
  if (r.side === "buy") return "bought";
  if (r.side === "sell") return "sold";
  if (r.side === "exchange") return "exchanged";
  return r.txn_code ? `Form 4 code ${r.txn_code}` : "other";
}
