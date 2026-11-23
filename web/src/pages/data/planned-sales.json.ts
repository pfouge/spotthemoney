// /data/planned-sales.json: the rows behind the planned sales hub (/planned-sales/), packed
// (lib/plannedsales.ts): one short array per Form 144 notice filed in the last 12 months about a
// company with a page here, with companies and sellers written once. Empty while the load is not current.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { sitePlanned } from "../../lib/plannedsales-build";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(JSON.stringify(sitePlanned(m).data), { headers: { "content-type": "application/json; charset=utf-8" } });
};
