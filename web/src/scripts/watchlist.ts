// /watchlist/ and /watchlist/shared/ (2026-10-10, item 4). Both pages are static shells; this
// script fills them from the account API. Everything is built with DOM methods and textContent,
// never innerHTML, because names and labels come from filings and from visitors.

import { api, loadMe, signInUrl, toast, type Me } from "./account";
import { KIND_LABEL, feedAmount, feedVerb, itemPath, type FeedRow, type Kind } from "../lib/account";

type Kids = (Node | string | null | undefined | false)[];
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Kids): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v); else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(typeof k === "string" ? document.createTextNode(k) : k);
  return el;
}
const fmtDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const stockPath = (t: string): string => `/stocks/${encodeURIComponent(t.toLowerCase())}/`;

/** One trade as a table row: disclosed, who, what, stock, size, source. */
function tradeRow(r: FeedRow, showNew: boolean): HTMLTableRowElement {
  return h("tr", { class: showNew && r.is_new ? "is-new" : undefined },
    h("td", {}, fmtDate(r.disclosed_at), showNew && r.is_new ? h("span", { class: "tag tag-new" }, "New") : null),
    h("td", {}, r.person_name ? (r.person_slug ? h("a", { href: r.source.startsWith("sec") ? `/insiders/${r.person_slug}/` : `/congress/${r.person_slug}/` }, r.person_name) : r.person_name) : "—"),
    h("td", {}, feedVerb(r)),
    h("td", {}, r.ticker ? h("a", { class: "mono", href: stockPath(r.ticker) }, r.ticker.toUpperCase()) : r.security_name ?? "—"),
    h("td", { class: "num" }, feedAmount(r)),
    h("td", {}, r.source_url ? h("a", { href: r.source_url, rel: "noopener nofollow" }, "Filing") : ""),
  );
}
function tradeTable(rows: FeedRow[], showNew: boolean, caption: string): HTMLElement {
  return h("div", { class: "tablewrap" },
    h("table", { class: "data" },
      h("caption", { class: "sr-only" }, caption),
      h("thead", {}, h("tr", {}, ...["Disclosed", "Who", "What", "Stock", "Size as filed", "Source"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, ...rows.map((r) => tradeRow(r, showNew)))));
}

function itemLink(i: { kind: Kind; key: string; label: string | null }): HTMLElement {
  return h("a", { href: itemPath(i.kind, i.key) }, i.label || (i.kind === "stock" ? i.key.toUpperCase() : i.key));
}

// ── /watchlist/ ─────────────────────────────────────────────────────────────────────────────
async function ownPage(root: HTMLElement): Promise<void> {
  const me = await loadMe(true);
  const out = root.querySelector<HTMLElement>("[data-wl-body]")!;
  const signedOut = root.querySelector<HTMLElement>("[data-wl-signed-out]")!;
  const err = new URLSearchParams(location.search).get("signin");
  if (err) {
    const msg = err === "cancelled" ? "Sign-in was cancelled." : err === "expired" ? "That sign-in link expired. Please try again." : "Sign-in did not complete. Please try again.";
    root.querySelector("[data-wl-msg]")?.append(h("p", { class: "note", role: "alert" }, msg));
  }
  if (!me.available) { signedOut.hidden = false; signedOut.querySelector("[data-wl-off]")?.removeAttribute("hidden"); return; }
  if (!me.signedIn) {
    signedOut.hidden = false;
    signedOut.querySelector<HTMLAnchorElement>("[data-wl-signin]")!.href = signInUrl("/watchlist/");
    return;
  }
  out.hidden = false;
  await render(out, me);
}

async function render(out: HTMLElement, me: Me): Promise<void> {
  out.replaceChildren(h("p", { class: "note" }, "Loading…"));
  const feed = await api<{ rows: FeedRow[] }>("feed").then((r) => r.rows).catch(() => [] as FeedRow[]);
  const lists = me.lists ?? [];
  const total = lists.reduce((n, l) => n + l.items.length, 0);
  const fresh = feed.filter((r) => r.is_new);
  const older = feed.filter((r) => !r.is_new);

  const head = h("div", { class: "wl-head" },
    h("p", { class: "soft" }, `Signed in${me.email ? ` as ${me.email}` : ""}. Following ${total} ${total === 1 ? "page" : "pages"} in ${lists.length} ${lists.length === 1 ? "list" : "lists"}.`));

  const feedSec = h("section", { "aria-labelledby": "wl-new" },
    h("h2", { id: "wl-new" }, fresh.length ? `New since your last visit (${fresh.length})` : "New since your last visit"),
    fresh.length ? tradeTable(fresh, true, "New trades") : h("p", { class: "empty-reason" }, total ? "Nothing new has been disclosed by what you follow since your last visit." : "Follow a member, insider, stock or company with the Follow button on its page, and new trades will show here."),
    older.length ? h("details", { class: "wl-older" }, h("summary", {}, `Earlier trades in the last 12 months (${older.length})`), tradeTable(older, false, "Earlier trades")) : null);

  const listSecs = lists.map((l) => listSection(l, lists, out));
  const newList = h("form", { class: "wl-new-list" },
    h("label", { for: "wl-new-name" }, "New list"),
    h("input", { id: "wl-new-name", name: "name", maxlength: "80", placeholder: "e.g. Banks, my state's delegation", required: true }),
    h("button", { type: "submit", class: "btn" }, "Create"));
  newList.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = (newList.querySelector("input") as HTMLInputElement).value.trim();
    if (!name) return;
    try { await api("list", { name }); await refresh(out); toast(`Created "${name}".`); } catch (x) { toast((x as Error).message); }
  });

  const acct = h("section", { "aria-labelledby": "wl-acct", class: "wl-acct" },
    h("h2", { id: "wl-acct" }, "Your account"),
    h("p", {}, "Your account holds your email address, your lists and when you last opened this page. ", h("a", { href: "/privacy/#accounts" }, "What we keep and why"), "."),
    h("div", { class: "wl-actions" }, signOutForm(), deleteButton()));

  out.replaceChildren(head, feedSec, h("h2", { id: "wl-lists" }, "Your lists"), ...listSecs, newList, acct);
  if (fresh.length || (me.new_count ?? 0) > 0) {
    api("seen", {}).then(() => { const b = document.querySelector<HTMLElement>("#acctBtn .acct-badge"); if (b) b.hidden = true; }).catch(() => {});
  }
}

async function refresh(out: HTMLElement): Promise<void> { await render(out, await loadMe(true)); }

function listSection(l: NonNullable<Me["lists"]>[number], all: NonNullable<Me["lists"]>, out: HTMLElement): HTMLElement {
  const shareUrl = l.share_slug ? `${location.origin}/watchlist/shared/#${l.share_slug}` : "";
  const rows = l.items.map((i) => {
    const move = all.length > 1 ? h("select", { "aria-label": `Move ${i.label ?? i.key} to another list` },
      h("option", { value: "" }, "Move to…"), ...all.filter((o) => o.id !== l.id).map((o) => h("option", { value: o.id }, o.name))) : null;
    move?.addEventListener("change", async () => {
      const to = (move as HTMLSelectElement).value; if (!to) return;
      try { await api("move", { kind: i.kind, key: i.key, from: l.id, to }); await refresh(out); } catch (x) { toast((x as Error).message); }
    });
    const rm = h("button", { type: "button", class: "btn-quiet" }, "Remove");
    rm.addEventListener("click", async () => {
      try { await api("follow", { kind: i.kind, key: i.key, on: false, list: l.id }); await refresh(out); } catch (x) { toast((x as Error).message); }
    });
    return h("li", {}, h("span", { class: "wl-kind" }, KIND_LABEL[i.kind]), itemLink(i), h("span", { class: "wl-item-actions" }, move, rm));
  });

  const rename = h("button", { type: "button", class: "btn-quiet" }, "Rename");
  rename.addEventListener("click", async () => {
    const name = prompt("New name for this list", l.name)?.trim();
    if (!name || name === l.name) return;
    try { await api("list", { id: l.id, name }); await refresh(out); } catch (x) { toast((x as Error).message); }
  });
  const share = h("button", { type: "button", class: "btn-quiet", "aria-pressed": String(l.is_public) }, l.is_public ? "Stop sharing" : "Share with a link");
  share.addEventListener("click", async () => {
    try { await api("list", { id: l.id, public: !l.is_public }); await refresh(out); toast(l.is_public ? "Sharing stopped. The old link no longer works." : "Anyone with the link can now see this list."); } catch (x) { toast((x as Error).message); }
  });
  const del = l.is_default ? null : h("button", { type: "button", class: "btn-quiet danger" }, "Delete list");
  del?.addEventListener("click", async () => {
    if (!confirm(`Delete "${l.name}"? This cannot be undone.`)) return;
    try { await api("list", { id: l.id, delete: true }); await refresh(out); } catch (x) { toast((x as Error).message); }
  });
  const link = shareUrl ? h("div", { class: "share-link wl-share" },
    h("input", { type: "text", readonly: true, value: shareUrl, "aria-label": `Link to ${l.name}` }),
    (() => { const c = h("button", { type: "button", class: "btn" }, "Copy link"); c.addEventListener("click", () => { navigator.clipboard?.writeText(shareUrl).then(() => toast("Link copied."), () => toast(shareUrl)); }); return c; })()) : null;

  return h("section", { class: "card wl-list", "aria-label": l.name },
    h("div", { class: "wl-list-head" }, h("h3", {}, l.name, l.is_public ? h("span", { class: "tag" }, "Shared") : null), h("span", { class: "wl-item-actions" }, rename, share, del)),
    link,
    rows.length ? h("ul", { class: "wl-items" }, ...rows) : h("p", { class: "empty-reason" }, "Nothing here yet."));
}

function signOutForm(): HTMLElement {
  const f = h("form", { method: "post", action: "/auth/logout" }, h("button", { type: "submit", class: "btn" }, "Sign out"));
  return f;
}
function deleteButton(): HTMLElement {
  const b = h("button", { type: "button", class: "btn-quiet danger" }, "Delete my account");
  b.addEventListener("click", async () => {
    if (!confirm("Delete your account, all your lists and your sign-in? This cannot be undone.")) return;
    try { await api("delete-account", {}); location.href = "/?account=deleted"; } catch (x) { toast((x as Error).message); }
  });
  return b;
}

// ── /watchlist/shared/#<slug> ───────────────────────────────────────────────────────────────
async function sharedPage(root: HTMLElement): Promise<void> {
  const out = root.querySelector<HTMLElement>("[data-wl-shared]")!;
  const slug = location.hash.slice(1);
  if (!/^[a-z0-9]{12}$/.test(slug)) { out.replaceChildren(h("p", { class: "empty-reason" }, "This link is incomplete. Ask whoever shared it to copy it again.")); return; }
  let list: { name: string; updated_at: string; items: { kind: Kind; key: string; label: string | null }[]; recent: FeedRow[] };
  try { list = await api("public?slug=" + slug); } catch (x) { out.replaceChildren(h("p", { class: "empty-reason" }, (x as Error).message)); return; }
  document.title = `${list.name} — shared watchlist | Spot the Money`;
  const copy = h("button", { type: "button", class: "btn" }, "Copy to my watchlist");
  copy.addEventListener("click", async () => {
    const me = await loadMe();
    if (!me.signedIn) { location.href = signInUrl(`/watchlist/shared/#${slug}`); return; }
    try { await api("copy", { slug }); toast(`Copied. It's on your watchlist as "Copy of ${list.name}".`); } catch (x) { toast((x as Error).message); }
  });
  out.replaceChildren(
    h("h2", {}, list.name),
    h("p", { class: "soft" }, `${list.items.length} ${list.items.length === 1 ? "page" : "pages"} followed. Shared by a Spot the Money visitor; the list shows what they chose to follow, not advice.`),
    h("div", { class: "wl-actions" }, copy),
    h("ul", { class: "wl-items" }, ...list.items.map((i) => h("li", {}, h("span", { class: "wl-kind" }, KIND_LABEL[i.kind]), itemLink(i)))),
    h("h2", {}, "Trades disclosed in the last 90 days"),
    list.recent.length ? tradeTable(list.recent, false, "Recent trades") : h("p", { class: "empty-reason" }, "None of these has a trade disclosed in the last 90 days."));
}

const own = document.querySelector<HTMLElement>("[data-watchlist]");
if (own) void ownPage(own);
const shared = document.querySelector<HTMLElement>("[data-watchlist-shared]");
if (shared) { void sharedPage(shared); window.addEventListener("hashchange", () => void sharedPage(shared)); }
