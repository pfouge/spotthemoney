// Client-side heatmap: fetches /data/heatmap-<kind>.json, filters, aggregates by ticker and
// draws a squarified treemap (no dependencies). One instance per `[data-heatmap]` root; the
// markup skeleton is Heatmap.astro. Filter state round-trips through the URL hash so a view can
// be linked. Tile size = dollars in the window; color = direction (green net buying, red net
// selling) with intensity = how one-sided. Everything here is presentation: the numbers are
// the disclosed values as filed.

type Side = "buy" | "sell" | "other";
interface CongressRow { t: string; n: string | null; p: string; ps: string | null; ch: "house" | "senate" | null; pa: string | null; st: string | null; s: Side; v: number; lo: number | null; hi: number | null; o: string | null; d: string; f: string | null; u: string | null }
interface InsiderRow { t: string; n: string | null; p: string; ps: string | null; r: "officer" | "director" | "owner"; ti: string | null; c: string | null; s: Side; v: number; sh: number | null; pr: number | null; pl: boolean; o: string | null; d: string; f: string | null; u: string | null }
type Row = CongressRow | InsiderRow;
interface File { kind: "congress" | "insiders"; builtAt: string; windowDays: number; rows: Row[] }

interface State {
  scope: string;      // congress: all|house|senate|dem|rep ; insiders: all|officer|director|owner
  who: string;        // person slug or "" (congress: member; insiders: filer)
  codes: "open" | "all";   // insiders only
  plan: "exclude" | "include"; // insiders only
  window: number;     // days
  view: "net" | "buy" | "sell";
  tickers: string;    // comma list, "" = all
  side: "tickers" | "filers";
}

interface Node { ticker: string; name: string | null; buy: number; sell: number; trades: number; people: Map<string, { name: string; slug: string | null; amt: number; n: number }>; net: number; total: number; value: number }

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
  const kind = (root.dataset.kind as "congress" | "insiders") ?? "congress";
  const src = root.dataset.src!;
  const compact = root.dataset.compact === "true";
  const q = <T extends Element>(sel: string): T => root.querySelector<T>(sel)!;
  const mapEl = q<HTMLDivElement>(".hm-map");
  const tip = q<HTMLDivElement>(".hm-tip");
  const state: State = { scope: "all", who: "", codes: "open", plan: "exclude", window: 30, view: "net", tickers: "", side: "tickers" };
  let rows: Row[] = []; let builtAt = ""; let maxVal = 1;

  // hash → state (only when this instance is the page's primary map)
  const primary = root.dataset.primary === "true";
  if (primary && location.hash.length > 1) {
    const h = new URLSearchParams(location.hash.slice(1));
    for (const k of ["scope", "who", "codes", "plan", "view", "tickers", "side"] as const) { const v = h.get(k); if (v != null) (state as unknown as Record<string, string>)[k] = v; }
    const w = Number(h.get("w")); if ([7, 30, 90, 365].includes(w)) state.window = w;
  }
  const writeHash = (): void => {
    if (!primary) return;
    const h = new URLSearchParams();
    if (state.scope !== "all") h.set("scope", state.scope);
    if (state.who) h.set("who", state.who);
    if (kind === "insiders" && state.codes !== "open") h.set("codes", state.codes);
    if (kind === "insiders" && state.plan !== "exclude") h.set("plan", state.plan);
    if (state.window !== 30) h.set("w", String(state.window));
    if (state.view !== "net") h.set("view", state.view);
    if (state.tickers) h.set("tickers", state.tickers);
    if (state.side !== "tickers") h.set("side", state.side);
    const s = h.toString(); history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
  };

  // ── filters ──
  const cutoff = (): string => { const d = new Date(); d.setUTCDate(d.getUTCDate() - state.window); return d.toISOString().slice(0, 10); };
  const tickerSet = (): Set<string> | null => { const t = state.tickers.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean); return t.length ? new Set(t) : null; };
  const scopeMatch = (r: Row): boolean => {
    if (kind === "congress") {
      const c = r as CongressRow; const pa = (c.pa ?? "").toLowerCase();
      switch (state.scope) { case "house": return c.ch === "house"; case "senate": return c.ch === "senate"; case "dem": return pa.startsWith("dem"); case "rep": return pa.startsWith("rep"); default: return true; }
    }
    const i = r as InsiderRow;
    if (state.codes === "open" && i.c !== "P" && i.c !== "S") return false;
    if (state.plan === "exclude" && i.pl) return false;
    switch (state.scope) { case "officer": return i.r === "officer"; case "director": return i.r === "director"; case "owner": return i.r === "owner"; default: return true; }
  };
  function filtered(): Row[] {
    const c = cutoff(); const ts = tickerSet();
    return rows.filter((r) => r.d >= c && scopeMatch(r) && (!state.who || r.ps === state.who) && (!ts || ts.has(r.t)));
  }
  function aggregate(sel: Row[]): Node[] {
    const m = new Map<string, Node>();
    for (const r of sel) {
      let o = m.get(r.t);
      if (!o) { o = { ticker: r.t, name: r.n, buy: 0, sell: 0, trades: 0, people: new Map(), net: 0, total: 0, value: 0 }; m.set(r.t, o); }
      if (r.s === "buy") o.buy += r.v; else if (r.s === "sell") o.sell += r.v;
      o.trades++;
      const key = r.ps ?? r.p; const pp = o.people.get(key) ?? { name: r.p, slug: r.ps, amt: 0, n: 0 }; pp.amt += r.v; pp.n++; o.people.set(key, pp);
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
    const sel = filtered(); const nodes = aggregate(sel);
    maxVal = Math.max(1, ...nodes.map((d) => d.value));
    const W = mapEl.clientWidth, H = mapEl.clientHeight;
    mapEl.innerHTML = "";
    if (!nodes.length) {
      mapEl.innerHTML = `<div class="hm-empty">No disclosed ${kind === "congress" ? "congressional" : "insider"} trades match these filters in the last ${state.window} days.</div>`;
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
      (top ? `<div class="t-row t-top"><span>${top}</span></div>` : "");
    tip.style.opacity = "1";
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + 260 > innerWidth) x = e.clientX - 260; if (y + 160 > innerHeight) y = e.clientY - 160;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function renderSummary(nodes: Node[], sel: Row[]): void {
    const buy = nodes.reduce((s, d) => s + d.buy, 0), sell = nodes.reduce((s, d) => s + d.sell, 0), net = buy - sell;
    const filers = new Set(sel.map((r) => r.ps ?? r.p)).size;
    const cells: [string, string, string][] = [
      ["Total traded", fmtUSD(buy + sell), ""], ["Disclosures", sel.length.toLocaleString("en-US"), ""],
      ["Tickers", String(nodes.length), ""], [kind === "congress" ? "Members" : "Filers", String(filers), ""],
      ["Net flow", (net >= 0 ? "▲ " : "▼ ") + fmtUSD(Math.abs(net)), net >= 0 ? "pos" : "neg"],
    ];
    q(".hm-summary").innerHTML = cells.map((c) => `<div class="cell"><div class="k">${c[0]}</div><div class="v ${c[2]}">${c[1]}</div></div>`).join("");
  }
  function renderSide(nodes: Node[], sel: Row[]): void {
    const title = q(".hm-side-title"); const body = q(".hm-side-rows");
    if (state.side === "filers") {
      const m = new Map<string, { name: string; slug: string | null; buy: number; sell: number; n: number }>();
      for (const r of sel) { const k = r.ps ?? r.p; const p = m.get(k) ?? { name: r.p, slug: r.ps, buy: 0, sell: 0, n: 0 }; if (r.s === "buy") p.buy += r.v; else if (r.s === "sell") p.sell += r.v; p.n++; m.set(k, p); }
      const list = [...m.values()].map((p) => ({ ...p, value: state.view === "buy" ? p.buy : state.view === "sell" ? p.sell : p.buy + p.sell, net: p.buy - p.sell })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value).slice(0, 16);
      title.textContent = state.view === "buy" ? "Biggest buyers" : state.view === "sell" ? "Biggest sellers" : "Most active";
      const base = kind === "congress" ? "/congress/" : "/insiders/";
      body.innerHTML = list.map((p, i) => {
        const cls = p.net >= 0 ? "pos" : "neg", arrow = p.net >= 0 ? "▲" : "▼";
        const right = state.view === "net" ? `<span class="${cls}">${arrow} ${fmtUSD(Math.abs(p.net))}</span>` : fmtUSD(p.value);
        const nm = p.slug ? `<a href="${base}${esc(p.slug)}/">${esc(p.name)}</a>` : esc(p.name);
        return `<div class="row"><span class="rk">${i + 1}</span><span><span class="tkr">${nm}</span> <span class="nm">${p.n} ${p.n === 1 ? "trade" : "trades"}</span></span><span class="val">${right}</span></div>`;
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
    const size = kind === "congress" ? "Tile size = top of the reported range, summed" : "Tile size = shares × price, summed";
    if (state.view === "net") el.innerHTML = `<span><span class="sw" style="background:${R.hiG}"></span>Net buying</span><span><span class="sw" style="background:${R.hiR}"></span>Net selling</span><span>${size} · color intensity = how one-sided</span>`;
    else { const c = state.view === "buy" ? R.hiG : R.hiR, w = state.view === "buy" ? "buying" : "selling"; el.innerHTML = `<span><span class="sw" style="background:${c}"></span>${w} volume</span><span>${size} · intensity = $ ${w}</span>`; }
    const stamp = q(".hm-stamp"); if (stamp) stamp.textContent = builtAt ? `Data as of ${builtAt.slice(0, 10)} · ${rows.length.toLocaleString("en-US")} disclosed trades in the last 365 days` : "";
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
  const scopeSel = root.querySelector<HTMLSelectElement>('[data-ctl="scope"]');
  scopeSel?.addEventListener("change", () => { state.scope = scopeSel.value; render(); });
  const whoSel = root.querySelector<HTMLSelectElement>('[data-ctl="who"]');
  whoSel?.addEventListener("change", () => { state.who = whoSel.value; render(); });
  const tickIn = root.querySelector<HTMLInputElement>('[data-ctl="tickers"]');
  let tt: ReturnType<typeof setTimeout>; tickIn?.addEventListener("input", () => { clearTimeout(tt); tt = setTimeout(() => { state.tickers = tickIn.value; render(); }, 180); });
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-ctl="reset"]');
  resetBtn?.addEventListener("click", () => { Object.assign(state, { scope: "all", who: "", codes: "open", plan: "exclude", window: 30, view: "net", tickers: "", side: "tickers" }); syncAll(); render(); });
  function syncAll(): void {
    ["window", "view", "codes", "plan", "side"].forEach(syncSeg);
    if (scopeSel) scopeSel.value = state.scope; if (whoSel) whoSel.value = state.who; if (tickIn) tickIn.value = state.tickers;
  }
  function fillWho(): void {
    if (!whoSel) return;
    const m = new Map<string, string>();
    for (const r of rows) if (r.ps) m.set(r.ps, r.p);
    const opts = [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    whoSel.innerHTML = `<option value="">${kind === "congress" ? "All members" : "All filers"}</option>` + opts.map(([slug, name]) => `<option value="${esc(slug)}">${esc(name)}</option>`).join("");
    whoSel.value = state.who;
  }

  let rt: ReturnType<typeof setTimeout>; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  addEventListener("themechange", () => render());

  // ── load ──
  mapEl.innerHTML = `<div class="hm-empty">Loading disclosed trades…</div>`;
  fetch(src, { headers: { accept: "application/json" } })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<File>; })
    .then((f) => { rows = f.rows; builtAt = f.builtAt; fillWho(); syncAll(); render(); if (compact) root.classList.add("hm-ready"); })
    .catch((err: Error) => { mapEl.innerHTML = `<div class="hm-empty">The trade data could not be loaded (${esc(err.message)}). The tables below carry the same rows.</div>`; });
}

export function initAllHeatmaps(): void {
  document.querySelectorAll<HTMLElement>("[data-heatmap]").forEach((el) => { if (!el.dataset.init) { el.dataset.init = "1"; initHeatmap(el); } });
}
