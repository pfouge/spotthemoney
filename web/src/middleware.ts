// Runs only for on-demand routes (`export const prerender = false`) — prerendered pages are
// static assets and get their headers from public/_headers. Keep the security header list
// identical in both places.
//
// Edge caching is what keeps on-demand pages cheap: Cloudflare serves the cached copy for a
// day and revalidates in the background for a week, so Supabase sees a trickle of the traffic.
// Ingest jobs purge affected URLs (cache-purge works on the free plan) when data changes.

import { defineMiddleware } from "astro:middleware";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const EDGE_CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";

// Entity pages rendered on demand (stage 3a) also go through the Workers Cache API, keyed by URL,
// so a hit never reaches Supabase. Found pages live a day, an unknown slug five minutes. A
// response that sets a cookie is never stored. Parity requests (test switch) are never stored.
const OD_PATH = /^\/(insiders|stocks|companies)\/[^/]+\/?$/;
const FOUR_OH_FOUR_TTL = "public, max-age=60, s-maxage=300";

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  // The build (Node) renders prerendered pages through this middleware too; only the Worker has
  // a Cache API, and only the Worker may load cloudflare:workers.
  const workerCache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null;
  const cache = workerCache && request.method === "GET" && OD_PATH.test(url.pathname) && !(await import("./lib/server/odsource")).parityAllowed(url)
    ? workerCache
    : null;
  const key = cache ? new Request(new URL(url.pathname.replace(/\/?$/, "/"), url).toString(), { method: "GET" }) : null;
  if (cache && key) {
    const hit = await cache.match(key);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set("x-od-cache", "hit");
      return r;
    }
  }
  const response = await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (!response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", EDGE_CACHE);
  }
  if (cache && key && !response.headers.has("set-cookie") && (response.status === 200 || response.status === 404)) {
    const out = new Response(response.body, response);
    out.headers.set("x-od-cache", "miss");
    const cacheCopy = new Response(out.clone().body, out);
    if (response.status === 404) cacheCopy.headers.set("Cache-Control", FOUR_OH_FOUR_TTL);
    await cache.put(key, cacheCopy).catch(() => {});
    return out;
  }
  return response;
});
