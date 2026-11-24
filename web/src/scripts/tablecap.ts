// Long tables (shared by every page). CSS caps a .tablewrap that holds more than 12 body rows at the
// head plus 12 rows, so the page stays short and the sticky head stays in view; every row is still in
// the page (find in page, row links and the checks that count rows all work). Here:
//  1. "Show all N rows" / "Show fewer rows" under each capped table (the cap is read from the computed
//     style, so a table the CSS leaves uncapped, such as a screener that pages its own rows, gets no button);
//  2. a row named by the URL hash (tr:target) is scrolled into view inside its box, on load and on hashchange;
//  3. a column of numbers is right-aligned even where the template printed no `num` class.
// Without JavaScript the box still scrolls.
import { readUi, updateUi } from "./uistate";

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

function initCaps(): void {
  const stored = readUi().tables ?? {};
  const wraps = [...document.querySelectorAll<HTMLElement>(".tablewrap")];
  wraps.forEach((wrap, i) => {
    const key = `${location.pathname}#${i}`;
    if (getComputedStyle(wrap).maxHeight === "none" && !wrap.hasAttribute("data-open")) return;
    const n = rowCount(wrap);
    if (n <= 12) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "tbl-more";
    const paint = (open: boolean): void => {
      if (open) wrap.setAttribute("data-open", ""); else wrap.removeAttribute("data-open");
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Show fewer rows" : `Show all ${n.toLocaleString("en-US")} rows`;
    };
    paint(stored[key] === 1);
    btn.addEventListener("click", () => {
      const open = !wrap.hasAttribute("data-open");
      paint(open);
      updateUi((u) => { const t = (u.tables ??= {}); if (open) t[key] = 1; else delete t[key]; });
      if (!open) wrap.scrollTop = 0;
    });
    wrap.after(btn);
  });
}

/** Bring the row the URL hash names into view inside its scroll box. */
function revealTarget(): void {
  let id = location.hash.slice(1);
  if (!id) return;
  try { id = decodeURIComponent(id); } catch { /* keep as is */ }
  const el = document.getElementById(id);
  const wrap = el?.closest<HTMLElement>(".tablewrap");
  if (!el || !wrap || wrap.scrollHeight <= wrap.clientHeight + 1) return;
  const head = wrap.querySelector("thead")?.getBoundingClientRect().height ?? 0;
  const w = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
  const top = r.top - w.top, bottom = r.bottom - w.top;
  if (top >= head && bottom <= wrap.clientHeight) return; // already visible
  wrap.scrollTop += top - head - (wrap.clientHeight - head - r.height) / 2;
}

for (const t of document.querySelectorAll<HTMLTableElement>("table.data")) alignNumbers(t);
initCaps();
revealTarget();
addEventListener("load", revealTarget);
addEventListener("hashchange", () => { revealTarget(); requestAnimationFrame(revealTarget); });
