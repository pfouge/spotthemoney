// Roll-call hub (pages/congress-votes.astro, lib/votes.ts). Progressive: the page already holds
// the first rows; this script loads the packed roll call file once, then filters, sorts and pages
// in the browser with the same functions the build and the unit tests use. "Positions" opens, in
// place under a row, the members' recorded positions from that chamber's monthly file. Text always
// goes in as text nodes (scripts/dom.ts). Nothing is sent anywhere and nothing is stored.
import { h } from "./dom";
import { formatDate as fmtDate } from "../lib/format";
import {
  unpackVotes, screen, summaryLine, viewCsv, viewCsvName, parseHash, toHash, isViewHash, isDefaultFilter, firstDir, monthFilePath, monthOf, groupPositions, positionIn,
  NO_FILTER, DEFAULT_VIEW, DEFAULT_PER, VOTES_DATA, POSITION_LABEL, CHAMBER_LABEL, rollLabel, rollTitle,
  type VotesData, type Roll, type VoteView, type VoteFilter, type SortKey, type MonthFile, type Position,
} from "../lib/votes";

const root = document.querySelector<HTMLElement>("[data-votes-hub]");
if (root) void start(root);

const nf = (n: number | null): string => (n == null ? "—" : n.toLocaleString("en-US"));

async function start(root: HTMLElement): Promise<void> {
  const ctl = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-vt="${name}"]`);
  const sel = (name: string) => ctl<HTMLSelectElement>(name);
  const q = ctl<HTMLInputElement>("q"), tbody = ctl<HTMLTableSectionElement>("rows"), count = ctl<HTMLElement>("count"), empty = ctl<HTMLElement>("empty"),
    reset = ctl<HTMLButtonElement>("reset"), prev = ctl<HTMLButtonElement>("prev"), next = ctl<HTMLButtonElement>("next"), pins = ctl<HTMLElement>("pins"),
    pageinfo = ctl<HTMLElement>("pageinfo"), pager = ctl<HTMLElement>("pager"), per = sel("per"), download = ctl<HTMLButtonElement>("download"), posHead = ctl<HTMLElement>("poshead");
  const heads = Array.from(root.querySelectorAll<HTMLTableCellElement>("th[data-sort]"));
  if (!tbody) return;

  let data: VotesData;
  root.dataset.loading = "";
  try {
    const res = await fetch(root.dataset.src ?? VOTES_DATA);
    if (!res.ok) throw new Error(String(res.status));
    data = (await res.json()) as VotesData;
  } catch {
    delete root.dataset.loading;
    root.dataset.ready = "failed";
    if (count) count.textContent = `${count.textContent ?? ""} The filters could not be loaded; reload the page to try again.`;
    return;
  }
  delete root.dataset.loading;
  const all = unpackVotes(data);
  const names = new Map(data.members.map(([slug, name]) => [slug, name]));
  let view: VoteView = { ...DEFAULT_VIEW };

  // Monthly position files, fetched when a row is opened or a member is pinned.
  const months = new Map<string, Promise<MonthFile | null>>();
  const getMonth = (r: Roll): Promise<MonthFile | null> => {
    const key = `${r.chamber}-${monthOf(r.date)}`;
    let p = months.get(key);
    if (!p) {
      p = fetch(monthFilePath(r.chamber, monthOf(r.date))).then((x) => (x.ok ? (x.json() as Promise<MonthFile>) : null)).catch(() => null);
      months.set(key, p);
    }
    return p;
  };

  const has = (s: HTMLSelectElement | null, v: string) => !!s && Array.from(s.options).some((o) => o.value === v);
  const pick = (s: HTMLSelectElement | null, v: string, fallback = "") => { if (s) s.value = has(s, v) ? v : fallback; };
  const readFilter = (): VoteFilter => ({
    q: q?.value ?? "", chamber: (sel("chamber")?.value === "house" || sel("chamber")?.value === "senate" ? sel("chamber")!.value : "") as VoteFilter["chamber"],
    result: sel("result")?.value ?? "", w: (sel("w")?.value ?? DEFAULT_VIEW.f.w) as VoteFilter["w"], member: view.f.member,
  });
  const writeControls = (v: VoteView): void => {
    const f = v.f;
    if (q) q.value = f.q;
    pick(sel("chamber"), f.chamber); pick(sel("result"), f.result); pick(sel("w"), f.w, DEFAULT_VIEW.f.w);
    pick(per, String(v.per), String(DEFAULT_PER));
  };
  // A member the data does not know (no position on record) is dropped from the view.
  const cleanView = (v: VoteView): VoteView => (v.f.member && !names.has(v.f.member) ? { ...v, f: { ...v.f, member: "" } } : v);

  const cell = (text: string, cls = ""): HTMLTableCellElement => h("td", cls ? { class: cls } : {}, text);
  const rowEls = (r: Roll, pinned: string): HTMLTableRowElement[] => {
    const tr = h("tr", { "data-roll": String(r.id) },
      h("td", { class: "mono" }, fmtDate(r.date)),
      cell(CHAMBER_LABEL[r.chamber]),
      h("td", {}, r.url ? h("a", { href: r.url, rel: "noopener nofollow", target: "_blank", title: rollTitle(r) }, `${r.roll} ↗`) : h("span", { title: rollTitle(r) }, String(r.roll))),
      cell(r.bill ?? "—"), h("td", { class: "wrap vt-q" }, r.question ?? "—"), h("td", { class: "wrap" }, r.result ?? "—"),
      cell(nf(r.yeas), "num"), cell(nf(r.nays), "num"), cell(nf(r.present), "num"), cell(nf(r.notVoting), "num"),
      ...(pinned ? [h("td", { "data-vt": "pos" }, "…")] : []),
      h("td", {}, h("button", { type: "button", class: "chip vt-open", "aria-expanded": "false", "data-vt": "open", "aria-label": `Show positions on ${rollLabel(r)}, ${fmtDate(r.date)}` }, "Positions")),
    );
    return [tr];
  };

  const fillPins = (v: VoteView): void => {
    if (!pins) return;
    pins.replaceChildren();
    if (v.f.member) {
      pins.append(h("span", { class: "vt-pin" }, `Positions of ${names.get(v.f.member) ?? v.f.member} `,
        h("button", { type: "button", class: "linklike", "data-vt": "unpin", "aria-label": "Remove the member filter" }, "Remove")));
    }
    pins.hidden = !v.f.member;
  };

  const openDetail = async (tr: HTMLTableRowElement, r: Roll, btn: HTMLButtonElement, colspan: number): Promise<void> => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("vt-detail")) { next.remove(); btn.setAttribute("aria-expanded", "false"); return; }
    btn.setAttribute("aria-expanded", "true");
    // The cell spans the whole table; the inner box stays as wide as the screen and follows sideways scrolling.
    const inner = h("div", { class: "vt-detail-in" }, h("p", { class: "soft" }, "Loading positions…"));
    const detail = h("tr", { class: "vt-detail", "data-detail": String(r.id) }, h("td", { colspan: String(colspan) }, inner));
    const box = inner;
    tr.after(detail);
    const file = await getMonth(r);
    const s = file?.rolls[String(r.id)];
    if (!file || s == null) { box.replaceChildren(h("p", { class: "soft" }, file ? "No positions are on record for this roll call." : "Positions could not be loaded; reload the page to try again.")); return; }
    const groups = groupPositions(file, r.id);
    box.replaceChildren(...groups.map((g) => h("div", { class: "vt-group", "data-position": g.position },
      h("h3", {}, `${POSITION_LABEL[g.position]} (${g.count.toLocaleString("en-US")})`),
      g.count === 0 ? h("p", { class: "soft" }, "None.") : h("div", {}, ...g.parties.map((p) => h("p", { class: "vt-party" },
        h("strong", {}, `${p.party} (${p.members.length}): `),
        ...p.members.flatMap((m, i) => [i ? ", " : "", m[4] ? h("a", { href: `/congress/${m[4]}/` }, m[1]) : m[1]]),
      ))),
    )));
  };

  const render = (updateHash: boolean): void => {
    view = cleanView(view);
    const res = screen(all, view, data.built);
    view = { ...view, page: res.page };
    const pinned = view.f.member;
    const cols = 11 + (pinned ? 1 : 0);
    tbody.replaceChildren(...res.rows.flatMap((r) => rowEls(r, pinned)));
    if (posHead) posHead.hidden = !pinned;
    fillPins(view);
    for (const btn of Array.from(tbody.querySelectorAll<HTMLButtonElement>('[data-vt="open"]'))) {
      const tr = btn.closest("tr") as HTMLTableRowElement; const r = all.find((x) => String(x.id) === tr.dataset.roll)!;
      btn.addEventListener("click", () => void openDetail(tr, r, btn, cols));
    }
    if (pinned) {
      for (const tr of Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-roll]"))) {
        const r = all.find((x) => String(x.id) === tr.dataset.roll)!;
        const td = tr.querySelector<HTMLElement>('[data-vt="pos"]');
        void getMonth(r).then((f) => {
          if (!td) return;
          const p: Position | null = f ? positionIn(f, r.id, pinned) : null;
          td.textContent = p ? POSITION_LABEL[p] : "No record";
          td.dataset.position = p ?? "none";
        });
      }
    }
    if (count) count.textContent = summaryLine(res);
    if (empty) empty.hidden = res.total > 0;
    if (pager) pager.hidden = res.total === 0;
    if (reset) reset.hidden = isDefaultFilter(view.f);
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
    root.dataset.member = pinned;
    root.dataset.ready = "1";
    if (updateHash) history.replaceState(null, "", toHash(view) || location.pathname + location.search);
  };

  const filterChanged = (): void => { view = { ...view, f: readFilter(), page: 1 }; render(true); };
  root.querySelectorAll<HTMLSelectElement>(".vt-controls select").forEach((s) => s.addEventListener("change", filterChanged));
  q?.addEventListener("input", filterChanged);
  per?.addEventListener("change", () => { view = { ...view, per: Number(per.value) || DEFAULT_PER, page: 1 }; render(true); });
  prev?.addEventListener("click", () => { view = { ...view, page: view.page - 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  next?.addEventListener("click", () => { view = { ...view, page: view.page + 1 }; render(true); root.scrollIntoView({ block: "start" }); });
  for (const th of heads) th.querySelector("button")?.addEventListener("click", () => {
    const k = th.dataset.sort as SortKey;
    if (view.sort !== k) view = { ...view, sort: k, dir: firstDir(k), page: 1 };
    else if (view.dir === firstDir(k)) view = { ...view, dir: view.dir === "asc" ? "desc" : "asc", page: 1 };
    else view = { ...view, sort: DEFAULT_VIEW.sort, dir: DEFAULT_VIEW.dir, page: 1 };
    render(true);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-vt="reset"], [data-vt="reset2"]').forEach((b) => b.addEventListener("click", () => {
    view = { ...view, f: { ...NO_FILTER }, page: 1 }; writeControls(view); render(true);
  }));
  pins?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest('[data-vt="unpin"]')) { view = { ...view, f: { ...view.f, member: "" }, page: 1 }; render(true); }
  });
  download?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([viewCsv(all, view, data.built)], { type: "text/csv;charset=utf-8" }));
    const a = h("a", { href: url, download: viewCsvName(view, data.built) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  window.addEventListener("hashchange", () => {
    if (location.hash.length > 1 && !isViewHash(location.hash)) return;
    view = cleanView(parseHash(location.hash)); writeControls(view); view = { ...view, f: { ...readFilter(), member: view.f.member } }; render(false);
  });

  if (isViewHash(location.hash)) view = cleanView(parseHash(location.hash));
  writeControls(view);
  view = { ...view, f: { ...readFilter(), q: view.f.q, member: view.f.member } };
  render(false);
}
