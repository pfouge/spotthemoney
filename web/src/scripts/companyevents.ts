// Company events hub (pages/company-events.astro, lib/events8k.ts). Progressive: the page already holds
// the first rows; this script loads the packed data file once, then filters, sorts and pages in the
// browser with the same functions the build and the unit tests use. Text always goes in as text nodes
// (scripts/dom.ts). Nothing is sent anywhere and nothing is stored in the browser.
import { h } from "./dom";
import {
  unpackHub, hubScreen, hubSummaryLine, hubViewCsv, hubViewCsvName, parseHubHash, toHubHash, isHubViewHash, isDefaultHubFilter, firstHubDir, hubShortDate,
  orderItems, itemLabel, isAmendment, safeUrl, NO_HUB_FILTER, DEFAULT_HUB_VIEW, DEFAULT_PER, EVENTS_DATA, EXHIBITS_ITEM, HUB_WINDOWS,
  type HubData, type HubRow, type HubView, type HubFilter, type HubSortKey,
} from "../lib/events8k";

const root = document.querySelector<HTMLElement>("[data-evhub]");
if (root) void start(root);

async function start(root: HTMLElement): Promise<void> {
  const ctl = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-ev="${name}"]`);
  const sel = (name: string) => ctl<HTMLSelectElement>(name);
  const q = ctl<HTMLInputElement>("q"), tbody = ctl<HTMLTableSectionElement>("rows"), count = ctl<HTMLElement>("count"), empty = ctl<HTMLElement>("empty"),
    reset = ctl<HTMLButtonElement>("reset"), prev = ctl<HTMLButtonElement>("prev"), next = ctl<HTMLButtonElement>("next"),
    pageinfo = ctl<HTMLElement>("pageinfo"), pager = ctl<HTMLElement>("pager"), per = sel("per"), download = ctl<HTMLButtonElement>("download");
  const heads = Array.from(root.querySelectorAll<HTMLTableCellElement>("th[data-sort]"));
  if (!tbody) return;

  let data: HubData;
  root.dataset.loading = "";
  try {
    const res = await fetch(root.dataset.src ?? EVENTS_DATA);
    if (!res.ok) throw new Error(String(res.status));
    data = (await res.json()) as HubData;
  } catch {
    delete root.dataset.loading;
    root.dataset.ready = "failed";
    if (count) count.textContent = `${count.textContent ?? ""} The filters could not be loaded; reload the page to try again.`;
    return;
  }
  delete root.dataset.loading;
  const all = unpackHub(data);
  const built = data.built;
  let view: HubView = { ...DEFAULT_HUB_VIEW };

  const has = (s: HTMLSelectElement | null, v: string) => !!s && Array.from(s.options).some((o) => o.value === v);
  const pick = (s: HTMLSelectElement | null, v: string, fallback = "") => { if (s) s.value = has(s, v) ? v : fallback; };
  const readFilter = (): HubFilter => {
    const w = Number(sel("w")?.value);
    const form = sel("form")?.value ?? "";
    return {
      q: q?.value ?? "", item: sel("item")?.value ?? "", division: sel("division")?.value ?? "",
      form: form === "report" || form === "amendment" ? form : "", w: (HUB_WINDOWS as readonly number[]).includes(w) ? w : NO_HUB_FILTER.w,
    };
  };
  const writeControls = (v: HubView): void => {
    const f = v.f;
    if (q) q.value = f.q;
    pick(sel("item"), f.item); pick(sel("division"), f.division); pick(sel("form"), f.form); pick(sel("w"), String(f.w), String(NO_HUB_FILTER.w));
    pick(per, String(v.per), String(DEFAULT_PER));
  };

  const rowEl = (r: HubRow): HTMLTableRowElement => {
    const its = orderItems(r.e.items), url = safeUrl(r.e.sourceUrl), am = isAmendment(r.e);
    return h("tr", { "data-cik": r.c.cik, "data-event": r.e.accession },
      h("td", { class: "mono" }, hubShortDate(r.e.filed)),
      h("td", {}, h("span", { class: "ent" }, r.c.path ? h("a", { href: r.c.path }, r.c.name) : r.c.name, r.c.ticker ? h("span", { class: "tk" }, ` ${r.c.ticker}`) : null)),
      h("td", {}, r.c.division ? h("a", { href: `/industries/${r.c.division.slug}/` }, r.c.division.name) : null),
      h("td", { "data-ev-form": "" }, r.e.form, am ? h("span", { class: "soft small" }, " amendment") : null),
      h("td", { class: "wrap ev-items", "data-ev-items": "" }, ...(its.length ? its.map((i) => h("span", { class: i === EXHIBITS_ITEM ? "ev-item ev-soft" : "ev-item", "data-item": i }, itemLabel(i))) : ["—"])),
      h("td", {}, url ? h("a", { href: url, rel: "noopener nofollow", target: "_blank" }, `${am ? "8-K/A" : "8-K"} ↗`) : (am ? "8-K/A" : "8-K")),
    );
  };

  const render = (updateHash: boolean): void => {
    const res = hubScreen(all, view, built);
    view = { ...view, page: res.page };
    tbody.replaceChildren(...res.rows.map(rowEl));
    if (count) count.textContent = hubSummaryLine(res);
    if (empty) empty.hidden = res.total > 0;
    if (pager) pager.hidden = res.total === 0;
    if (reset) reset.hidden = isDefaultHubFilter(view.f);
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
    root.dataset.companies = String(res.companies);
    root.dataset.all = String(res.all);
    root.dataset.page = String(res.page);
    root.dataset.pages = String(res.pages);
    root.dataset.ready = "1";
    if (updateHash) history.replaceState(null, "", toHubHash(view) || location.pathname + location.search);
  };

  const filterChanged = (): void => { view = { ...view, f: readFilter(), page: 1 }; render(true); };
  root.querySelectorAll<HTMLSelectElement>(".ev-controls select").forEach((s) => s.addEventListener("change", filterChanged));
  q?.addEventListener("input", filterChanged);
  per?.addEventListener("change", () => { view = { ...view, per: Number(per.value) || DEFAULT_PER, page: 1 }; render(true); });
  prev?.addEventListener("click", () => { view = { ...view, page: view.page - 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  next?.addEventListener("click", () => { view = { ...view, page: view.page + 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  for (const th of heads) th.querySelector("button")?.addEventListener("click", () => {
    const k = th.dataset.sort as HubSortKey;
    if (view.sort !== k) view = { ...view, sort: k, dir: firstHubDir(k), page: 1 };
    else if (view.dir === firstHubDir(k)) view = { ...view, dir: view.dir === "asc" ? "desc" : "asc", page: 1 };
    else view = { ...view, sort: DEFAULT_HUB_VIEW.sort, dir: DEFAULT_HUB_VIEW.dir, page: 1 };
    render(true);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-ev="reset"], [data-ev="reset2"]').forEach((b) => b.addEventListener("click", () => {
    view = { ...view, f: { ...NO_HUB_FILTER }, page: 1 }; writeControls(view); render(true);
  }));
  download?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([hubViewCsv(all, view, built)], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: hubViewCsvName(view, built) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  window.addEventListener("hashchange", () => {
    if (location.hash.length > 1 && !isHubViewHash(location.hash)) return;
    view = parseHubHash(location.hash); writeControls(view); view = { ...view, f: { ...readFilter(), q: view.f.q } }; render(false);
  });

  if (isHubViewHash(location.hash)) view = parseHubHash(location.hash);
  writeControls(view);
  view = { ...view, f: { ...readFilter(), q: view.f.q } };
  render(false);
}
