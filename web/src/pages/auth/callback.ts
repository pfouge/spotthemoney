// GET /auth/callback?code=…&state=… — WorkOS sends the visitor back here. Exchange the code for
// a sealed session, create the account row (and the default watchlist) as that visitor, set the
// session cookies and return to the page they came from.
import type { APIRoute } from "astro";
import { STATE_COOKIE, clearCookie, readCookie, safeReturnPath } from "../../lib/account";
import { clientId, configured, cookiePassword, redirect, rpc, sessionCookies, workos } from "../../lib/server/session";

export const prerender = false;

const fail = (why: string) => redirect(`/watchlist/?signin=${encodeURIComponent(why)}`, [clearCookie(STATE_COOKIE)]);

export const GET: APIRoute = async ({ url, request }) => {
  if (!configured()) return new Response("Accounts are not switched on yet.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const code = url.searchParams.get("code");
  const [nonce, ret = ""] = (url.searchParams.get("state") ?? "").split(".");
  const expected = readCookie(request.headers.get("cookie"), STATE_COOKIE);
  if (url.searchParams.get("error")) return fail("cancelled");
  // Arrived with nothing at all: WorkOS's sign-in page sent the browser back without finishing
  // (seen 2026-10-10 in one browser profile that is also signed in to the WorkOS dashboard).
  if (!code && !url.searchParams.get("state")) return fail("incomplete");
  if (!code || !nonce || !expected || nonce !== expected) return fail("expired");
  let returnTo = "/watchlist/";
  try { returnTo = safeReturnPath(atob(ret)); } catch { /* keep the default */ }
  try {
    const auth = await workos().userManagement.authenticateWithCode({
      clientId: clientId(), code,
      session: { sealSession: true, cookiePassword: cookiePassword() },
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    if (!auth.sealedSession) return fail("failed");
    await rpc("account_touch", { p_email: auth.user.email ?? null }, auth.accessToken);
    return redirect(returnTo, [...sessionCookies(auth.sealedSession), clearCookie(STATE_COOKIE)]);
  } catch {
    return fail("failed");
  }
};
