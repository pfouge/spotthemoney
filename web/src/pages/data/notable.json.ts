// /data/notable.json: the 30-day set behind the home-page feed (lib/notable.ts). The page renders the
// default view into its HTML; scripts/notable.ts fetches this file for every other view.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { homeFeed } from "../../lib/notable-build";

export const GET: APIRoute = async () => {
  const { data } = homeFeed(await getFlagship());
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json; charset=utf-8" } });
};
