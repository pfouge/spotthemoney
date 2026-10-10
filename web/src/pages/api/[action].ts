// /api/<action> — the watchlist API the site's own scripts call. Every action maps to one
// database function (ACTIONS in src/lib/account.ts) run as the signed-in visitor, so row-level
// security, not this file, decides what a request can read or change.
//
//   GET  /api/me        signed-in state, lists and items, count of new trades
//   GET  /api/feed      recent trades by what the visitor follows
//   POST /api/follow    { kind, key, label?, on?, list? }
//   POST /api/list      { id?, name?, public?, delete? }   create / rename / share / delete
//   POST /api/move      { kind, key, from, to }
//   POST /api/copy      { slug }                           copy a shared list
//   POST /api/seen      mark the feed as read
//   POST /api/delete-account
//   GET  /api/public?slug=… a shared list as anyone may see it (no sign-in needed)
//
// Never cached (Cache-Control: private, no-store). POSTs must come from this site.
import type { APIRoute } from "astro";
import { ACTIONS, isSlug, sameOrigin } from "../../lib/account";
import { DbError, configured, getSession, json, rpc, signedOutCookies, workos } from "../../lib/server/session";

export const prerender = false;

async function handle(method: "GET" | "POST", action: string, request: Request): Promise<Response> {
  if (method === "POST" && !sameOrigin(request.headers.get("origin"), new URL(request.url).origin)) return json({ error: "Forbidden." }, 403);
  if (!configured()) return action === "me" ? json({ signedIn: false, available: false }) : json({ error: "Accounts are not switched on yet." }, 503);

  if (action === "public" && method === "GET") {
    const slug = new URL(request.url).searchParams.get("slug");
    if (!isSlug(slug)) return json({ error: "Bad link." }, 400);
    try {
      const list = await rpc("public_watchlist", { p_slug: slug });
      return list ? json(list) : json({ error: "That shared watchlist no longer exists." }, 404);
    } catch { return json({ error: "Something went wrong. Please try again." }, 502); }
  }

  const { session, setCookies } = await getSession(request);
  if (!session) return action === "me" ? json({ signedIn: false, available: true }, 200, setCookies) : json({ error: "Please sign in." }, 401, setCookies);

  try {
    if (action === "delete-account" && method === "POST") {
      await rpc("account_delete", {}, session.accessToken);
      try { await workos().userManagement.deleteUser(session.userId); } catch { /* data is gone either way; WorkOS user can be removed by hand */ }
      return json({ deleted: true }, 200, signedOutCookies());
    }
    const a = ACTIONS[action];
    if (!a || a.method !== method) return json({ error: "Not found." }, 404, setCookies);
    let body: Record<string, unknown> = {};
    if (method === "POST") {
      try { body = (await request.json()) as Record<string, unknown>; } catch { body = {}; }
      if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
    }
    const args = a.args(body);
    if (typeof args === "string") return json({ error: args }, 400, setCookies);
    const data = await rpc(a.fn, args, session.accessToken);
    if (action === "me") return json({ signedIn: true, available: true, email: session.email, ...(data as object) }, 200, setCookies);
    if (action === "feed") return json({ rows: data }, 200, setCookies);
    return json(data, 200, setCookies);
  } catch (e) {
    if (e instanceof DbError) return json({ error: e.message }, e.status, setCookies);
    return json({ error: "Something went wrong. Please try again." }, 500, setCookies);
  }
}

export const GET: APIRoute = ({ params, request }) => handle("GET", String(params.action ?? ""), request);
export const POST: APIRoute = ({ params, request }) => handle("POST", String(params.action ?? ""), request);
