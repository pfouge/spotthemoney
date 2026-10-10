// Server-only: sign-in sessions (WorkOS AuthKit) and calls into Supabase as the signed-in
// visitor. Imported only by on-demand routes (`export const prerender = false`), which run in the
// Cloudflare Worker; static pages never load this file.
//
// Worker settings (web/wrangler.jsonc "vars" for the public ones; secrets via the Cloudflare
// dashboard or `npx wrangler secret put`, never in the repo):
//   WORKOS_CLIENT_ID        public    client_…
//   WORKOS_API_KEY          SECRET    sk_…
//   WORKOS_COOKIE_PASSWORD  SECRET    32+ random characters; encrypts the session cookie
//   SUPABASE_URL            public    https://<ref>.supabase.co
//   SUPABASE_ANON_KEY       public    the project's publishable key (sb_publishable_…)
//   WORKOS_API_HOSTNAME     optional  test only: point the SDK at a local fake WorkOS
// Without the secrets every account route answers 503 and the pages keep working.

import { env } from "cloudflare:workers";
import { WorkOS } from "@workos-inc/node";
import { COOKIE, SIGNED_IN, SESSION_MAX_AGE, clearCookie, readCookie, setCookie } from "../account";

interface Env {
  WORKOS_CLIENT_ID?: string; WORKOS_API_KEY?: string; WORKOS_COOKIE_PASSWORD?: string;
  SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; WORKOS_API_HOSTNAME?: string; SITE_URL?: string;
}
const E = env as unknown as Env;

export const siteUrl = (): string => (E.SITE_URL ?? "https://spotthemoney.com").replace(/\/$/, "");

export function configured(): boolean {
  return !!(E.WORKOS_CLIENT_ID && E.WORKOS_API_KEY && E.WORKOS_COOKIE_PASSWORD && E.WORKOS_COOKIE_PASSWORD.length >= 32
    && E.SUPABASE_URL && E.SUPABASE_ANON_KEY);
}

let client: WorkOS | null = null;
export function workos(): WorkOS {
  if (!client) {
    const host = E.WORKOS_API_HOSTNAME;
    client = new WorkOS(E.WORKOS_API_KEY!, {
      clientId: E.WORKOS_CLIENT_ID!,
      ...(host ? { apiHostname: host.replace(/:\d+$/, ""), port: Number(host.split(":")[1]) || undefined, https: false } : {}),
    });
  }
  return client;
}
export const clientId = (): string => E.WORKOS_CLIENT_ID!;
export const cookiePassword = (): string => E.WORKOS_COOKIE_PASSWORD!;

/** The cookies that mark a visitor as signed in: the sealed session, and a flag scripts can read. */
export function sessionCookies(sealed: string): string[] {
  return [setCookie(COOKIE, sealed, { maxAge: SESSION_MAX_AGE }), setCookie(SIGNED_IN, "1", { maxAge: SESSION_MAX_AGE, httpOnly: false })];
}
export const signedOutCookies = (): string[] => [clearCookie(COOKIE), clearCookie(SIGNED_IN, false)];

export interface Session {
  userId: string; email: string | null; sessionId: string; accessToken: string;
  /** Cookies to send back when the tokens were refreshed during this request. */
  setCookies: string[];
}

/**
 * The visitor's session, or null. An expired access token is refreshed once with the refresh
 * token inside the cookie.
 *
 * Only a cookie that cannot be opened at all is cleared here. A refresh that fails leaves the
 * cookies alone: WorkOS refresh tokens are single-use, so when two requests from one page
 * refresh at the same moment, one wins and sets a new cookie and the other fails — clearing
 * cookies on that failure signed people out a few minutes after they signed in (2026-10-10).
 * A session that has really ended stays signed out without it, and /auth/logout clears it.
 */
export async function getSession(request: Request): Promise<{ session: Session | null; setCookies: string[] }> {
  const sealed = readCookie(request.headers.get("cookie"), COOKIE);
  if (!sealed || !configured()) return { session: null, setCookies: [] };
  try {
    const s = workos().userManagement.loadSealedSession({ sessionData: sealed, cookiePassword: cookiePassword() });
    const auth = await s.authenticate();
    if (auth.authenticated) {
      return { session: { userId: auth.user.id, email: auth.user.email ?? null, sessionId: auth.sessionId, accessToken: auth.accessToken, setCookies: [] }, setCookies: [] };
    }
    if (auth.reason === "invalid_session_cookie") return { session: null, setCookies: signedOutCookies() };
    const r = await s.refresh({ cookiePassword: cookiePassword() });
    if (r.authenticated && r.sealedSession && r.session) {
      const set = sessionCookies(r.sealedSession);
      return { session: { userId: r.user.id, email: r.user.email ?? null, sessionId: r.sessionId, accessToken: r.session.accessToken, setCookies: set }, setCookies: set };
    }
    if (!r.authenticated && r.reason === "invalid_session_cookie") return { session: null, setCookies: signedOutCookies() };
  } catch { /* network or WorkOS error: signed out for this request only */ }
  return { session: null, setCookies: [] };
}

export class DbError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * Call one of the 0017 database functions through Supabase's REST endpoint. With a token the
 * call runs as that visitor (role `authenticated`, row-level security on); without one, as
 * `anon`, which may only call public_watchlist().
 */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>, accessToken?: string): Promise<T> {
  const res = await fetch(`${E.SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: E.SUPABASE_ANON_KEY!,
      // With Supabase's publishable key the apikey header alone means "anon"; a visitor's
      // WorkOS token in Authorization makes the call run as that visitor.
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = "Something went wrong. Please try again.";
    try {
      const j = JSON.parse(text) as { code?: string; message?: string };
      // Messages raised on purpose by the 0017 functions (P0001/P0002) are written for people.
      if ((j.code === "P0001" || j.code === "P0002") && j.message) msg = j.message;
      else if (j.code === "28000" || res.status === 401) msg = "Please sign in again.";
    } catch { /* not JSON */ }
    throw new DbError(msg, res.status === 401 ? 401 : res.status >= 500 ? 502 : 400);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** A JSON response that is never cached and carries any refreshed session cookies. */
export function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "private, no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}
