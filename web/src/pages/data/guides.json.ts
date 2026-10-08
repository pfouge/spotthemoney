// /data/guides.json — a machine-readable index of the guides: what each one says it depends on
// (source files, on-screen labels, dated facts) and what it links to. scripts/verify-guides.mjs
// reads this to check that the guides still match the site; it carries no page text.
import type { APIRoute } from "astro";
import { getGuides, guidePath, wordCount, internalLinks, externalLinks } from "../../lib/guides";
import { FACTS } from "../../lib/guides/facts";

export const GET: APIRoute = async () => {
  const guides = await getGuides();
  const body = {
    builtAt: new Date().toISOString(),
    facts: Object.fromEntries(Object.entries(FACTS).map(([k, f]) => [k, { asOf: f.asOf, recheckBy: f.recheckBy, source: f.source }])),
    guides: guides.map((g) => ({
      slug: g.slug, path: guidePath(g.slug), group: g.group, title: g.title, updated: g.updated, words: wordCount(g),
      sections: g.sections.length, faqs: g.faqs.length, sources: g.sources.length,
      covers: g.covers, ui: g.ui, facts: g.facts, internal: internalLinks(g), external: externalLinks(g),
    })),
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" } });
};
