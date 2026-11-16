// /feeds/<id>.xml — RSS 2.0 feeds of the newest disclosed trades (rules in lib/feeds.ts).
// Static files, rebuilt with the site; nothing records who reads them.
import type { APIRoute, GetStaticPaths } from "astro";
import { FEEDS, feedDef, rssXml, type FeedId } from "../../lib/feeds";
import { getFeeds } from "../../lib/feeds-build";
import { getFlagship } from "../../lib/flagship";
import { SITE_URL } from "../../lib/seo";

export const getStaticPaths: GetStaticPaths = () => FEEDS.map((f) => ({ params: { feed: f.id } }));

export const GET: APIRoute = async ({ params }) => {
  const id = params.feed as FeedId;
  const items = (await getFeeds()).get(id) ?? [];
  const built = (await getFlagship()).builtAt.slice(0, 10);
  return new Response(rssXml(feedDef(id), items, SITE_URL, built), { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
};
