// Search box on /institutional-holders/: hides table rows whose name does not contain the text.
// Nothing is stored or sent anywhere.
const box = document.querySelector<HTMLInputElement>("[data-ih-search]");
if (box) {
  const rows = [...document.querySelectorAll<HTMLTableRowElement>("tr[data-name]")];
  const status = document.querySelector<HTMLElement>("[data-ih-count]");
  const run = () => {
    const q = box.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) { const hit = !q || (r.dataset.name ?? "").includes(q); r.hidden = !hit; if (hit) shown++; }
    if (status) status.textContent = q ? `${shown.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows match.` : "";
  };
  box.addEventListener("input", run);
  box.closest("[data-ih-search-wrap]")?.removeAttribute("hidden");
}
