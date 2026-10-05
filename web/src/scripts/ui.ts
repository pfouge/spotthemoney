// Site chrome behaviour: theme switch, the phone menu, the header search, and "show more" on
// long answer blocks. No dependencies. Everything degrades: without this script the menu
// links are simply visible (html lacks the `js` class) and search does nothing.

function initTheme(): void {
  document.getElementById("themeBtn")?.addEventListener("click", () => {
    const root = document.documentElement, next = root.classList.contains("dark") ? "light" : "dark";
    root.classList.remove("dark", "light"); root.classList.add(next);
    document.getElementById("themeColor")?.setAttribute("content", next === "dark" ? "#0A0B0C" : "#F2F1EC");
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

type Row = [kind: string, title: string, sub: string, url: string, weight: number];

function initSearch(): void {
  const dlg = document.getElementById("searchDlg") as HTMLDialogElement | null;
  const input = document.getElementById("searchInput") as HTMLInputElement | null;
  const list = document.getElementById("searchResults");
  if (!dlg || !input || !list || typeof dlg.showModal !== "function") return;
  let rows: Row[] | null = null, loading: Promise<void> | null = null, active = 0, shown: Row[] = [];
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const load = (): Promise<void> => (loading ??= fetch("/data/search.json").then((r) => r.json()).then((d: Row[]) => { rows = d; }).catch(() => { rows = []; }));
  // rank: exact ticker, then title starts with the query, then a word starts with it, then anywhere
  const score = (r: Row, q: string): number => {
    const t = r[1].toLowerCase(), s = r[2].toLowerCase();
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    if (t.split(/[\s,.-]+/).some((w) => w.startsWith(q))) return 2;
    if (s.startsWith(q) || s.split(/[\s,.-]+/).some((w) => w.startsWith(q))) return 3;
    if (t.includes(q) || s.includes(q)) return 4;
    return -1;
  };
  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    if (!rows) { list.innerHTML = `<p class="search-note">Loading…</p>`; return; }
    shown = q === ""
      ? [...rows].filter((r) => r[0] !== "Page").sort((a, b) => b[4] - a[4]).slice(0, 8)
      : rows.map((r) => [score(r, q), r] as const).filter((x) => x[0] >= 0).sort((a, b) => a[0] - b[0] || b[1][4] - a[1][4]).slice(0, 12).map((x) => x[1]);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length === 0
      ? `<p class="search-note">Nothing on record matches “${esc(input.value.trim())}”.</p>`
      : (q === "" ? `<p class="search-note">Most active on record</p>` : "") + shown.map((r, i) =>
          `<a class="search-row${i === active ? " on" : ""}" href="${esc(r[3])}" role="option" aria-selected="${i === active}"><span class="tk">${esc(r[0] === "Ticker" ? r[1] : r[0])}</span><span class="nm"><b>${esc(r[0] === "Ticker" ? r[2] || r[1] : r[1])}</b>${r[0] !== "Ticker" && r[2] ? `<small>${esc(r[2])}</small>` : ""}</span></a>`).join("");
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
initSearch();
initAnswerMore();
