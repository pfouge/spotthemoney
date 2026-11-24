// Home page behaviour that is not the trade map or the notable feed: the map's pane switch (three map instances, one switch
// copy in each), the phone's "All datasets" button and each leaderboard's "Show all".
const links: Record<string, [string, string]> = {
  all: ["/congress/", "Congress: late filers, most active members, filings as they arrive →"],
  congress: ["/congress/", "Full Congress page: late filers, most active members, filings as they arrive →"],
  insiders: ["/insiders/", "Full Insiders page: cluster buys, CEO purchases, officer sales →"],
};

function initPanes(): void {
  const more = document.getElementById("hmMore") as HTMLAnchorElement | null;
  document.querySelectorAll<HTMLButtonElement>(".hm-panesw button[data-pane]").forEach((b) => b.addEventListener("click", () => {
    const pane = b.dataset.pane!;
    document.querySelectorAll<HTMLButtonElement>(".hm-panesw button[data-pane]").forEach((x) => { const on = x.dataset.pane === pane; x.classList.toggle("on", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
    document.querySelectorAll<HTMLElement>(".hm-pane").forEach((p) => { p.hidden = p.dataset.pane !== pane; });
    if (more) { more.href = links[pane]![0]; more.textContent = links[pane]![1]; }
    window.dispatchEvent(new Event("resize"));
    document.querySelector<HTMLButtonElement>(`.hm-pane[data-pane="${pane}"] .hm-panesw button.on`)?.focus({ preventScroll: true });
  }));
}

function initTiles(): void {
  const btn = document.querySelector<HTMLButtonElement>("[data-ht-more]");
  const nav = document.getElementById("htTiles");
  if (!btn || !nav) return;
  btn.addEventListener("click", () => {
    const open = nav.toggleAttribute("data-open");
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "Fewer datasets" : "All datasets";
  });
}

function initBoards(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-lb-more]").forEach((b) => b.addEventListener("click", () => {
    const panel = b.closest<HTMLElement>("[data-panel]")!;
    const all = panel.querySelector<HTMLElement>("[data-lb-all]")!, top = panel.querySelector<HTMLElement>(".lb-top")!;
    const open = all.hidden;
    all.hidden = !open; top.hidden = open;
    b.setAttribute("aria-expanded", String(open));
    b.textContent = open ? "Show fewer" : "Show all";
  }));
}

initPanes(); initTiles(); initBoards();
