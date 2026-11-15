// Column sorting for the trade tables (components/TxnTable.astro, scripts/tablesort.ts).
// Pure functions: the browser script reads each cell's `data-v`, calls these, and moves the rows.
// Rules: numbers and dates sort high-to-low first, text A-to-Z first; clicking the same column again
// reverses; a third click restores the server order; empty values always sort last; ties keep
// their original order (stable).

export type SortType = "num" | "text";
export type SortDir = "asc" | "desc";
export interface SortState { col: number; dir: SortDir }

/** The direction a column starts in when first clicked. */
export function firstDir(type: SortType): SortDir {
  return type === "text" ? "asc" : "desc";
}

/** The state after a click on `col`: first direction, then the reverse, then none (original order). */
export function nextState(cur: SortState | null, col: number, type: SortType): SortState | null {
  if (!cur || cur.col !== col) return { col, dir: firstDir(type) };
  if (cur.dir === firstDir(type)) return { col, dir: cur.dir === "asc" ? "desc" : "asc" };
  return null;
}

/** A cell's raw `data-v` as a sortable value; null for empty or unparseable. */
export function parseValue(raw: string | null | undefined, type: SortType): number | string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;
  if (type === "num") { const n = Number(s); return Number.isFinite(n) ? n : null; }
  return s.toLowerCase();
}

/**
 * Row order for the given column. `raws[i]` is row i's `data-v` in the original order.
 * Returns the original indices in display order. With no state, the original order.
 */
export function sortedOrder(raws: (string | null | undefined)[], state: SortState | null, type: SortType): number[] {
  const idx = raws.map((_, i) => i);
  if (!state) return idx;
  const vals = raws.map((r) => parseValue(r, type));
  const sign = state.dir === "asc" ? 1 : -1;
  return idx.sort((a, b) => {
    const x = vals[a], y = vals[b];
    if (x == null && y == null) return a - b;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : x < y ? -1 : x > y ? 1 : 0;
    return c !== 0 ? c * sign : a - b;
  });
}

/** Days since 1970-01-01 for an ISO date (UTC), as a string for `data-v`; "" when absent. */
export function dayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso.slice(0, 10));
  return Number.isFinite(t) ? String(Math.round(t / 86400000)) : "";
}

/** Number as `data-v`; "" when absent. */
export function numKey(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "" : String(n);
}
