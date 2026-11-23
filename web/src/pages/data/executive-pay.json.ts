// /data/executive-pay.json: the rows behind /executive-pay/, packed (lib/execpay.ts): one short array per
// company with figures, holding its newest fiscal year as the company tagged it.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { sitePayHub } from "../../lib/execpay-build";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(JSON.stringify(sitePayHub(m).data), { headers: { "content-type": "application/json; charset=utf-8" } });
};
