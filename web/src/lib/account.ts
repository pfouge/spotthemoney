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
 * The API actions the site's scripts may call, each mapped to one database function and the
 * only arguments it may pass. Anything not listed is a 404; any argument that fails its check
 * is a 400 before the database is asked.
 */
export type Action = { method: "GET" | "POST"; fn: string; args: (body: Record<string, unknown>) => Record<string, unknown> | string };
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
