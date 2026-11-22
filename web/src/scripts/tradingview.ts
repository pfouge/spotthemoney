// Mounts TradingView's free widgets inside [data-tv] blocks (components/TradingView.astro).
// Their embed is a <script> whose own text is the JSON config, so each widget is built by
// creating that script element. Mounted lazily (the two widgets pull ~1 MB of third-party
// code we do not want on first paint) and rebuilt when the theme changes.
const BASE = "https://s3.tradingview.com/external-embedding/";

function theme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function mountWidget(slot: HTMLElement, file: string, config: Record<string, unknown>): void {
  slot.innerHTML = "";
  const box = document.createElement("div");
  box.className = "tradingview-widget-container";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  box.appendChild(inner);
  const s = document.createElement("script");
  s.type = "text/javascript";
  s.async = true;
  s.src = BASE + file;
  s.text = JSON.stringify(config);
  box.appendChild(s);
  slot.appendChild(box);
}

// ONE setup for every full chart on the site (Peter, 2026-11-22): the conventional daily swing
// layout. Daily candles over one year; volume bars under the price (the widget draws them unless
// hide_volume is set); TradingView's built-in Moving Average Ribbon, whose defaults are the 20, 50,
// 100 and 200 day simple averages; and a 14 day RSI in its own pane. The free embed takes study
// ids only, not study settings, which is why the ribbon is used: four separate "SMA" studies
// would all be drawn at the widget's default length. Change the setup here and nowhere else.
// The small watchlist charts are TradingView's Mini Chart, which draws a price line only and
// accepts no studies.
export const CHART_SETUP = {
  interval: "D", range: "12M", timezone: "America/New_York", style: "1",
  hide_volume: false, hide_top_toolbar: false, withdateranges: true,
  studies: ["STD;MA%Ribbon", "STD;RSI"],
} as const;

function mount(root: HTMLElement): void {
  const symbol = root.dataset.symbol;
  if (!symbol) return;
  const t = theme();
  const info = root.querySelector<HTMLElement>('[data-tv-slot="info"]');
  const chart = root.querySelector<HTMLElement>('[data-tv-slot="chart"]');
  if (info) mountWidget(info, "embed-widget-symbol-info.js", { symbol, width: "100%", locale: "en", colorTheme: t, isTransparent: true });
  if (chart) mountWidget(chart, "embed-widget-advanced-chart.js", {
    ...CHART_SETUP, autosize: true, symbol, theme: t, locale: "en",
    allow_symbol_change: false, calendar: false, hide_side_toolbar: true, save_image: false,
    support_host: "https://www.tradingview.com",
  });
  root.dataset.tvMounted = t;
}

export function initTradingView(): void {
  const roots = [...document.querySelectorAll<HTMLElement>("[data-tv]")].filter((r) => !r.dataset.tvInit);
  if (roots.length === 0) return;
  for (const root of roots) {
    root.dataset.tvInit = "1";
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); mount(root); }
      }, { rootMargin: "300px 0px" });
      io.observe(root);
    } else {
      mount(root);
    }
  }
  window.addEventListener("themechange", () => {
    for (const root of roots) if (root.dataset.tvMounted && root.dataset.tvMounted !== theme()) mount(root);
  });
}

// ── Mini charts (watchlist cards, 2026-10-10) ───────────────────────────────────────────────
// TradingView's Mini Chart: price, change over the range and a small line, in TradingView's own
// frame (no price data passes through this site). One per followed stock, each mounted when it
// scrolls near the viewport and rebuilt on a theme change. Clicking it opens our stock page.
const minis = new Set<HTMLElement>();
let miniIO: IntersectionObserver | null = null;
let miniThemeHooked = false;

function mountMini(slot: HTMLElement): void {
  const symbol = slot.dataset.tvMini;
  if (!symbol) return;
  const t = theme();
  mountWidget(slot, "embed-widget-mini-symbol-overview.js", {
    symbol, width: "100%", height: "100%", locale: "en", dateRange: slot.dataset.tvRange || "3M", colorTheme: t,
    isTransparent: true, autosize: true, chartOnly: false, noTimeScale: false,
    largeChartUrl: slot.dataset.tvHref ? new URL(slot.dataset.tvHref, location.origin).href : "",
  });
  slot.dataset.tvMounted = t;
}

/** Mount a mini chart in `slot` (data-tv-mini="<symbol>", optional data-tv-range, data-tv-href) once it is near the screen. */
export function observeMini(slot: HTMLElement): void {
  minis.add(slot);
  if (!miniThemeHooked) {
    miniThemeHooked = true;
    window.addEventListener("themechange", () => {
      for (const s of minis) if (!s.isConnected) minis.delete(s); else if (s.dataset.tvMounted && s.dataset.tvMounted !== theme()) mountMini(s);
    });
  }
  if (!("IntersectionObserver" in window)) { mountMini(slot); return; }
  miniIO ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { miniIO!.unobserve(e.target); mountMini(e.target as HTMLElement); }
  }, { rootMargin: "400px 0px" });
  miniIO.observe(slot);
}
