// Flag SVG sources, read from src/assets/flags at build time and inlined into charts by
// lib/viz.ts (rankBarsSvg). Nothing is requested at runtime and no flag emoji is used.
// Only the flags a chart needs are vendored; see src/assets/flags/README.md.
const files = import.meta.glob<string>("../assets/flags/*.svg", { query: "?raw", import: "default", eager: true });
const FLAGS = new Map(Object.entries(files).map(([path, src]) => [path.slice(path.lastIndexOf("/") + 1, -4), src]));

/** The full SVG source of a 4x3 flag by ISO code ("us", "eu"). Throws at build time when the flag is not vendored. */
export function flagSrc(code: string): string {
  const src = FLAGS.get(code.toLowerCase());
  if (!src) throw new Error(`[flags] no flag for "${code}" in src/assets/flags (see the README there)`);
  return src;
}
