// Congress trade screener (pages/congress-trades.astro, lib/screener.ts). Progressive: the page
// already holds the newest rows; this script loads the packed data file once, then filters, sorts
// and pages in the browser with the same functions the build and the unit tests use. Text always
// goes in as text nodes (scripts/dom.ts): names come from filings. Nothing is sent anywhere.
import { h } from "./dom";
import {
  unpack, screen, summaryLine, memberSlug, viewCsv, viewCsvName, parseHash, toHash, isViewHash, isDefaultFilter, firstDir, isLateRow, rangeLabel, assetLabel, shortDate, seatTag, tickerPath, rowRunFlag,
  NO_FILTER, DEFAULT_VIEW, DEFAULT_PER, SIDE_LABEL, OWNER_LABEL, type ScreenData, type ScreenRow, type ScreenView, type ScreenFilter, type SortKey,
} from "../lib/screener";

const root = document.querySelector<HTMLElement>("[data-screener]");
if (root) void start(root);

async function start(root: HTMLElement): Promise<void> {
  const ctl = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-scr="${name}"]`);
  const sel = (name: string) => ctl<HTMLSelectElement>(name);
  const q = ctl<HTMLInputElement>("q"), tbody = ctl<HTMLTableSectionElement>("rows"), count = ctl<HTMLElement>("count"), empty = ctl<HTMLElement>("empty"),
    reset = ctl<HTMLButtonElement>("reset"), prev = ctl<HTMLButtonElement>("prev"), next = ctl<HTMLButtonElement>("next"),
    pageinfo = ctl<HTMLElement>("pageinfo"), pager = ctl<HTMLElement>("pager"), per = sel("per"),
    pins = ctl<HTMLElement>("pins"), download = ctl<HTMLButtonElement>("download");
  const heads = Array.from(root.querySelectorAll<HTMLTableCellElement>("th[data-sort]"));
  if (!tbody) return;

  let data: ScreenData;
  root.dataset.loading = "";
  try {
    const res = await fetch(root.dataset.src ?? "/data/congress-screener.json");
    if (!res.ok) throw new Error(String(res.status));
    data = (await res.json()) as ScreenData;
  } catch {
    // The rows the page came with stay; say the filters are not available.
    delete root.dataset.loading;
    root.dataset.ready = "failed";
    if (count) count.textContent = `${count.textContent ?? ""} The filters could not be loaded; reload the page to try again.`;
    return;
  }
  delete root.dataset.loading;
  const all = unpack(data);
  const lateHref = root.dataset.lateHref, histHref = root.dataset.histHref;
  // "first on record" and "3rd buy in a row" (lib/tickerhistory.ts), linked to the guide section that explains them.
  const histTag = (text: string, cls: string): (Node | string)[] => [" ", histHref ? h("a", { class: `flag ${cls}`, href: histHref, title: "What this flag means" }, text) : h("span", { class: `flag ${cls}` }, text)];
  let view: ScreenView = { ...DEFAULT_VIEW };

  const has = (s: HTMLSelectElement | null, v: string) => !!s && Array.from(s.options).some((o) => o.value === v);
  const pick = (s: HTMLSelectElement | null, v: string, fallback = "") => { if (s) s.value = has(s, v) ? v : fallback; };
  // One member or one ticker alone: set by a link from another page, kept until removed.
  const memberNames = new Map(data.members.map((m) => [memberSlug(m), m.n] as [string, string]).filter(([s]) => s));
  const tickers = new Set(all.map((r) => r.ticker.toUpperCase()).filter(Boolean));
  const readFilter = (): ScreenFilter => ({
    member: view.f.member, ticker: view.f.ticker,
    q: q?.value ?? "", chamber: (sel("chamber")?.value ?? "") as ScreenFilter["chamber"], party: (sel("party")?.value ?? "") as ScreenFilter["party"],
    state: sel("state")?.value ?? "", committee: sel("committee")?.value ?? "", side: (sel("side")?.value ?? "") as ScreenFilter["side"],
    min: Number(sel("min")?.value ?? 0), max: Number(sel("max")?.value ?? 0), tw: Number(sel("tw")?.value ?? 0) as ScreenFilter["tw"], owner: (sel("owner")?.value ?? "") as ScreenFilter["owner"], asset: (sel("asset")?.value ?? "") as ScreenFilter["asset"],
    w: Number(sel("w")?.value ?? 0) as ScreenFilter["w"], late: (sel("late")?.value ?? "") as ScreenFilter["late"],
    hist: (sel("hist")?.value ?? "") as ScreenFilter["hist"],
  });
  const writeControls = (v: ScreenView): void => {
    const f = v.f;
    if (q) q.value = f.q;
    pick(sel("chamber"), f.chamber); pick(sel("party"), f.party); pick(sel("state"), f.state); pick(sel("committee"), f.committee);
    pick(sel("side"), f.side); pick(sel("min"), String(f.min), "0"); pick(sel("max"), String(f.max), "0"); pick(sel("tw"), String(f.tw), "0"); pick(sel("owner"), f.owner); pick(sel("asset"), f.asset);
    pick(sel("w"), String(f.w), "0"); pick(sel("late"), f.late); pick(sel("hist"), f.hist); pick(per, String(v.per), String(DEFAULT_PER));
  };

  const rowEl = (r: ScreenRow): HTMLTableRowElement => {
    const src = r.m.ch === "senate" ? "Senate PTR" : "House PTR";
    return h("tr", { "data-id": String(r.id) },
      h("td", {}, r.m.p ? h("a", { href: r.m.p }, r.m.n) : r.m.n, seatTag(r.m) ? h("span", { class: "soft small" }, ` ${seatTag(r.m)}`) : null, r.m.f === 1 ? h("span", { class: "soft small" }, " · left office") : null),
      h("td", { class: "mono" }, r.ticker ? h("a", { href: tickerPath(r.ticker) }, r.ticker) : h("span", { class: "soft" }, assetLabel(r.asset))),
      h("td", { class: `side ${r.side}` }, SIDE_LABEL[r.side] ?? "Other", ...(r.first ? histTag("first on record", "hist first") : []), ...(rowRunFlag(r) ? histTag(rowRunFlag(r), "hist run") : [])),
      h("td", {}, OWNER_LABEL[r.owner] ?? ""),
      h("td", { class: "mono" }, shortDate(r.txn)),
      h("td", { class: "mono" }, shortDate(r.disc)),
      h("td", { class: "num" }, r.lag == null ? "" : `${r.lag}d`, isLateRow(r) ? " " : null,
        isLateRow(r) ? (lateHref ? h("a", { class: "flag late", href: lateHref, title: "What this flag means" }, "late") : h("span", { class: "flag late" }, "late")) : null),
      h("td", { class: "num strong" }, rangeLabel(r.low, r.high)),
      h("td", {}, r.url ? h("a", { href: r.url, rel: "noopener nofollow", target: "_blank" }, `${src} ↗`) : src),
    );
  };

  const render = (updateHash: boolean): void => {
    const res = screen(all, view, data.built);
    view = { ...view, page: res.page };
    tbody.replaceChildren(...res.rows.map(rowEl));
    if (count) count.textContent = summaryLine(res, all.length);
    if (empty) empty.hidden = res.total > 0;
    if (pager) pager.hidden = res.total === 0;
    if (reset) reset.hidden = isDefaultFilter(view.f);
    if (pins) {
      const pin = (label: string, clear: () => void): HTMLElement => {
        const b = h("button", { type: "button", "aria-label": `Remove: ${label}` }, "Remove");
        b.addEventListener("click", () => { clear(); view = { ...view, page: 1 }; render(true); });
        return h("span", { class: "pin" }, label, b);
      };
      const kids: HTMLElement[] = [];
      if (view.f.member) kids.push(pin(`Only trades by ${memberNames.get(view.f.member) ?? view.f.member}`, () => { view = { ...view, f: { ...view.f, member: "" } }; }));
      if (view.f.ticker) kids.push(pin(`Only ${view.f.ticker}`, () => { view = { ...view, f: { ...view.f, ticker: "" } }; }));
      pins.replaceChildren(...kids);
      pins.hidden = kids.length === 0;
    }
    if (download) download.disabled = res.total === 0;
    root.dataset.member = view.f.member; root.dataset.ticker = view.f.ticker;
    if (prev) prev.disabled = res.page <= 1;
    if (next) next.disabled = res.page >= res.pages;
    if (pageinfo) pageinfo.textContent = `Page ${res.page.toLocaleString("en-US")} of ${res.pages.toLocaleString("en-US")}`;
    for (const th of heads) {
      const on = th.dataset.sort === view.sort;
      th.setAttribute("aria-sort", on ? (view.dir === "asc" ? "ascending" : "descending") : "none");
      const arr = th.querySelector(".arr"); if (arr) arr.textContent = on ? (view.dir === "asc" ? "▲" : "▼") : "";
    }
    root.dataset.shown = String(res.total);
    root.dataset.members = String(res.members);
    root.dataset.page = String(res.page);
    root.dataset.pages = String(res.pages);
    root.dataset.ready = "1";
    if (updateHash) history.replaceState(null, "", toHash(view) || location.pathname + location.search);
  };

  const filterChanged = (): void => { view = { ...view, f: readFilter(), page: 1 }; render(true); };
  root.querySelectorAll<HTMLSelectElement>(".scr-controls select").forEach((s) => s.addEventListener("change", filterChanged));
  q?.addEventListener("input", filterChanged);
  per?.addEventListener("change", () => { view = { ...view, per: Number(per.value) || DEFAULT_PER, page: 1 }; render(true); });
  prev?.addEventListener("click", () => { view = { ...view, page: view.page - 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  next?.addEventListener("click", () => { view = { ...view, page: view.page + 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  for (const th of heads) th.querySelector("button")?.addEventListener("click", () => {
    const k = th.dataset.sort as SortKey;
    // First click: the column's natural direction; again: the reverse; a third time: back to the default order.
    if (view.sort !== k) view = { ...view, sort: k, dir: firstDir(k), page: 1 };
    else if (view.dir === firstDir(k)) view = { ...view, dir: view.dir === "asc" ? "desc" : "asc", page: 1 };
    else view = { ...view, sort: DEFAULT_VIEW.sort, dir: DEFAULT_VIEW.dir, page: 1 };
    render(true);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-scr="reset"], [data-scr="reset2"]').forEach((b) => b.addEventListener("click", () => {
    view = { ...view, f: { ...NO_FILTER }, page: 1 }; writeControls(view); render(true);
  }));
  download?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([viewCsv(all, view, data.built)], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: viewCsvName(view, data.built) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  // A member or ticker the table does not hold falls back to "any", like a state with no trades.
  const known = (v: ScreenView): ScreenView => ({ ...v, f: { ...v.f, member: memberNames.has(v.f.member) ? v.f.member : "", ticker: tickers.has(v.f.ticker) ? v.f.ticker : "" } });
  // A hash without one of the screener's keys is a jump link (the skip link, a heading): leave the view alone.
  window.addEventListener("hashchange", () => {
    if (location.hash.length > 1 && !isViewHash(location.hash)) return;
    view = known(parseHash(location.hash)); writeControls(view); view = { ...view, f: readFilter() }; render(false);
  });

  if (isViewHash(location.hash)) view = known(parseHash(location.hash));
  writeControls(view);
  // A value the controls do not offer (a state with no trades, say) falls back to "any": read it back.
  view = { ...view, f: { ...readFilter(), q: view.f.q } };
  render(false);
}
