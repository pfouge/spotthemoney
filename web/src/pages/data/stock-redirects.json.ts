// /data/stock-redirects.json: tickers that have no page of their own because they are another
// share class of a company (lib/onepage.ts), lower-case ticker to the page that shows them. Read
// by the Worker route pages/stocks/[...rest].astro, which answers with a permanent redirect.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { stockRedirects } from "../../lib/onepage";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(JSON.stringify(stockRedirects(m)), { headers: { "content-type": "application/json; charset=utf-8" } });
};
