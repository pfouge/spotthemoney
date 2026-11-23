// The browser half of the two filing hubs (/planned-sales/ and /large-holders/): one engine,
// configured by scripts/plannedsales.ts and scripts/largeholders.ts. Progressive: the page already
// holds the first rows; this loads the packed data file once, then filters, sorts and pages in the
// browser with the same functions the build and the unit tests use. Text always goes in as text
// nodes (scripts/dom.ts): names come from filings. Nothing is sent anywhere and nothing is stored.
import { h } from "./dom";
import { DEFAULT_PER } from "../lib/hubscreen";

interface View<F> { f: F; sort: string; dir: "asc" | "desc"; page: number; per: number }
interface Res<R> { rows: R[]; total: number; page: number; pages: number }

export interface HubCfg<R, F, V extends View<F>, D extends { built: string }> {
  unpack(d: D): R[];
  defaults: V;
  parse(hash: string): V;
  toHash(v: V): string;
  isHash(hash: string): boolean;
  isDefault(f: F): boolean;
  screen(all: readonly R[], v: V, built: string): Res<R>;
  line(res: Res<R>): string;
  rowEl(r: R): HTMLTableRowElement;
  /** Reads the filter from the controls: `get(key)` is a control's value ("" when there is none). */
  readFilter(get: (key: string) => string): F;
  /** The control values for a filter, by control key. */
  controls(f: F): Record<string, string>;
  csv(all: readonly R[], v: V, built: string): string;
  csvName(v: V, built: string): string;
  firstDir(sort: string): "asc" | "desc";
}

export function startHub<R, F, V extends View<F>, D extends { built: string }>(cfg: HubCfg<R, F, V, D>): void {
  const root = document.querySelector<HTMLElement>("[data-hub-root]");
  if (root) void run(root, cfg);
}

async function run<R, F, V extends View<F>, D extends { built: string }>(root: HTMLElement, cfg: HubCfg<R, F, V, D>): Promise<void> {
  const el = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-hub="${name}"]`);
  const ctl = (key: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-hub-ctl="${key}"]`);
  const tbody = el<HTMLTableSectionElement>("rows"), count = el("count"), empty = el("empty"), pager = el("pager"), prev = el<HTMLButtonElement>("prev"),
    next = el<HTMLButtonElement>("next"), pageinfo = el("pageinfo"), download = el<HTMLButtonElement>("download");
  const heads = Array.from(root.querySelectorAll<HTMLTableCellElement>("th[data-sort]"));
  if (!tbody) return;

  let data: D;
  root.dataset.loading = "";
  try {
    const res = await fetch(root.dataset.src ?? "");
    if (!res.ok) throw new Error(String(res.status));
    data = (await res.json()) as D;
  } catch {
    delete root.dataset.loading;
    root.dataset.ready = "failed";
    if (count) count.textContent = `${count.textContent ?? ""} The filters could not be loaded; reload the page to try again.`;
    return;
  }
  delete root.dataset.loading;
  const all = cfg.unpack(data);
  const built = data.built;
  let view: V = { ...cfg.defaults };

  const get = (k: string) => ctl(k)?.value ?? "";
  const readFilter = (): F => cfg.readFilter(get);
  const writeControls = (v: V): void => {
    for (const [k, val] of Object.entries(cfg.controls(v.f))) {
      const c = ctl(k); if (!c) continue;
      if (c instanceof HTMLSelectElement) c.value = Array.from(c.options).some((o) => o.value === val) ? val : (c.options[0]?.value ?? "");
      else c.value = val;
    }
    const per = ctl("per"); if (per) per.value = String(v.per);
  };

  const render = (updateHash: boolean): void => {
    const res = cfg.screen(all, view, built);
    view = { ...view, page: res.page };
    tbody.replaceChildren(...res.rows.map(cfg.rowEl));
    if (count) count.textContent = cfg.line(res);
    if (empty) empty.hidden = res.total > 0;
    if (pager) pager.hidden = res.total === 0;
    root.querySelectorAll<HTMLElement>('[data-hub="reset"]').forEach((b) => { b.hidden = cfg.isDefault(view.f); });
    if (download) download.disabled = res.total === 0;
    if (prev) prev.disabled = res.page <= 1;
    if (next) next.disabled = res.page >= res.pages;
    if (pageinfo) pageinfo.textContent = `Page ${res.page.toLocaleString("en-US")} of ${res.pages.toLocaleString("en-US")}`;
    for (const th of heads) {
      const on = th.dataset.sort === view.sort;
      th.setAttribute("aria-sort", on ? (view.dir === "asc" ? "ascending" : "descending") : "none");
      const arr = th.querySelector(".arr"); if (arr) arr.textContent = on ? (view.dir === "asc" ? "▲" : "▼") : "";
    }
    root.dataset.shown = String(res.total);
    root.dataset.all = String(all.length);
    root.dataset.page = String(res.page);
    root.dataset.pages = String(res.pages);
    root.dataset.ready = "1";
    if (updateHash) history.replaceState(null, "", cfg.toHash(view) || location.pathname + location.search);
  };

  const filterChanged = (): void => { view = { ...view, f: readFilter(), page: 1 }; render(true); };
  root.querySelectorAll<HTMLElement>("[data-hub-ctl]").forEach((c) => {
    const key = c.getAttribute("data-hub-ctl");
    if (key === "per") c.addEventListener("change", () => { view = { ...view, per: Number((c as HTMLSelectElement).value) || DEFAULT_PER, page: 1 }; render(true); });
    else c.addEventListener(c instanceof HTMLInputElement ? "input" : "change", filterChanged);
  });
  prev?.addEventListener("click", () => { view = { ...view, page: view.page - 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  next?.addEventListener("click", () => { view = { ...view, page: view.page + 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  for (const th of heads) th.querySelector("button")?.addEventListener("click", () => {
    const k = th.dataset.sort as string;
    // First click: the column's natural direction; again: the reverse; a third time: back to the opening order.
    if (view.sort !== k) view = { ...view, sort: k, dir: cfg.firstDir(k), page: 1 };
    else if (view.dir === cfg.firstDir(k)) view = { ...view, dir: view.dir === "asc" ? "desc" : "asc", page: 1 };
    else view = { ...view, sort: cfg.defaults.sort, dir: cfg.defaults.dir, page: 1 };
    render(true);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-hub="reset"], [data-hub="reset2"]').forEach((b) => b.addEventListener("click", () => {
    view = { ...view, f: cfg.defaults.f, page: 1 }; writeControls(view); render(true);
  }));
  download?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([cfg.csv(all, view, built)], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: cfg.csvName(view, built) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  // A hash without one of the hub's keys is a jump link (the skip link, a heading): leave the view alone.
  window.addEventListener("hashchange", () => {
    if (location.hash.length > 1 && !cfg.isHash(location.hash)) return;
    view = cfg.parse(location.hash); writeControls(view); view = { ...view, f: readFilter() }; render(false);
  });

  if (cfg.isHash(location.hash)) view = cfg.parse(location.hash);
  writeControls(view);
  // A value the controls do not offer (a division with no company, say) falls back to "any": read it back.
  const q = (view.f as { q?: string }).q;
  view = { ...view, f: { ...readFilter(), ...(q != null ? { q } : {}) } };
  render(false);
}
