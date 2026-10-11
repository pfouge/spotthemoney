// /data/watch/<kind>-<n>.json — watchlist cards for one shard of one kind of page (lib/watchcards.ts).
// 60 small files in all; the watchlist pages fetch only the shards their items fall in.
import type { APIRoute } from "astro";
import { getFlagship } from "../../../lib/flagship";
import { KINDS, type Kind } from "../../../lib/account";
import { SHARDS } from "../../../lib/watchcards";
import { watchShard } from "../../../lib/watchcards-build";

export function getStaticPaths() {
  return KINDS.flatMap((kind) => Array.from({ length: SHARDS[kind] }, (_, n) => ({ params: { shard: `${kind}-${n}` }, props: { kind, n } })));
}

export const GET: APIRoute = async ({ props }) => {
  const { kind, n } = props as { kind: Kind; n: number };
  const m = await getFlagship();
  return new Response(JSON.stringify(watchShard(m, kind, n)), { headers: { "content-type": "application/json; charset=utf-8" } });
};
