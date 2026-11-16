// Member directory filters (pages/congress-members.astro, lib/directory.ts). Progressive: without
// this script the controls are hidden and the whole table is shown. Rows are hidden, never
// removed, so column sorting (scripts/tablesort.ts) keeps working on the same rows.
import { matches, parseHash, toHash, isDefault, NO_FILTER, type DirFilter, type DirKey } from "../lib/directory";

const root = document.querySelector<HTMLElement>("[data-directory]");
if (root) {
  const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  const keys: DirKey[] = rows.map((tr) => ({
    name: tr.dataset.name ?? "", chamber: tr.dataset.ch ?? "", party: tr.dataset.party ?? "", state: tr.dataset.st ?? "",
    committees: (tr.dataset.c ?? "").split(" ").filter(Boolean), trades: Number(tr.dataset.n ?? 0), latest: tr.dataset.latest || null,
  }));
  const ctl = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-dir="${name}"]`);
  const q = ctl<HTMLInputElement>("q"), chamber = ctl<HTMLSelectElement>("chamber"), party = ctl<HTMLSelectElement>("party"),
    state = ctl<HTMLSelectElement>("state"), committee = ctl<HTMLSelectElement>("committee"), activity = ctl<HTMLSelectElement>("activity"),
    reset = ctl<HTMLButtonElement>("reset"), count = ctl<HTMLElement>("count"), empty = ctl<HTMLElement>("empty");
  const today = new Date().toISOString().slice(0, 10);
  const has = (sel: HTMLSelectElement | null, v: string) => !!sel && Array.from(sel.options).some((o) => o.value === v);

  const read = (): DirFilter => ({
    q: q?.value ?? "", chamber: (chamber?.value ?? "") as DirFilter["chamber"], party: (party?.value ?? "") as DirFilter["party"],
    state: state?.value ?? "", committee: committee?.value ?? "", activity: (activity?.value ?? "any") as DirFilter["activity"],
  });
  const write = (f: DirFilter): void => {
    if (q) q.value = f.q;
    if (chamber) chamber.value = f.chamber;
    if (party) party.value = has(party, f.party) ? f.party : "";
    if (state) state.value = has(state, f.state) ? f.state : "";
    if (committee) committee.value = has(committee, f.committee) ? f.committee : "";
    if (activity) activity.value = f.activity;
  };
  const apply = (updateHash: boolean): void => {
    const f = read();
    let shown = 0;
    rows.forEach((tr, i) => { const ok = matches(keys[i], f, today); tr.hidden = !ok; if (ok) shown++; });
    if (count) count.textContent = shown === rows.length
      ? `Showing all ${rows.length.toLocaleString("en-US")} members`
      : `Showing ${shown.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} members`;
    if (empty) empty.hidden = shown > 0;
    if (reset) reset.hidden = isDefault(f);
    root.dataset.shown = String(shown);
    if (updateHash) history.replaceState(null, "", toHash(f) || location.pathname + location.search);
  };

  for (const el of [chamber, party, state, committee, activity]) el?.addEventListener("change", () => apply(true));
  q?.addEventListener("input", () => apply(true));
  root.querySelectorAll<HTMLButtonElement>('[data-dir="reset"], [data-dir="reset2"]').forEach((b) => b.addEventListener("click", () => { write(NO_FILTER); apply(true); }));
  // A hash with no "=" is a jump link (the skip link, a heading), not a saved view: leave the filters alone.
  window.addEventListener("hashchange", () => { if (location.hash.length > 1 && !location.hash.includes("=")) return; write(parseHash(location.hash)); apply(false); });

  write(parseHash(location.hash));
  apply(false);
}
