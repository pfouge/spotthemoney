// Company financials screener (pages/company-financials.astro, lib/finscreen.ts). Progressive: the
// page already holds the first rows; this script loads the packed data file once, then filters,
// sorts and pages in the browser with the same functions the build and the unit tests use. Text
// always goes in as text nodes (scripts/dom.ts): names come from filings. Nothing is sent
// anywhere and nothing is stored in the browser.
import { h } from "./dom";
import {
  unpackFinScreen, finScreen, fsSummaryLine, fsViewCsv, fsViewCsvName, parseFinHash, toFinHash, isFsViewHash, isDefaultFsFilter, firstFsDir, fsCellText, fsPayText, fsShortDate, reportUrl, divisionPagePath, columnsOf, colsOf, asCols, withCols, fsRatio, fsRatioText,
  NO_FS_FILTER, DEFAULT_FS_VIEW, DEFAULT_PER, FIN_SCREENER_DATA, type FinScreenData, type FsRow, type FsView, type FsFilter, type FsSortKey, type FsCols,
} from "../lib/finscreen";

const root = document.querySelector<HTMLElement>("[data-finscreen]");
if (root) void start(root);

async function start(root: HTMLElement): Promise<void> {
  const ctl = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-fs="${name}"]`);
  const sel = (name: string) => ctl<HTMLSelectElement>(name);
  const q = ctl<HTMLInputElement>("q"), tbody = ctl<HTMLTableSectionElement>("rows"), count = ctl<HTMLElement>("count"), empty = ctl<HTMLElement>("empty"),
    reset = ctl<HTMLButtonElement>("reset"), prev = ctl<HTMLButtonElement>("prev"), next = ctl<HTMLButtonElement>("next"),
    pageinfo = ctl<HTMLElement>("pageinfo"), pager = ctl<HTMLElement>("pager"), per = sel("per"), colsSel = sel("cols"), ratioNote = ctl<HTMLElement>("rationote"), download = ctl<HTMLButtonElement>("download"), endHead = ctl<HTMLElement>("endhead");
  const heads = Array.from(root.querySelectorAll<HTMLTableCellElement>("th[data-sort]"));
  const viewHeads = Array.from(root.querySelectorAll<HTMLTableCellElement>("th[data-cols]"));
  if (!tbody) return;

  let data: FinScreenData;
  root.dataset.loading = "";
  try {
    const res = await fetch(root.dataset.src ?? FIN_SCREENER_DATA);
    if (!res.ok) throw new Error(String(res.status));
    data = (await res.json()) as FinScreenData;
  } catch {
    // The rows the page came with stay; say the filters are not available.
    delete root.dataset.loading;
    root.dataset.ready = "failed";
    if (count) count.textContent = `${count.textContent ?? ""} The filters could not be loaded; reload the page to try again.`;
    return;
  }
  delete root.dataset.loading;
  const all = unpackFinScreen(data);
  const heldHref = root.dataset.heldHref;
  let view: FsView = { ...DEFAULT_FS_VIEW };

  const has = (s: HTMLSelectElement | null, v: string) => !!s && Array.from(s.options).some((o) => o.value === v);
  const pick = (s: HTMLSelectElement | null, v: string, fallback = "") => { if (s) s.value = has(s, v) ? v : fallback; };
  const readFilter = (): FsFilter => ({
    q: q?.value ?? "", period: sel("period")?.value === "quarter" ? "quarter" : "year", division: sel("division")?.value ?? "", unit: sel("unit")?.value ?? "",
    rmin: Number(sel("rmin")?.value ?? 0), rmax: Number(sel("rmax")?.value ?? 0), ni: (sel("ni")?.value ?? "") as FsFilter["ni"], amin: Number(sel("amin")?.value ?? 0), pay: sel("pay")?.value === "1" ? 1 : 0, recent: sel("recent")?.value === "1" ? 1 : 0,
  });
  const writeControls = (v: FsView): void => {
    const f = v.f;
    if (q) q.value = f.q;
    pick(sel("period"), f.period, "year"); pick(sel("division"), f.division); pick(sel("unit"), f.unit);
    pick(sel("rmin"), String(f.rmin), "0"); pick(sel("rmax"), String(f.rmax), "0"); pick(sel("ni"), f.ni); pick(sel("amin"), String(f.amin), "0"); pick(sel("pay"), String(f.pay), "0"); pick(sel("recent"), String(f.recent ?? 0), "0");
    pick(per, String(v.per), String(DEFAULT_PER));
    pick(colsSel, colsOf(v), "figures");
  };
  const readCols = (): FsCols => asCols(colsSel?.value);

  const rowEl = (r: FsRow, cols: FsCols): HTMLTableRowElement => {
    const url = reportUrl(r);
    return h("tr", { "data-cik": r.c.cik },
      h("td", {}, h("span", { class: "ent" }, r.c.path ? h("a", { href: r.c.path }, r.c.name) : r.c.name, r.c.ticker ? h("span", { class: "tk" }, ` ${r.c.ticker}`) : null)),
      h("td", {}, r.c.division ? h("a", { href: divisionPagePath(r.c.division.slug) }, r.c.division.name) : null),
      h("td", { class: "mono" }, fsShortDate(r.p.end)),
      ...columnsOf(cols).map((c) => {
        if (c.kind === "pay") return h("td", { class: "num", "data-pay": "" }, fsPayText(r.c));
        if (c.kind === "payyear") return h("td", { class: "mono", "data-payyear": "" }, r.c.pay ? fsShortDate(r.c.pay.fye) : "");
        if (c.kind === "ratio") return h("td", { class: "num", "data-ratio": c.key, "data-status": fsRatio(r, c.key).status }, fsRatioText(r, c.key));
        const text = fsCellText(r, c.key);
        if (r.p.held[c.key]) return h("td", { class: "num", "data-held": "" }, heldHref ? h("a", { class: "soft", href: heldHref }, text) : h("span", { class: "soft" }, text));
        return h("td", { class: `num${c.key === "revenue" ? " strong" : ""}`, "data-fig": c.key }, text);
      }),
      h("td", { class: "mono" }, url ? h("a", { href: url, rel: "noopener nofollow", target: "_blank", title: `Filed ${fsShortDate(r.p.filed)}` }, `${r.p.form} ↗`) : r.p.form),
    );
  };

  const render = (updateHash: boolean): void => {
    const res = finScreen(all, view);
    view = { ...view, page: res.page };
    const cols = colsOf(view);
    for (const th of viewHeads) th.hidden = !(th.dataset.cols ?? "").split(" ").includes(cols);
    if (ratioNote) ratioNote.hidden = cols !== "ratios";
    tbody.replaceChildren(...res.rows.map((r) => rowEl(r, cols)));
    if (count) count.textContent = fsSummaryLine(res, view.f.period);
    if (empty) empty.hidden = res.total > 0;
    if (pager) pager.hidden = res.total === 0;
    if (reset) reset.hidden = isDefaultFsFilter(view.f);
    if (download) download.disabled = res.total === 0;
    if (endHead) endHead.textContent = view.f.period === "quarter" ? "Quarter ended" : "Fiscal year ended";
    if (prev) prev.disabled = res.page <= 1;
    if (next) next.disabled = res.page >= res.pages;
    if (pageinfo) pageinfo.textContent = `Page ${res.page.toLocaleString("en-US")} of ${res.pages.toLocaleString("en-US")}`;
    for (const th of heads) {
      const on = th.dataset.sort === view.sort;
      th.setAttribute("aria-sort", on ? (view.dir === "asc" ? "ascending" : "descending") : "none");
      const arr = th.querySelector(".arr"); if (arr) arr.textContent = on ? (view.dir === "asc" ? "▲" : "▼") : "";
    }
    root.dataset.shown = String(res.total);
    root.dataset.all = String(res.all);
    root.dataset.period = view.f.period;
    root.dataset.cols = cols;
    root.dataset.page = String(res.page);
    root.dataset.pages = String(res.pages);
    root.dataset.ready = "1";
    if (updateHash) history.replaceState(null, "", toFinHash(view) || location.pathname + location.search);
  };

  // The Columns control is not a filter: Reset leaves it, and a sort the new columns cannot show goes back to the opening order.
  const filterChanged = (): void => { view = { ...view, f: readFilter(), page: 1 }; if (readCols() !== colsOf(view)) view = withCols(view, readCols()); render(true); };
  root.querySelectorAll<HTMLSelectElement>(".fs-controls select").forEach((s) => s.addEventListener("change", filterChanged));
  q?.addEventListener("input", filterChanged);
  per?.addEventListener("change", () => { view = { ...view, per: Number(per.value) || DEFAULT_PER, page: 1 }; render(true); });
  prev?.addEventListener("click", () => { view = { ...view, page: view.page - 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  next?.addEventListener("click", () => { view = { ...view, page: view.page + 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  for (const th of heads) th.querySelector("button")?.addEventListener("click", () => {
    const k = th.dataset.sort as FsSortKey;
    // First click: the column's natural direction; again: the reverse; a third time: back to the opening order.
    if (view.sort !== k) view = { ...view, sort: k, dir: firstFsDir(k), page: 1 };
    else if (view.dir === firstFsDir(k)) view = { ...view, dir: view.dir === "asc" ? "desc" : "asc", page: 1 };
    else view = { ...view, sort: DEFAULT_FS_VIEW.sort, dir: DEFAULT_FS_VIEW.dir, page: 1 };
    render(true);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-fs="reset"], [data-fs="reset2"]').forEach((b) => b.addEventListener("click", () => {
    view = { ...view, f: { ...NO_FS_FILTER }, page: 1 }; writeControls(view); render(true);
  }));
  download?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([fsViewCsv(all, view)], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: fsViewCsvName(view, data.built) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  // A hash without one of the screener's keys is a jump link (the skip link, a heading): leave the view alone.
  window.addEventListener("hashchange", () => {
    if (location.hash.length > 1 && !isFsViewHash(location.hash)) return;
    view = parseFinHash(location.hash); writeControls(view); view = { ...view, f: readFilter() }; render(false);
  });

  if (isFsViewHash(location.hash)) view = parseFinHash(location.hash);
  writeControls(view);
  // A value the controls do not offer (a division with no company, say) falls back to "any": read it back.
  view = { ...view, f: { ...readFilter(), q: view.f.q } };
  render(false);
}
