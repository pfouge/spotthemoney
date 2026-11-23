// /data/company-redirects.json: old /companies/<slug>/ addresses of companies that are now shown
// on their ticker page (lib/onepage.ts), slug to new path. Read by the Worker route
// pages/companies/[...rest].astro, which answers such an address with a permanent redirect.
import type { APIRoute } from "astro";
import { getFlagship } from "../../lib/flagship";
import { companyRedirects } from "../../lib/onepage";

export const GET: APIRoute = async () => {
  const m = await getFlagship();
  return new Response(JSON.stringify(companyRedirects(m)), { headers: { "content-type": "application/json; charset=utf-8" } });
};
