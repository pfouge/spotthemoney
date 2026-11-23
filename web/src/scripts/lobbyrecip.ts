// Search box over the "Most named recipients" table on /lobbyist-contributions/. Progressive: without
// this script the box is hidden and the whole table is shown. Rows are hidden, never removed, so
// column sorting (scripts/tablesort.ts) keeps working on the same rows.
const root = document.querySelector<HTMLElement>("[data-lc-recipients]");
if (root) {
  const input = root.querySelector<HTMLInputElement>("[data-lc-q]");
  const count = root.querySelector<HTMLElement>("[data-lc-count]");
  const empty = root.querySelector<HTMLElement>("[data-lc-empty]");
  const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  const keys = rows.map((tr) => (tr.dataset.name ?? "").toLowerCase());
  const run = (): void => {
    const q = (input?.value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    let shown = 0;
    rows.forEach((tr, i) => { const ok = !q || keys[i]!.includes(q); tr.hidden = !ok; if (ok) shown++; });
    if (count) count.textContent = shown === rows.length ? `Showing all ${rows.length.toLocaleString("en-US")} names` : `Showing ${shown.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} names`;
    if (empty) empty.hidden = shown > 0;
  };
  input?.addEventListener("input", run);
  run();
}
