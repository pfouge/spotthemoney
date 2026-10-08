// Ready-made citations for a page, a chart or a single trade, in the four styles the Cite menu
// offers. Pure functions shared by the browser (scripts/share.ts) and the "How to cite" guide,
// so the examples in the guide are produced by the same code as the menu.
//
// What is cited is always the page on this site, with its "last updated" date and the date it
// was read (pages change daily, so the access date matters). A trade also names the original
// government filing: that is the authority, and a careful writer cites it too.
// Style notes: APA 7 (group author, retrieval date because the content changes), MLA 9
// (container in italics, day-month-year, abbreviated months), Chicago 17 notes-bibliography.

export type CiteStyle = "plain" | "apa" | "mla" | "chicago";
export const CITE_STYLES: { key: CiteStyle; label: string }[] = [
  { key: "plain", label: "Plain" }, { key: "apa", label: "APA" }, { key: "mla", label: "MLA" }, { key: "chicago", label: "Chicago" },
];

export interface CiteInput {
  /** What is being cited: the page title, "Chart — page", or the one-line trade sentence. */
  title: string;
  /** Canonical URL (with #anchor for a chart or a trade). */
  url: string;
  /** ISO date the page's data was last updated; null when unknown. */
  updated: string | null;
  /** ISO date the reader accessed it (today). */
  accessed: string;
  /** The government filing behind a single trade. */
  original?: { label: string; url: string } | null;
}

export const PUBLISHER_NAME = "Spot the Money";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MLA_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

function parts(iso: string | null): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { y, m: mo - 1, d } : null;
}
const long = (iso: string | null): string | null => { const p = parts(iso); return p ? `${MONTHS[p.m]} ${p.d}, ${p.y}` : null; };
const apaDate = (iso: string | null): string => { const p = parts(iso); return p ? `${p.y}, ${MONTHS[p.m]} ${p.d}` : "n.d."; };
const mlaDate = (iso: string | null): string | null => { const p = parts(iso); return p ? `${p.d} ${MLA_MONTHS[p.m]} ${p.y}` : null; };

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The title without a trailing full stop, so a style can add its own punctuation once. */
const bare = (t: string): string => t.trim().replace(/\.+$/, "");
/** Closing punctuation for a title: nothing extra after "?" or "!". */
const stop = (t: string): string => (/[?!]$/.test(t) ? "" : ".");

/** One citation as plain text and as HTML (italics where the style wants them). */
export function citation(style: CiteStyle, c: CiteInput): { text: string; html: string } {
  const t = bare(c.title), acc = long(c.accessed) ?? c.accessed, upd = long(c.updated);
  const orig = c.original ? ` Original filing: ${bare(c.original.label)}, ${c.original.url}` : "";
  let text: string, html: string;
  if (style === "apa") {
    const head = `${PUBLISHER_NAME}. (${apaDate(c.updated)}). `, tail = `${stop(t)} Retrieved ${acc}, from ${c.url}`;
    text = head + t + tail; html = esc(head) + `<em>${esc(t)}</em>` + esc(tail);
  } else if (style === "mla") {
    const date = mlaDate(c.updated), accM = mlaDate(c.accessed) ?? c.accessed;
    const head = `“${t}${stop(t)}” `, tail = `${date ? `, ${date}` : ""}, ${c.url}. Accessed ${accM}.`;
    text = head + PUBLISHER_NAME + tail; html = esc(head) + `<em>${PUBLISHER_NAME}</em>` + esc(tail);
  } else if (style === "chicago") {
    text = `${PUBLISHER_NAME}. “${t}${stop(t)}” ${upd ? `Last modified ${upd}. ` : ""}Accessed ${acc}. ${c.url}.`; html = esc(text);
  } else {
    text = `${t}${stop(t)} ${PUBLISHER_NAME}${upd ? `, updated ${upd}` : ""}. ${c.url} (accessed ${acc}).`; html = esc(text);
  }
  return { text: text + orig, html: html + esc(orig) };
}
