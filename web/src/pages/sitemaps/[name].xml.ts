// /sitemaps/<type>.xml — one child sitemap per entity type (pages, insiders, congress,
// companies, stocks), generated at build from the same graph the pages render from.
import type { APIRoute, GetStaticPaths } from "astro";
import { buildSitemaps, renderChild } from "../../lib/sitemap";

export const getStaticPaths: GetStaticPaths = async () => {
  const children = await buildSitemaps();
  return children.map((c) => ({ params: { name: c.name }, props: { child: c } }));
};

export const GET: APIRoute = ({ props }) => {
  const child = (props as { child: Awaited<ReturnType<typeof buildSitemaps>>[number] }).child;
  return new Response(renderChild(child), { headers: { "content-type": "application/xml; charset=utf-8" } });
};
