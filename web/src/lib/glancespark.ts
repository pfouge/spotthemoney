// Series for the sparklines on the "At a glance" tiles of an entity page (design/system.md, "Tiles").
// Pure and built only from rows the page already holds: no query. Each series is the count of rows per
// calendar month for the 12 months ending in the month of `now`, by that dataset's own date, oldest first.
// A series with nothing in it returns [] so the tile draws no spark (sparkBars/sparkSvg also draw nothing
// for fewer than two points).

export const SPARK_MONTHS = 12;
export type MonthBar = number | { up: number; down: number };

/** "YYYY-MM" of a date string, or null when it does not start with a plausible year and month. */
export function monthOf(d: string | null | undefined): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})/.exec(d);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${m[1]}-${m[2]}` : null;
}

/** The `months` month keys ending with the month of `now`, oldest first. */
export function monthKeys(now: string, months = SPARK_MONTHS): string[] {
  const cur = monthOf(now);
  if (!cur) return [];
  let y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < months; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

/** Rows per month. [] when no row falls in the window. */
export function monthlyCounts(dates: (string | null | undefined)[], now: string, months = SPARK_MONTHS): number[] {
  const keys = monthKeys(now, months);
  if (!keys.length) return [];
  const at = new Map(keys.map((k, i) => [k, i] as const));
  const out = keys.map(() => 0);
  let any = false;
  for (const d of dates) {
    const i = at.get(monthOf(d) ?? "");
    if (i !== undefined) { out[i]!++; any = true; }
  }
  return any ? out : [];
}

/** Purchases (up) and sales (down) per month; rows whose side is neither are left out. [] when nothing is left. */
export function monthlyDirection(rows: { date: string | null | undefined; side: string }[], now: string, months = SPARK_MONTHS): { up: number; down: number }[] {
  const keys = monthKeys(now, months);
  if (!keys.length) return [];
  const at = new Map(keys.map((k, i) => [k, i] as const));
  const out = keys.map(() => ({ up: 0, down: 0 }));
  let any = false;
  for (const r of rows) {
    const i = at.get(monthOf(r.date) ?? "");
    if (i === undefined) continue;
    if (r.side === "buy") { out[i]!.up++; any = true; }
    else if (r.side === "sell") { out[i]!.down++; any = true; }
  }
  return any ? out : [];
}
