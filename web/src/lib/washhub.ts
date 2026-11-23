// The /washington/ hub and the home page's "This week in filings": the pure selection rules.
// Nothing here reads the database. washhub-build.ts turns the model into tiles with the same
// figures and wording each dataset's own hub prints; this file orders them, keeps the shown ones,
// picks the three newest items, counts a 7-day window and writes the answer sentence and the logs.
import { inWindow } from "./hubscreen";

export const WEEK_DAYS = 7;
/** The home page's week row needs at least this many tiles; fewer and the section is absent. */
export const WEEK_MIN_TILES = 3;
export const TILE_ITEMS = 3;

export type TileKey = "lobbying" | "lobbycontrib" | "contracts" | "grants" | "donations" | "outside" | "votes";
export const TILE_ORDER: readonly TileKey[] = ["lobbying", "lobbycontrib", "contracts", "grants", "donations", "outside", "votes"];

export interface TileFigure { key: string; label: string; value: string }
export interface TileItem { text: string; href: string; date: string | null }
export interface Tile {
  key: TileKey;
  title: string;
  path: string;
  /** One sentence of what the dataset is. */
  blurb: string;
  /** The window the figures cover, in words ("filed in 2026", "started in the last 180 days"). */
  window: string;
  figures: TileFigure[];
  /** The newest date on file, YYYY-MM-DD, and what that date is. */
  newest: string | null;
  newestLabel: string;
  items: TileItem[];
  /** A clause for the page's answer sentence, with its source. */
  phrase: string;
  /** Short name for the page description. */
  short: string;
}

/** A tile list in the page's order, with absent (null) tiles dropped. */
export function orderTiles(tiles: readonly (Tile | null | undefined)[]): Tile[] {
  const present = tiles.filter((t): t is Tile => !!t);
  return TILE_ORDER.flatMap((k) => present.filter((t) => t.key === k).slice(0, 1));
}

/** The n newest by a date, newest first; ties and missing dates keep the input order (missing last). */
export function newestFirst<T>(xs: readonly T[], date: (x: T) => string | null | undefined, n = TILE_ITEMS): T[] {
  return xs.map((x, i) => ({ x, i, d: (date(x) ?? "").slice(0, 10) }))
    .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? 1 : -1))
    .slice(0, n).map((e) => e.x);
}

export const newestOf = (ds: readonly (string | null | undefined)[]): string | null => {
  let best: string | null = null;
  for (const d of ds) { const s = d?.slice(0, 10); if (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && (!best || s > best)) best = s; }
  return best;
};

/** Dates within `days` days up to the build day, both edges inclusive: the rule every hub filter uses. */
export function countInWindow(dates: readonly (string | null | undefined)[], built: string, days = WEEK_DAYS): number {
  let n = 0;
  for (const d of dates) if (d && inWindow(d.slice(0, 10), built.slice(0, 10), days)) n++;
  return n;
}

const joinWords = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`);

/** The answer sentence: only the datasets that are shown in this build are named. */
export function washAnswer(tiles: readonly Tile[]): string {
  if (tiles.length === 0) return "No Washington records are on file here yet. They are added as the Senate, the FEC, USAspending and the two chambers publish them.";
  return `The money-in-politics records on file here: ${joinWords(tiles.map((t) => t.phrase))}. Each is a public record shown as filed, and each opens to its own page.`;
}

export function washShortList(tiles: readonly Tile[]): string { return joinWords(tiles.map((t) => t.short)); }

export function washLog(tiles: readonly Tile[]): string {
  return `[web] washington hub: tiles ${tiles.map((t) => t.key).join(", ") || "none"}${tiles.map((t) => `; ${t.key} ${t.figures.map((f) => `${f.key} ${f.value}`).join(", ")}, newest ${t.newest ?? "none"}`).join("")}`;
}

// ── the home page's week row ─────────────────────────────────────────────────────────────
export type WeekKey = "events" | "votes" | "outside" | "holders" | "planned" | "lobbycontrib" | "grants";
export const WEEK_ORDER: readonly WeekKey[] = ["events", "votes", "outside", "holders", "planned", "lobbycontrib", "grants"];
export const WEEK_DEF: Record<WeekKey, { label: string; noun: string; path: string }> = {
  events: { label: "Company events", noun: "8-K reports filed", path: "/company-events/" },
  votes: { label: "Roll-call votes", noun: "votes held", path: "/congress-votes/" },
  outside: { label: "Outside spending", noun: "expenditures reported", path: "/outside-spending/" },
  holders: { label: "Large holders", noun: "13D and 13G statements filed", path: "/large-holders/" },
  planned: { label: "Planned sales", noun: "Form 144 notices filed", path: "/planned-sales/" },
  lobbycontrib: { label: "Lobbyist contributions", noun: "reports posted", path: "/lobbyist-contributions/" },
  grants: { label: "Grants and loans", noun: "awards started", path: "/grants/" },
};
export interface WeekTile { key: WeekKey; label: string; noun: string; path: string; count: number }

/** `counts[key]` is null or missing when the dataset is not shown in this build: no tile. Fewer than WEEK_MIN_TILES tiles: none. */
export function weekTiles(counts: Partial<Record<WeekKey, number | null>>): WeekTile[] {
  const out: WeekTile[] = [];
  for (const k of WEEK_ORDER) { const c = counts[k]; if (c == null || !Number.isFinite(c)) continue; out.push({ key: k, ...WEEK_DEF[k], count: Math.max(0, Math.round(c)) }); }
  return out.length >= WEEK_MIN_TILES ? out : [];
}
export const weekLog = (built: string, tiles: readonly WeekTile[]): string =>
  `[web] week in filings: ${tiles.length ? tiles.map((t) => `${t.key} ${t.count}`).join(", ") : "not shown (fewer than " + WEEK_MIN_TILES + " datasets)"}; ${WEEK_DAYS} days up to ${built.slice(0, 10)}`;
