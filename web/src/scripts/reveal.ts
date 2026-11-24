// One way to bring a target on screen, shared by every page (redesign, task F).
// A target can sit inside three kinds of closed container: a hidden group of an entity page's tab set
// (GroupBar + PageGroup), a closed <details>, and a previewed table whose row is hidden (tablecap.ts).
// revealId() opens all three around the element, innermost last, and scrolls to it. It runs for the URL
// hash on DOMContentLoaded (every module script has run by then, so the table openers are registered and
// remembered state is restored first: the address wins), on `load`, on `hashchange`, and when an in-page
// link to the hash already in the address is clicked again (no hashchange fires then).
// Also here: the group tab set itself. Without JavaScript nothing below runs and every group shows stacked.
import { readUi, updateUi } from "./uistate";

type Opener = (el: HTMLElement) => boolean;
const openers: Opener[] = [];
/** A component that hides content (preview tables) registers how to open around an element. */
export function registerOpener(fn: Opener): void { openers.push(fn); }

// ---- group tabs ----------------------------------------------------------------------------------------------
const ALL = "all";
let tabsReady = false;
let showGroup: (id: string, remember: boolean) => void = () => {};

/** Page type for the remembered tab: the first path segment (stocks, companies, congress, insiders). */
const pageType = (): string => location.pathname.split("/").filter(Boolean)[0] ?? "";

function initTabs(): void {
  const bar = document.querySelector<HTMLElement>("nav.groupbar[data-groupbar]");
  const groups = [...document.querySelectorAll<HTMLElement>(".pgroup[data-pgroup][id]")];
  if (!bar || groups.length < 2) return;
  const links = [...bar.querySelectorAll<HTMLAnchorElement>("a[href^='#']")];
  const allBtn = bar.querySelector<HTMLButtonElement>("[data-gtab-all]");
  const tabs: HTMLElement[] = [...links, ...(allBtn ? [allBtn] : [])];
  const idOf = (t: HTMLElement): string => (t === allBtn ? ALL : t.getAttribute("href")!.slice(1));
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-orientation", "horizontal");
  bar.dataset.tabs = "1";
  document.documentElement.classList.add("gtabs");
  tabs.forEach((t, i) => {
    t.setAttribute("role", "tab");
    if (!t.id) t.id = `gtab-${idOf(t)}`;
    t.removeAttribute("aria-current");
    if (t === allBtn) { t.hidden = false; t.setAttribute("aria-controls", groups.map((g) => g.id).join(" ")); }
    else t.setAttribute("aria-controls", idOf(t));
    t.addEventListener("click", (e) => {
      e.preventDefault();
      showGroup(idOf(t), true);
      keepBarInView();
    });
    t.addEventListener("keydown", (e) => {
      let n = -1;
      if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = tabs.length - 1;
      if (n < 0) return;
      e.preventDefault();
      tabs[n]!.focus();
      showGroup(idOf(tabs[n]!), true);
    });
  });
  for (const g of groups) {
    g.setAttribute("role", "tabpanel");
    g.removeAttribute("aria-label");
    const t = links.find((l) => idOf(l) === g.id);
    if (t) g.setAttribute("aria-labelledby", t.id);
  }
  showGroup = (id: string, remember: boolean): void => {
    const all = id === ALL || !groups.some((g) => g.id === id);
    const pick = all ? ALL : id;
    document.documentElement.classList.toggle("gtabs-all", all);
    for (const g of groups) {
      const on = all || g.id === pick;
      g.hidden = !on;
      // A shown panel is reachable with Tab only through its content; the panel itself takes focus in tab mode.
      if (!all && on) g.tabIndex = 0; else g.removeAttribute("tabindex");
    }
    for (const t of tabs) {
      const on = idOf(t) === pick;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle("on", on);
    }
    const cur = tabs.find((t) => idOf(t) === pick);
    if (cur && bar.scrollWidth > bar.clientWidth) { const x = cur.offsetLeft - 16; if (x < bar.scrollLeft || x + cur.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: Math.max(0, x) }); }
    if (remember) updateUi((u) => { (u.tabs ??= {})[pageType()] = pick; });
    // Charts and maps that measure their box redraw when they become visible.
    window.dispatchEvent(new Event("resize"));
  };
  // When the visitor has scrolled past the top of the groups, bring the start of the chosen group under the bar.
  const keepBarInView = (): void => {
    const first = groups[0]!;
    const stick = (document.getElementById("siteHeader")?.offsetHeight ?? 49) + bar.offsetHeight;
    const top = first.getBoundingClientRect().top;
    if (top < stick) window.scrollTo({ top: window.scrollY + top - stick - 8 });
  };
  const remembered = readUi().tabs?.[pageType()];
  const start = remembered && (remembered === ALL || groups.some((g) => g.id === remembered)) ? remembered : groups[0]!.id;
  tabsReady = true;
  showGroup(start, false);
}

// ---- reveal ---------------------------------------------------------------------------------------------------
/** Open every container around the element with this id and scroll to it. Returns false when there is no such element. */
export function revealId(id: string, scroll: boolean): boolean {
  if (!id) return false;
  const el = document.getElementById(id);
  if (!el) return false;
  let changed = false;
  // 1. the group: the target is a group itself, or sits inside a hidden one
  if (tabsReady) {
    const g = el.matches(".pgroup[data-pgroup]") ? el : el.closest<HTMLElement>(".pgroup[data-pgroup]");
    if (g && (g.hidden || g === el)) {
      const allShown = document.querySelector("nav.groupbar [data-gtab-all][aria-selected='true']");
      if (g.hidden || !allShown) { if (g.hidden) changed = true; showGroup(g.id, true); }
    }
  }
  // 2. closed disclosures around it, outermost first
  const chain: HTMLDetailsElement[] = [];
  for (let p = el.closest("details"); p; p = p.parentElement?.closest("details") ?? null) chain.unshift(p);
  for (const d of chain) if (!d.open) { d.open = true; changed = true; }
  // 3. a previewed table whose row is hidden
  for (const fn of openers) if (fn(el)) changed = true;
  if (changed || scroll) {
    const inTable = !!el.closest("tr");
    el.scrollIntoView({ block: inTable ? "center" : "start" });
  }
  return true;
}

const hashId = (): string => {
  let id = location.hash.slice(1);
  try { id = decodeURIComponent(id); } catch { /* keep as is */ }
  return id;
};

function onReady(): void {
  initTabs();
  revealId(hashId(), false);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady); else queueMicrotask(onReady);
addEventListener("load", () => revealId(hashId(), true));
addEventListener("hashchange", () => { revealId(hashId(), true); requestAnimationFrame(() => revealId(hashId(), false)); });
// A link to the hash already in the address fires no hashchange: reveal on the click instead.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href^='#']");
  if (!a || a.getAttribute("role") === "tab") return;
  const id = a.hash.slice(1);
  if (!id || a.hash !== location.hash) return;
  let dec = id; try { dec = decodeURIComponent(id); } catch { /* keep */ }
  if (revealId(dec, true)) e.preventDefault();
});
