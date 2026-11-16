// Worker-only source for the on-demand entity pages (stage 3a): one rpc call per page into the
// od_* functions (db/migrations/0020), plus the small static JSON of guide titles the layout
// needs. Never imported by a prerendered page.
import { env } from "cloudflare:workers";
import { FORM4_FLOOR } from "@stm/shared";
import { rpc } from "./supabase";
import type { OdDoc, OdKind } from "./od";

interface Env { OD_PARITY?: string; ASSETS?: { fetch: (r: Request | string) => Promise<Response> } }
const E = env as unknown as Env;

/**
 * The parity switch. od_* functions return a TRACKED entity (one with a static page) only when
 * called with p_any = true. The Worker sends it only when the environment variable OD_PARITY is
 * "1" AND the request is addressed to a loopback host. Production sets no such variable (it is not
 * in wrangler.jsonc, not a secret, and no workflow sets it), and a production request is never
 * addressed to a loopback host, so the guard is closed twice over.
 */
export function parityAllowed(url: URL): boolean {
  return E.OD_PARITY === "1" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

const FN: Record<OdKind, [string, string]> = { insider: ["od_insider", "p_slug"], stock: ["od_stock", "p_ticker"], company: ["od_company", "p_slug"] };

/** The page's document, or null when there is no such entity (or it is tracked and this is not a parity request). */
export async function fetchOd(kind: OdKind, key: string, url: URL): Promise<OdDoc | null> {
  const [fn, arg] = FN[kind];
  const doc = await rpc<OdDoc | null>(fn, { [arg]: key, p_any: parityAllowed(url), p_floor: FORM4_FLOOR });
  return doc ?? null;
}

export interface GuideLink { slug: string; title: string; fact: string | null }
let guides: Promise<Record<string, GuideLink>> | null = null;
/** Guide titles for the "Guides for this page" block, from the static file the build writes (/data/od-guides.json). */
export function guideLinks(url: URL): Promise<Record<string, GuideLink>> {
  guides ??= (async () => {
    try {
      const res = await E.ASSETS!.fetch(new Request(new URL("/data/od-guides.json", url)));
      if (!res.ok) return {};
      return (await res.json()) as Record<string, GuideLink>;
    } catch { return {}; }
  })();
  return guides;
}

const SEG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
/** The one path segment an on-demand route accepts (/insiders/<slug>/); anything else is a 404. */
export function oneSegment(rest: string | undefined): string | null {
  if (!rest) return null;
  const s = rest.replace(/\/+$/, "");
  return SEG.test(s) ? s : null;
}

/** The site's own 404 page with a 404 status. */
export async function notFound(url: URL): Promise<Response> {
  let body = "<!doctype html><title>Not found</title><h1>Page not found</h1>";
  try {
    const res = await E.ASSETS!.fetch(new Request(new URL("/404.html", url), { redirect: "follow" }));
    if (res.ok) body = await res.text();
  } catch { /* keep the fallback */ }
  return new Response(body, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60, s-maxage=300" } });
}
