// Client-side heatmap: fetches /data/heatmap-<kind>.json, filters, aggregates by ticker and
// draws a squarified treemap (no dependencies). One instance per `[data-heatmap]` root; the
// markup skeleton is Heatmap.astro. Filter state round-trips through the URL hash so a view can
// be linked. Tile size = dollars in the window; color = direction (green net buying, red net
// selling) with intensity = how one-sided. Everything here is presentation: the numbers are
// the disclosed values as filed.

type Side = "buy" | "sell" | "other";
interface CongressRow { t: string; n: string | null; p: string; ps: string | null; ch: "house" | "senate" | null; pa: string | null; st: string | null; s: Side; v: number; lo: number | null; hi: number | null; o: string | null; d: string; f: string | null; u: string | null }
interface InsiderRow { t: string; n: string | null; p: string; ps: string | null; r: "officer" | "director" | "owner"; ti: string | null; c: string | null; s: Side; v: number; sh: number | null; pr: number | null; pl: boolean; o: string | null; d: string; f: string | null; u: string | null }
type Row = (CongressRow | InsiderRow) & { k: "congress" | "insiders" };
const isC = (r: Row): r is CongressRow & { k: "congress" } => r.k === "congress";
import { unpack, type Packed } from "../lib/heatmap-pack";
interface File { kind: "congress" | "insiders"; builtAt: string; windowDays: number; recentDays?: number; older?: string | null; caps?: Record<string, string>; v?: number; rows: unknown[] }

interface State {
  cls: "all" | "congress" | "insiders";        // combined map only
  chamber: "all" | "house" | "senate";
  party: "all" | "dem" | "rep" | "ind";
  role: "all" | "officer" | "director" | "owner";
  who: string;        // person slug or "" (congress: member; insiders: filer)
  codes: "open" | "all";   // insiders only
  plan: "exclude" | "include"; // insiders only
  window: number;     // days
  view: "net" | "buy" | "sell";
  tickers: string;    // comma list, "" = all
  cap: "all" | "mega" | "large" | "mid" | "small" | "micro"; // company size band (estimated from filings)
  side: "tickers" | "filers";
}

interface Node { ticker: string; name: string | null; buy: number; sell: number; trades: number; cBuy: number; cSell: number; iBuy: number; iSell: number; people: Map<string, { name: string; slug: string | null; k: "congress" | "insiders"; amt: number; n: number }>; net: number; total: number; value: number }

const fmtUSD = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return "$" + Math.round(v / 1e3) + "K";
  return "$" + Math.round(v);
};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ── color ──────────────────────────────────────────────────────────────────────────────────
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a: string, b: string, t: number): string => {
  const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b); const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(b1 + (b2 - b1) * k)})`;
};
const lum = (rgb: string): number => {
  const m = rgb.match(/\d+/g)!.map(Number); const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(m[0]!) + 0.7152 * f(m[1]!) + 0.0722 * f(m[2]!);
};
const RAMPS = {
  dark:  { loG: "#163D2B", hiG: "#4ADE80", loR: "#3A1A1C", hiR: "#F0564B" },
  light: { loG: "#BFE8CF", hiG: "#15824B", loR: "#F3C9C5", hiR: "#C0392B" },
};
const isDark = () => document.documentElement.classList.contains("dark");
function bestInk(fill: string): { c: string; sh: string } {
  const l = lum(fill); const cd = (l + 0.05) / 0.05, cl = 1.05 / (l + 0.05);
  return cd >= cl ? { c: "#0A0B0C", sh: "0 1px 0 rgba(255,255,255,.22)" } : { c: "#F4F4F2", sh: "0 1px 2px rgba(0,0,0,.55)" };
}

// ── squarified treemap (Bruls, Huizing, van Wijk) ─────────────────────────────────────────
interface Rect { x: number; y: number; w: number; h: number }
function squarify<T extends { value: number }>(items: T[], rect: Rect): (Rect & { item: T })[] {
  const out: (Rect & { item: T })[] = [];
  const total = items.reduce((s, d) => s + d.value, 0);
  if (!total || items.length === 0) return out;
  const scale = (rect.w * rect.h) / total;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  let { x, y, w, h } = rect;
  let row: T[] = []; let rowSum = 0;
  const worst = (r: T[], sum: number, side: number): number => {
    if (!r.length) return Infinity;
    const s2 = sum * sum, mx = Math.max(...r.map((d) => d.value)) * scale, mn = Math.min(...r.map((d) => d.value)) * scale;
    return Math.max((side * side * mx) / s2, s2 / (side * side * mn));
  };
  const layoutRow = (r: T[], sum: number): void => {
    const horiz = w >= h;                                 // lay the row along the shorter side
    const side = horiz ? h : w;
    const thick = sum / side;                             // in px, since sum is already scaled
    let off = 0;
    for (const d of r) {
      const len = (d.value * scale) / thick;
      out.push(horiz ? { x, y: y + off, w: thick, h: len, item: d } : { x: x + off, y, w: len, h: thick, item: d });
      off += len;
    }
    if (horiz) { x += thick; w -= thick; } else { y += thick; h -= thick; }
  };
  for (const d of sorted) {
    const side = Math.min(w, h);
    const v = d.value * scale;
    if (row.length && worst(row, rowSum, side) < worst([...row, d], rowSum + v, side)) { layoutRow(row, rowSum); row = []; rowSum = 0; }
    row.push(d); rowSum += v;
  }
  if (row.length) layoutRow(row, rowSum);
  return out;
}

// ── instance ───────────────────────────────────────────────────────────────────────────────
export function initHeatmap(root: HTMLElement): void {
  const kind = (root.dataset.kind as "congress" | "insiders" | "all") ?? "congress";
  const srcs = root.dataset.src!.split(",").map((s) => s.trim()).filter(Boolean);
  const hasInsiders = kind !== "congress";
  const compact = root.dataset.compact === "true";
  const q = <T extends Element>(sel: string): T => root.querySelector<T>(sel)!;
  const mapEl = q<HTMLDivElement>(".hm-map");
  const tip = q<HTMLDivElement>(".hm-tip");
  const DEFAULTS: State = { cls: "all", chamber: "all", party: "all", role: "all", who: "", codes: "open", plan: "exclude", window: 30, view: "net", tickers: "", cap: "all", side: "tickers" };
  const state: State = { ...DEFAULTS };
  let rows: Row[] = []; let builtAt = ""; let maxVal = 1;
  // The insiders file holds the last `recentDays`; the rest of the year is a second file,
  // fetched the first time a longer window is asked for (root.dataset.older tracks it).
  let fullDays = 365, recentDays = 365; let olderSrcs: string[] = [];
  let older: "none" | "idle" | "loading" | "loaded" | "failed" = "none";
  const caps: Record<string, string> = {};

  // hash → state (only when this instance is the page's primary map)
  const primary = root.dataset.primary === "true";
  if (primary && location.hash.length > 1) {
    const h = new URLSearchParams(location.hash.slice(1));
    for (const k of ["cls", "chamber", "party", "role", "who", "codes", "plan", "view", "tickers", "side", "cap"] as const) { const v = h.get(k); if (v != null) (state as unknown as Record<string, string>)[k] = v; }
    const w = Number(h.get("w")); if ([7, 30, 90, 365].includes(w)) state.window = w;
    if (!["all", "mega", "large", "mid", "small", "micro"].includes(state.cap)) state.cap = "all";
  }
  const writeHash = (): void => {
    if (!primary) return;
    const h = new URLSearchParams();
    for (const k of ["cls", "chamber", "party", "role"] as const) if (state[k] !== "all") h.set(k, state[k]);
    if (state.who) h.set("who", state.who);
    if (hasInsiders && state.codes !== "open") h.set("codes", state.codes);
    if (hasInsiders && state.plan !== "exclude") h.set("plan", state.plan);
    if (state.window !== 30) h.set("w", String(state.window));
    if (state.view !== "net") h.set("view", state.view);
    if (state.tickers) h.set("tickers", state.tickers);
    if (state.cap !== "all") h.set("cap", state.cap);
    if (state.side !== "tickers") h.set("side", state.side);
    const s = h.toString(); history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
  };

  // ── filters ──
  const cutoff = (): string => { const d = new Date(); d.setUTCDate(d.getUTCDate() - state.window); return d.toISOString().slice(0, 10); };
  const tickerSet = (): Set<string> | null => { const t = state.tickers.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean); return t.length ? new Set(t) : null; };
  const partyOf = (pa: string | null): "dem" | "rep" | "ind" | null => {
    const p = (pa ?? "").toLowerCase(); if (!p) return null;
    return p.startsWith("dem") ? "dem" : p.startsWith("rep") ? "rep" : "ind";
  };
  // On the combined map a class-specific filter narrows to its class: Party = Democrats
  // means "what Democrats traded", not "Democrats plus every corporate insider" (which is
  // what it showed until 2026-10-04 — insider dollars swamped the answer). If both classes
  // carry a filter (Party + Role) each applies to its own class and both are shown.
  const scopeMatch = (r: Row): boolean => {
    const congressFilter = state.chamber !== "all" || state.party !== "all";
    const insiderFilter = state.role !== "all";
    if (isC(r)) {
      if (state.cls === "insiders") return false;
      if (state.cls === "all" && insiderFilter && !congressFilter) return false;
      if (state.chamber !== "all" && r.ch !== state.chamber) return false;
      if (state.party !== "all" && partyOf(r.pa) !== state.party) return false;
      return true;
    }
    if (state.cls === "congress") return false;
    if (state.cls === "all" && congressFilter && !insiderFilter) return false;
    const i = r as InsiderRow;
    if (state.codes === "open" && i.c !== "P" && i.c !== "S") return false;
    if (state.plan === "exclude" && i.pl) return false;
    if (state.role !== "all" && i.r !== state.role) return false;
    return true;
  };
  function filtered(): Row[] {
    const c = cutoff(); const ts = tickerSet();
    return rows.filter((r) => r.d >= c && scopeMatch(r) && (!state.who || r.ps === state.who) && (!ts || ts.has(r.t)) && (state.cap === "all" || caps[r.t] === state.cap));
  }
  function aggregate(sel: Row[]): Node[] {
    const m = new Map<string, Node>();
    for (const r of sel) {
      let o = m.get(r.t);
      if (!o) { o = { ticker: r.t, name: r.n, buy: 0, sell: 0, trades: 0, cBuy: 0, cSell: 0, iBuy: 0, iSell: 0, people: new Map(), net: 0, total: 0, value: 0 }; m.set(r.t, o); }
      if (r.s === "buy") { o.buy += r.v; if (isC(r)) o.cBuy += r.v; else o.iBuy += r.v; }
      else if (r.s === "sell") { o.sell += r.v; if (isC(r)) o.cSell += r.v; else o.iSell += r.v; }
      o.trades++;
      if (!o.name && r.n) o.name = r.n;
      const key = r.k + ":" + (r.ps ?? r.p); const pp = o.people.get(key) ?? { name: r.p, slug: r.ps, k: r.k, amt: 0, n: 0 }; pp.amt += r.v; pp.n++; o.people.set(key, pp);
    }
    const nodes: Node[] = [];
    for (const o of m.values()) {
      o.net = o.buy - o.sell; o.total = o.buy + o.sell;
      o.value = state.view === "buy" ? o.buy : state.view === "sell" ? o.sell : o.total;
      if (o.value > 0) nodes.push(o);
    }
    return nodes;
  }
  function colorFor(d: Node): string {
    const R = isDark() ? RAMPS.dark : RAMPS.light;
    if (state.view === "buy") return lerp(R.loG, R.hiG, 0.2 + 0.8 * (d.value / maxVal));
    if (state.view === "sell") return lerp(R.loR, R.hiR, 0.2 + 0.8 * (d.value / maxVal));
    const ratio = d.total ? d.net / d.total : 0; const t = 0.28 + 0.72 * Math.abs(ratio);
    return ratio >= 0 ? lerp(R.loG, R.hiG, t) : lerp(R.loR, R.hiR, t);
  }

  // ── render ──
  function render(): void {
    needOlder();
    const sel = filtered(); const nodes = aggregate(sel);
    maxVal = Math.max(1, ...nodes.map((d) => d.value));
    const W = mapEl.clientWidth, H = mapEl.clientHeight;
    mapEl.innerHTML = "";
    if (!nodes.length) {
      mapEl.innerHTML = `<div class="hm-empty">No disclosed ${kind === "congress" ? "congressional" : kind === "insiders" ? "insider" : ""} trades match these filters in the last ${state.window} days.</div>`;
    } else {
      for (const leaf of squarify(nodes, { x: 0, y: 0, w: W, h: H })) {
        const d = leaf.item; const w = Math.round(leaf.w), h = Math.round(leaf.h);
        if (w < 2 || h < 2) continue;
        const fill = colorFor(d), ink = bestInk(fill);
        const a = document.createElement("a");
        a.className = "hm-tile"; a.href = `/stocks/${d.ticker.toLowerCase()}/`;
        a.style.cssText = `left:${Math.round(leaf.x)}px;top:${Math.round(leaf.y)}px;width:${w}px;height:${h}px;background:${fill};color:${ink.c};text-shadow:${ink.sh}`;
        let html = "";
        if (w > 34 && h > 20) { const fs = Math.max(11, Math.min(18, Math.sqrt(w * h) / 9)); html += `<div class="tk" style="font-size:${fs}px">${esc(d.ticker)}</div>`; }
        if (w > 52 && h > 40) html += `<div class="amt" style="font-size:${Math.max(11, Math.min(13, w / 8))}px">${fmtUSD(d.value)}</div>`;
        a.innerHTML = html;
        a.addEventListener("mousemove", (e) => showTip(e, d));
        a.addEventListener("mouseleave", () => { tip.style.opacity = "0"; });
        mapEl.appendChild(a);
      }
    }
    renderSummary(nodes, sel); renderSide(nodes, sel); renderLegend();
    writeHash();
  }
  function showTip(e: MouseEvent, d: Node): void {
    const dir = d.net >= 0 ? "pos" : "neg", arrow = d.net >= 0 ? "▲" : "▼";
    const top = [...d.people.values()].sort((a, b) => b.amt - a.amt).slice(0, 3).map((p) => esc(p.name)).join(", ");
    tip.innerHTML = `<div class="t-tk">${esc(d.ticker)} <span class="soft">${esc(d.name ?? "")}</span></div>` +
      `<div class="t-row"><span>Buys</span><b class="pos">${fmtUSD(d.buy)}</b></div>` +
      `<div class="t-row"><span>Sells</span><b class="neg">${fmtUSD(d.sell)}</b></div>` +
      `<div class="t-row"><span>Net</span><b class="${dir}">${arrow} ${fmtUSD(Math.abs(d.net))}</b></div>` +
      `<div class="t-row"><span>Disclosures</span><b>${d.trades}</b></div>` +
      (kind === "all" ? `<div class="t-row"><span>Congress / insiders</span><b>${fmtUSD(d.cBuy + d.cSell)} / ${fmtUSD(d.iBuy + d.iSell)}</b></div>` : "") +
      (top ? `<div class="t-row t-top"><span>${top}</span></div>` : "");
    tip.style.opacity = "1";
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + 260 > innerWidth) x = e.clientX - 260; if (y + 160 > innerHeight) y = e.clientY - 160;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function renderSummary(nodes: Node[], sel: Row[]): void {
    const buy = nodes.reduce((s, d) => s + d.buy, 0), sell = nodes.reduce((s, d) => s + d.sell, 0), net = buy - sell;
    const filers = new Set(sel.map((r) => r.k + ":" + (r.ps ?? r.p))).size;
    const cells: [string, string, string][] = [
      ["Total traded", fmtUSD(buy + sell), ""], ["Disclosures", sel.length.toLocaleString("en-US"), ""],
      ["Tickers", String(nodes.length), ""], [kind === "congress" ? "Members" : kind === "insiders" ? "Filers" : "Members + filers", String(filers), ""],
      ["Net flow", (net >= 0 ? "▲ " : "▼ ") + fmtUSD(Math.abs(net)), net >= 0 ? "pos" : "neg"],
    ];
    q(".hm-summary").innerHTML = cells.map((c) => `<div class="cell"><div class="k">${c[0]}</div><div class="v ${c[2]}">${c[1]}</div></div>`).join("");
  }
  function renderSide(nodes: Node[], sel: Row[]): void {
    const title = q(".hm-side-title"); const body = q(".hm-side-rows");
    if (state.side === "filers") {
      const m = new Map<string, { name: string; slug: string | null; k: "congress" | "insiders"; buy: number; sell: number; n: number }>();
      for (const r of sel) { const k = r.k + ":" + (r.ps ?? r.p); const p = m.get(k) ?? { name: r.p, slug: r.ps, k: r.k, buy: 0, sell: 0, n: 0 }; if (r.s === "buy") p.buy += r.v; else if (r.s === "sell") p.sell += r.v; p.n++; m.set(k, p); }
      const list = [...m.values()].map((p) => ({ ...p, value: state.view === "buy" ? p.buy : state.view === "sell" ? p.sell : p.buy + p.sell, net: p.buy - p.sell })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value).slice(0, 16);
      title.textContent = state.view === "buy" ? "Biggest buyers" : state.view === "sell" ? "Biggest sellers" : "Most active";
      body.innerHTML = list.map((p, i) => {
        const cls = p.net >= 0 ? "pos" : "neg", arrow = p.net >= 0 ? "▲" : "▼";
        const right = state.view === "net" ? `<span class="${cls}">${arrow} ${fmtUSD(Math.abs(p.net))}</span>` : fmtUSD(p.value);
        const base = p.k === "congress" ? "/congress/" : "/insiders/";
        const nm = p.slug ? `<a href="${base}${esc(p.slug)}/">${esc(p.name)}</a>` : esc(p.name);
        const tag = kind === "all" ? (p.k === "congress" ? " · Congress" : " · insider") : "";
        return `<div class="row"><span class="rk">${i + 1}</span><span><span class="tkr">${nm}</span> <span class="nm">${p.n} ${p.n === 1 ? "trade" : "trades"}${tag}</span></span><span class="val">${right}</span></div>`;
      }).join("") || `<div class="row"><span class="nm">Nothing in this window.</span></div>`;
      return;
    }
    const sorted = [...nodes].sort((a, b) => b.value - a.value).slice(0, 16);
    title.textContent = state.view === "buy" ? "Most bought" : state.view === "sell" ? "Most sold" : "Most traded";
    body.innerHTML = sorted.map((d, i) => {
      const cls = d.net >= 0 ? "pos" : "neg", arrow = d.net >= 0 ? "▲" : "▼";
      const right = state.view === "net" ? `<span class="${cls}">${arrow} ${fmtUSD(Math.abs(d.net))}</span>` : fmtUSD(d.value);
      return `<div class="row"><span class="rk">${i + 1}</span><span><a class="tkr" href="/stocks/${esc(d.ticker.toLowerCase())}/">${esc(d.ticker)}</a> <span class="nm">${esc(d.name ?? "")}</span></span><span class="val">${right}</span></div>`;
    }).join("") || `<div class="row"><span class="nm">Nothing in this window.</span></div>`;
  }
  function renderLegend(): void {
    const R = isDark() ? RAMPS.dark : RAMPS.light; const el = q(".hm-legend");
    const size = kind === "congress" ? "Tile size = top of the reported range, summed" : kind === "insiders" ? "Tile size = shares × price, summed" : "Tile size = $ disclosed (Congress: top of range; insiders: shares × price)";
    if (state.view === "net") el.innerHTML = `<span><span class="sw" style="background:${R.hiG}"></span>Net buying</span><span><span class="sw" style="background:${R.hiR}"></span>Net selling</span><span>${size} · color intensity = how one-sided</span>`;
    else { const c = state.view === "buy" ? R.hiG : R.hiR, w = state.view === "buy" ? "buying" : "selling"; el.innerHTML = `<span><span class="sw" style="background:${c}"></span>${w} volume</span><span>${size} · intensity = $ ${w}</span>`; }
    const stamp = q(".hm-stamp"); if (stamp) stamp.textContent = builtAt ? `Data as of ${builtAt.slice(0, 10)} · ${rows.length.toLocaleString("en-US")} disclosed trades${older === "loaded" || older === "none" ? ` in the last ${fullDays} days` : older === "loading" ? " · loading older trades…" : older === "failed" ? " · older insider trades could not be loaded" : kind === "insiders" ? ` in the last ${recentDays} days` : ` · insider trades older than ${recentDays} days load with 1Y`}` : "";
  }

  // ── controls ──
  const bindSeg = (name: string, apply: (v: string) => void): void => {
    root.querySelectorAll<HTMLButtonElement>(`[data-seg="${name}"] button`).forEach((b) => b.addEventListener("click", () => { apply(b.dataset.v!); syncSeg(name); render(); }));
  };
  const syncSeg = (name: string): void => {
    const cur = name === "window" ? String(state.window) : (state as unknown as Record<string, string>)[name];
    root.querySelectorAll<HTMLButtonElement>(`[data-seg="${name}"] button`).forEach((b) => b.classList.toggle("on", b.dataset.v === cur));
  };
  bindSeg("window", (v) => { state.window = Number(v); });
  bindSeg("view", (v) => { state.view = v as State["view"]; });
  bindSeg("codes", (v) => { state.codes = v as State["codes"]; });
  bindSeg("plan", (v) => { state.plan = v as State["plan"]; });
  bindSeg("side", (v) => { state.side = v as State["side"]; });
  const sels: Partial<Record<"cls" | "chamber" | "party" | "role", HTMLSelectElement>> = {};
  for (const k of ["cls", "chamber", "party", "role"] as const) {
    const el = root.querySelector<HTMLSelectElement>(`[data-ctl="${k}"]`); if (!el) continue;
    sels[k] = el; el.addEventListener("change", () => { (state as unknown as Record<string, string>)[k] = el.value; syncVisibility(); render(); });
  }
  // in the combined map, chamber/party only make sense for Congress and role only for insiders
  function syncVisibility(): void {
    if (kind !== "all") return;
    root.querySelectorAll<HTMLElement>("[data-only]").forEach((el) => { el.hidden = state.cls !== "all" && state.cls !== el.dataset.only; });
  }
  const whoSel = root.querySelector<HTMLSelectElement>('[data-ctl="who"]');
  whoSel?.addEventListener("change", () => { state.who = whoSel.value; render(); });
  const capSel = root.querySelector<HTMLSelectElement>('[data-ctl="cap"]');
  capSel?.addEventListener("change", () => { state.cap = capSel.value as State["cap"]; render(); });
  const tickIn = root.querySelector<HTMLInputElement>('[data-ctl="tickers"]');
  let tt: ReturnType<typeof setTimeout>; tickIn?.addEventListener("input", () => { clearTimeout(tt); tt = setTimeout(() => { state.tickers = tickIn.value; render(); }, 180); });
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-ctl="reset"]');
  resetBtn?.addEventListener("click", () => { Object.assign(state, DEFAULTS); syncAll(); render(); });
  function syncAll(): void {
    ["window", "view", "codes", "plan", "side"].forEach(syncSeg);
    for (const k of ["cls", "chamber", "party", "role"] as const) { const el = sels[k]; if (el) el.value = state[k]; }
    if (whoSel) whoSel.value = state.who; if (tickIn) tickIn.value = state.tickers;
    if (capSel) capSel.value = state.cap;
    syncVisibility();
  }
  function fillWho(): void {
    if (!whoSel) return;
    const groups: Record<string, Map<string, string>> = { congress: new Map(), insiders: new Map() };
    for (const r of rows) if (r.ps) groups[r.k]!.set(r.ps, r.p);
    const opt = (m: Map<string, string>) => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([slug, name]) => `<option value="${esc(slug)}">${esc(name)}</option>`).join("");
    const head = kind === "congress" ? "All members" : kind === "insiders" ? "All filers" : "Everyone";
    whoSel.innerHTML = `<option value="">${head}</option>` + (kind === "all"
      ? `<optgroup label="Members of Congress">${opt(groups.congress!)}</optgroup><optgroup label="Corporate insiders">${opt(groups.insiders!)}</optgroup>`
      : opt(groups[kind]!));
    whoSel.value = state.who;
  }

  let rt: ReturnType<typeof setTimeout>; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  addEventListener("themechange", () => render());

  // ── load ──
  const getFile = (u: string): Promise<File> => fetch(u, { headers: { accept: "application/json" } }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<File>; });
  const rowsOf = (f: File): Row[] => ((f.v === 2 ? unpack(f as unknown as Packed) : f.rows) as (CongressRow | InsiderRow)[]).map((r) => ({ ...r, k: f.kind }) as Row);
  /** Called by render(): a window longer than the recent file needs the older rows. */
  function needOlder(): void {
    if (older !== "idle" || state.window <= recentDays) return;
    older = "loading"; root.dataset.older = older;
    Promise.all(olderSrcs.map(getFile))
      .then((files) => { for (const f of files) { rows = rows.concat(rowsOf(f)); Object.assign(caps, f.caps ?? {}); } older = "loaded"; })
      .catch(() => { older = "failed"; })
      .finally(() => { root.dataset.older = older; fillWho(); render(); });
  }
  mapEl.innerHTML = `<div class="hm-empty">Loading disclosed trades…</div>`;
  Promise.all(srcs.map(getFile))
    .then((files) => {
      rows = files.flatMap(rowsOf);
      builtAt = files.map((f) => f.builtAt).sort().at(-1) ?? "";
      fullDays = Math.max(...files.map((f) => f.windowDays || 365));
      olderSrcs = files.map((f) => f.older).filter((u): u is string => !!u);
      if (olderSrcs.length) { older = "idle"; recentDays = Math.min(...files.filter((f) => f.older).map((f) => f.recentDays || 90)); }
      root.dataset.older = older;
      for (const f of files) Object.assign(caps, f.caps ?? {});
      fillWho(); syncAll(); render(); if (compact) root.classList.add("hm-ready");
    })
    .catch((err: Error) => { mapEl.innerHTML = `<div class="hm-empty">The trade data could not be loaded (${esc(err.message)}). The tables below carry the same rows.</div>`; });
}

export function initAllHeatmaps(): void {
  document.querySelectorAll<HTMLElement>("[data-heatmap]").forEach((el) => { if (!el.dataset.init) { el.dataset.init = "1"; initHeatmap(el); } });
}
