// /data/heatmap-insiders.json — rows for the corporate insider heatmap (see lib/heatmap.ts).
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { insiderRows, heatmapFile } from "../../lib/heatmap";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  const body = JSON.stringify(heatmapFile("insiders", m, insiderRows(m)));
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } });
};
