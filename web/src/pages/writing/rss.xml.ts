// /writing/rss.xml — RSS 2.0 feed of the newest 50 published articles (never drafts or
// future-dated ones). Hand-written; every value is XML-escaped.
import type { APIRoute } from "astro";
import { getArticles, getAuthorMap, articleUrl } from "../../lib/articles";
import { SITE_URL } from "../../lib/seo";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const rfc822 = (isoDay: string) => new Date(`${isoDay}T12:00:00Z`).toUTCString();

export const GET: APIRoute = async () => {
  const articles = (await getArticles({ publicOnly: true })).slice(0, 50);
  const authors = await getAuthorMap();
  const last = articles.map((a) => a.modified).sort().at(-1);
  const items = articles.map((a) => {
    const url = articleUrl(a.slug);
    return [
      "    <item>",
      `      <title>${esc(a.title)}</title>`,
      `      <link>${esc(url)}</link>`,
      `      <guid isPermaLink="true">${esc(url)}</guid>`,
      `      <pubDate>${rfc822(a.published)}</pubDate>`,
      `      <dc:creator>${esc(authors.get(a.authorId)?.name ?? a.authorId)}</dc:creator>`,
      ...a.tags.map((t) => `      <category>${esc(t)}</category>`),
      `      <description>${esc(a.deck)}</description>`,
      "    </item>",
    ].join("\n");
  });
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    "  <channel>",
    "    <title>Spot the Money: Writing</title>",
    `    <link>${SITE_URL}/writing/</link>`,
    "    <description>Articles from contributors on what public records show about money, markets and Washington.</description>",
    "    <language>en-us</language>",
    ...(last ? [`    <lastBuildDate>${rfc822(last)}</lastBuildDate>`] : []),
    `    <atom:link href="${SITE_URL}/writing/rss.xml" rel="self" type="application/rss+xml" />`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
};
