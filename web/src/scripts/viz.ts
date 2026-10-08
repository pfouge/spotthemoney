// Client side of the build-time charts (lib/viz.ts): the shared hover tooltip, the leaderboard
// tabs and the yield-curve playback. No dependencies; everything degrades to a static chart.

function initTooltip(): void {
  const tipEl = document.createElement("div");
  tipEl.className = "viz-tip";
  tipEl.setAttribute("aria-hidden", "true"); // pointer-only aid; the chart's text summary carries the same facts
  document.body.appendChild(tipEl);
  let current: Element | null = null;
  const show = (el: Element, x: number, y: number): void => {
    if (el !== current) {
      current = el;
      const lines = (el.getAttribute("data-tip") ?? "").split("|");
      tipEl.textContent = "";
      lines.forEach((line, i) => { const row = document.createElement(i === 0 ? "b" : "span"); row.textContent = line; tipEl.appendChild(row); });
    }
    tipEl.style.opacity = "1";
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top + h > innerHeight - 8) top = y - h - 14;
    tipEl.style.left = `${Math.max(4, left)}px`;
    tipEl.style.top = `${Math.max(4, top)}px`;
  };
  const hide = (): void => { current = null; tipEl.style.opacity = "0"; };
  document.addEventListener("pointermove", (e) => {
    const el = (e.target as Element | null)?.closest?.("[data-tip]");
    if (el) show(el, e.clientX, e.clientY); else if (current) hide();
  });
  document.addEventListener("pointerdown", (e) => {
    const el = (e.target as Element | null)?.closest?.("[data-tip]");
    if (el) show(el, e.clientX, e.clientY); else hide();
  });
  addEventListener("scroll", hide, { passive: true });
}

function initTabs(): void {
  document.querySelectorAll<HTMLElement>("[data-viz-tabs]").forEach((root) => {
    const buttons = root.querySelectorAll<HTMLButtonElement>("[data-tab]"), panels = root.querySelectorAll<HTMLElement>("[data-panel]");
    buttons.forEach((b) => b.addEventListener("click", () => {
      buttons.forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); });
      panels.forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
    }));
  });
}

function initCurves(): void {
  document.querySelectorAll<SVGSVGElement>("svg[data-curve]").forEach((svg) => {
    const box = svg.closest(".viz");
    const range = box?.querySelector<HTMLInputElement>("[data-curve-range]"), play = box?.querySelector<HTMLButtonElement>("[data-curve-play]"), label = box?.querySelector<HTMLElement>("[data-curve-label]");
    const path = svg.querySelector<SVGPathElement>("[data-live]");
    if (!range || !path) return;
    let frames: { label: string; values: (number | null)[] }[] = [];
    try { frames = JSON.parse(svg.dataset.frames ?? "[]"); } catch { return; }
    const n = (k: string) => Number(svg.dataset[k]);
    const lo = n("lo"), hi = n("hi"), l = n("l"), r = n("r"), base = n("base"), top = n("top"), count = frames[0]?.values.length ?? 0;
    const x = (i: number) => l + (i * (r - l)) / (count - 1), y = (v: number) => base - ((v - lo) / (hi - lo || 1)) * (base - top);
    const draw = (k: number): void => {
      const f = frames[k]; if (!f) return;
      let d = "", on = false;
      f.values.forEach((v, i) => {
        const dot = svg.querySelector<SVGCircleElement>(`[data-dot="${i}"]`);
        if (v == null) { on = false; dot?.setAttribute("visibility", "hidden"); return; }
        d += `${on ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; on = true;
        if (dot) { dot.setAttribute("visibility", "visible"); dot.setAttribute("cy", y(v).toFixed(1)); dot.setAttribute("data-tip", `${dot.getAttribute("data-tip")?.split("|")[0]}|${v.toFixed(2)}%`); }
      });
      path.setAttribute("d", d);
      if (label) label.textContent = f.label;
    };
    range.max = String(frames.length - 1); range.value = range.max;
    range.addEventListener("input", () => draw(Number(range.value)));
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => { if (timer) clearInterval(timer); timer = null; if (play) play.textContent = "▶ Play"; };
    play?.addEventListener("click", () => {
      if (timer) { stop(); return; }
      play.textContent = "❚❚ Pause";
      let k = 0; range.value = "0"; draw(0);
      timer = setInterval(() => { k++; if (k >= frames.length) { stop(); return; } range.value = String(k); draw(k); }, 500);
    });
  });
}

// On a phone a time-series chart is wider than its card (the 560px rule in global.css); the newest
// data is at the right-hand end, so start it scrolled there.
function initScrollEnd(): void {
  document.querySelectorAll<SVGSVGElement>("svg.vz-time").forEach((svg) => {
    const body = svg.closest<HTMLElement>(".viz-body");
    if (body && body.scrollWidth > body.clientWidth + 2) body.scrollLeft = body.scrollWidth;
  });
}

initTooltip();
initTabs();
initScrollEnd();
initCurves();
