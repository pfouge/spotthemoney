// Build-time database reads for the Astro site.
// Pages are rendered FROM the database at build; the DB is never queried by a visitor.
// If DATABASE_URL is absent (e.g. first run before Supabase is connected), reads return null
// and pages render a graceful "data pending" state so the site still builds.

import postgres from "postgres";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

let _sql: ReturnType<typeof postgres> | null | undefined;

// Local builds: load the nearest .env walking up from the cwd (the build runs from web/, the
// file lives at the repo root; Astro itself only reads web/.env). In CI the variable comes
// from the environment. Build-time only — this module never runs in a Worker
// (astro.config.mjs sets prerenderEnvironment: "node").
function loadRootEnv() {
  try {
    if (process.env.DATABASE_URL) return;
    let dir = process.cwd();
    for (let i = 0; i < 4; i++) {
      const envFile = join(dir, ".env");
      if (existsSync(envFile)) {
        process.loadEnvFile?.(envFile);
        return;
      }
      const parent = dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  } catch {
    /* rely on real environment */
  }
}

function db() {
  if (_sql !== undefined) return _sql;
  loadRootEnv();
  const url = process.env.DATABASE_URL ?? import.meta.env.DATABASE_URL;
  _sql = url ? postgres(url, { max: 1 }) : null;
  if (!_sql) {
    console.warn("[web] DATABASE_URL not set — data-backed pages will render 'data pending'.");
  }
  return _sql;
}

export interface IBondRateView {
  effectiveDate: string;
  compositeRate: number | null;
  fixedRate: number | null;
  semiannualInflationRate: number | null;
}

/** Latest published I-Bond composite rate period, or null if unavailable. */
export async function getLatestIBondRate(): Promise<IBondRateView | null> {
  const sql = db();
  if (!sql) return null;
  try {
    const rows = await sql<
      { obs_date: string; value: number | null; meta: Record<string, number | null> | null }[]
    >`
      -- Cast: postgres.js turns date into a timezone-shifted JS Date and numeric into a string.
      select o.obs_date::text as obs_date, o.value::float8 as value, o.meta
        from rate_observations o
        join rate_series r on r.id = o.series_id
       where r.code = 'IBOND_COMPOSITE'
       order by o.obs_date desc
       limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      effectiveDate: String(row.obs_date),
      compositeRate: row.value,
      fixedRate: row.meta?.fixedRate ?? null,
      semiannualInflationRate: row.meta?.semiannualInflationRate ?? null,
    };
  } catch (err) {
    console.warn("[web] getLatestIBondRate failed:", (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Treasury par yield curve (series UST_PAR_<tenor>, daily, percent)
// ---------------------------------------------------------------------------

export interface TenorPoint {
  code: string;
  /** Short label, e.g. "3M", "10Y". */
  label: string;
  /** Maturity in months — the x position of the tenor on the curve. */
  months: number;
  latest: number | null;
  prev: number | null;
  monthAgo: number | null;
  yearStart: number | null;
}

export interface YieldCurveView {
  latestDate: string;
  prevDate: string | null;
  monthAgoDate: string | null;
  yearStartDate: string | null;
  tenors: TenorPoint[];
}

/** "UST_PAR_1_5M" → { label: "1.5M", months: 1.5 }; "UST_PAR_10Y" → { label: "10Y", months: 120 }. */
export function parseTenorCode(code: string, prefix = "UST_PAR"): { label: string; months: number } | null {
  const m = code.match(new RegExp(`^${prefix}_(\\d+(?:_\\d+)?)([MY])$`));
  if (!m) return null;
  const n = Number(m[1]!.replace("_", "."));
  const unit = m[2]!;
  return { label: `${m[1]!.replace("_", ".")}${unit}`, months: unit === "Y" ? n * 12 : n };
}

/**
 * The latest curve plus three comparison snapshots (previous business day, ~1 month ago,
 * first observation of the year). Snapshots are the closest observed date on or before
 * the target, so holidays never produce holes.
 */
export async function getYieldCurve(prefix = "UST_PAR"): Promise<YieldCurveView | null> {
  const sql = db();
  if (!sql) return null;
  const like = `${prefix}_%`;
  try {
    const dates = await sql<{ latest: string; prev: string | null; month_ago: string | null; year_start: string | null }[]>`
      with d as (
        select distinct o.obs_date
          from rate_observations o join rate_series s on s.id = o.series_id
         where s.code like ${like}
      ),
      latest as (select max(obs_date) as d from d)
      select (select d from latest)::text as latest,
             (select max(obs_date) from d where obs_date < (select d from latest))::text as prev,
             (select max(obs_date) from d where obs_date <= (select d from latest) - interval '1 month')::text as month_ago,
             (select min(obs_date) from d where obs_date >= date_trunc('year', (select d from latest)))::text as year_start
    `;
    const dt = dates[0];
    if (!dt?.latest) return null;

    const rows = await sql<{ code: string; obs_date: string; value: number | null }[]>`
      select s.code, o.obs_date::text as obs_date, o.value::float8 as value
        from rate_observations o join rate_series s on s.id = o.series_id
       where s.code like ${like}
         and o.obs_date in (${dt.latest}::date, ${dt.prev}::date, ${dt.month_ago}::date, ${dt.year_start}::date)
    `;

    const byCode = new Map<string, TenorPoint>();
    for (const r of rows) {
      const t = parseTenorCode(r.code, prefix);
      if (!t) continue;
      const p = byCode.get(r.code) ?? { code: r.code, ...t, latest: null, prev: null, monthAgo: null, yearStart: null };
      if (r.obs_date === dt.latest) p.latest = r.value;
      if (r.obs_date === dt.prev) p.prev = r.value;
      if (r.obs_date === dt.month_ago) p.monthAgo = r.value;
      if (r.obs_date === dt.year_start) p.yearStart = r.value;
      byCode.set(r.code, p);
    }
    const tenors = [...byCode.values()].filter((p) => p.latest != null).sort((a, b) => a.months - b.months);
    if (tenors.length === 0) return null;
    return { latestDate: dt.latest, prevDate: dt.prev, monthAgoDate: dt.month_ago, yearStartDate: dt.year_start, tenors };
  } catch (err) {
    console.warn("[web] getYieldCurve failed:", (err as Error).message);
    return null;
  }
}

export interface SeriesPoint { date: string; value: number }

/** Daily history for one series since the start of its latest year (for the trend chart). */
export async function getSeriesYearToDate(code: string): Promise<SeriesPoint[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = await sql<{ date: string; value: number }[]>`
      select o.obs_date::text as date, o.value::float8 as value
        from rate_observations o join rate_series s on s.id = o.series_id
       where s.code = ${code} and o.value is not null
         and o.obs_date >= date_trunc('year', (select max(obs_date) from rate_observations o2 where o2.series_id = s.id))
       order by o.obs_date
    `;
    return rows;
  } catch (err) {
    console.warn(`[web] getSeriesYearToDate(${code}) failed:`, (err as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// CPI-U (series CPI_U_NSA, monthly) — the I-Bond variable-rate input
// ---------------------------------------------------------------------------

export interface CpiPoint { month: string; value: number }

/** Monthly CPI-U NSA index levels, oldest first, last `months` months. */
export async function getCpiSeries(months = 30): Promise<CpiPoint[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = await sql<{ month: string; value: number }[]>`
      select o.obs_date::text as month, o.value::float8 as value
        from rate_observations o join rate_series s on s.id = o.series_id
       where s.code = 'CPI_U_NSA' and o.value is not null
       order by o.obs_date desc limit ${months}
    `;
    return rows.reverse();
  } catch (err) {
    console.warn("[web] getCpiSeries failed:", (err as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Chart inputs (lib/viz.ts): I-Bond history and month-by-month yield curves
// ---------------------------------------------------------------------------

/** Every I-Bond rate period on record, oldest first (composite + the fixed-rate part). */
export async function getIBondHistory(limit = 24): Promise<{ date: string; composite: number | null; fixed: number | null }[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = await sql<{ obs_date: string; value: number | null; meta: Record<string, number | null> | null }[]>`
      select o.obs_date::text as obs_date, o.value::float8 as value, o.meta
        from rate_observations o join rate_series r on r.id = o.series_id
       where r.code = 'IBOND_COMPOSITE' and o.obs_date <= current_date
       order by o.obs_date desc limit ${limit}`;
    return rows.reverse().map((r) => ({ date: String(r.obs_date), composite: r.value, fixed: r.meta?.fixedRate ?? null }));
  } catch (err) {
    console.warn("[web] getIBondHistory failed:", (err as Error).message);
    return [];
  }
}

/** The par yield curve on the last business day of each of the last `months` months, oldest first. */
export async function getCurveFrames(months = 13, prefix = "UST_PAR"): Promise<{ tenors: string[]; frames: { label: string; values: (number | null)[] }[] }> {
  const sql = db();
  if (!sql) return { tenors: [], frames: [] };
  try {
    const rows = await sql<{ code: string; d: string; value: number | null }[]>`
      with days as (
        select max(o.obs_date) as d
          from rate_observations o join rate_series s on s.id = o.series_id
         where s.code like ${prefix + "_%"} and o.obs_date > current_date - (${months}::int * interval '1 month')
         group by date_trunc('month', o.obs_date)
      )
      select s.code, o.obs_date::text as d, o.value::float8 as value
        from rate_observations o join rate_series s on s.id = o.series_id
       where s.code like ${prefix + "_%"} and o.obs_date in (select d from days)
       order by o.obs_date`;
    const tenorMap = new Map<string, { label: string; months: number }>();
    for (const r of rows) { const t = parseTenorCode(r.code, prefix); if (t) tenorMap.set(r.code, t); }
    const codes = [...tenorMap.entries()].sort((a, b) => a[1].months - b[1].months);
    const byDay = new Map<string, Map<string, number | null>>();
    for (const r of rows) { const m = byDay.get(r.d) ?? new Map(); m.set(r.code, r.value); byDay.set(r.d, m); }
    const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const frames = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, m]) => ({ label: `${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`, values: codes.map(([c]) => m.get(c) ?? null) }));
    return { tenors: codes.map(([, t]) => t.label), frames };
  } catch (err) {
    console.warn("[web] getCurveFrames failed:", (err as Error).message);
    return { tenors: [], frames: [] };
  }
}
