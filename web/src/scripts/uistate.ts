// What the visitor chose for this visit: row density, which sections they opened, which long tables
// they expanded. One sessionStorage key, `stm.ui`, JSON `{density, open: {<id>: 0|1}, tables: {<key>: 1}, tabs: {<page type>: <group id>}}`.
// Session storage ends with the tab and is never sent anywhere (the privacy page says so). Every
// access is wrapped: a browser that refuses storage simply forgets, and nothing breaks.
export const UI_KEY = "stm.ui";
export interface UiState { density?: "compact" | "comfortable"; open?: Record<string, 0 | 1>; tables?: Record<string, 1>; tabs?: Record<string, string> }

export function readUi(): UiState {
  try {
    const v = JSON.parse(sessionStorage.getItem(UI_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as UiState) : {};
  } catch { return {}; }
}
export function updateUi(change: (u: UiState) => void): void {
  try { const u = readUi(); change(u); sessionStorage.setItem(UI_KEY, JSON.stringify(u)); } catch { /* storage refused */ }
}

// The density switch in the header (#densityBtn). The inline script in the layout head has already
// applied the stored choice before first paint; this wires the button.
function initDensity(): void {
  const btn = document.getElementById("densityBtn");
  const root = document.documentElement;
  if (!btn) return;
  const paint = (): void => btn.setAttribute("aria-pressed", String(root.getAttribute("data-density") === "compact"));
  paint();
  btn.addEventListener("click", () => {
    const compact = root.getAttribute("data-density") !== "compact";
    if (compact) root.setAttribute("data-density", "compact"); else root.removeAttribute("data-density");
    updateUi((u) => { u.density = compact ? "compact" : "comfortable"; });
    paint();
    window.dispatchEvent(new CustomEvent("densitychange", { detail: compact ? "compact" : "comfortable" }));
  });
}

// <details data-remember id="..."> keeps its open or closed state for the visit.
function initRemembered(): void {
  const open = readUi().open ?? {};
  for (const d of document.querySelectorAll<HTMLDetailsElement>("details[data-remember][id]")) {
    const v = open[d.id];
    if (v === 1) d.open = true; else if (v === 0) d.open = false;
    d.addEventListener("toggle", () => updateUi((u) => { (u.open ??= {})[d.id] = d.open ? 1 : 0; }));
  }
}

initDensity();
initRemembered();
