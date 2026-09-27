import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// Hosting: Cloudflare Workers with static assets (decided 2026-09-06; see docs/01 §3 and
// docs/reference/platform-facts-2026-09.md). Astro 7 + @astrojs/cloudflare 14 is the current
// stable pair — re-verify the adapter's `astro` peer range on npm before any Astro major bump.
//
// Rendering: `output: "static"` prerenders every page at build time from the database, so a
// normal pageview is a free static-asset hit — no Worker invocation, no DB read. When the long
// tail (per-ticker / insider / politician profiles) arrives, opt those routes out per file with
// `export const prerender = false;` and serve them with the edge cache headers set in
// src/middleware.ts. (`output: "hybrid"` no longer exists in Astro ≥ 5.)
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://spotthemoney.com",
  output: "static",
  // prerenderEnvironment "node": pages are prerendered in Node (default is a workerd sandbox,
  // where the build-time Postgres read over TCP and the repo-root .env loader do not work).
  adapter: cloudflare({ imageService: "compile", prerenderEnvironment: "node" }),
  // No server sessions: keeps the Worker free of the KV binding the adapter would otherwise
  // require. Turn on (and add a SESSION KV namespace to wrangler.jsonc) only if accounts
  // ever move server-side; the app plan uses Supabase Auth client-side instead (docs/05).
  session: false,
  build: { format: "directory" },
});
