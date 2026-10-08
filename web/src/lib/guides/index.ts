// All guides, built once per site build against the live values (ctx.ts).
import type { Guide, GuideGroup, Faq } from "./types";
import { GROUPS } from "./types";
import { getGuideCtx } from "./ctx";
import { congressGuides } from "./congress";
import { insiderGuides } from "./insiders";
import { washingtonGuides } from "./washington";
import { ratesGuides } from "./rates";
import { siteGuides } from "./site";
import { plain } from "./html";

export { GROUPS } from "./types";
export type { Guide, GuideGroup, Faq } from "./types";

const BUILDERS = [...congressGuides, ...insiderGuides, ...washingtonGuides, ...ratesGuides, ...siteGuides];

let memo: Promise<Guide[]> | null = null;
export function getGuides(): Promise<Guide[]> {
  return (memo ??= getGuideCtx().then((c) => {
    const guides = BUILDERS.map((b) => b(c));
    const slugs = new Set(guides.map((g) => g.slug));
    if (slugs.size !== guides.length) throw new Error("guides: duplicate slug");
    for (const g of guides) for (const r of g.related) if (!slugs.has(r)) throw new Error(`guides: ${g.slug} links to unknown guide "${r}"`);
    return guides;
  }));
}

export const guidePath = (slug: string): string => `/guides/${slug}/`;

export function byGroup(guides: Guide[]): { key: GuideGroup; label: string; blurb: string; hub: string; guides: Guide[] }[] {
  return GROUPS.map((g) => ({ ...g, guides: guides.filter((x) => x.group === g.key) })).filter((g) => g.guides.length > 0);
}

/** Questions a section page shows in its FAQ block, each with the guide it comes from. */
export function sectionFaqs(guides: Guide[], section: NonNullable<Faq["on"]>[number], limit = 5): { q: string; a: string; guide: Guide }[] {
  const out: { q: string; a: string; guide: Guide }[] = [];
  for (const g of guides) for (const f of g.faqs) if (f.on?.includes(section)) out.push({ q: f.q, a: f.a, guide: g });
  return out.slice(0, limit);
}

/** Words of body text, for the drift check and the hub's reading-time line. */
export function wordCount(g: Guide): number {
  return plain([g.answer, ...g.keyFacts, ...g.sections.map((s) => `${s.h} ${s.html}`), ...g.faqs.map((f) => `${f.q} ${f.a}`)].join(" ")).split(" ").length;
}

/** Every internal href a guide's body links to (checked against the built site). */
export function internalLinks(g: Guide): string[] {
  const hrefs = new Set<string>();
  for (const s of g.sections) for (const m of s.html.matchAll(/href="(\/[^"]*)"/g)) hrefs.add(m[1]!);
  for (const l of g.seeLive) hrefs.add(l.href);
  for (const r of g.related) hrefs.add(guidePath(r));
  return [...hrefs];
}

export function externalLinks(g: Guide): string[] {
  const hrefs = new Set<string>(g.sources.map((s) => s.url));
  for (const s of g.sections) for (const m of s.html.matchAll(/href="(https?:\/\/[^"]*)"/g)) hrefs.add(m[1]!.replace(/&amp;/g, "&"));
  return [...hrefs];
}
