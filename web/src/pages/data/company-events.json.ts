// /data/company-events.json: the rows behind /company-events/, packed (lib/events8k.ts): every Form 8-K
// report filed in the last 365 days by a company with a page here. About twelve thousand rows, well
// under the 25 MiB per-file limit (the file is about a megabyte).
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { siteEventsHub } from "../../lib/events8k-build";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(JSON.stringify(siteEventsHub(m).data), { headers: { "content-type": "application/json; charset=utf-8" } });
};
