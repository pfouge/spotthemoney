// /data/catalog.json: the machine-readable list of the public data files (the CSV downloads with
// their row counts and columns, one-member and one-ticker files, the RSS feeds, and the JSON files
// the site's own pages load, marked as not stable). Documented on /developers/; see lib/datafiles.ts.
import type { APIRoute } from "astro";
import { getCatalog } from "../../lib/datafiles-build";

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await getCatalog()), { headers: { "content-type": "application/json; charset=utf-8" } });
