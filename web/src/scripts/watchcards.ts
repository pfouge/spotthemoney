// Watchlist cards in the browser (lib/watchcards.ts has the data shapes). A followed stock or
// company shows TradingView's mini price chart and who traded it in the window; a member or an
// insider shows trades per month, the latest trade, the window's totals and the tickers traded.
import { h, fmtDate } from "./dom";
import { observeMini } from "./tradingview";
import { shardFor, isStockCard, WATCH_WINDOW_DAYS, type Card, type StockCard, type PersonCard, type WatchShard, type WhoInsider, type WhoMember } from "../lib/watchcards";
import type { Kind } from "../lib/account";

type Item = { kind: Kind; key: string; label: string | null };
const shards = new Map<string, Promise<WatchShard | null>>();
function shard(url: string): Promise<WatchShard | null> {
  let p = shards.get(url);
  if (!p) {
    p = fetch(url, { headers: { Accept: "application/json" } }).then((r) => (r.ok ? (r.json() as Promise<WatchShard>) : null)).catch(() => null);
    shards.set(url, p);
  }
  return p;
}

export interface Cards { get(i: Item): Card | undefined; built: string | null; window: number }
/** Fetch the shards these items fall in (each file once per page) and index their cards. */
export async function loadCards(items: Item[]): Promise<Cards> {
  const urls = [...new Set(items.map((i) => shardFor(i.kind, i.key)))];
  const got = await Promise.all(urls.map(shard));
  const byUrl = new Map(urls.map((u, n) => [u, got[n]]));
  const built = got.find((s) => s)?.built ?? null;
  return { built, window: got.find((s) => s)?.window ?? WATCH_WINDOW_DAYS, get: (i) => byUrl.get(shardFor(i.kind, i.key))?.cards[i.key] };
}

const money = (v: number): string => {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`;
};
const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString("en-US")} ${x === 1 ? one : many}`;
const link = (path: string | null, text: string, cls?: string) => (path ? h("a", { href: path, class: cls }, text) : h("span", { class: cls }, text));

function insiderLine(r: WhoInsider): HTMLElement {
  const parts = [r.buys ? `Bought ${money(r.bought)}` : "", r.sells ? `Sold ${money(r.sold)}` : ""].filter(Boolean);
  const what = parts.length ? parts.join(" · ") : n(r.rows, "other row");
  return h("li", {}, h("span", { class: "wl-who-name", title: r.role ? `${r.name} · ${r.role}` : r.name }, link(r.path, r.name), r.role ? h("span", { class: "wl-who-role" }, ` · ${r.role}`) : null),
    h("span", { class: "wl-who-fig" }, what, r.last ? ` · ${fmtDate(r.last, false)}` : ""));
}
function memberLine(r: WhoMember): HTMLElement {
  const sides = [r.buys ? n(r.buys, "buy") : "", r.sells ? n(r.sells, "sale") : ""].filter(Boolean).join(", ") || n(r.trades, "trade");
  const range = r.high ? ` · ${money(r.low)}–${money(r.high)}` : "";
  return h("li", {}, h("span", { class: "wl-who-name", title: `${r.name} · ${r.seat}` }, link(r.path, r.name), h("span", { class: "wl-who-role" }, ` · ${r.seat}`)),
    h("span", { class: "wl-who-fig" }, sides, range, r.last ? ` · ${fmtDate(r.last, false)}` : ""));
}
function whoGroup(title: string, count: number, lines: HTMLElement[], more: string): HTMLElement | null {
  if (!count) return null;
  return h("div", { class: "wl-who-group" },
    h("h4", {}, `${title} (${count})`),
    h("ul", {}, ...lines),
    count > lines.length ? h("p", { class: "wl-who-more" }, h("a", { href: more }, `${count - lines.length} more on the page`)) : null);
}

function stockBody(c: StockCard, days: number): HTMLElement[] {
  const chart = c.chart && c.ticker
    ? h("div", { class: "wl-chart", "data-tv-mini": c.ticker.toUpperCase(), "data-tv-range": "3M", "data-tv-href": c.path, role: "img", "aria-label": `${c.ticker.toUpperCase()} share price over three months, from TradingView` })
    : h("div", { class: "wl-chart wl-chart-none" }, h("p", {}, c.ticker ? "No price chart for this security." : "No ticker on file, so no price chart."));
  if (chart.dataset.tvMini) observeMini(chart);
  const groups = [
    whoGroup("Corporate insiders", c.insiderCount, c.insiders.map(insiderLine), `${c.path}#insiders`),
    whoGroup("Members of Congress", c.memberCount, c.members.map(memberLine), `${c.path}#members`),
  ].filter((g): g is HTMLElement => !!g);
  const who = h("div", { class: "wl-who" },
    h("p", { class: "wl-who-head" }, `Who traded it, last ${days} days`),
    groups.length ? h("div", { class: "wl-who-groups" }, ...groups) : h("p", { class: "empty-reason" }, "No insider or congressional trades disclosed in this window."));
  return [chart, who];
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
const monthName = (k: string, year = false) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-US", year ? { month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", timeZone: "UTC" });

/** Trades per month: buys above the line, sales below. Counts, not dollars, so grants and ranges compare. */
function bars(c: PersonCard): HTMLElement {
  const W = 240, H = 64, mid = H / 2, slot = W / c.months.length, bw = Math.max(4, slot - 6);
  const max = Math.max(1, ...c.months.flatMap(([, b, s]) => [b, s]));
  const buys = c.months.reduce((a, m) => a + m[1], 0), sells = c.months.reduce((a, m) => a + m[2], 0);
  const first = c.months[0]?.[0], last = c.months.at(-1)?.[0];
  const label = first && last ? `Trades disclosed per month, ${monthName(first, true)} to ${monthName(last, true)}: ${n(buys, "buy")}, ${n(sells, "sale")}.` : "Trades per month.";
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "wl-bars", role: "img", "aria-label": label, preserveAspectRatio: "none" });
  s.append(svg("line", { x1: 0, x2: W, y1: mid, y2: mid, class: "wl-bars-axis" }));
  c.months.forEach(([k, b, sl], i) => {
    const x = i * slot + (slot - bw) / 2;
    if (b) { const r = svg("rect", { x, y: mid - (b / max) * (mid - 2), width: bw, height: (b / max) * (mid - 2), class: "wl-bar-buy", rx: 1.5 }); r.append(Object.assign(svg("title", {}), { textContent: `${monthName(k, true)}: ${n(b, "buy")}` })); s.append(r); }
    if (sl) { const r = svg("rect", { x, y: mid, width: bw, height: (sl / max) * (mid - 2), class: "wl-bar-sell", rx: 1.5 }); r.append(Object.assign(svg("title", {}), { textContent: `${monthName(k, true)}: ${n(sl, "sale")}` })); s.append(r); }
  });
  return h("div", { class: "wl-chart wl-chart-bars" },
    s as unknown as HTMLElement,
    h("div", { class: "wl-bars-scale", "aria-hidden": "true" }, h("span", {}, first ? monthName(first) : ""), h("span", { class: "wl-bars-key" }, h("i", { class: "k-buy" }), "buys ", h("i", { class: "k-sell" }), "sales"), h("span", {}, last ? monthName(last) : "")));
}

function personBody(c: PersonCard, days: number): HTMLElement[] {
  const congress = c.low != null;
  const sides = [c.buys ? n(c.buys, "buy") : "", c.sells ? n(c.sells, "sale") : ""].filter(Boolean).join(", ");
  const dollars = congress
    ? (c.high ? `${money(c.low ?? 0)}–${money(c.high)} as filed` : "")
    : [c.buys ? `bought ${money(c.bought)}` : "", c.sells ? `sold ${money(c.sold)}` : ""].filter(Boolean).join(", ");
  const window = c.rows
    ? `${n(c.rows, congress ? "trade" : "row")}${sides ? ` (${sides})` : ""}${dollars ? ` · ${dollars}` : ""}`
    : "Nothing disclosed in this window.";
  const lastLine = c.last
    ? h("p", {}, h("span", { class: "wl-who-head" }, "Latest: "), `${c.last.verb}${c.last.ticker ? " " : ""}`,
        c.last.ticker ? h("a", { class: "mono", href: `/stocks/${encodeURIComponent(c.last.ticker.toLowerCase())}/` }, c.last.ticker) : null,
        c.last.amount && c.last.amount !== "—" ? `, ${c.last.amount}` : "", `, disclosed ${fmtDate(c.last.date)}`)
    : h("p", { class: "empty-reason" }, "No trades on file.");
  const tickers = c.tickers.length
    ? h("p", { class: "wl-chips" }, ...c.tickers.map(([t, k]) => h("a", { class: "wl-tk mono", href: `/stocks/${encodeURIComponent(t.toLowerCase())}/`, title: n(k, congress ? "trade" : "row") }, t)))
    : null;
  return [bars(c), h("div", { class: "wl-who" }, lastLine, h("p", {}, h("span", { class: "wl-who-head" }, `Last ${days} days: `), window), tickers)];
}

/** The widget part of one item's row: [chart, details], or nothing when the page has no card. */
export function cardParts(c: Card | undefined, days: number): HTMLElement[] {
  if (!c) return [];
  return isStockCard(c) ? stockBody(c, days) : personBody(c, days);
}
/** The line under an item's name: a stock's company name, a company's ticker, a person's role or seat. */
export function cardSub(kind: Kind, c: Card | undefined): string | null {
  if (!c) return null;
  if (!isStockCard(c)) return c.role;
  if (kind === "company") return c.ticker ? c.ticker.toUpperCase() : null;
  return c.ticker && c.name.toUpperCase() !== c.ticker.toUpperCase() ? c.name : null;
}
/** One line under "Your lists" saying what the cards cover. */
export function cardsNote(cards: Cards): HTMLElement {
  return h("p", { class: "note wl-cards-note" },
    `Who-traded figures cover trades disclosed in the ${cards.window} days to ${cards.built ? fmtDate(cards.built) : "the last site update"}, from the same filings as each page. Price charts are TradingView's, delayed; this site stores no prices.`);
}
