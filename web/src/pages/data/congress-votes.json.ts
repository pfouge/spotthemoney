// /data/congress-votes.json: the rows behind the roll-call hub (/congress-votes/), packed
// (lib/votes.ts): one short list per roll call, no positions. Members' positions are in the
// monthly files under /data/votes/. Empty list when no roll call is on record.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { packVotes } from "../../lib/votes";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  const v = m.votes;
  return new Response(JSON.stringify(packVotes(v.builtAt || m.builtAt.slice(0, 10), v.rolls, v.members)), { headers: { "content-type": "application/json; charset=utf-8" } });
};
