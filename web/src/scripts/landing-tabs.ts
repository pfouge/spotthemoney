export {};
// Tabs over one panel on a landing ([data-ltabs]). Every pane stays in the page (rows keep their ids and are found by
// find-in-page); the script only chooses which pane is shown. A link to a row or heading inside a hidden pane
// (the URL hash, on load and on change) opens that pane first. Without JavaScript every pane is shown.
function init(): void {
  document.querySelectorAll<HTMLElement>("[data-ltabs]").forEach((root) => {
    const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-ltab]")];
    const panes = [...root.querySelectorAll<HTMLElement>("[data-lpane]")];
    const show = (id: string): void => {
      tabs.forEach((t) => { const on = t.dataset.ltab === id; t.classList.toggle("on", on); t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
      panes.forEach((p) => p.classList.toggle("on", p.dataset.lpane === id));
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => show(t.dataset.ltab ?? ""));
      t.addEventListener("keydown", (e) => {
        const k = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!k) return;
        const n = tabs[(i + k + tabs.length) % tabs.length];
        n.focus(); show(n.dataset.ltab ?? ""); e.preventDefault();
      });
    });
    const fromHash = (): void => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      const pane = el?.closest<HTMLElement>("[data-lpane]");
      if (!el || !pane || !root.contains(pane) || pane.classList.contains("on")) return;
      show(pane.dataset.lpane ?? "");
      requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
    };
    fromHash();
    addEventListener("hashchange", fromHash);
  });
}
init();
