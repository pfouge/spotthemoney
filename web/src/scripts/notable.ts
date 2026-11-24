// Home-page feed: tabs, presets, search, sort, "Show more" and the URL hash. The rules and the
// selection live in lib/notable.ts (shared with the build, which writes the default view into the
// HTML). All text goes in as text nodes (scripts/dom.ts): names and labels come from filings.
import { h, type Kids } from "./dom";
import { actLabel, DEFAULT_STATE, FEED_PAGE, PREVIEW_ROWS, PREVIEW_ROWS_PHONE, PRESETS, PRESET_HASH, REASON_LABEL, SORTS, WINDOWS, countLine, capLine, emptyLine, presetFromHash, resolveView, shortDate, type Entry, type FeedItem, type FeedCluster, type FeedState, type NotableData, type Preset, type SortKey, type Win } from "../lib/notable";

const KEYS = ["nw", "np", "nq", "ns"] as const;

function link(href: string | null, cls: string | undefined, ...kids: Kids): HTMLElement {
  return href ? h("a", { href, class: cls }, ...kids) : h("span", { class: cls }, ...kids);
}
const cell = (cls: string, ...kids: Kids) => h("div", { class: `nf-c ${cls}` }, ...kids);
const sub = (t: string) => h("span", { class: "nf-sub" }, t);
const CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
function expander(label: string): HTMLElement {
  const b = h("button", { type: "button", class: "nf-exp", "aria-expanded": "false", "aria-label": label });
  b.innerHTML = CHEVRON; // a fixed icon, no data in it
  return b;
}

function itemEl(e: FeedItem): HTMLElement {
  return h("li", { class: "nf-item" },
    cell("nf-date", h("time", { datetime: e.d }, shortDate(e.d))),
    cell("nf-stock", link(e.tp, "nf-tk", e.tk), sub(e.co)),
    cell(`nf-act ${e.b ? "buy" : "sell"}`, h("b", {}, actLabel(e.b))),
    cell("nf-val", h("b", {}, e.vl)),
    cell("nf-who", e.np ? h("a", { href: e.np }, e.n) : h("b", {}, e.n)),
    cell("nf-tags", ...e.tg.map((t) => h("span", { class: "nf-tag" }, REASON_LABEL[t]))),
    expander(`Details: ${e.tk}, ${e.n}`),
    h("div", { class: "nf-detail", hidden: true },
      sub(`Traded ${shortDate(e.t)}`), sub(e.r), sub(e.vs),
      ...(e.ch && e.ch !== "—" ? [sub(`${e.ch} of holding`)] : []),
      ...(e.u ? [h("a", { class: "nf-src", href: e.u, rel: "noopener nofollow", target: "_blank" }, `${e.ul} ↗`)] : [])),
  );
}

function clusterEl(e: FeedCluster): HTMLElement {
  const names: Kids = [];
  e.who.forEach((w, i) => { if (i) names.push(", "); names.push(w.p ? h("a", { href: w.p }, w.n) : w.n); });
  return h("li", { class: "nf-item nf-cluster" },
    cell("nf-date", h("time", { datetime: e.d }, shortDate(e.d))),
    cell("nf-stock", link(e.tp, "nf-tk", e.tk), sub(e.co)),
    cell(`nf-act ${e.b ? "buy" : "sell"}`, h("b", {}, actLabel(e.b, e.n))),
    cell("nf-val", h("b", {}, e.vl)),
    cell("nf-who", h("b", {}, `${e.n} insiders`)),
    cell("nf-tags", h("span", { class: "nf-tag" }, e.b ? REASON_LABEL.cluster : REASON_LABEL["cluster-sell"])),
    expander(`Details: ${e.tk}, ${e.n} insiders`),
    h("div", { class: "nf-detail", hidden: true },
      sub(`Traded ${shortDate(e.f)}${e.f !== e.l ? ` to ${shortDate(e.l)}` : ""}`),
      h("span", { class: "nf-sub nf-names" }, ...names),
      sub(`${e.ids.length} ${e.b ? "purchases" : "sales"}`)),
  );
}

export function readState(hash: string): FeedState {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const w = Number(p.get("nw"));
  const np = presetFromHash(p.get("np")), ns = p.get("ns") as SortKey | null;
  return {
    win: (WINDOWS as readonly number[]).includes(w) ? (w as Win) : DEFAULT_STATE.win,
    preset: np ?? DEFAULT_STATE.preset,
    q: (p.get("nq") ?? "").slice(0, 60),
    sort: ns && SORTS.some((x) => x.id === ns) ? ns : DEFAULT_STATE.sort,
  };
}

/** Writes the feed's keys into the hash and leaves every other key (the map's) alone. */
export function writeState(s: FeedState): void {
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  for (const k of KEYS) p.delete(k);
  if (s.win !== DEFAULT_STATE.win) p.set("nw", String(s.win));
  if (s.preset !== DEFAULT_STATE.preset) p.set("np", PRESET_HASH[s.preset]);
  if (s.q.trim()) p.set("nq", s.q.trim());
  if (s.sort !== DEFAULT_STATE.sort) p.set("ns", s.sort);
  const str = p.toString();
  history.replaceState(null, "", str ? `#${str}` : location.pathname + location.search);
}

function init(root: HTMLElement): void {
  const allBtn = () => { const b = h("button", { type: "button", class: "btn nf-all", "data-nf-all": true }, "Show all notable trades"); b.addEventListener("click", () => set({ preset: "all" })); return b; };
  const src = root.dataset.src!;
  const list = () => root.querySelector<HTMLUListElement>("[data-nf-list]");
  const count = root.querySelector<HTMLElement>("[data-nf-count]")!;
  const capEl = root.querySelector<HTMLElement>("[data-nf-cap]");
  const emptyEl = root.querySelector<HTMLElement>("[data-nf-empty]")!;
  const more = root.querySelector<HTMLButtonElement>("[data-nf-more]")!;
  const input = root.querySelector<HTMLInputElement>("[data-nq]")!;
  const sortSel = root.querySelector<HTMLSelectElement>("[data-ns]")!;
  let data: NotableData | null = null;
  let state = readState(location.hash);
  let visible = FEED_PAGE;
  let preview = true; // only the first rows show until the first "Show more"
  const previewRows = () => (matchMedia("(max-width: 640px)").matches ? PREVIEW_ROWS_PHONE : PREVIEW_ROWS);

  let shownWin: Win = state.win;
  const paintControls = () => {
    root.querySelectorAll<HTMLButtonElement>("[data-nw]").forEach((b) => { const on = Number(b.dataset.nw) === shownWin; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    root.querySelectorAll<HTMLButtonElement>("[data-np]").forEach((b) => { const on = b.dataset.np === state.preset; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    if (document.activeElement !== input) input.value = state.q;
    sortSel.value = state.sort;
  };

  const render = () => {
    paintControls();
    if (!data) return;
    const view = resolveView(data, state);
    const all = view.entries;
    shownWin = view.win; paintControls();
    const shown = all.slice(0, visible);
    let ul = list();
    if (!ul) { ul = h("ul", { class: "nf-list", "data-nf-list": true }); count.after(ul); }
    ul.toggleAttribute("data-preview", preview);
    ul.replaceChildren(...shown.map((e: Entry) => (e.k === "c" ? clusterEl(e) : itemEl(e))));
    ul.hidden = all.length === 0;
    if (capEl) capEl.textContent = capLine(data, { ...state, win: view.win });
    count.textContent = all.length ? countLine(all.length, shown.length, { ...state, win: view.win }, data.newest, view.fellBack) : "";
    emptyEl.hidden = all.length > 0;
    emptyEl.replaceChildren(...(all.length ? [] : [emptyLine(state, view.offerAll), ...(view.offerAll ? [" ", allBtn()] : [])]));
    more.hidden = !(preview && all.length > previewRows()) && all.length <= shown.length;
  };

  const set = (patch: Partial<FeedState>) => { state = { ...state, ...patch }; visible = FEED_PAGE; preview = true; writeState(state); render(); };

  root.querySelectorAll<HTMLButtonElement>("[data-nw]").forEach((b) => b.addEventListener("click", () => set({ win: Number(b.dataset.nw) as Win })));
  root.querySelectorAll<HTMLButtonElement>("[data-np]").forEach((b) => b.addEventListener("click", () => set({ preset: b.dataset.np as Preset })));
  input.addEventListener("input", () => set({ q: input.value }));
  sortSel.addEventListener("change", () => set({ sort: sortSel.value as SortKey }));
  more.addEventListener("click", () => { if (preview) preview = false; else visible += FEED_PAGE; render(); });
  root.addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>(".nf-exp");
    if (!b) return;
    const open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(open));
    b.closest("li")?.querySelector<HTMLElement>(".nf-detail")?.toggleAttribute("hidden", !open);
  });
  window.addEventListener("hashchange", () => { const s = readState(location.hash); if (JSON.stringify(s) !== JSON.stringify(state)) { state = s; visible = FEED_PAGE; preview = true; input.value = state.q; render(); } });

  paintControls();
  root.dataset.nf = "loading";
  fetch(src).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((d: NotableData) => {
    data = d; root.dataset.nf = "ready"; render();
  }).catch(() => { root.dataset.nf = "failed"; count.textContent = "The filters could not load. The list below is the default view from the last update."; });
}

document.querySelectorAll<HTMLElement>("[data-notable]").forEach(init);
