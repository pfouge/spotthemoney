// Build-time SVG visualizations for the disclosure data (added 2026-10-04 from the mockups in
// docs/mockups/viz-mockup-2026-10-04.html). Same contract as lib/charts.ts: pure functions
// that return markup, no client library. Every function returns "" when it has nothing to
// draw, and the <Viz> component then renders nothing — never an empty frame.
//
// House rules (dataviz): color is a CSS class so the theme picks the hex (`.v-buy`, `.v-sell`,
// `.v-one`, `.v-late`, `.v-muted` → the --viz-* tokens in global.css, validated per mode for
// colorblind separation); direction is never color alone (buys sit above a baseline or carry
// ▲, sells below or ▼); text wears ink tokens; one y-axis; hairline solid grids; 2px surface
// gaps between fills and a surface ring on overlapping dots; labels only where they fit.
// Hover text travels in `data-tip` ("line one|line two"); scripts/viz.ts shows it.

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tip = (s: string) => ` data-tip="${esc(s)}"`;
const f1 = (n: number) => n.toFixed(1);

export function usd(v: number): string {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${Math.round(a)}`;
}
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayNum = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const open = (w: number, h: number, label: string, cls = "") => `<svg class="vz ${cls}" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(label)}">`;
const text = (x: number, y: number, s: string, cls = "vt", anchor = "start", extra = "") => `<text x="${f1(x)}" y="${f1(y)}" class="${cls}" text-anchor="${anchor}"${extra}>${esc(s)}</text>`;
/** Approximate width of a label in the 11px mono face, for "does it fit" decisions. */
const tw = (s: string) => s.length * 6.7;

// ── 02 sparkline ────────────────────────────────────────────────────────────────────────
export function sparklineSvg(values: number[], label: string): string {
  if (values.length < 2) return "";
  const W = 200, H = 36, mn = Math.min(...values), mx = Math.max(...values), span = mx - mn || 1;
  const x = (i: number) => (i * (W - 6)) / (values.length - 1) + 1, y = (v: number) => H - 5 - ((v - mn) / span) * (H - 10);
  const d = values.map((v, i) => `${i ? "L" : "M"}${f1(x(i))},${f1(y(v))}`).join("");
  return `${open(W, H, label, "spark")}<path d="${d}" class="v-line" fill="none" stroke-width="2" stroke-linejoin="round"/><circle cx="${f1(x(values.length - 1))}" cy="${f1(y(values[values.length - 1]!))}" r="4" class="v-one ring" stroke-width="2"/></svg>`;
}

// ── 03 buy / sell gauge ─────────────────────────────────────────────────────────────────
export function gaugeSvg(d: { buy: number; sell: number; monthly: { label: string; ratio: number | null }[] }): string {
  const tot = d.buy + d.sell;
  if (tot <= 0) return "";
  const W = 560, pts = d.monthly.filter((m) => m.ratio != null);
  const H = pts.length >= 2 ? 232 : 76;
  const bp = (d.buy / tot) * 100, bw = Math.max(4, Math.min(W - 4, (W * d.buy) / tot));
  let o = open(W, H, `Open-market buying ${bp.toFixed(1)}% of dollars, selling ${(100 - bp).toFixed(1)}%`);
  o += text(0, 14, "Open-market dollars, last 30 days", "vi vb");
  o += `<rect x="0" y="26" width="${f1(bw - 1)}" height="22" rx="4" class="v-buy"${tip(`Buying|${usd(d.buy)} · ${bp.toFixed(1)}% of dollars`)}/>`;
  o += `<rect x="${f1(bw + 1)}" y="26" width="${f1(W - bw - 1)}" height="22" rx="4" class="v-sell"${tip(`Selling|${usd(d.sell)} · ${(100 - bp).toFixed(1)}% of dollars`)}/>`;
  o += text(0, 66, `▲ Buying ${bp.toFixed(1)}%`, "vi") + text(W, 66, `Selling ${(100 - bp).toFixed(1)}% ▼`, "vi", "end");
  if (pts.length >= 2) {
    const mx = Math.max(0.1, ...pts.map((p) => p.ratio!)), top = 112, bot = 208;
    const x = (i: number) => 34 + (i * (W - 50)) / (d.monthly.length - 1 || 1), y = (v: number) => bot - (v / mx) * (bot - top);
    o += text(0, 98, "Buy / sell ratio by month", "vi vb");
    for (const g of [0, mx / 2, mx]) o += `<line x1="34" x2="${W - 16}" y1="${f1(y(g))}" y2="${f1(y(g))}" class="${g === 0 ? "v-axis" : "v-grid"}"/>` + text(28, y(g) + 4, g.toFixed(2), "vt", "end");
    let path = "", started = false;
    d.monthly.forEach((m, i) => { if (m.ratio == null) { started = false; return; } path += `${started ? "L" : "M"}${f1(x(i))},${f1(y(m.ratio))}`; started = true; });
    o += `<path d="${path}" class="v-line" fill="none" stroke-width="2" stroke-linejoin="round"/>`;
    d.monthly.forEach((m, i) => {
      if (i % 2 === (d.monthly.length - 1) % 2) o += text(x(i), 226, m.label, "vt", "middle");
      if (m.ratio == null) return;
      o += `<circle cx="${f1(x(i))}" cy="${f1(y(m.ratio))}" r="${i === d.monthly.length - 1 ? 4.5 : 3}" class="v-one ring" stroke-width="2"/>`;
      o += `<rect x="${f1(x(i) - 20)}" y="${top - 8}" width="40" height="${bot - top + 16}" fill="transparent"${tip(`${m.label}|ratio ${m.ratio.toFixed(2)}`)}/>`;
    });
    const last = d.monthly[d.monthly.length - 1]!;
    if (last.ratio != null) o += text(x(d.monthly.length - 1) - 8, y(last.ratio) - 9, last.ratio.toFixed(2), "vi vb", "end");
  }
  return o + "</svg>";
}

// ── 04 activity calendar ────────────────────────────────────────────────────────────────
export function calendarSvg(days: Map<string, { buy: number; sell: number; n: number }>, endIso: string): string {
  if (days.size === 0) return "";
  const end = dayNum(endIso), endDow = (new Date(end * 86400000).getUTCDay() + 6) % 7; // Mon = 0
  const weeks = 53, start = end - endDow - (weeks - 1) * 7;
  const totals = [...days.values()].map((d) => d.buy + d.sell).filter((v) => v > 0);
  const mx = Math.max(1, ...totals);
  const W = 584, cw = 10.4, ch = 12, H = 7 * ch + 30;
  let o = open(W, H, "Disclosed trading by day over the last year", "vz-time");
  ["Mon", "Wed", "Fri"].forEach((d, i) => { o += text(0, 20 + i * 2 * ch, d); });
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const n = start + w * 7 + dow;
      if (n > end) continue;
      const iso = isoOf(n), v = days.get(iso), x = 30 + w * cw, y = 10 + dow * ch;
      if (dow === 0) { const m = new Date(n * 86400000).getUTCMonth(); if (m !== lastMonth && w < weeks - 2) { o += text(x, H - 4, MONTH[m]!); lastMonth = m; } }
      const tot = v ? v.buy + v.sell : 0;
      if (!v || (tot === 0 && v.n === 0)) { o += `<rect x="${f1(x)}" y="${y}" width="8.6" height="10" rx="2" class="v-none"/>`; continue; }
      const net = v.buy - v.sell, op = tot > 0 ? 0.28 + 0.72 * Math.sqrt(tot / mx) : 0.28;
      o += `<rect x="${f1(x)}" y="${y}" width="8.6" height="10" rx="2" class="${net >= 0 && v.buy > 0 ? "v-buy" : tot === 0 ? "v-muted" : "v-sell"}" fill-opacity="${op.toFixed(2)}"${tip(`${iso}|${v.n} trade${v.n === 1 ? "" : "s"} · ${net >= 0 ? "▲ net bought" : "▼ net sold"} ${usd(Math.abs(net))}`)}/>`;
    }
  }
  return o + "</svg>";
}

// ── 05 weekly flow bars ─────────────────────────────────────────────────────────────────
export function flowSvg(weeks: { label: string; buy: number; sell: number }[]): string {
  if (!weeks.some((w) => w.buy + w.sell > 0)) return "";
  const W = 560, H = 214, mid = 104, mx = Math.max(...weeks.map((w) => Math.max(w.buy, w.sell)), 1), bw = W / weeks.length, half = 88;
  let o = open(W, H, "Weekly dollars bought and sold", "vz-time");
  o += `<line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="v-axis"/>`;
  weeks.forEach((w, i) => {
    const x = i * bw + 2, hb = (w.buy / mx) * half, hs = (w.sell / mx) * half;
    if (hb > 0.5) o += `<rect x="${f1(x)}" y="${f1(mid - hb - 1)}" width="${f1(bw - 4)}" height="${f1(hb)}" rx="3" class="v-buy"/>`;
    if (hs > 0.5) o += `<rect x="${f1(x)}" y="${mid + 1}" width="${f1(bw - 4)}" height="${f1(hs)}" rx="3" class="v-sell"/>`;
    o += `<rect x="${f1(i * bw)}" y="8" width="${f1(bw)}" height="${H - 24}" fill="transparent"${tip(`Week of ${w.label}|▲ bought ${usd(w.buy)}|▼ sold ${usd(w.sell)}`)}/>`;
  });
  o += text(0, 10, `${usd(mx)} bought`) + text(0, H - 2, `${usd(mx)} sold`) + text(W, H - 2, `week of ${weeks[weeks.length - 1]!.label}`, "vt", "end");
  return o + "</svg>";
}

// ── 06 grouped buy/sell bars (party, chamber) · 14 who is trading ──────────────────────
export function pairBarsSvg(rows: { label: string; buy: number; sell: number; href?: string | null }[], stacked = false): string {
  const live = rows.filter((r) => r.buy + r.sell > 0);
  if (live.length === 0) return "";
  const W = 560, lw = Math.min(200, Math.max(...live.map((r) => tw(r.label))) + 12), rowH = stacked ? 30 : 40, H = live.length * rowH + 6;
  const mx = Math.max(...live.map((r) => (stacked ? r.buy + r.sell : Math.max(r.buy, r.sell)))), sc = (W - lw - 70) / mx;
  let o = open(W, H, "Dollars bought and sold by group");
  live.forEach((r, i) => {
    const y = i * rowH + 4, lab = text(0, y + (stacked ? 15 : 18), r.label, "vi");
    o += r.href ? `<a href="${esc(r.href)}">${lab}</a>` : lab;
    if (stacked) {
      let x = lw;
      if (r.buy > 0) { const w = Math.max(4, r.buy * sc); o += `<rect x="${f1(x)}" y="${y + 2}" width="${f1(w)}" height="16" rx="3" class="v-buy"${tip(`${r.label}|▲ bought ${usd(r.buy)}`)}/>`; x += w + 2; }
      if (r.sell > 0) { const w = Math.max(4, r.sell * sc); o += `<rect x="${f1(x)}" y="${y + 2}" width="${f1(w)}" height="16" rx="3" class="v-sell"${tip(`${r.label}|▼ sold ${usd(r.sell)}`)}/>`; x += w; }
      o += text(x + 6, y + 15, usd(r.buy + r.sell));
    } else {
      const wb = Math.max(r.buy > 0 ? 4 : 0, r.buy * sc), ws = Math.max(r.sell > 0 ? 4 : 0, r.sell * sc);
      o += `<rect x="${lw}" y="${y}" width="${f1(wb)}" height="13" rx="3" class="v-buy"${tip(`${r.label}|▲ bought ${usd(r.buy)}`)}/>` + text(lw + wb + 5, y + 11, `▲ ${usd(r.buy)}`);
      o += `<rect x="${lw}" y="${y + 15}" width="${f1(ws)}" height="13" rx="3" class="v-sell"${tip(`${r.label}|▼ sold ${usd(r.sell)}`)}/>` + text(lw + ws + 5, y + 26, `▼ ${usd(r.sell)}`);
    }
  });
  return o + "</svg>";
}

// ── 07 / 21 state tile map ──────────────────────────────────────────────────────────────
const TILES: [string, number, number][] = [["AK", 0, 0], ["ME", 0, 10], ["VT", 1, 9], ["NH", 1, 10], ["WA", 2, 0], ["ID", 2, 1], ["MT", 2, 2], ["ND", 2, 3], ["MN", 2, 4], ["IL", 2, 5], ["WI", 2, 6], ["MI", 2, 7], ["NY", 2, 8], ["RI", 2, 9], ["MA", 2, 10], ["OR", 3, 0], ["NV", 3, 1], ["WY", 3, 2], ["SD", 3, 3], ["IA", 3, 4], ["IN", 3, 5], ["OH", 3, 6], ["PA", 3, 7], ["NJ", 3, 8], ["CT", 3, 9], ["CA", 4, 0], ["UT", 4, 1], ["CO", 4, 2], ["NE", 4, 3], ["MO", 4, 4], ["KY", 4, 5], ["WV", 4, 6], ["VA", 4, 7], ["MD", 4, 8], ["DE", 4, 9], ["AZ", 5, 1], ["NM", 5, 2], ["KS", 5, 3], ["AR", 5, 4], ["TN", 5, 5], ["NC", 5, 6], ["SC", 5, 7], ["DC", 5, 8], ["OK", 6, 3], ["LA", 6, 4], ["MS", 6, 5], ["AL", 6, 6], ["GA", 6, 7], ["HI", 7, 0], ["TX", 7, 3], ["FL", 7, 8]];
export function tileMapSvg(values: Map<string, number>, unit: string, detail?: Map<string, string>, wide = false): string {
  const vals = [...values.values()].filter((v) => v > 0).sort((a, b) => a - b);
  if (vals.length === 0) return "";
  // five quantile steps of one hue; states with nothing stay the empty tone
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]!;
  const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)], ops = [0.16, 0.34, 0.54, 0.76, 1];
  const W = wide ? 1120 : 560, cw = wide ? 92 : 48, ch = wide ? 40 : 34, H = 8 * ch + 30, lx = W - 230;
  let o = open(W, H, `${unit} by state`);
  for (const [st, r, c] of TILES) {
    const v = values.get(st) ?? 0, bin = v <= 0 ? -1 : cuts.filter((k) => v > k).length;
    const x = 10 + c * cw, y = 4 + r * ch;
    o += `<g${tip(`${st}|${v > 0 ? `${usd(v)} ${unit}` : "nothing on record"}${detail?.get(st) ? `|${detail.get(st)}` : ""}`)}><rect x="${x}" y="${y}" width="${cw - 3}" height="${ch - 3}" rx="3" class="${bin < 0 ? "v-none" : "v-one"}"${bin < 0 ? "" : ` fill-opacity="${ops[bin]}"`}/>` +
      text(x + (cw - 3) / 2, y + (ch - 3) / 2 + 4, st, bin >= 3 ? "v-on vb" : "vi vb", "middle") + "</g>";
  }
  ops.forEach((op, i) => { o += `<rect x="${lx + i * 26}" y="${H - 14}" width="24" height="10" rx="2" class="v-one" fill-opacity="${op}"/>`; });
  o += text(lx - 4, H - 5, "less", "vt", "end") + text(lx + 134, H - 5, "more");
  return o + "</svg>";
}

// ── 08 reporting-lag histogram ──────────────────────────────────────────────────────────
export function histogramSvg(lags: number[], deadline: number, opts: { bin?: number; max?: number } = {}): string {
  const v = lags.filter((d) => Number.isFinite(d) && d >= 0);
  if (v.length < 3) return "";
  const bin = opts.bin ?? 5, max = opts.max ?? 90, nb = Math.ceil(max / bin) + 1; // last bin = "max+"
  const counts = new Array<number>(nb).fill(0);
  for (const d of v) counts[Math.min(nb - 1, Math.floor(d / bin))]!++;
  const W = 560, H = 224, base = 180, bw = (W - 40) / nb, mx = Math.max(...counts);
  let o = open(W, H, "Days between the trade and its disclosure");
  counts.forEach((c, i) => {
    const lo = i * bin, late = lo >= deadline, h = (c / mx) * 150, lab = i === nb - 1 ? `${max}+ days` : `${lo}–${lo + bin - 1} days`;
    if (c > 0) o += `<rect x="${f1(30 + i * bw + 1)}" y="${f1(base - Math.max(2, h))}" width="${f1(bw - 2)}" height="${f1(Math.max(2, h))}" rx="3" class="${late ? "v-late" : "v-one"}"${tip(`${lab}|${c} filing${c === 1 ? "" : "s"}${late ? " · late" : ""}`)}/>`;
    if (i % 3 === 0) o += text(30 + i * bw, base + 14, i === nb - 1 ? `${max}+` : String(lo));
  });
  o += `<line x1="30" x2="${W - 10}" y1="${base}" y2="${base}" class="v-axis"/>`;
  const dx = 30 + (deadline / bin) * bw;
  o += `<line x1="${f1(dx)}" x2="${f1(dx)}" y1="12" y2="${base}" class="v-rule"/>` + text(dx + 6, 22, `${deadline}-day deadline`, "vi vb");
  o += text(W / 2, H - 4, "days between the trade and the filing", "vt", "middle");
  return o + "</svg>";
}

// ── 10 Congress vs insiders scatter ─────────────────────────────────────────────────────
export function scatterSvg(points: { label: string; x: number; y: number; size: number; href?: string | null }[]): string {
  if (points.length < 2) return "";
  const W = 560, H = 330, l = 40, r = 540, t = 10, b = 290, cx = (l + r) / 2, cy = (t + b) / 2;
  // signed square-root scales: insider dollars and congressional dollars differ by orders of magnitude
  const mxX = Math.max(1, ...points.map((p) => Math.abs(p.x))), mxY = Math.max(1, ...points.map((p) => Math.abs(p.y))), mxS = Math.max(1, ...points.map((p) => p.size));
  const sx = (v: number) => cx + Math.sign(v) * Math.sqrt(Math.abs(v) / mxX) * ((r - l) / 2 - 16), sy = (v: number) => cy - Math.sign(v) * Math.sqrt(Math.abs(v) / mxY) * ((b - t) / 2 - 16);
  let o = open(W, H, "Net congressional trading against net insider trading, one dot per stock");
  o += `<rect x="${l}" y="${t}" width="${r - l}" height="${b - t}" class="v-plot"/><line x1="${l}" x2="${r}" y1="${cy}" y2="${cy}" class="v-axis"/><line x1="${cx}" x2="${cx}" y1="${t}" y2="${b}" class="v-axis"/>`;
  o += text(r - 4, t + 14, "Both buying", "vi vb", "end") + text(l + 4, b - 6, "Both selling", "vi vb") + text(l + 4, t + 14, "Congress buys, insiders sell") + text(r - 4, b - 6, "Insiders buy, Congress sells", "vt", "end");
  const sorted = [...points].sort((a, c) => c.size - a.size), labelled = new Set(sorted.slice(0, 7).map((p) => p.label));
  let labels = "";
  for (const p of sorted) {
    const X = sx(p.x), Y = sy(p.y), R = 4 + Math.sqrt(p.size / mxS) * 10;
    const dot = `<circle cx="${f1(X)}" cy="${f1(Y)}" r="${f1(R)}" class="v-one ring" fill-opacity=".78" stroke-width="2"${tip(`${p.label}|Insiders net ${p.x >= 0 ? "bought" : "sold"} ${usd(Math.abs(p.x))}|Congress net ${p.y >= 0 ? "bought" : "sold"} ${usd(Math.abs(p.y))}`)}/>`;
    o += p.href ? `<a href="${esc(p.href)}">${dot}</a>` : dot;
    if (labelled.has(p.label)) { const right = X + R + 4 + tw(p.label) < r; labels += text(right ? X + R + 4 : X - R - 4, Y + 4, p.label, "vi vb v-halo", right ? "start" : "end"); }
  }
  o += labels + text(cx, H - 22, "corporate insiders: net selling  ←→  net buying", "vt", "middle");
  o += text(14, cy, "Congress: selling ←→ buying", "vt", "middle", ` transform="rotate(-90 14 ${cy})"`);
  return o + "</svg>";
}

// ── 11 leaderboards · 15 agencies ───────────────────────────────────────────────────────
export function rankBarsSvg(rows: { label: string; value: number; valueLabel: string; href?: string | null }[], label = "Ranked bars"): string {
  const live = rows.filter((r) => r.value > 0);
  if (live.length === 0) return "";
  const W = 560, lw = Math.min(230, Math.max(...live.map((r) => tw(r.label))) + 12), H = live.length * 28 + 4, mx = Math.max(...live.map((r) => r.value));
  const room = W - lw - Math.max(...live.map((r) => tw(r.valueLabel))) - 10;
  let o = open(W, H, label);
  live.forEach((r, i) => {
    const y = i * 28 + 4, w = Math.max(4, (r.value / mx) * room), lab = text(0, y + 15, r.label.length > 32 ? r.label.slice(0, 31) + "…" : r.label, "vi");
    o += (r.href ? `<a href="${esc(r.href)}">${lab}</a>` : lab) + `<rect x="${lw}" y="${y + 2}" width="${f1(w)}" height="16" rx="3" class="v-one"${tip(`${r.label}|${r.valueLabel}`)}/>` + text(lw + w + 6, y + 15, r.valueLabel);
  });
  return o + "</svg>";
}

// ── 15 column bars (lobbying by quarter) ────────────────────────────────────────────────
export function columnsSvg(cols: { label: string; value: number }[], label: string): string {
  if (!cols.some((c) => c.value > 0)) return "";
  const W = 560, H = 204, base = 170, bw = (W - 20) / cols.length, mx = Math.max(...cols.map((c) => c.value));
  let o = open(W, H, label);
  cols.forEach((c, i) => {
    const h = (c.value / mx) * 140, x = 10 + i * bw + bw * 0.15;
    if (c.value > 0) o += `<rect x="${f1(x)}" y="${f1(base - Math.max(2, h))}" width="${f1(bw * 0.7)}" height="${f1(Math.max(2, h))}" rx="3" class="v-one"${tip(`${c.label}|${usd(c.value)}`)}/>`;
    o += text(10 + i * bw + bw / 2, base + 16, c.label, "vt", "middle");
    if (i === cols.length - 1 && c.value > 0) o += text(10 + i * bw + bw / 2, base - h - 6, usd(c.value), "vi vb", "middle");
  });
  return o + `<line x1="10" x2="${W - 10}" y1="${base}" y2="${base}" class="v-axis"/></svg>`;
}

// ── 13 holdings step lines ──────────────────────────────────────────────────────────────
export function stepLinesSvg(series: { name: string; points: { date: string; value: number }[] }[], unitLabel = "shares"): string {
  const live = series.filter((s) => s.points.length >= 2).slice(0, 2);
  if (live.length === 0) return "";
  const all = live.flatMap((s) => s.points), d0 = Math.min(...all.map((p) => dayNum(p.date))), d1 = Math.max(...all.map((p) => dayNum(p.date)));
  const mx = Math.max(...all.map((p) => p.value)) || 1, W = 560, H = 214, l = 56, r = 500, top = 14, bot = 180;
  const x = (iso: string) => l + ((dayNum(iso) - d0) / (d1 - d0 || 1)) * (r - l), y = (v: number) => bot - (v / mx) * (bot - top);
  const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
  let o = open(W, H, `${unitLabel} held after each filing`, "vz-time");
  for (const g of [0, mx / 2, mx]) o += `<line x1="${l}" x2="${r}" y1="${f1(y(g))}" y2="${f1(y(g))}" class="${g === 0 ? "v-axis" : "v-grid"}"/>` + text(l - 6, y(g) + 4, short(g), "vt", "end");
  live.forEach((s, k) => {
    const cls = k === 0 ? "v-line" : "v-line2", dot = k === 0 ? "v-one" : "v-muted";
    let d = "";
    s.points.forEach((p, i) => { d += i ? `H${f1(x(p.date))}V${f1(y(p.value))}` : `M${f1(x(p.date))},${f1(y(p.value))}`; });
    o += `<path d="${d}" class="${cls}" fill="none" stroke-width="2"/>`;
    for (const p of s.points) o += `<circle cx="${f1(x(p.date))}" cy="${f1(y(p.value))}" r="4" class="${dot} ring" stroke-width="2"${tip(`${s.name}|${p.date}|${Math.round(p.value).toLocaleString("en-US")} ${unitLabel} held`)}/>`;
    const last = s.points[s.points.length - 1]!;
    o += text(r + 6, y(last.value) + 4, short(last.value), "vi vb");
  });
  o += text(l, H - 6, isoOf(d0)) + text(r, H - 6, isoOf(d1), "vt", "end");
  return o + "</svg>";
}

// ── 16 trade timeline ───────────────────────────────────────────────────────────────────
export function timelineSvg(dots: { date: string; value: number; side: string; label: string }[], opts: { width?: number; days?: number; endIso: string }): string {
  const days = opts.days ?? 365, end = dayNum(opts.endIso), start = end - days;
  const live = dots.filter((d) => dayNum(d.date) >= start && dayNum(d.date) <= end);
  if (live.length === 0) return "";
  const W = opts.width ?? 1120, H = 176, mid = 84, l = 20, r = W - 20, mx = Math.max(1, ...live.map((d) => d.value));
  const x = (iso: string) => l + ((dayNum(iso) - start) / days) * (r - l);
  let o = open(W, H, "Timeline of disclosed trades", "vz-time");
  o += `<line x1="${l}" x2="${r}" y1="${mid}" y2="${mid}" class="v-axis"/>`;
  // deterministic vertical spread so same-day trades do not stack exactly
  [...live].sort((a, b) => b.value - a.value).forEach((d, i) => {
    const R = 4 + Math.sqrt(d.value / mx) * 12, buy = d.side === "buy", other = d.side !== "buy" && d.side !== "sell";
    const off = 16 + ((dayNum(d.date) * 7 + i * 13) % 40), X = x(d.date), Y = other ? mid : buy ? mid - off : mid + off;
    if (!other) o += `<line x1="${f1(X)}" x2="${f1(X)}" y1="${mid}" y2="${f1(Y)}" class="v-grid"/>`;
    o += `<circle cx="${f1(X)}" cy="${f1(Y)}" r="${f1(other ? 4 : R)}" class="${other ? "v-muted" : buy ? "v-buy" : "v-sell"} ring" fill-opacity=".86" stroke-width="2"${tip(`${d.label}|${d.date} · ${buy ? "▲ bought" : other ? "other transaction" : "▼ sold"}${d.value > 0 ? ` ${usd(d.value)}` : ""}`)}/>`;
  });
  for (let m = 0; m < 12; m++) { const n = start + Math.round((m * days) / 12), dt = new Date(n * 86400000); o += text(x(isoOf(n)), H - 6, `${MONTH[dt.getUTCMonth()]}${dt.getUTCMonth() === 0 || m === 0 ? " " + String(dt.getUTCFullYear()).slice(2) : ""}`); }
  return o + "</svg>";
}

// ── 17 / 19 treemap ─────────────────────────────────────────────────────────────────────
export function treemapSvg(items: { name: string; value: number; label: string; href?: string | null }[], label: string, height = 230, W = 560): string {
  const live = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value).slice(0, 14);
  if (live.length === 0) return "";
  const cut = (s: string, w: number) => { if (tw(s) + 14 <= w) return s; let t = s; while (t.length > 2 && tw(t + "…") + 14 > w) t = t.slice(0, -1); return t.length > 2 ? t.trimEnd() + "…" : ""; };
  let o = open(W, height, label);
  const place = (list: typeof live, x: number, y: number, w: number, h: number): void => {
    if (list.length === 0) return;
    if (list.length === 1) {
      const it = list[0]!, nm = cut(it.name, w), fits = (s: string) => w >= tw(s) + 14;
      let g = `<rect x="${f1(x + 1)}" y="${f1(y + 1)}" width="${f1(Math.max(0, w - 2))}" height="${f1(Math.max(0, h - 2))}" rx="3" class="v-one"${tip(`${it.name}|${it.label}`)}/>`;
      if (h > 24 && nm) g += text(x + 7, y + 17, nm, "v-on vb");
      if (h > 40 && nm && fits(it.label)) g += text(x + 7, y + 32, it.label, "v-on");
      o += it.href ? `<a href="${esc(it.href)}">${g}</a>` : g;
      return;
    }
    const tot = list.reduce((a, b2) => a + b2.value, 0);
    let acc = 0, k = 0;
    while (k < list.length - 1 && acc + list[k]!.value <= tot / 2) { acc += list[k]!.value; k++; }
    if (k === 0) { acc = list[0]!.value; k = 1; }
    const f = acc / tot;
    if (w >= h) { place(list.slice(0, k), x, y, w * f, h); place(list.slice(k), x + w * f, y, w * (1 - f), h); }
    else { place(list.slice(0, k), x, y, w, h * f); place(list.slice(k), x, y + h * f, w, h * (1 - f)); }
  };
  place(live, 0, 0, W, height);
  return o + "</svg>";
}

// ── 18 reporting-lag strip ──────────────────────────────────────────────────────────────
export function lagStripSvg(bars: { days: number; label: string }[], deadline: number): string {
  const live = bars.filter((b) => Number.isFinite(b.days) && b.days >= 0).slice(-40);
  if (live.length < 2) return "";
  const W = 560, H = 176, base = 150, top = 14, mx = Math.max(deadline * 1.3, ...live.map((b) => b.days)), bw = (W - 40) / live.length, y = (d: number) => base - (d / mx) * (base - top);
  let o = open(W, H, "Days to report for each filing, oldest to newest", "vz-time");
  live.forEach((b, i) => {
    const late = b.days > deadline;
    o += `<rect x="${f1(30 + i * bw + 1.5)}" y="${f1(Math.min(base - 2, y(b.days)))}" width="${f1(Math.max(2, bw - 3))}" height="${f1(Math.max(2, base - y(b.days)))}" rx="3" class="${late ? "v-late" : "v-one"}"${tip(`${b.label}|${b.days} day${b.days === 1 ? "" : "s"} to report${late ? " · late" : ""}`)}/>`;
  });
  o += `<line x1="30" x2="${W - 10}" y1="${base}" y2="${base}" class="v-axis"/><line x1="30" x2="${W - 10}" y1="${f1(y(deadline))}" y2="${f1(y(deadline))}" class="v-rule"/>`;
  o += text(W - 10, y(deadline) - 6, `${deadline}-day deadline`, "vi vb", "end") + text(30, H - 6, "oldest filing") + text(W - 10, H - 6, "newest", "vt", "end");
  return o + "</svg>";
}

// ── 20 contract flow (agency → recipient) ───────────────────────────────────────────────
export function flowDiagramSvg(flows: { left: string; right: string; value: number }[], label: string, wide = false): string {
  const live = flows.filter((f) => f.value > 0);
  if (live.length === 0) return "";
  const tot = (key: "left" | "right") => { const m = new Map<string, number>(); for (const f of live) m.set(f[key], (m.get(f[key]) ?? 0) + f.value); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const L = tot("left"), R = tot("right"), sum = live.reduce((a, f) => a + f.value, 0);
  const W = wide ? 1120 : 560, gap = 13, H = wide ? 360 : 300, usable = H - 12 - gap * (Math.max(L.length, R.length) - 1), sc = usable / sum;
  const pos = (list: [string, number][]) => { const m = new Map<string, number>(); let y = 6; for (const [k, v] of list) { m.set(k, y); y += v * sc + gap; } return m; };
  const ly = pos(L), ry = pos(R), lo = new Map(ly), ro = new Map(ry), x1 = wide ? 300 : 170, x2 = W - (wide ? 320 : 160), xm = (x1 + x2) / 2;
  const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  let o = open(W, H, label);
  for (const f of [...live].sort((a, b) => b.value - a.value)) {
    const h = Math.max(1, f.value * sc), y1 = lo.get(f.left)!, y2 = ro.get(f.right)!;
    lo.set(f.left, y1 + f.value * sc); ro.set(f.right, y2 + f.value * sc);
    o += `<path d="M${x1},${f1(y1)}C${xm},${f1(y1)} ${xm},${f1(y2)} ${x2},${f1(y2)}V${f1(y2 + h)}C${xm},${f1(y2 + h)} ${xm},${f1(y1 + h)} ${x1},${f1(y1 + h)}Z" class="v-band"${tip(`${f.left} → ${f.right}|${usd(f.value)}`)}/>`;
  }
  for (const [k, v] of L) o += `<rect x="${x1 - 12}" y="${f1(ly.get(k)!)}" width="12" height="${f1(Math.max(2, v * sc))}" rx="3" class="v-ink"${tip(`${k}|${usd(v)}`)}/>` + text(x1 - 18, ly.get(k)! + Math.max(2, v * sc) / 2 + 4, short(k, wide ? 40 : 22), "vi", "end");
  for (const [k, v] of R) o += `<rect x="${x2}" y="${f1(ry.get(k)!)}" width="12" height="${f1(Math.max(2, v * sc))}" rx="3" class="v-ink"${tip(`${k}|${usd(v)}`)}/>` + text(x2 + 18, ry.get(k)! + Math.max(2, v * sc) / 2 + 4, short(k, wide ? 40 : 20), "vi");
  return o + "</svg>";
}

// ── 22 I-Bond history steps ─────────────────────────────────────────────────────────────
export function rateStepsSvg(periods: { date: string; composite: number | null; fixed: number | null }[], wide = false): string {
  const p = periods.filter((x) => x.composite != null);
  if (p.length < 2) return "";
  const W = wide ? 1120 : 560, H = wide ? 280 : 214, l = 38, r = W - 12, base = H - 28, top = 14, mx = Math.max(...p.map((x) => x.composite!)) * 1.08, step = (r - l) / p.length;
  const x = (i: number) => l + i * step, y = (v: number) => base - (v / mx) * (base - top);
  let o = open(W, H, "I-Bond composite rate and fixed rate by six-month period", "vz-time");
  const ticks = mx > 8 ? [0, 5, 10] : mx > 4 ? [0, 2.5, 5] : [0, 1, 2];
  for (const g of ticks) if (g <= mx) o += `<line x1="${l}" x2="${r}" y1="${f1(y(g))}" y2="${f1(y(g))}" class="${g ? "v-grid" : "v-axis"}"/>` + text(l - 6, y(g) + 4, `${g}%`, "vt", "end");
  const path = (key: "composite" | "fixed") => { let d = ""; p.forEach((q, i) => { const v = q[key] ?? 0; d += `${i ? `V${f1(y(v))}` : `M${f1(x(0))},${f1(y(v))}`}H${f1(x(i + 1))}`; }); return d; };
  o += `<path d="${path("fixed")}" class="v-line2" fill="none" stroke-width="2"/><path d="${path("composite")}" class="v-line" fill="none" stroke-width="2"/>`;
  let peak = 0;
  p.forEach((q, i) => { if (q.composite! > p[peak]!.composite!) peak = i; o += `<rect x="${f1(x(i))}" y="${top}" width="${f1(step)}" height="${base - top}" fill="transparent"${tip(`From ${q.date}|composite ${q.composite!.toFixed(2)}%|fixed part ${(q.fixed ?? 0).toFixed(2)}%`)}/>`; });
  o += text(x(peak) + step / 2, y(p[peak]!.composite!) - 6, `${p[peak]!.composite!.toFixed(2)}%`, "vi vb", "middle");
  const last = p[p.length - 1]!;
  if (peak !== p.length - 1) o += text(r, y(last.composite!) - 6, `${last.composite!.toFixed(2)}%`, "vi vb", "end");
  o += text(l, H - 6, p[0]!.date.slice(0, 7)) + text(r, H - 6, "now", "vt", "end");
  return o + "</svg>";
}

// ── 23 yield curve playback (static last frame; scripts/viz.ts animates from data-frames) ─
export function curvePlaybackSvg(tenors: string[], frames: { label: string; values: (number | null)[] }[], wide = false): string {
  if (frames.length < 2 || tenors.length < 3) return "";
  const all = frames.flatMap((f) => f.values).filter((v): v is number => v != null);
  const lo = Math.floor(Math.min(...all) * 2) / 2, hi = Math.ceil(Math.max(...all) * 2) / 2 || 1;
  const W = wide ? 1120 : 560, H = wide ? 300 : 214, l = 44, r = W - 12, base = H - 32, top = 14;
  const x = (i: number) => l + (i * (r - l)) / (tenors.length - 1), y = (v: number) => base - ((v - lo) / (hi - lo || 1)) * (base - top);
  const d = (vals: (number | null)[]) => { let s = "", on = false; vals.forEach((v, i) => { if (v == null) { on = false; return; } s += `${on ? "L" : "M"}${f1(x(i))},${f1(y(v))}`; on = true; }); return s; };
  const last = frames[frames.length - 1]!;
  let o = `<svg class="vz" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Treasury yield curve, month by month" data-curve data-lo="${lo}" data-hi="${hi}" data-l="${l}" data-r="${r}" data-base="${base}" data-top="${top}" data-frames="${esc(JSON.stringify(frames))}">`;
  const stepv = hi - lo > 3 ? 1 : 0.5;
  for (let g = lo; g <= hi + 1e-9; g += stepv) o += `<line x1="${l}" x2="${r}" y1="${f1(y(g))}" y2="${f1(y(g))}" class="v-grid"/>` + text(l - 6, y(g) + 4, `${g.toFixed(1)}%`, "vt", "end");
  tenors.forEach((t, i) => { if (wide || tenors.length <= 9 || i % 2 === 0 || i === tenors.length - 1) o += text(x(i), H - 8, t, "vt", "middle"); });
  o += `<path d="${d(frames[0]!.values)}" class="v-line2" fill="none" stroke-width="2"/>` + text(r, y(frames[0]!.values.filter((v) => v != null).pop() ?? lo) + 16, frames[0]!.label, "vt", "end");
  o += `<path data-live d="${d(last.values)}" class="v-line" fill="none" stroke-width="2" stroke-linejoin="round"/>`;
  last.values.forEach((v, i) => { if (v != null) o += `<circle data-dot="${i}" cx="${f1(x(i))}" cy="${f1(y(v))}" r="4" class="v-one ring" stroke-width="2"${tip(`${tenors[i]}|${v.toFixed(2)}%`)}/>`; });
  return o + "</svg>";
}
