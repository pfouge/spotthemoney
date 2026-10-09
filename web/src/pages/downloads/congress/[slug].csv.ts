// /downloads/congress/<slug>.csv — one member's trades, the same rows as /congress/<slug>/.
import type { APIRoute } from "astro";
import { getDownloads } from "../../../lib/downloads";
import { csvResponse } from "../../../lib/csv";

export async function getStaticPaths() {
  return [...(await getDownloads()).member.keys()].map((slug) => ({ params: { slug } }));
}
export const GET: APIRoute = async ({ params }) => {
  const f = (await getDownloads()).member.get(params.slug!);
  return f ? csvResponse(f.body()) : new Response("Not found", { status: 404 });
};
