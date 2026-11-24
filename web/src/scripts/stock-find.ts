export {};
// Find box over the /stocks/ table: narrows the rows to those whose ticker or company contains what was typed.
// Every row stays in the page. While a search is active the table shows all its matches (the "open" state of the
// preview, so the scroll box holds them); clearing it puts the table back as it was.
const box = document.querySelector<HTMLElement>("[data-stock-find]");
const table = document.querySelector<HTMLTableElement>("table[data-stock-list]");
const wrap = table?.closest<HTMLElement>(".tablewrap");
const input = box?.querySelector<HTMLInputElement>("input");
const count = box?.querySelector<HTMLElement>(".tb-find-n");
if (box && table && wrap && input && count) {
  box.hidden = false;
  const rows = [...table.tBodies[0].rows];
  const text = rows.map((r) => `${r.cells[0]?.textContent ?? ""} ${r.cells[1]?.textContent ?? ""}`.toLowerCase());
  let wasOpen = false, active = false;
  const run = (): void => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      rows.forEach((r) => { r.hidden = false; });
      count.textContent = "";
      if (active) { active = false; if (!wasOpen) wrap.removeAttribute("data-open"); }
      return;
    }
    if (!active) { active = true; wasOpen = wrap.hasAttribute("data-open"); }
    let n = 0;
    rows.forEach((r, i) => { const hit = text[i].includes(q); r.hidden = !hit; if (hit) n++; });
    wrap.setAttribute("data-open", "");
    count.textContent = `${n.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")}`;
  };
  input.addEventListener("input", run);
}
