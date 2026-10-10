/// <reference path="../.astro/types.d.ts" />
// The Cloudflare Worker's settings, read by on-demand routes (src/lib/server/session.ts).
// @cloudflare/workers-types is not installed; this is the one name the site uses from it.
declare module "cloudflare:workers" {
  export const env: Record<string, string | undefined>;
}
