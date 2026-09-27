// Build-time SVG charts. Pure functions returning markup — no client library, no runtime
// dependency. The page adds a tiny hover script that reads the data-* attributes these emit.
// Mark specs follow the dataviz house rules: 2px lines, ≥8px markers with a 2px surface ring,
// hairline solid gridlines, text in ink tokens (never series color), one y-axis.

// Series identity is a CSS class, not a hex, so the theme decides the color:
// `.s-primary` → var(--chart-1), `.s-compare` → var(--chart-2) (both validated per mode in global.css).
export const SERIES = { primary: "s-primary", compare: "s-compare" } as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const rawStep = span / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

export interface CurveSeries {
  name: string;
  /** Series class: SERIES.primary or SERIES.compare. */
  cls: string;
  points: { label: string; months: number; value: number | null }[];
}

/** Yield-vs-maturity curve. Maturity on a log scale so 1M…30Y reads evenly. */
export function yieldCurveSvg(series: CurveSeries[], opts: { width?: number; height?: number } = {}): string {
  const W = opts.width ?? 860, H = opts.height ?? 360;
  const pad = { t: 18, r: 22, b: 44, l: 44 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  const tenors = series[0]?.points ?? [];
  if (tenors.length === 0) return "";
  const lx = (m: number) => Math.log(m);
  const xmin = lx(tenors[0]!.months), xmax = lx(tenors[tenors.length - 1]!.months);
  const X = (m: number) => pad.l + ((lx(m) - xmin) / (xmax - xmin || 1)) * iw;

  const vals = series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v != null);
  const ticks = niceTicks(Math.min(...vals) - 0.15, Math.max(...vals) + 0.15, 5);
  const ymin = ticks[0]!, ymax = ticks[ticks.length - 1]!;
  const Y = (v: number) => pad.t + (1 - (v - ymin) / (ymax - ymin || 1)) * ih;

  let out = `<svg class="chart curve" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-labelledby="curve-title" data-ymin="${ymin}" data-ymax="${ymax}" data-padl="${pad.l}" data-padt="${pad.t}" data-iw="${iw}" data-ih="${ih}">`;
  out += `<title id="curve-title">Treasury par yield curve by maturity</title>`;
  // gridlines + y labels
  for (const t of ticks) {
    const y = Y(t).toFixed(1);
    out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="grid" stroke-width="1"/>`;
    out += `<text x="${pad.l - 8}" y="${y}" dy="0.35em" text-anchor="end" class="tick">${t.toFixed(1)}%</text>`;
  }
  // x labels per tenor
  for (const p of tenors) {
    out += `<text x="${X(p.months).toFixed(1)}" y="${H - pad.b + 20}" text-anchor="middle" class="tick">${esc(p.label)}</text>`;
  }
  // series
  for (const s of series) {
    const pts = s.points.filter((p) => p.value != null);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.months).toFixed(1)} ${Y(p.value!).toFixed(1)}`).join(" ");
    out += `<path class="${s.cls}" d="${d}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const p of pts) {
      out += `<circle class="${s.cls} ring" cx="${X(p.months).toFixed(1)}" cy="${Y(p.value!).toFixed(1)}" r="4" stroke-width="2"/>`;
    }
  }
  // hover targets: one invisible column per tenor carrying every series' value
  for (const p of tenors) {
    const x = X(p.months);
    const vals = series.map((s) => s.points.find((q) => q.label === p.label)?.value ?? null);
    out += `<rect class="hit" x="${(x - 18).toFixed(1)}" y="${pad.t}" width="36" height="${ih}" fill="transparent" data-x="${x.toFixed(1)}" data-label="${esc(p.label)}" data-values="${esc(JSON.stringify(vals))}"/>`;
  }
  out += `<line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke-width="1" visibility="hidden"/>`;
  out += `</svg>`;
  return out;
}

/** Single-series time trend with a direct end label. */
export function trendSvg(points: { date: string; value: number }[], opts: { cls?: string; width?: number; height?: number; title?: string } = {}): string {
  const W = opts.width ?? 860, H = opts.height ?? 220;
  const cls = opts.cls ?? SERIES.primary;
  const pad = { t: 14, r: 64, b: 30, l: 44 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  if (points.length < 2) return "";

  const t0 = Date.parse(points[0]!.date), t1 = Date.parse(points[points.length - 1]!.date);
  const X = (d: string) => pad.l + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * iw;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...vals) - 0.1, Math.max(...vals) + 0.1, 4);
  const ymin = ticks[0]!, ymax = ticks[ticks.length - 1]!;
  const Y = (v: number) => pad.t + (1 - (v - ymin) / (ymax - ymin || 1)) * ih;

  let out = `<svg class="chart trend" viewBox="0 0 ${W} ${H}" width="100%" role="img" data-padt="${pad.t}" aria-label="${esc(opts.title ?? "Trend")}">`;
  for (const t of ticks) {
    const y = Y(t).toFixed(1);
    out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="grid" stroke-width="1"/>`;
    out += `<text x="${pad.l - 8}" y="${y}" dy="0.35em" text-anchor="end" class="tick">${t.toFixed(1)}%</text>`;
  }
  // month labels at the first observation of each month
  let lastMonth = "";
  for (const p of points) {
    const m = p.date.slice(0, 7);
    if (m !== lastMonth) {
      lastMonth = m;
      const label = new Date(p.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
      out += `<text x="${X(p.date).toFixed(1)}" y="${H - 8}" text-anchor="start" class="tick">${label}</text>`;
    }
  }
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(" ");
  out += `<path class="${cls}" d="${d}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const last = points[points.length - 1]!;
  out += `<circle class="${cls} ring" cx="${X(last.date).toFixed(1)}" cy="${Y(last.value).toFixed(1)}" r="4" stroke-width="2"/>`;
  out += `<text x="${(X(last.date) + 10).toFixed(1)}" y="${Y(last.value).toFixed(1)}" dy="0.35em" class="endlabel">${last.value.toFixed(2)}%</text>`;
  // hover hits
  for (const p of points) {
    out += `<rect class="hit" x="${(X(p.date) - 3).toFixed(1)}" y="${pad.t}" width="6" height="${ih}" fill="transparent" data-x="${X(p.date).toFixed(1)}" data-label="${esc(p.date)}" data-values="${esc(JSON.stringify([p.value]))}"/>`;
  }
  out += `<line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke-width="1" visibility="hidden"/>`;
  out += `</svg>`;
  return out;
}
