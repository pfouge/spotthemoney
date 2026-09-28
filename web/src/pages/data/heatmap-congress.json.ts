// /data/heatmap-congress.json — rows for the congressional trades heatmap (see lib/heatmap.ts).
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { congressRows, heatmapFile } from "../../lib/heatmap";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  const body = JSON.stringify(heatmapFile("congress", m, congressRows(m)));
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } });
};
