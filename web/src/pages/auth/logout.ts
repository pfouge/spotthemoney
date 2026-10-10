// POST /auth/logout — end the session here and at WorkOS, then go home. POST only, from this
// site only, so a link or image elsewhere cannot sign anyone out.
import type { APIRoute } from "astro";
import { sameOrigin } from "../../lib/account";
import { getSession, redirect, signedOutCookies, siteUrl, workos, configured } from "../../lib/server/session";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!sameOrigin(request.headers.get("origin"), new URL(request.url).origin)) return new Response("Forbidden", { status: 403 });
  let to = "/";
  if (configured()) {
    const { session } = await getSession(request);
    if (session) {
      try { to = workos().userManagement.getLogoutUrl({ sessionId: session.sessionId, returnTo: `${siteUrl()}/` }); } catch { /* local sign-out still happens */ }
    }
  }
  return redirect(to, signedOutCookies());
};
