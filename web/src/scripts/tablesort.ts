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

// Form 4 footnotes under a trade table (lib/footnotes.ts). The notes sit in a folded <details>;
// a row's "notes" link, or a link from elsewhere to #fn<filing id>, opens it first, so the
// target is on screen when the browser scrolls to it. Without this script most browsers open
// the block themselves on such a link; where one does not, the summary is one click away.
function showNote(id: string, focus: boolean): void {
  if (!/^fn\d+$/.test(id)) return;
  const el = document.getElementById(id);
  const box = el?.closest<HTMLDetailsElement>("details[data-fnotes]");
  if (!el || !box) return;
  box.open = true;
  el.scrollIntoView({ block: "start" });
  if (focus) el.focus({ preventScroll: true });
}
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-notes]");
  if (!a) return;
  const id = a.hash.slice(1);
  if (!document.getElementById(id)) return;
  e.preventDefault();
  history.replaceState(null, "", `#${id}`);
  showNote(id, true);
});
if (location.hash.length > 1) showNote(location.hash.slice(1), false);
