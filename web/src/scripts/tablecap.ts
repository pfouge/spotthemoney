// Preview tables (shared by every page). A .tablewrap with more body rows than its preview count
// (data-preview, default 5) shows only those rows (rd-kit.css, html.js only: no row leaves the page, so find in
// page, row links and the checks that count rows all work). Here:
//  1. "Show all N rows" / "Show fewer rows" under each previewed table; opened, the table is a scroll box of at
//     most 20 rows with a sticky head (rd-kit.css). The state is remembered per page through the stm.ui helpers;
//  2. a row named by the URL hash that is hidden opens its table (reveal.ts calls the opener registered here);
//  3. a column of numbers is right-aligned even where the template printed no `num` class.
// Sorting (tablesort.ts) moves rows inside tbody, so the first N rows of the new order are the ones shown.
import { readUi, updateUi } from "./uistate";
import { registerOpener } from "./reveal";

const NUMERIC = /^[−+\-–]?\$?[\d,]*\.?\d+\s?(%|[KMBT]|bp|x|days?|d)?$/;

function alignNumbers(table: HTMLTableElement): void {
  const head = table.tHead?.rows[0];
  const body = table.tBodies[0];
  if (!head || !body || body.rows.length === 0) return;
  [...head.cells].forEach((th, i) => {
    if (th.classList.contains("num")) return;
    let seen = 0, nums = 0;
    for (const r of body.rows) {
      const c = r.cells[i];
      if (!c || c.colSpan > 1) continue;
      const t = (c.textContent ?? "").trim().replace(/\s+/g, " ");
      if (t === "" || t === "—" || t === "-") continue;
      seen++;
      if (NUMERIC.test(t)) nums++;
    }
    if (seen >= 2 && nums / seen >= 0.9) {
      th.classList.add("num");
      for (const r of body.rows) r.cells[i]?.classList.add("num");
    }
  });
}

function rowCount(wrap: HTMLElement): number {
  let n = 0;
  for (const t of wrap.querySelectorAll("table")) for (const b of t.tBodies) n += b.rows.length;
  return n;
}

/** Preview count of a wrapper: data-preview, default 5 (the same default rd-kit.css uses). */
function previewOf(wrap: HTMLElement): number {
  const v = Number(wrap.getAttribute("data-preview"));
  return Number.isInteger(v) && v >= 3 && v <= 12 ? v : 5;
}

/** Open or close a previewed table; `paint` is registered per wrapper by initPreviews. */
const painters = new Map<HTMLElement, (open: boolean, remember: boolean) => void>();

function initPreviews(): void {
  const stored = readUi().tables ?? {};
  const wraps = [...document.querySelectorAll<HTMLElement>(".tablewrap")];
  wraps.forEach((wrap, i) => {
    const key = `${location.pathname}#${i}`;
    const n = rowCount(wrap);
    const keep = previewOf(wrap);
    if (n <= keep) return;
    // Eligible only when the stylesheet really hides row keep+1 (client-paged tables, guide tables and
    // [data-nocap] wrappers are opted out in CSS, so they get no button).
    const probe = wrap.querySelector("tbody tr:nth-child(" + (keep + 1) + ")") as HTMLElement | null;
    if (!probe || getComputedStyle(probe).display !== "none") return;
    if (!wrap.id) wrap.id = `tbl-${i}`;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "tbl-more";
    btn.setAttribute("aria-controls", wrap.id);
    const paint = (open: boolean, remember: boolean): void => {
      if (open) wrap.setAttribute("data-open", ""); else wrap.removeAttribute("data-open");
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Show fewer rows" : `Show all ${n.toLocaleString("en-US")} rows`;
      if (remember) updateUi((u) => { const t = (u.tables ??= {}); if (open) t[key] = 1; else delete t[key]; });
      if (!open) wrap.scrollTop = 0;
      // A scroll box with nothing focusable and visible inside must itself be a Tab stop (arrow keys then scroll it).
      // Rows hidden by the preview hold links too, so "focusable" means a visible one.
      const seen = [...wrap.querySelectorAll<HTMLElement>("a[href], button, input, select, [tabindex]")].some((e) => e.getClientRects().length > 0);
      if (!seen && (wrap.scrollWidth > wrap.clientWidth + 1 || wrap.scrollHeight > wrap.clientHeight + 1)) { wrap.tabIndex = 0; wrap.setAttribute("data-tbl-stop", "1"); wrap.setAttribute("role", "group"); wrap.setAttribute("aria-label", "Table, scrollable"); }
      else if (wrap.hasAttribute("data-tbl-stop")) { wrap.removeAttribute("tabindex"); wrap.removeAttribute("data-tbl-stop"); wrap.removeAttribute("role"); wrap.removeAttribute("aria-label"); }
    };
    painters.set(wrap, paint);
    paint(stored[key] === 1, false);
    btn.addEventListener("click", () => paint(!wrap.hasAttribute("data-open"), true));
    wrap.after(btn);
  });
}

/** Open the previewed table around an element when its row is hidden (called by reveal.ts for links and the hash). */
registerOpener((el) => {
  const wrap = el.closest<HTMLElement>(".tablewrap");
  if (!wrap) return false;
  const row = el.closest<HTMLElement>("tr");
  if (!row || getComputedStyle(row).display !== "none") return false;
  painters.get(wrap)?.(true, false);
  return true;
});

for (const t of document.querySelectorAll<HTMLTableElement>("table.data")) alignNumbers(t);
initPreviews();
