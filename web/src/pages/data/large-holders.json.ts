// /data/large-holders.json: the rows behind the large holders hub (/large-holders/), packed
// (lib/largeholders.ts): one short array per holder and company, the holder's newest Schedule 13D
// or 13G statement. Empty while the load is not current.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { siteLarge } from "../../lib/largeholders-build";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(JSON.stringify(siteLarge(m).data), { headers: { "content-type": "application/json; charset=utf-8" } });
};
