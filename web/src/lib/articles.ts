// Writing section data (articles + authors), read from the content collections in
// src/content.config.ts. Pure helpers; pages, the sitemap, llms.txt and the RSS feed all call
// getArticles() so a URL appears in one place only if it appears in all of them.
//
// What is public: an article is listed when `draft` is not true AND its `published` date is on
// or before today (the build date, UTC). The site is rebuilt and redeployed daily (ingest.yml
// calls deploy.yml), so a future-dated article goes live on its own at the first daily deploy
// on or after its date, with no further commit.
//
// Local preview: with PUBLIC_SHOW_DRAFTS=1 in the environment, drafts and future-dated articles
// are included and flagged `preview: true`; their pages show a "Draft — not public" banner and
// noindex. The sitemap, llms.txt and the RSS feed always use { publicOnly: true }.
import { getCollection, type CollectionEntry } from "astro:content";
import { SITE_URL } from "./seo";

const env = (import.meta as any).env ?? {};
export const SHOW_DRAFTS = (env.PUBLIC_SHOW_DRAFTS ?? (typeof process !== "undefined" ? process.env.PUBLIC_SHOW_DRAFTS : undefined)) === "1";

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Build date, UTC. */
const today = () => new Date().toISOString().slice(0, 10);

export const articlePath = (slug: string): string => `/writing/${slug}/`;
export const authorPath = (slug: string): string => `/writing/authors/${slug}/`;
export const articleUrl = (slug: string): string => `${SITE_URL}${articlePath(slug)}`;

/** About 220 words a minute, never less than 2. */
export const readingMinutes = (body: string | undefined): number => {
  const words = (body ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / 220));
};

export interface Article {
  slug: string;
  entry: CollectionEntry<"articles">;
  title: string;
  deck: string;
  /** Optional two-sentence answer; shown in an answer block and used by llms.txt instead of the deck. */
  summary: string | null;
  /** Optional questions and answers (FAQPage). */
  faqs: { q: string; a: string }[];
  /** ISO dates, YYYY-MM-DD. */
  published: string;
  updated: string | null;
  /** updated ?? published */
  modified: string;
  authorId: string;
  tags: string[];
  original: string | null;
  image: string | null;
  minutes: number;
  /** True for a draft or a future-dated article shown only because PUBLIC_SHOW_DRAFTS=1. */
  preview: boolean;
}

/** Published articles, newest first. */
export async function getArticles(opts: { publicOnly?: boolean } = {}): Promise<Article[]> {
  const now = today();
  const includeHidden = SHOW_DRAFTS && !opts.publicOnly;
  const out: Article[] = [];
  const authorIds = new Set((await getCollection("authors")).map((e) => e.id));
  for (const entry of await getCollection("articles")) {
    const d = entry.data;
    if (!authorIds.has(d.author.id)) {
      throw new Error(`Article "${entry.id}": author "${d.author.id}" has no file src/content/authors/${d.author.id}.json. Add the author file in the same pull request.`);
    }
    const published = iso(d.published);
    const hidden = d.draft || published > now;
    if (hidden && !includeHidden) continue;
    const updated = d.updated ? iso(d.updated) : null;
    out.push({
      slug: entry.id, entry, title: d.title, deck: d.deck, summary: d.summary ?? null, faqs: d.faqs ?? [], published, updated, modified: updated ?? published,
      authorId: d.author.id, tags: d.tags, original: d.original ?? null, image: d.image ?? null,
      minutes: readingMinutes(entry.body), preview: hidden,
    });
  }
  return out.sort((a, b) => (a.published === b.published ? a.slug.localeCompare(b.slug) : a.published < b.published ? 1 : -1));
}

export interface AuthorLink { label: string; href: string }
export interface Author { id: string; name: string; bio: string | null; links: AuthorLink[] }

const asUrl = (v: string, base: string) => (/^https?:\/\//i.test(v) ? v : `${base}${v.replace(/^@/, "").replace(/^\/+/, "")}`);

export async function getAuthors(): Promise<Author[]> {
  const rows = await getCollection("authors");
  return rows.map((e) => {
    const d = e.data;
    const links: AuthorLink[] = [];
    if (d.url) links.push({ label: "Website", href: /^https?:\/\//i.test(d.url) ? d.url : `https://${d.url}` });
    if (d.x) links.push({ label: "X", href: asUrl(d.x, "https://x.com/") });
    if (d.linkedin) links.push({ label: "LinkedIn", href: asUrl(d.linkedin, "https://www.linkedin.com/in/") });
    if (d.github) links.push({ label: "GitHub", href: asUrl(d.github, "https://github.com/") });
    return { id: e.id, name: d.name, bio: d.bio ?? null, links };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export async function getAuthorMap(): Promise<Map<string, Author>> {
  return new Map((await getAuthors()).map((a) => [a.id, a]));
}
