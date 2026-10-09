// /data/trade-cross.json — the other group's dollars per ticker and window, for the scatter view
// of the trade map on /congress/ and /insiders/ (see lib/trade-cross.ts).
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { congressRows, insiderRows } from "../../lib/heatmap";
import { crossFile } from "../../lib/trade-cross";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(JSON.stringify(crossFile(congressRows(m), insiderRows(m), m.builtAt)), { headers: { "content-type": "application/json; charset=utf-8" } });
};
