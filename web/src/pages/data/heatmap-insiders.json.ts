// /data/heatmap-insiders.json — the last 90 days of rows for the corporate insider heatmap,
// packed (see lib/heatmap.ts and lib/heatmap-pack.ts). The rest of the year is in
// /data/heatmap-insiders-older.json, which the map fetches when the 1Y window is chosen.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { insidersFiles } from "../../lib/heatmap";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(insidersFiles(m).recent, { headers: { "content-type": "application/json; charset=utf-8" } });
};
