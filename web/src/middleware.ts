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

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (!response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", EDGE_CACHE);
  }
  return response;
});
