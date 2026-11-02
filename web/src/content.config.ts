// Content collections for the Writing section (articles by outside contributors).
//
// One Markdown file in src/content/articles/ is one article; the file name (without .md) is the
// URL slug: /writing/<slug>/. One JSON file in src/content/authors/ is one author; the file name
// is the author slug: /writing/authors/<slug>/. Contributor guide: PUBLISHING-ARTICLES.md.
// scripts/check-articles.mjs repeats these rules so a contributor can check before opening a PR.
// Both collections may be empty: the build passes with zero articles and zero authors.
import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Entry id = file name without its extension. A name that cannot be a URL slug fails the build. */
function idFromFile(kind: string, ext: RegExp) {
  return ({ entry }: { entry: string }) => {
    const id = entry.replace(ext, "");
    if (!SLUG_RE.test(id)) {
      throw new Error(
        `${kind} file "${entry}": the file name becomes the URL, so it may use only lowercase letters, digits and single hyphens ` +
        `(like "my-first-article"). Rename it to match ${SLUG_RE}.`,
      );
    }
    return id;
  };
}

/**
 * The glob loader for one folder of files named *.<ext> (dotfiles ignored). Astro's glob loader
 * returns early when nothing matches and leaves the previous entries in its local cache, so after
 * the last article is deleted a build on the same machine would still publish it. When the
 * folder has no such files this clears the collection instead.
 */
function folderLoader(kind: string, base: string, ext: "md" | "json") {
  const inner = glob({ pattern: [`*.${ext}`, "!.*"], base, generateId: idFromFile(kind, new RegExp(`\\.${ext}$`)) });
  return {
    ...inner,
    async load(ctx: Parameters<typeof inner.load>[0]) {
      const dir = fileURLToPath(new URL(base, ctx.config.root));
      const any = existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(`.${ext}`) && !f.startsWith("."));
      if (!any) { ctx.store.clear(); return; }
      return inner.load(ctx);
    },
  };
}

const articles = defineCollection({
  loader: folderLoader("Article", "./src/content/articles", "md"),
  schema: z.object({
    title: z.string().min(1).max(60),
    deck: z.string().min(70).max(155),
    // Optional answer-engine fields (PUBLISHING-ARTICLES.md, "Getting found in search and AI answers").
    summary: z.string().min(80).max(320).optional(),
    faqs: z.array(z.object({ q: z.string().min(10).max(150), a: z.string().min(40).max(600) })).max(8).optional(),
    published: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: reference("authors"),
    tags: z.array(z.string().trim().min(1).refine((t) => t === t.toLowerCase(), "tags must be lowercase")).default([]),
    original: z.url({ protocol: /^https?$/ }).optional(),
    image: z.string().regex(/^\/writing\/\S+$/, "image must be a site path starting with /writing/ (the file lives in web/public/writing/<slug>/)").optional(),
    draft: z.boolean().default(false),
  }),
});

const authors = defineCollection({
  loader: folderLoader("Author", "./src/content/authors", "json"),
  schema: z.object({
    name: z.string().min(1),
    bio: z.string().max(300).optional(),
    // Links: a full URL, or for x / linkedin / github a bare handle.
    url: z.string().optional(),
    x: z.string().optional(),
    linkedin: z.string().optional(),
    github: z.string().optional(),
  }),
});

export const collections = { articles, authors };
