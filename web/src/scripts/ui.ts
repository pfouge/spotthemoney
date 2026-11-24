// Site chrome behaviour: theme switch, the phone menu, the header search, and "show more" on
// long answer blocks. No dependencies. Everything degrades: without this script the menu
// links are simply visible (html lacks the `js` class) and search does nothing.

function initTheme(): void {
  document.getElementById("themeBtn")?.addEventListener("click", () => {
    const root = document.documentElement, next = root.classList.contains("dark") ? "light" : "dark";
    root.classList.remove("dark", "light"); root.classList.add(next);
    document.getElementById("themeColor")?.setAttribute("content", next === "dark" ? "#0F1215" : "#FFFFFF");
    // Keep the browser's own surfaces (form controls, scrollbars, the canvas before CSS loads) on the chosen scheme.
    document.getElementById("colorScheme")?.setAttribute("content", next);
    try { localStorage.setItem("theme", next); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  });
}

function initMenu(): void {
  const btn = document.getElementById("menuBtn"), menu = document.getElementById("siteMenu");
  if (!btn || !menu) return;
  const set = (open: boolean): void => { menu.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); set(!menu.classList.contains("open")); });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target as Node)) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
}

// Header menus (details.navm). The shared name makes them exclusive where the browser supports it;
// this also covers older browsers, and closes a menu on an outside click, on Escape (focus goes
// back to its summary) and when focus leaves the nav. Nothing opens on hover.
function initNavMenus(): void {
  const nav = document.getElementById("siteMenu");
  const all = [...document.querySelectorAll<HTMLDetailsElement>("details.navm")];
  if (!nav || all.length === 0) return;
  for (const d of all) d.addEventListener("toggle", () => { if (d.open) for (const o of all) if (o !== d) o.open = false; });
  const closeAll = (): void => { for (const d of all) d.open = false; };
  document.addEventListener("click", (e) => { if (!nav.contains(e.target as Node)) closeAll(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = all.find((d) => d.open);
    if (!open) return;
    open.open = false;
    open.querySelector("summary")?.focus();
  });
  nav.addEventListener("focusout", (e) => { const to = (e as FocusEvent).relatedTarget as Node | null; if (to && !nav.contains(to)) closeAll(); });
}

// The group bar of an entity page: mark the group in view (aria-current="true" on its link).
function initGroupBar(): void {
  const bar = document.querySelector<HTMLElement>("nav.groupbar");
  if (!bar || !("IntersectionObserver" in window)) return;
  const groups = [...document.querySelectorAll<HTMLElement>(".pgroup[id]")];
  if (groups.length === 0) return;
  const links = new Map<string, HTMLAnchorElement>();
  for (const a of bar.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) links.set(a.getAttribute("href")!.slice(1), a);
  const visible = new Set<string>();
  const mark = (): void => {
    const first = groups.find((g) => visible.has(g.id));
    for (const [id, a] of links) { if (first && id === first.id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); }
    const cur = first ? links.get(first.id) : null;
    if (cur && bar.scrollWidth > bar.clientWidth) { const x = cur.offsetLeft - 16; if (Math.abs(bar.scrollLeft - x) > 40) bar.scrollTo({ left: x }); }
  };
  const hdr = document.getElementById("siteHeader")?.offsetHeight ?? 64;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) { if (en.isIntersecting) visible.add(en.target.id); else visible.delete(en.target.id); }
    mark();
  }, { rootMargin: `-${hdr + bar.offsetHeight + 8}px 0px -55% 0px` });
  for (const g of groups) io.observe(g);
}

type Row = [kind: string, title: string, sub: string, url: string, weight: number];

function initSearch(): void {
  const dlg = document.getElementById("searchDlg") as HTMLDialogElement | null;
  const input = document.getElementById("searchInput") as HTMLInputElement | null;
  const list = document.getElementById("searchResults");
  if (!dlg || !input || !list || typeof dlg.showModal !== "function") return;
  let rows: Row[] | null = null, loading: Promise<void> | null = null, active = 0, shown: Row[] = [];
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const load = (): Promise<void> => (loading ??= fetch("/data/search.json").then((r) => r.json()).then((d: Row[]) => { rows = d; }).catch(() => { rows = []; }));
  // rank: exact ticker, then title starts with the query, then a word starts with it, then anywhere.
  // A member of Congress is usually looked up by surname, so a word match counts as a title match there.
  const score = (r: Row, q: string): number => {
    const t = r[1].toLowerCase(), s = r[2].toLowerCase();
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    if (t.split(/[\s,.-]+/).some((w) => w.startsWith(q))) return r[0] === "Congress" ? 1 : 2;
    if (s.startsWith(q) || s.split(/[\s,.-]+/).some((w) => w.startsWith(q))) return 3;
    if (t.includes(q) || s.includes(q)) return 4;
    return -1;
  };
  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    if (!rows) { list.innerHTML = `<p class="search-note">Loading…</p>`; return; }
    shown = q === ""
      ? [...rows].filter((r) => r[0] !== "Page").sort((a, b) => b[4] - a[4]).slice(0, 8)
      : rows.map((r) => [score(r, q), r] as const).filter((x) => x[0] >= 0).sort((a, b) => a[0] - b[0] || Number(b[1][0] === "Congress") - Number(a[1][0] === "Congress") || b[1][4] - a[1][4]).slice(0, 12).map((x) => x[1]);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length === 0
      ? `<p class="search-note">Nothing on record matches “${esc(input.value.trim())}”.</p>`
      : (q === "" ? `<p class="search-note">Most active on record</p>` : "") + shown.map((r, i) =>
          `<a class="search-row${i === active ? " on" : ""}" href="${esc(r[3])}" role="option" aria-selected="${i === active}"><span class="tk">${esc(r[0] === "Ticker" ? r[1] : r[0])}</span><span class="nm"><b>${esc(r[0] === "Ticker" ? r[2] || "Stock" : r[1])}</b>${r[0] !== "Ticker" && r[2] ? `<small>${esc(r[2])}</small>` : ""}</span></a>`).join("");
  };
  const open = (): void => { if (dlg.open) return; dlg.showModal(); input.value = ""; active = 0; render(); void load().then(render); input.focus(); };
  document.querySelectorAll("[data-search-open]").forEach((b) => b.addEventListener("click", open));
  document.getElementById("searchClose")?.addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(shown.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === "Enter") { const r = shown[active]; if (r) location.href = r[3]; e.preventDefault(); }
    else if (e.key === "Escape") { dlg.close(); e.preventDefault(); } // a search field would otherwise just clear itself first
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null, typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); open(); }
  });
}

// Long answer blocks are clamped on phones (global.css); offer the rest on request.
function initAnswerMore(): void {
  document.querySelectorAll<HTMLElement>(".answer-text").forEach((p) => {
    if (p.scrollHeight <= p.clientHeight + 4) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "answer-more"; b.textContent = "Show more";
    b.addEventListener("click", () => { const open = p.classList.toggle("open"); b.textContent = open ? "Show less" : "Show more"; });
    p.after(b);
  });
}

initTheme();
initMenu();
initNavMenus();
initGroupBar();
initSearch();
initAnswerMore();

// Sideways-scrolling strips (figure rows, chips, wide charts on phones) must be reachable from
// the keyboard: a region that overflows and holds nothing focusable becomes a Tab stop itself,
// so arrow keys can scroll it. Re-checked on resize and when a strip's content changes.
const SCROLLERS = ".datastrip, .summary, .viz-body, .feeds, .tablewrap, .hm-bar, .strip-compact";
function markScrollers(): void {
  for (const el of document.querySelectorAll<HTMLElement>(SCROLLERS)) {
    const overflows = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    const hasStop = !!el.querySelector("a[href], button, select, input, [tabindex]:not([tabindex='-1'])");
    if (overflows && !hasStop) { el.tabIndex = 0; el.dataset.scrollStop = "1"; }
    else if (el.dataset.scrollStop) { el.removeAttribute("tabindex"); delete el.dataset.scrollStop; }
  }
}
markScrollers();
addEventListener("load", markScrollers);
let scrollerTimer = 0;
addEventListener("resize", () => { clearTimeout(scrollerTimer); scrollerTimer = window.setTimeout(markScrollers, 150); });
if ("MutationObserver" in window) {
  const mo = new MutationObserver(() => { clearTimeout(scrollerTimer); scrollerTimer = window.setTimeout(markScrollers, 150); });
  for (const el of document.querySelectorAll(".summary, .hm-bar")) mo.observe(el, { childList: true });
}

// Redesign (2026-11-23): a link or address that points inside a closed disclosure opens it.
// Remembered disclosures (uistate.ts) restore their last state on load, so this also runs on
// `load` and `hashchange`, and the address wins over what was remembered.
function openToHash(scroll: boolean): void {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  let changed = false;
  for (let p = el.closest("details"); p; p = p.parentElement?.closest("details") ?? null) {
    if (!p.open) { p.open = true; changed = true; }
  }
  if (changed || scroll) el.scrollIntoView();
}
openToHash(false);
window.addEventListener("load", () => openToHash(true));
window.addEventListener("hashchange", () => openToHash(true));

// The contents list sits open beside the text on a wide screen and folds on a phone.
const tocMq = window.matchMedia("(min-width: 1024px)");
const syncToc = (): void => {
  document.querySelectorAll<HTMLDetailsElement>("details[data-toc]").forEach((d) => { d.open = tocMq.matches; });
};
syncToc();
tocMq.addEventListener("change", syncToc);
