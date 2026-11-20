// Saved screens for the Congress trade screener (pages/congress-trades.astro, scripts/screener.ts).
// A saved screen is a name the visitor typed and the screener's own address for a view (its
// filters, sort order and rows per page; never the page number). The list lives in the visitor's
// browser only, under one localStorage key: nothing is sent to the site, no account is involved,
// and the privacy page says so (pages/privacy.astro, "What is stored in your browser").
// Everything here is pure, so the browser script and the unit tests (scripts/savedscreens.test.ts)
// use the same rules. Whatever is read back from storage is treated as untrusted text: a name is
// cleaned and cut, and an address is taken apart and written again by the screener's own
// `parseHash` and `toHash`, so only the screener's keys and values survive.
import { parseHash, toHash, isViewHash, type ScreenView } from "./screener";

/** The one localStorage key this feature uses. Named on the privacy page: change both together. */
export const SAVED_KEY = "stm.screens.congress";
/** Most screens kept. The oldest is never dropped silently: a save past the limit is refused. */
export const MAX_SAVED = 20;
/** Longest name, in characters. */
export const NAME_MAX = 60;

export interface SavedScreen {
  /** The name the visitor gave it. */
  n: string;
  /** The screener's address for the view, "#chamber=senate&side=buy". Never empty. */
  h: string;
}
export type SaveProblem = "name" | "view" | "full";

/** A name as typed, tidied: control characters out, white space collapsed, cut to NAME_MAX. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
}
/** An address for a view, rewritten by the screener itself and without a page number.
 *  "" when the text is not a view at all, or is the view the page opens on. */
export function cleanHash(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 600 || !isViewHash(raw)) return "";
  return toHash({ ...parseHash(raw), page: 1 });
}
/** The address to save for the view on screen: "" when it is the view the page opens on. */
export function hashToSave(v: ScreenView): string { return toHash({ ...v, page: 1 }); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The stored text → a list. Anything that is not a list of well-formed screens is dropped,
 *  piece by piece: a bad entry never costs the good ones. */
export function parseSaved(raw: string | null | undefined): SavedScreen[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const out: SavedScreen[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const n = cleanName((item as Record<string, unknown>).n), h = cleanHash((item as Record<string, unknown>).h);
    if (!n || !h || out.some((s) => same(s.n, n))) continue;
    out.push({ n, h });
    if (out.length >= MAX_SAVED) break;
  }
  return out;
}
export function serializeSaved(list: SavedScreen[]): string { return JSON.stringify(list.map((s) => ({ n: s.n, h: s.h }))); }

/** Add a screen, newest first. A name already in use (whatever its capitals) is replaced.
 *  Refused, with the reason, when the name is empty, the view is the one the page opens on,
 *  or the list is full. The list passed in is never changed. */
export function addSaved(list: SavedScreen[], name: unknown, hash: unknown): { list: SavedScreen[]; problem: SaveProblem | null; replaced: boolean } {
  const n = cleanName(name), h = cleanHash(hash);
  if (!n) return { list, problem: "name", replaced: false };
  if (!h) return { list, problem: "view", replaced: false };
  const rest = list.filter((s) => !same(s.n, n));
  const replaced = rest.length < list.length;
  if (rest.length >= MAX_SAVED) return { list, problem: "full", replaced: false };
  return { list: [{ n, h }, ...rest], problem: null, replaced };
}
export function removeSaved(list: SavedScreen[], name: string): SavedScreen[] { return list.filter((s) => !same(s.n, name)); }

export const SAVE_PROBLEM: Record<SaveProblem, string> = {
  name: "Give the screen a name first.",
  view: "Set a filter or a sort order first: there is nothing to save yet.",
  full: `${MAX_SAVED} screens are saved already. Remove one to save another.`,
};
/** A name to offer in the box, from the labels of the filters that are set. */
export function suggestName(parts: string[]): string {
  return cleanName(parts.map((p) => p.trim()).filter(Boolean).join(", ")) || "My screen";
}
