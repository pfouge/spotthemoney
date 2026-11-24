// Where the top advertisement goes in a page's content: after the title block, not above it.
// BaseLayout renders the page content to a string and splits it here. Pure string work, no DOM.
// The title block is the first top-level element that holds the h1, plus the lede or facts list
// that directly follows it. A page with no h1 at all keeps the ad first.

export interface TopEl { start: number; end: number; tag: string; cls: string }

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "template"]);

/** The top-level elements of an HTML fragment, in order (text between them is ignored). */
export function topLevel(html: string): TopEl[] {
  const out: TopEl[] = [];
  const n = html.length;
  let i = 0, depth = 0, cur: TopEl | null = null;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) { const e = html.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") { const e = html.indexOf(">", lt); i = e < 0 ? n : e + 1; continue; }
    const closing = html[lt + 1] === "/";
    const m = /^<\/?([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    const tag = m[1]!.toLowerCase();
    // find the end of the tag, honouring quoted attribute values
    let j = lt + m[0].length, q = "";
    for (; j < n; j++) { const c = html[j]!; if (q) { if (c === q) q = ""; } else if (c === '"' || c === "'") q = c; else if (c === ">") break; }
    const tagText = html.slice(lt, j + 1);
    const selfClose = tagText.endsWith("/>");
    if (closing) {
      if (depth > 0) depth--;
      if (depth === 0 && cur) { cur.end = j + 1; out.push(cur); cur = null; }
      i = j + 1; continue;
    }
    if (depth === 0) {
      const c = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/.exec(tagText);
      cur = { start: lt, end: j + 1, tag, cls: c ? (c[2] ?? c[3] ?? "") : "" };
    }
    if (VOID.has(tag) || selfClose) {
      if (depth === 0 && cur) { out.push(cur); cur = null; }
      i = j + 1; continue;
    }
    if (RAW.has(tag)) {
      const e = html.toLowerCase().indexOf(`</${tag}`, j + 1);
      const ee = e < 0 ? n : html.indexOf(">", e) + 1;
      if (depth === 0 && cur) { cur.end = ee; out.push(cur); cur = null; }
      i = ee; continue;
    }
    depth++;
    i = j + 1;
  }
  return out;
}

const hasClass = (cls: string, name: string) => cls.split(/\s+/).includes(name);
const FOLLOWS = ["lede", "facts", "site-what", "title-sub"];

/** Split the content so the ad can sit between the two halves. `before` is "" when there is no h1. */
export function splitForAd(html: string): { before: string; after: string } {
  const els = topLevel(html);
  let k = els.findIndex((e) => e.tag === "h1" || /<h1[\s>]/i.test(html.slice(e.start, e.end)));
  if (k < 0) return { before: "", after: html };
  while (k + 1 < els.length && FOLLOWS.some((c) => hasClass(els[k + 1]!.cls, c))) k++;
  const cut = els[k]!.end;
  return { before: html.slice(0, cut), after: html.slice(cut) };
}

/** True when some top-level element carries the class. */
export function topHasClass(html: string, name: string): boolean {
  return topLevel(html).some((e) => hasClass(e.cls, name));
}
