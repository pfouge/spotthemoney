// /downloads/<name>.csv — the site-wide files listed on /downloads/ (lib/downloads.ts).
import type { APIRoute } from "astro";
import { getDownloads } from "../../lib/downloads";
import { csvResponse } from "../../lib/csv";

export async function getStaticPaths() {
  return (await getDownloads()).files.map((f) => ({ params: { file: f.name.replace(/\.csv$/, "") } }));
}
export const GET: APIRoute = async ({ params }) => {
  const f = (await getDownloads()).files.find((x) => x.name === `${params.file}.csv`);
  return f ? csvResponse(f.body()) : new Response("Not found", { status: 404 });
};
