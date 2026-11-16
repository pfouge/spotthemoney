// RSS feeds of the newest disclosed trades (/feeds/). Pure: the pages pass in the model's rows
// and labels, so a feed item can never say something the site's own tables do not.
//
//   congress-trades    one item per published row of a House or Senate periodic transaction
//                      report, newest disclosure first.
//   insider-trades     one item per Form 4 filing and direction: the filing's open-market
//                      purchases (code P) or its open-market sales (code S), added up. A sale
//                      filled in twelve lots is twelve rows on the form and one item here.
//   insider-purchases  the purchase items of insider-trades only.
//
// Awards, option exercises, gifts, shares withheld for tax, derivative rows and a second filing
// of a trade already on file are not open-market trades and are in no feed (the rules are
// isOpenBuy / isOpenSale in lib/entity.ts). Rows under review are never in a feed.
// Every item links to the filer's page on this site at the row (#t<id>) and names the original
// filing. A feed states what a filing shows, never a reason for a trade.
import type { Txn } from "./flagship-core";
import { tradeSentence } from "./sharetext";

export const FEEDS_PATH = "/feeds/";
export type FeedId = "congress-trades" | "insider-trades" | "insider-purchases";
export interface FeedDef { id: FeedId; path: string; title: string; description: string; pagePath: string; limit: number }
export const FEEDS: FeedDef[] = [
  { id: "congress-trades", path: "/feeds/congress-trades.xml", title: "Spot the Money: Congress stock trades", pagePath: "/congress/", limit: 200,
    description: "The newest trades disclosed by members of Congress in House and Senate periodic transaction reports, one item per reported transaction." },
  { id: "insider-purchases", path: "/feeds/insider-purchases.xml", title: "Spot the Money: Insider open-market purchases", pagePath: "/insiders/", limit: 100,
    description: "The newest open-market purchases reported by corporate insiders on SEC Form 4, one item per filing." },
  { id: "insider-trades", path: "/feeds/insider-trades.xml", title: "Spot the Money: Insider open-market trades", pagePath: "/insiders/", limit: 200,
    description: "The newest open-market purchases and sales reported by corporate insiders on SEC Form 4, one item per filing and direction." },
];
export const feedDef = (id: FeedId): FeedDef => FEEDS.find((f) => f.id === id)!;

export interface FeedItem {
  guid: string;
  title: string;
  /** Site path with the row anchor, e.g. /congress/jane-doe/#t123. */
  link: string;
  /** ISO day the filing became public. */
  date: string;
  description: string;
  categories: string[];
  /** How many transaction rows the item stands for (1 for a congressional row). */
  rows: number;
}

/** What the builder needs to know about a row beyond the row itself; the page supplies it from the model. */
export interface FeedLookup {
  name: (t: Txn) => string | null;
  /** The filer's page, or the stock's when the filer has none; null leaves the row out. */
  path: (t: Txn) => string | null;
  ticker: (t: Txn) => string | null;
  /** The label the trade tables show for the row's amount ("$1K–$15K", "$41.2M"). */
  amount: (t: Txn) => string;
  /** The label for an asset with no ticker ("bond"). */
  asset: (t: Txn) => string;
  /** Link to the original filing. */
  source: (t: Txn) => string | null;
  /** "Rep. D-CA-11", "Chief Financial Officer at Example Corp": shown after the sentence when present. */
  role?: (t: Txn) => string | null;
  late: (t: Txn) => boolean;
  money: (n: number) => string;
  num: (n: number) => string;
}

const day = (iso: string | null | undefined) => (iso ?? "").slice(0, 10);
const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const isForm4 = (t: Txn) => t.source === "sec_form4";
const openBuy = (t: Txn) => isForm4(t) && t.code === "P" && t.side === "buy";
const openSale = (t: Txn) => isForm4(t) && t.code === "S" && t.side === "sell";
/** A row a feed may carry: published, disclosed on a known day that is not in the future. */
const feedable = (t: Txn, today: string) => t.isPublished && /^\d{4}-\d{2}-\d{2}/.test(t.disclosedAt ?? "") && day(t.disclosedAt) <= today;

const sourceName = (t: Txn) => (t.source === "sec_form4" ? "SEC Form 4" : t.source === "house_ptr" ? "House periodic transaction report" : "Senate periodic transaction report");
const tail = (t: Txn, look: FeedLookup, extra: string[] = []): string => {
  const parts = [...extra];
  const role = look.role?.(t);
  if (role) parts.unshift(role + ".");
  if (t.ownerType && t.ownerType !== "self") parts.push(`Owner: ${t.ownerType}.`);
  if (look.late(t)) parts.push("Disclosed after the filing deadline.");
  const src = look.source(t);
  parts.push(src ? `Original filing (${sourceName(t)}): ${src}` : `Source: ${sourceName(t)}.`);
  return parts.join(" ");
};

/** Congress: one item per published report row, newest disclosure first, then newest row id. */
export function congressItems(txns: Txn[], look: FeedLookup, today: string, limit: number): FeedItem[] {
  const rows = txns.filter((t) => !isForm4(t) && feedable(t, today))
    .sort((a, b) => day(b.disclosedAt).localeCompare(day(a.disclosedAt)) || b.id - a.id);
  const out: FeedItem[] = [];
  for (const t of rows) {
    if (out.length >= limit) break;
    const path = look.path(t);
    if (!path) continue;
    const ticker = look.ticker(t);
    const title = tradeSentence({ name: look.name(t), side: t.side, amount: look.amount(t), what: ticker ?? look.asset(t), txnDate: t.txnDate, disclosedAt: day(t.disclosedAt), lagDays: t.lagDays });
    out.push({ guid: `stm-txn-${t.id}`, title, link: `${path}#t${t.id}`, date: day(t.disclosedAt), description: `${title} ${tail(t, look)}`,
      categories: ["Congress", ...(ticker ? [ticker] : [])], rows: 1 });
  }
  return out;
}

/** The sentence for one Form 4 filing's open-market purchases or sales (one row: the share menu's own sentence). */
export function filingSentence(rows: Txn[], look: FeedLookup): string {
  const t = rows[0];
  const ticker = look.ticker(t) ?? look.asset(t);
  if (rows.length === 1) return tradeSentence({ name: look.name(t), side: t.side, amount: look.amount(t), what: ticker, txnDate: t.txnDate, disclosedAt: day(t.disclosedAt), lagDays: t.lagDays });
  const buy = t.side === "buy";
  const priced = rows.every((r) => r.value != null && r.price != null && r.price > 0);
  const shares = rows.reduce((a, r) => a + (r.shares ?? 0), 0);
  const amount = priced ? look.money(rows.reduce((a, r) => a + (r.value ?? 0), 0)) : `${look.num(shares)} shares`;
  const days = [...new Set(rows.map((r) => day(r.txnDate)).filter(Boolean))].sort();
  const when = days.length === 0 ? "" : days.length === 1 ? ` on ${shortDate(days[0])}` : ` between ${shortDate(days[0])} and ${shortDate(days.at(-1)!)}`;
  return `${look.name(t)?.trim() || "A filer"} ${buy ? "bought" : "sold"} ${amount} of ${ticker} in ${look.num(rows.length)} open-market ${buy ? "purchases" : "sales"}${when}; disclosed ${shortDate(day(t.disclosedAt))}.`;
}

/**
 * Insiders: one item per Form 4 filing and direction. Newest disclosure first, then newest filing,
 * purchases before sales. `purchasesOnly` gives the purchases feed.
 */
export function insiderItems(txns: Txn[], look: FeedLookup, today: string, limit: number, purchasesOnly = false): FeedItem[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (!feedable(t, today)) continue;
    const buy = openBuy(t);
    if (!buy && (purchasesOnly || !openSale(t))) continue;
    const k = `${t.filingId}-${buy ? "buy" : "sell"}`;
    const g = groups.get(k);
    if (g) g.push(t); else groups.set(k, [t]);
  }
  const ordered = [...groups.entries()].map(([key, rows]) => ({ key, rows: rows.sort((a, b) => a.id - b.id) }))
    .sort((a, b) => day(b.rows[0].disclosedAt).localeCompare(day(a.rows[0].disclosedAt)) || b.rows[0].filingId - a.rows[0].filingId || (a.rows[0].side === "buy" ? -1 : 1));
  const out: FeedItem[] = [];
  for (const { key, rows } of ordered) {
    if (out.length >= limit) break;
    const t = rows[0];
    const path = look.path(t);
    if (!path) continue;
    const title = filingSentence(rows, look);
    const extra: string[] = [];
    const plan = rows.filter((r) => r.is10b51 === true).length;
    if (plan > 0) extra.push(plan === rows.length ? "Made under a Rule 10b5-1 trading plan, as stated on the form." : `${look.num(plan)} of the ${look.num(rows.length)} transactions were made under a Rule 10b5-1 trading plan, as stated on the form.`);
    const ticker = look.ticker(t);
    out.push({ guid: `stm-form4-${key}`, title, link: `${path}#t${t.id}`, date: day(t.disclosedAt), description: `${title} ${tail(t, look, extra)}`,
      categories: ["Insiders", t.side === "buy" ? "Purchase" : "Sale", ...(ticker ? [ticker] : [])], rows: rows.length });
  }
  return out;
}

// ── RSS 2.0 ────────────────────────────────────────────────────────────────────────────────
// Characters XML 1.0 does not allow are dropped (a name from a filing can carry one).
const clean = (s: string) => s.replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, "");
export const xmlEscape = (s: string) => clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const rfc822 = (isoDay: string) => new Date(`${isoDay}T12:00:00Z`).toUTCString();

export function rssXml(def: FeedDef, items: FeedItem[], site: string, builtDay: string): string {
  const last = items[0]?.date ?? builtDay;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    "  <channel>",
    `    <title>${xmlEscape(def.title)}</title>`,
    `    <link>${site}${def.pagePath}</link>`,
    `    <description>${xmlEscape(`${def.description} Public records shown as filed. Not investment advice.`)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${rfc822(last)}</lastBuildDate>`,
    "    <ttl>360</ttl>",
    `    <atom:link href="${site}${def.path}" rel="self" type="application/rss+xml" />`,
    ...items.map((i) => [
      "    <item>",
      `      <title>${xmlEscape(i.title)}</title>`,
      `      <link>${xmlEscape(site + i.link)}</link>`,
      `      <guid isPermaLink="false">${xmlEscape(i.guid)}</guid>`,
      `      <pubDate>${rfc822(i.date)}</pubDate>`,
      ...i.categories.map((c) => `      <category>${xmlEscape(c)}</category>`),
      `      <description>${xmlEscape(i.description)}</description>`,
      "    </item>",
    ].join("\n")),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** One line for the build log, to compare with a direct count on the database. */
export function feedLogLine(id: FeedId, items: FeedItem[]): string {
  const newest = items[0]?.date ?? "none", oldest = items.at(-1)?.date ?? "none";
  const onNewest = items.filter((i) => i.date === newest);
  return `feed ${id}: ${items.length} items (${items.reduce((a, i) => a + i.rows, 0)} rows), newest ${newest}, oldest ${oldest}, ${onNewest.length} items (${onNewest.reduce((a, i) => a + i.rows, 0)} rows) on the newest day`;
}
