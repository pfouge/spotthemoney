// /downloads/stocks/<ticker>.csv — every trade on record in one ticker, the same rows as /stocks/<ticker>/.
import type { APIRoute } from "astro";
import { getDownloads } from "../../../lib/downloads";
import { csvResponse } from "../../../lib/csv";

export async function getStaticPaths() {
  return [...(await getDownloads()).stock.keys()].map((ticker) => ({ params: { ticker } }));
}
export const GET: APIRoute = async ({ params }) => {
  const f = (await getDownloads()).stock.get(params.ticker!);
  return f ? csvResponse(f.body()) : new Response("Not found", { status: 404 });
};
