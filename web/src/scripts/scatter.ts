// The scatter view of the trade map (2026-10-09, Peter): one dot per ticker.
//   across  the page's own group (corporate insiders, or members of Congress on /congress/):
//           dollars bought (Buying), dollars sold (Selling) or bought minus sold (Net)
//   up/down the other group's buying minus selling
//   size    dollars behind the dot
//   colour  the share of those dollars that were purchases: red (all sales) through yellow
//           (even) to green (all purchases)
// Buying draws the right half only, Selling the left half, Net all four quadrants.
//
// Everything in this file is pure (numbers in, an SVG string out) so it can be tested without a
// browser (scripts/scatter.test.ts). The state, the data and the tooltip live in heatmap.ts.

export interface Pt {
  ticker: string;
  name: string | null;
  /** Signed dollars across: ≥ 0 in the right half, ≤ 0 in the left half. */
  x: number;
  /** Signed dollars up/down: the other group's buying minus selling. */
  y: number;
  /** Dollars behind the dot (sets the radius). */
  size: number;
  /** Share of the dollars that were purchases, 0…1. */
  share: number;
}
export interface ScatterOpts {
  W: number; H: number;
  half: "both" | "right" | "left";
  xTitle: string; yTitle: string;
  /** Corner captions: top-left, top-right, bottom-left, bottom-right ("" to leave one out). */
  corners: [string, string, string, string];
  /** Corners to print in bold (the two where both groups agree). */
  strong?: [boolean, boolean, boolean, boolean];
  dark: boolean;
  maxLabels?: number;
}
export interface ScatterOut { svg: string; dots: number; labelled: number }

// ── colour: red → yellow → green by share of purchases ───────────────────────────────────
const STOPS = {
  light: ["#C0392B", "#DE7A22", "#E3B505", "#7DB32E", "#15824B"],
  dark: ["#F0564B", "#F59342", "#F2C744", "#A4D65E", "#4ADE80"],
} as const;
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: string, b: string, t: number): string => {
  const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
};
/** 0 = all sales (red), 0.5 = even (yellow), 1 = all purchases (green); orange and lime in between. */
export function shareColor(share: number, dark: boolean): string {
  const s = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0.5;
  const stops = dark ? STOPS.dark : STOPS.light;
  const at = s * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(at));
  return mix(stops[i]!, stops[i + 1]!, at - i);
}
export function shareGradientCss(dark: boolean): string {
  return `linear-gradient(90deg, ${(dark ? STOPS.dark : STOPS.light).join(", ")})`;
}

// ── scales ───────────────────────────────────────────────────────────────────────────────
/** Dollars below this sit at the origin: a signed log scale needs a dead zone around zero. */
export const DEAD_ZONE = 10_000;
export const lg = (v: number): number => Math.log10(1 + Math.abs(v) / DEAD_ZONE);
export const decadesUpTo = (max: number): number[] => { const all = [1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12].filter((d) => d <= max); return all.length ? all : max >= 1e4 ? [1e4] : []; };
export const decadeLabel = (d: number): string => (d >= 1e9 ? `$${d / 1e9}B` : d >= 1e6 ? `$${d / 1e6}M` : `$${d / 1e3}K`);

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const usd = (v: number): string => { const a = Math.abs(v); return a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`; };

type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function scatterMarkup(points: Pt[], o: ScatterOpts): ScatterOut {
  const { W, H, half } = o;
  const phone = W < 560;
  const l = phone ? 26 : 34, r = W - (phone ? 46 : 58), t = 10, b = H - (phone ? 46 : 50);
  const pw = r - l, ph = b - t;
  const pad = phone ? 16 : 26;                       // room so the largest dot is not cut by the frame
  const mxX = Math.max(DEAD_ZONE, ...points.map((p) => Math.abs(p.x))), mxY = Math.max(DEAD_ZONE, ...points.map((p) => Math.abs(p.y)));
  const mxS = Math.max(1, ...points.map((p) => p.size));
  const cy = t + ph / 2, hy = ph / 2 - pad - 12;      // the top and bottom bands stay clear for the corner captions
  const x0 = half === "both" ? l + pw / 2 : half === "right" ? l + pad * 0.6 : r - pad * 0.6;
  const hx = half === "both" ? pw / 2 - pad : pw - pad * 1.6;
  const sx = (v: number): number => x0 + Math.sign(v) * (lg(v) / lg(mxX)) * hx;
  const sy = (v: number): number => cy - Math.sign(v) * (lg(v) / lg(mxY)) * hy;
  const rMin = phone ? 3.5 : 4.5, rMax = phone ? 15 : 24;

  let s = `<svg class="hm-scatter" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="${esc(`${o.xTitle}; ${o.yTitle}. One dot per ticker; each dot links to the ticker's page.`)}">`;
  // grid: one line per decade, labelled in dollars
  const signsX = half === "both" ? [-1, 1] : half === "right" ? [1] : [-1];
  const dx = decadesUpTo(mxX), dy = decadesUpTo(mxY);
  const stepX = phone && half === "both" ? 2 : 1;
  dx.forEach((d, i) => {
    for (const sg of signsX) {
      const X = sx(sg * d);
      s += `<line class="g" x1="${f1(X)}" x2="${f1(X)}" y1="${t}" y2="${b}"/>`;
      if ((dx.length - 1 - i) % stepX === 0) s += `<text class="tk" x="${f1(X)}" y="${b + 16}" text-anchor="middle">${decadeLabel(d)}</text>`;
    }
  });
  for (const d of dy) for (const sg of [-1, 1]) {
    const Y = sy(sg * d);
    s += `<line class="g" x1="${l}" x2="${r}" y1="${f1(Y)}" y2="${f1(Y)}"/><text class="tk" x="${r + 6}" y="${f1(Y + 4)}">${decadeLabel(d)}</text>`;
  }
  s += `<line class="ax" x1="${l}" x2="${r}" y1="${f1(cy)}" y2="${f1(cy)}"/><line class="ax" x1="${f1(x0)}" x2="${f1(x0)}" y1="${t}" y2="${b}"/>`;
  // axis titles
  s += `<text class="ttl" x="${f1(l + pw / 2)}" y="${H - 8}" text-anchor="middle">${esc(o.xTitle)}</text>`;
  s += `<text class="ttl" transform="translate(${phone ? 11 : 14} ${f1(cy)}) rotate(-90)" text-anchor="middle">${esc(o.yTitle)}</text>`;
  // corner captions
  const taken: Box[] = [];
  const cw = (txt: string): number => txt.length * (phone ? 6 : 6.9);
  const corner: [number, number, "start" | "end"][] = [[l + 8, t + 18, "start"], [r - 8, t + 18, "end"], [l + 8, b - 9, "start"], [r - 8, b - 9, "end"]];
  o.corners.forEach((txt, i) => {
    if (!txt) return;
    const [x, y, an] = corner[i]!;
    s += `<text class="cn${o.strong?.[i] ? " st" : ""}" x="${x}" y="${y}" text-anchor="${an}">${esc(txt)}</text>`;
    taken.push(an === "end" ? [x - cw(txt), y - 12, x, y + 3] : [x, y - 12, x + cw(txt), y + 3]);
  });

  // dots: largest first so small ones stay on top and clickable
  const dots = [...points].sort((a, c) => c.size - a.size).map((p) => ({ p, X: sx(p.x), Y: sy(p.y), R: rMin + Math.sqrt(p.size / mxS) * (rMax - rMin) }));
  let marks = "";
  dots.forEach((d, i) => {
    const title = `${d.p.ticker}${d.p.name ? `, ${d.p.name}` : ""}: ${usd(d.p.size)} disclosed, ${Math.round(d.p.share * 100)}% purchases`;
    marks += `<a class="hm-dot" href="/stocks/${esc(d.p.ticker.toLowerCase())}/" data-i="${i}" data-t="${esc(d.p.ticker)}" aria-label="${esc(title)}"><circle cx="${f1(d.X)}" cy="${f1(d.Y)}" r="${f1(d.R)}" fill="${shareColor(d.p.share, o.dark)}"/></a>`;
  });

  // labels: biggest dots first, each in the first free spot beside its dot; a label never covers
  // a dot, another label or a corner caption, so dense clusters keep only their largest names.
  const dotBoxes: Box[] = dots.map((d) => [d.X - d.R, d.Y - d.R, d.X + d.R, d.Y + d.R]);
  const maxLabels = o.maxLabels ?? (phone ? 28 : 90);
  const fs = phone ? 11 : 12.5, ch = fs * 0.62, lh = fs + 2;
  let labels = "", labelled = 0;
  for (let i = 0; i < dots.length && labelled < maxLabels && i < 600; i++) {
    const d = dots[i]!, w = d.p.ticker.length * ch + 2, g = 3;
    const spots: [number, number, "start" | "end" | "middle"][] = [
      [d.X + d.R + g, d.Y + fs * 0.36, "start"], [d.X - d.R - g, d.Y + fs * 0.36, "end"],
      [d.X, d.Y - d.R - g, "middle"], [d.X, d.Y + d.R + fs, "middle"],
    ];
    for (const [x, y, an] of spots) {
      const box: Box = an === "start" ? [x, y - fs, x + w, y + 3] : an === "end" ? [x - w, y - fs, x, y + 3] : [x - w / 2, y - fs, x + w / 2, y + 3];
      if (box[0] < l + 2 || box[2] > r - 2 || box[1] < t + 2 || box[3] > b - 2) continue;
      if (taken.some((k) => overlaps(box, k))) continue;
      if (dotBoxes.some((k, j) => j !== i && overlaps(box, k))) continue;
      labels += `<text class="lb" x="${f1(x)}" y="${f1(y)}" text-anchor="${an}" style="font-size:${fs}px">${esc(d.p.ticker)}</text>`;
      taken.push([box[0], box[1] - (lh - fs) / 2, box[2], box[3]]);
      labelled++;
      break;
    }
  }
  s += marks + labels + "</svg>";
  return { svg: s, dots: dots.length, labelled };
}
