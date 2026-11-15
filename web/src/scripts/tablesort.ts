// Sortable trade tables (components/TxnTable.astro, lib/tablesort.ts). Progressive: without this
// script the buttons do nothing and the table stays in the server's order. Rows are moved, never
// cloned, so row anchors (#t<id>), :target highlight and share buttons keep working.
import { nextState, sortedOrder, type SortState, type SortType } from "../lib/tablesort";

const ARROW: Record<string, string> = { none: "↕", ascending: "▲", descending: "▼" };

function setup(table: HTMLTableElement): void {
  const tbody = table.tBodies[0];
  const ths = Array.from(table.tHead?.rows[0]?.cells ?? []);
  if (!tbody || !ths.length) return;
  const rows = Array.from(tbody.rows); // original (server) order
  let state: SortState | null = null;

  const paint = (): void => {
    ths.forEach((th, i) => {
      if (!th.hasAttribute("aria-sort")) return;
      const v = state && state.col === i ? (state.dir === "asc" ? "ascending" : "descending") : "none";
      th.setAttribute("aria-sort", v);
      const arr = th.querySelector(".arr");
      if (arr) arr.textContent = ARROW[v];
    });
  };
  paint();

  ths.forEach((th, col) => {
    const btn = th.querySelector<HTMLButtonElement>("button.sort");
    if (!btn) return;
    const type = (th.dataset.type === "text" ? "text" : "num") as SortType;
    btn.addEventListener("click", () => {
      state = nextState(state, col, type);
      const order = sortedOrder(rows.map((r) => r.cells[col]?.dataset.v), state, type);
      const frag = document.createDocumentFragment();
      for (const i of order) frag.appendChild(rows[i]);
      tbody.appendChild(frag);
      paint();
    });
  });
}

document.querySelectorAll<HTMLTableElement>("table[data-sortable]").forEach(setup);
