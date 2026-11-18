// /alerts/unsubscribe/?token=<64 hex> — the link in every email digest (parity queue item 7,
// stage 3). Live whatever the site's alerts switch says: a way out must work before, during and
// after the feature is offered. Rules and wording are in src/lib/unsubscribe.ts.
//
//   GET   a page with one button; changes nothing (mail scanners open every link)
//   POST  turns the digest off through alert_unsubscribe() (migration 0025), called as `anon`.
//         No sign-in and no Origin check: a mail program's one-click POST (RFC 8058) has neither.
//
// Keep this file free of imports of the WorkOS session, postgres, fs, flagship or db.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { rpc } from "../../lib/server/supabase";
import { UNSUB_HEADERS, unsubPage, unsubPlan, type UnsubView } from "../../lib/unsubscribe";

export const prerender = false;

const page = (view: UnsubView, status: number, token: string | null): Response =>
  new Response(unsubPage(view, token), { status, headers: UNSUB_HEADERS });

async function handle(method: "GET" | "POST", request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  const plan = unsubPlan(method, token);
  if (!plan.call) return page(plan.view, plan.status, token);
  const e = env as unknown as { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string };
  if (!e.SUPABASE_URL || !e.SUPABASE_ANON_KEY) return page("error", 503, token);
  try {
    // The answer is {ok}; it is not shown, so a known and an unknown token read the same.
    await rpc("alert_unsubscribe", { p_token: token });
  } catch {
    return page("error", 503, token);
  }
  return page(plan.view, plan.status, token);
}

export const GET: APIRoute = ({ request }) => handle("GET", request);
export const POST: APIRoute = ({ request }) => handle("POST", request);
