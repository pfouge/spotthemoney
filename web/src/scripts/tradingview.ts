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

function mount(root: HTMLElement): void {
  const symbol = root.dataset.symbol;
  if (!symbol) return;
  const t = theme();
  const info = root.querySelector<HTMLElement>('[data-tv-slot="info"]');
  const chart = root.querySelector<HTMLElement>('[data-tv-slot="chart"]');
  if (info) mountWidget(info, "embed-widget-symbol-info.js", { symbol, width: "100%", locale: "en", colorTheme: t, isTransparent: true });
  if (chart) mountWidget(chart, "embed-widget-advanced-chart.js", {
    autosize: true, symbol, interval: "D", timezone: "Etc/UTC", theme: t, style: "1", locale: "en",
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
