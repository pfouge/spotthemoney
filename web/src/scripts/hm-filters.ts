// "More filters" on the trade map: keeps the count of filters that are not at their default in the disclosure's label.
// It only reads the controls scripts/heatmap.ts owns; it never changes a filter. Defaults: every select on its first option,
// Codes = Open-market, 10b5-1 = No 10b5-1 plans, no tickers typed.
const SEG_DEFAULT: Record<string, string> = { codes: "open", plan: "exclude" };

export function activeFilters(root: HTMLElement): number {
  let n = 0;
  root.querySelectorAll<HTMLElement>(".hm-filters .ctl").forEach((ctl) => {
    if (ctl.hidden) return;
    ctl.querySelectorAll<HTMLSelectElement>("select").forEach((sel) => { if (sel.selectedIndex > 0) n++; });
    const input = ctl.querySelector<HTMLInputElement>("input");
    if (input && input.value.trim()) n++;
    ctl.querySelectorAll<HTMLElement>("[data-seg]").forEach((seg) => {
      const on = seg.querySelector<HTMLElement>("button.on")?.dataset.v;
      const def = SEG_DEFAULT[seg.dataset.seg ?? ""];
      if (on && def && on !== def) n++;
    });
  });
  return n;
}

function paint(root: HTMLElement): void {
  const n = activeFilters(root);
  const out = root.querySelector<HTMLElement>("[data-hm-count]");
  if (out) out.textContent = n > 0 ? ` (${n})` : "";
}

export function initFilterCounts(): void {
  document.querySelectorAll<HTMLElement>("[data-heatmap]").forEach((root) => {
    if (root.dataset.fc === "1" || !root.querySelector(".hm-more-f")) return;
    root.dataset.fc = "1";
    const go = () => paint(root);
    root.addEventListener("change", () => setTimeout(go, 0));
    root.addEventListener("input", () => setTimeout(go, 0));
    root.addEventListener("click", () => setTimeout(go, 0));
    window.addEventListener("hashchange", () => setTimeout(go, 0));
    new MutationObserver(go).observe(root.querySelector(".hm-filters")!, { attributes: true, attributeFilter: ["class", "hidden"], subtree: true });
    go(); setTimeout(go, 400); setTimeout(go, 1500);
  });
}
