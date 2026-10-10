// GET /auth/login?return=/path[&signup=1] — send the visitor to WorkOS AuthKit's hosted sign-in
// page (email code or Google). A random state value is kept in a short-lived cookie and checked
// in /auth/callback, so nobody can complete a sign-in that this browser did not start.
import type { APIRoute } from "astro";
import { STATE_COOKIE, safeReturnPath, setCookie } from "../../lib/account";
import { clientId, configured, redirect, siteUrl, workos } from "../../lib/server/session";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  if (!configured()) return new Response("Accounts are not switched on yet.", { status: 503, headers: { "Cache-Control": "no-store" } });
  // Start every sign-in on the canonical host (www → apex): the state cookie set here must be
  // readable by /auth/callback, which WorkOS sends to the registered address only.
  if (url.origin !== siteUrl()) return redirect(`${siteUrl()}${url.pathname}${url.search}`);
  const returnTo = safeReturnPath(url.searchParams.get("return"));
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const state = `${nonce}.${btoa(returnTo).replace(/=+$/, "")}`;
  const authUrl = workos().userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId: clientId(),
    redirectUri: `${siteUrl()}/auth/callback`,
    state,
    ...(url.searchParams.get("signup") === "1" ? { screenHint: "sign-up" as const } : {}),
  });
  return redirect(authUrl, [setCookie(STATE_COOKIE, nonce, { maxAge: 600 })]);
};
