// Server-only: one call into Supabase's REST endpoint. Kept apart from session.ts so a route that
// needs only the database (the on-demand entity pages) does not load the WorkOS SDK. session.ts
// re-exports both names, so every existing import keeps working.
import { env } from "cloudflare:workers";

interface Env { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string }
const E = env as unknown as Env;

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

