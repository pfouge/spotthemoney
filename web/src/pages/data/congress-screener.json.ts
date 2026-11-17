// /data/congress-screener.json: the rows behind the Congress trade screener (/congress-trades/),
// packed (lib/screener.ts): each member and each report link is written once and a row is a short
// array. Published rows of House and Senate periodic transaction reports only. One file: the
// whole set is a few thousand rows, far below the 25 MiB per-file limit.
import type { APIRoute } from "astro";
import { getFlagship, personPath } from "../../lib/flagship";
import { screenerData } from "../../lib/screener";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  const data = screenerData(m, new Date().toISOString().slice(0, 10), personPath);
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json; charset=utf-8" } });
};
