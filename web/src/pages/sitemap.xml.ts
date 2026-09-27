// /sitemap.xml — same index as /sitemap-index.xml (crawlers and validators try both).
import type { APIRoute } from "astro";
import { buildSitemaps, renderIndex } from "../lib/sitemap";

export const GET: APIRoute = async () => {
  const children = await buildSitemaps();
  return new Response(renderIndex(children), { headers: { "content-type": "application/xml; charset=utf-8" } });
};
