// Shared parts of the two filing hubs (/planned-sales/ and /large-holders/): paging, a stable
// sort that puts empty values last in either direction, the date window, and the small helpers
// both hubs use. Pure, so the build, the browser scripts and the unit tests share it.
export const PER_PAGE = [25, 50, 100] as const;
export const DEFAULT_PER = 50;
const DAY = 86_400_000;

export interface Page<T> { rows: T[]; total: number; page: number; pages: number; from: number; to: number }
export function paginate<T>(sorted: readonly T[], page: number, per: number): Page<T> {
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  const p = Math.min(Math.max(1, page), pages);
  const from = (p - 1) * per;
  const rows = sorted.slice(from, from + per);
  return { rows, total: sorted.length, page: p, pages, from: rows.length ? from + 1 : 0, to: from + rows.length };
}

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const t0 = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
/** True when `day` is within `days` days before `built` (edge inclusive) and not after it. */
export function inWindow(day: string, built: string, days: number): boolean {
  if (!isDay(day) || !isDay(built)) return false;
  const d = t0(day), b = t0(built);
  return d <= b && d >= b - days * DAY;
}

/** Stable sort by a key; null and empty values go last in either direction; ties by `tie`. */
export function sortRows<T>(rows: readonly T[], value: (r: T) => number | string | null, dir: "asc" | "desc", tie: (a: T, b: T) => number): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows.map((r) => ({ r, v: value(r) })).sort((a, b) => {
    const x = a.v, y = b.v;
    if (x == null || y == null || x === "" || y === "") {
      const ex = x == null || x === "", ey = y == null || y === "";
      if (ex !== ey) return ex ? 1 : -1;
    } else if (x < y) return -sign;
    else if (x > y) return sign;
    return tie(a.r, b.r);
  }).map((x) => x.r);
}

export const nf = (x: number): string => x.toLocaleString("en-US");
export const plural = (x: number, one: string, many: string): string => `${nf(x)} ${x === 1 ? one : many}`;
export const shortDate = (iso: string | null | undefined): string => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
export const slugLike = (s: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 80;
