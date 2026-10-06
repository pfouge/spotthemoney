// /data/coverage.json — what the database holds against what the sources publish: filings and
// rows per source per month, held-for-review counts, recent run status (see lib/coverage.ts).
import type { APIRoute } from "astro";
import { getCoverage } from "../../lib/coverage";

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await getCoverage()), { headers: { "content-type": "application/json; charset=utf-8" } });
