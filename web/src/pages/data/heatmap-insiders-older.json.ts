// /data/heatmap-insiders-older.json — insider rows older than 90 days, back to a year, packed.
// Fetched by the heatmap only when the 1Y window is chosen (see lib/heatmap.ts).
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { insidersFiles } from "../../lib/heatmap";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(insidersFiles(m).older, { headers: { "content-type": "application/json; charset=utf-8" } });
};
