// Guide titles and first key facts for the on-demand entity pages (stage 3a), which cannot read the
// guides' build-time context. The Worker fetches this static file once per isolate.
import type { APIRoute } from "astro";
import { getGuides } from "../../lib/guides";

export const GET: APIRoute = async () => {
  const out: Record<string, { slug: string; title: string; fact: string | null }> = {};
  for (const g of await getGuides()) out[g.slug] = { slug: g.slug, title: g.title, fact: g.keyFacts[0] ?? null };
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
