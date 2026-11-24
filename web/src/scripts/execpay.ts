// Executive pay hub (pages/executive-pay.astro, lib/execpay.ts). Progressive: the page already holds the
// first rows; this script loads the packed data file once, then filters, sorts and pages in the browser
// with the same functions the build and the unit tests use. Text always goes in as text nodes
// (scripts/dom.ts). Nothing is sent anywhere and nothing is stored in the browser.
import { h } from "./dom";
import {
  unpackPayHub, payScreen, paySummaryLine, payViewCsv, payViewCsvName, parsePayHash, toPayHash, isPayViewHash, firstPayDir, payMoney, payMarked, payFilingUrl, shortDate,
  NO_PAY_FILTER, DEFAULT_PAY_VIEW, DEFAULT_PER, PAY_DATA, PAY_KEYS, PAY_MARK_NOTE, MIN_STEPS,
  type PayHubData, type PayHubRow, type PayView, type PayFilter, type PaySortKey,
} from "../lib/execpay";

const root = document.querySelector<HTMLElement>("[data-paycompare]");
if (root) void start(root);

async function start(root: HTMLElement): Promise<void> {
  const ctl = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-pc="${name}"]`);
  const sel = (name: string) => ctl<HTMLSelectElement>(name);
  const q = ctl<HTMLInputElement>("q"), tbody = ctl<HTMLTableSectionElement>("rows"), count = ctl<HTMLElement>("count"), empty = ctl<HTMLElement>("empty"),
    reset = ctl<HTMLButtonElement>("reset"), prev = ctl<HTMLButtonElement>("prev"), next = ctl<HTMLButtonElement>("next"),
    pageinfo = ctl<HTMLElement>("pageinfo"), pager = ctl<HTMLElement>("pager"), per = sel("per"), download = ctl<HTMLButtonElement>("download");
  const heads = Array.from(root.querySelectorAll<HTMLTableCellElement>("th[data-sort]"));
  if (!tbody) return;

  let data: PayHubData;
  root.dataset.loading = "";
  try {
    const res = await fetch(root.dataset.src ?? PAY_DATA);
    if (!res.ok) throw new Error(String(res.status));
    data = (await res.json()) as PayHubData;
  } catch {
    delete root.dataset.loading;
    root.dataset.ready = "failed";
    if (count) count.textContent = `${count.textContent ?? ""} The filters could not be loaded; reload the page to try again.`;
    return;
  }
  delete root.dataset.loading;
  const all = unpackPayHub(data);
  let view: PayView = { ...DEFAULT_PAY_VIEW };

  const has = (s: HTMLSelectElement | null, v: string) => !!s && Array.from(s.options).some((o) => o.value === v);
  const pick = (s: HTMLSelectElement | null, v: string, fallback = "") => { if (s) s.value = has(s, v) ? v : fallback; };
  const readFilter = (): PayFilter => {
    const mn = Number(sel("min")?.value ?? 0);
    return { q: q?.value ?? "", division: sel("division")?.value ?? "", fy: sel("fy")?.value ?? "", min: (MIN_STEPS as readonly number[]).includes(mn) ? mn : 0 };
  };
  const writeControls = (v: PayView): void => {
    const f = v.f;
    if (q) q.value = f.q;
    pick(sel("division"), f.division); pick(sel("fy"), f.fy); pick(sel("min"), String(f.min), "0");
    pick(per, String(v.per), String(DEFAULT_PER));
  };

  const rowEl = (r: PayHubRow): HTMLTableRowElement => {
    const u = payFilingUrl(r.c.cik, r.accession);
    return h("tr", { "data-cik": r.c.cik },
      h("td", {}, h("span", { class: "ent" }, r.c.path ? h("a", { href: r.c.path }, r.c.name) : r.c.name, r.c.ticker ? h("span", { class: "tk" }, ` ${r.c.ticker}`) : null)),
      h("td", {}, r.c.division ? h("a", { href: `/industries/${r.c.division.slug}/` }, r.c.division.name) : null),
      h("td", { class: "mono" }, shortDate(r.fye)),
      ...PAY_KEYS.map((k) => {
        const v = r.v[k];
        const cls = ["num", v != null && v < 0 ? "pc-neg" : "", k === "peo_total" ? "strong" : ""].filter(Boolean).join(" ");
        return h("td", { class: cls, "data-pay": k }, v == null ? "—" : payMoney(v), payMarked(k, v) ? h("sup", { class: "pc-mark", title: PAY_MARK_NOTE }, " a") : null);
      }),
      h("td", {}, u ? h("a", { href: u, rel: "noopener nofollow", target: "_blank" }, "Filing ↗") : "—"),
    );
  };

  const render = (updateHash: boolean): void => {
    const res = payScreen(all, view);
    view = { ...view, page: res.page };
    tbody.replaceChildren(...res.rows.map(rowEl));
    if (count) count.textContent = paySummaryLine(res);
    if (empty) empty.hidden = res.total > 0;
    if (pager) pager.hidden = res.total === 0;
    if (reset) reset.hidden = view.f.q.trim() === "" && !view.f.division && !view.f.fy && !view.f.min;
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
    root.dataset.all = String(res.all);
    root.dataset.page = String(res.page);
    root.dataset.pages = String(res.pages);
    root.dataset.ready = "1";
    if (updateHash) history.replaceState(null, "", toPayHash(view) || location.pathname + location.search);
  };

  const filterChanged = (): void => { view = { ...view, f: readFilter(), page: 1 }; render(true); };
  root.querySelectorAll<HTMLSelectElement>(".pc-controls select").forEach((s) => s.addEventListener("change", filterChanged));
  q?.addEventListener("input", filterChanged);
  per?.addEventListener("change", () => { view = { ...view, per: Number(per.value) || DEFAULT_PER, page: 1 }; render(true); });
  prev?.addEventListener("click", () => { view = { ...view, page: view.page - 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  next?.addEventListener("click", () => { view = { ...view, page: view.page + 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  for (const th of heads) th.querySelector("button")?.addEventListener("click", () => {
    const k = th.dataset.sort as PaySortKey;
    if (view.sort !== k) view = { ...view, sort: k, dir: firstPayDir(k), page: 1 };
    else if (view.dir === firstPayDir(k)) view = { ...view, dir: view.dir === "asc" ? "desc" : "asc", page: 1 };
    else view = { ...view, sort: DEFAULT_PAY_VIEW.sort, dir: DEFAULT_PAY_VIEW.dir, page: 1 };
    render(true);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-pc="reset"], [data-pc="reset2"]').forEach((b) => b.addEventListener("click", () => {
    view = { ...view, f: { ...NO_PAY_FILTER }, page: 1 }; writeControls(view); render(true);
  }));
  download?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([payViewCsv(all, view)], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: payViewCsvName(view, data.built) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  window.addEventListener("hashchange", () => {
    if (location.hash.length > 1 && !isPayViewHash(location.hash)) return;
    view = parsePayHash(location.hash); writeControls(view); view = { ...view, f: { ...readFilter(), q: view.f.q } }; render(false);
  });

  if (isPayViewHash(location.hash)) view = parsePayHash(location.hash);
  writeControls(view);
  view = { ...view, f: { ...readFilter(), q: view.f.q } };
  render(false);
}
