// /data/financials-screener.json: the rows behind the company financials screener
// (/company-financials/), packed (lib/finscreen.ts): one short array per company with the figures
// of its newest fiscal year and its newest quarter, as filed. A figure a page holds back is not
// in the file. About a thousand companies: far below the 25 MiB per-file limit.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { siteFinScreen } from "../../lib/finscreen-build";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(JSON.stringify(siteFinScreen(m).data), { headers: { "content-type": "application/json; charset=utf-8" } });
};
