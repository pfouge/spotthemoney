// "Notable trades": the rules that decide which published trades the home-page feed shows, how
// insider purchases group into clusters, and how the feed is filtered and sorted. One pure module:
// no database, no site model. The build (lib/notable-build.ts) turns the model into `NRow`s, this
// file does everything else, and scripts/notable.ts runs the same `selectFeed` in the browser so
// the page rendered at build time and the page after a click can never disagree.
// Tests: scripts/notable.test.ts. Wording of the rules for readers: methodology #notable.
//
// A trade is NOTABLE when it matches at least one of five rules (thresholds below):
//   insider-buy   Form 4 code P outside a Rule 10b5-1 plan. Every one counts.
//   cluster       3+ different insiders of one company with insider-buy rows whose trade dates fall
//                 within 30 days of each other, at least one disclosed inside the chosen window.
//   stake-change  Form 4 code P or S outside a plan that moves the reported holding by 20%+ and is
//                 worth $100,000+ (lib/holdings.ts; a first position counts as a rise).
//   large-sale    Form 4 code S outside a plan worth $1,000,000+.
//   congress      House or Senate buy or sell of a stock with a ticker, range starting at $15,001+.
// Always excluded: unpublished rows, duplicates of another filing (jointOf), derivative rows, rows
// with no ticker, and rows whose trade date is missing or after the filing date.

export const CLUSTER_MIN_INSIDERS = 3;
export const CLUSTER_DAYS = 30;
export const STAKE_MIN_PCT = 20;
export const STAKE_MIN_VALUE = 100_000;
export const LARGE_SALE_MIN = 1_000_000;
export const CONGRESS_MIN_LOW = 15_001;

export const WINDOWS = [1, 7, 30] as const;
export type Win = (typeof WINDOWS)[number];
export const FEED_PAGE = 60;
export const TOP_N = 5;

export type Reason = "insider-buy" | "stake-change" | "large-sale" | "congress";
export const REASON_LABEL: Record<Reason | "cluster", string> = {
  "insider-buy": "Insider buy", "stake-change": "Stake change", "large-sale": "Large sale", congress: "Congress", cluster: "Cluster buy",
};

/** One published transaction as the rules see it. Display strings are prepared by the build. */
export interface NRow {
  id: number; personId: number | null; name: string; path: string | null;
  /** "CEO", "Director", "Rep. D-AZ-4". */
  role: string;
  /** Company id when known, else the ticker: what "in the same company" means. */
  companyKey: string; company: string; ticker: string | null; stockPath: string | null;
  source: string; code: string | null; side: string;
  isDerivative: boolean | null; is10b51: boolean | null; jointOf?: number | null; isPublished: boolean;
  txnDate: string | null; disclosedAt: string | null;
  /** Insiders: shares x price. Congress: the top of the range. */
  value: number | null; shares: number | null; price: number | null; amountLow: number | null;
  /** From lib/holdings.ts: percent, "new", or null. */
  change: number | "new" | null | undefined;
  /** Prepared by the build. */
  valueLabel: string; subLabel: string; changeLabel: string; srcUrl: string | null; srcLabel: string;
}

export const isForm4 = (r: Pick<NRow, "source">) => r.source === "sec_form4";

/** The shared exclusions. */
export function eligible(r: NRow): boolean {
  if (!r.isPublished || r.jointOf != null || r.isDerivative === true || !r.ticker) return false;
  if (r.side !== "buy" && r.side !== "sell") return false;
  if (!r.txnDate || !r.disclosedAt || r.txnDate > r.disclosedAt) return false;
  return true;
}

/** Why a row is notable (empty when it is not, or is excluded). "cluster" is not here: it belongs to a group of rows. */
export function reasonsOf(r: NRow): Reason[] {
  if (!eligible(r)) return [];
  const out: Reason[] = [];
  if (isForm4(r)) {
    const open = !r.is10b51;
    if (open && r.code === "P" && r.side === "buy") out.push("insider-buy");
    if (open && (r.code === "P" || r.code === "S") && (r.value ?? 0) >= STAKE_MIN_VALUE && r.change != null
        && (r.change === "new" ? r.side === "buy" : Math.abs(r.change) >= STAKE_MIN_PCT)) out.push("stake-change");
    if (open && r.code === "S" && r.side === "sell" && (r.value ?? 0) >= LARGE_SALE_MIN) out.push("large-sale");
  } else if ((r.amountLow ?? 0) >= CONGRESS_MIN_LOW) out.push("congress");
  return out;
}

// ── clusters ──────────────────────────────────────────────────────────────────────────────
export interface FeedCluster {
  k: "c"; /** latest disclosure date among members */ d: string; /** first / last trade date */ f: string; l: string;
  tk: string; tp: string | null; co: string; n: number; who: { n: string; p: string | null }[];
  v: number; vl: string; ids: number[]; u: string | null;
}

const DAY = 86400_000;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
export const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * DAY).toISOString().slice(0, 10);
/** First day of a window counted back from the newest disclosure date: "Today" is one day, "7 days" is seven days including today. */
export const sinceOf = (newest: string, w: number) => addDays(newest, -(w - 1));

/**
 * One cluster per company at most. Among every group of insider-buy rows in one company whose trade
 * dates fit in a 30-day span and that has 3+ different insiders, the one disclosed most recently
 * wins (ties: more insiders). The group takes every insider-buy row of the company in that span.
 */
export function findClusters(rows: NRow[], fmt: (n: number) => string = (n) => `$${Math.round(n).toLocaleString("en-US")}`): FeedCluster[] {
  const byCo = new Map<string, NRow[]>();
  for (const r of rows) if (reasonsOf(r).includes("insider-buy")) { const a = byCo.get(r.companyKey); if (a) a.push(r); else byCo.set(r.companyKey, [r]); }
  const out: FeedCluster[] = [];
  for (const group of byCo.values()) {
    group.sort((a, b) => a.txnDate!.localeCompare(b.txnDate!) || a.id - b.id);
    let best: NRow[] | null = null; let bestKey = ""; let bestN = 0;
    for (const start of group) {
      const lo = dayNum(start.txnDate!);
      const span = group.filter((r) => { const d = dayNum(r.txnDate!); return d >= lo && d - lo <= CLUSTER_DAYS; });
      const people = new Set(span.map((r) => r.personId ?? `n:${r.name}`));
      if (people.size < CLUSTER_MIN_INSIDERS) continue;
      const latest = span.reduce((m, r) => (r.disclosedAt! > m ? r.disclosedAt! : m), "");
      if (!best || latest > bestKey || (latest === bestKey && people.size > bestN)) { best = span; bestKey = latest; bestN = people.size; }
    }
    if (!best) continue;
    const people = new Map<string, { n: string; p: string | null }>();
    for (const r of best) { const k = String(r.personId ?? `n:${r.name}`); if (!people.has(k)) people.set(k, { n: r.name, p: r.path }); }
    const total = best.reduce((s, r) => s + (r.value ?? 0), 0);
    const first = best[0]!;
    out.push({
      k: "c", d: bestKey, f: best.reduce((m, r) => (r.txnDate! < m ? r.txnDate! : m), first.txnDate!), l: best.reduce((m, r) => (r.txnDate! > m ? r.txnDate! : m), first.txnDate!),
      tk: first.ticker!, tp: first.stockPath, co: first.company, n: people.size, who: [...people.values()],
      v: total, vl: fmt(total), ids: best.map((r) => r.id), u: null,
    });
  }
  return out;
}

// ── the feed data (what /data/notable.json holds) ──────────────────────────────────────────
export interface FeedItem {
  k: "r"; id: number; d: string; t: string; n: string; np: string | null; r: string; tk: string; tp: string | null; co: string;
  /** 1 = bought, 0 = sold */ b: 0 | 1; v: number; vl: string; vs: string; ch: string; cs: number | null; tg: Reason[]; u: string | null; ul: string;
  /** index into clusters, or -1 */ cl: number;
}
export interface NotableData {
  built: string; newest: string; companies: number; senateThrough: string | null;
  items: FeedItem[]; clusters: FeedCluster[];
}

/** Sort number for "Biggest stake change": a first position outranks every percentage. */
export const changeKey = (c: NRow["change"]): number | null => (c == null ? null : c === "new" ? 1e9 : Math.abs(c));

/** The newest disclosure date among rows that pass the exclusions, never after the build day. */
export function newestDisclosure(rows: NRow[], builtDay: string): string | null {
  let n: string | null = null;
  for (const r of rows) if (eligible(r) && r.disclosedAt! <= builtDay && (n == null || r.disclosedAt! > n)) n = r.disclosedAt!;
  return n;
}

export function buildFeed(rows: NRow[], builtDay: string, extra: { companies: number; senateThrough: string | null; fmt?: (n: number) => string }): NotableData {
  const newest = newestDisclosure(rows, builtDay) ?? builtDay;
  const since30 = sinceOf(newest, 30);
  const live = rows.filter((r) => eligible(r) && r.disclosedAt! <= newest);
  const clusters = findClusters(live, extra.fmt).filter((c) => c.d >= since30);
  const clusterOf = new Map<number, number>();
  clusters.forEach((c, i) => c.ids.forEach((id) => clusterOf.set(id, i)));
  const items: FeedItem[] = [];
  for (const r of live) {
    if (r.disclosedAt! < since30) continue;
    const tg = reasonsOf(r);
    if (!tg.length) continue;
    items.push({
      k: "r", id: r.id, d: r.disclosedAt!, t: r.txnDate!, n: r.name, np: r.path, r: r.role, tk: r.ticker!, tp: r.stockPath, co: r.company,
      b: r.side === "buy" ? 1 : 0, v: r.value ?? 0, vl: r.valueLabel, vs: r.subLabel, ch: r.changeLabel, cs: changeKey(r.change), tg, u: r.srcUrl, ul: r.srcLabel,
      cl: tg.includes("insider-buy") ? clusterOf.get(r.id) ?? -1 : -1,
    });
  }
  items.sort((a, b) => b.d.localeCompare(a.d) || b.v - a.v || b.id - a.id);
  return { built: builtDay, newest, companies: extra.companies, senateThrough: extra.senateThrough, items, clusters };
}

// ── choosing what to show (build and browser) ──────────────────────────────────────────────
export type Preset = "all" | "cluster" | "buys" | "stake" | "sales" | "congress";
export type SortKey = "new" | "large" | "stake";
export const PRESETS: { id: Preset; label: string }[] = [
  { id: "all", label: "All" }, { id: "cluster", label: "Cluster buys" }, { id: "buys", label: "Insider buys" },
  { id: "stake", label: "Stake changes" }, { id: "sales", label: "Large sales" }, { id: "congress", label: "Congress" },
];
export const SORTS: { id: SortKey; label: string }[] = [{ id: "new", label: "Newest filed" }, { id: "large", label: "Largest" }, { id: "stake", label: "Biggest stake change" }];
export const WIN_LABEL: Record<Win, string> = { 1: "Today", 7: "7 days", 30: "30 days" };
export interface FeedState { win: Win; preset: Preset; q: string; sort: SortKey }
export const DEFAULT_STATE: FeedState = { win: 7, preset: "all", q: "", sort: "new" };
export type Entry = FeedItem | FeedCluster;

const PRESET_REASON: Partial<Record<Preset, Reason>> = { buys: "insider-buy", stake: "stake-change", sales: "large-sale", congress: "congress" };

export function selectFeed(data: Pick<NotableData, "newest" | "items" | "clusters">, s: FeedState): Entry[] {
  const since = sinceOf(data.newest, s.win);
  const q = s.q.trim().toLowerCase();
  const clustersIn = data.clusters.filter((c) => c.d >= since);
  const showClusters = s.preset === "all" || s.preset === "cluster";
  const out: Entry[] = [];
  if (showClusters) for (const c of clustersIn) out.push(c);
  if (s.preset !== "cluster") {
    const need = PRESET_REASON[s.preset];
    for (const it of data.items) {
      if (it.d < since) continue;
      if (need ? !it.tg.includes(need) : it.cl >= 0) continue; // "All" folds cluster members into their cluster
      out.push(it);
    }
  }
  const hit = q ? out.filter((e) => (e.k === "c" ? [e.tk, e.co, ...e.who.map((w) => w.n)] : [e.tk, e.co, e.n]).some((x) => x.toLowerCase().includes(q))) : out;
  const val = (e: Entry) => e.v;
  const chg = (e: Entry) => (e.k === "c" ? null : e.cs);
  const idOf = (e: Entry) => (e.k === "c" ? e.ids[0]! : e.id);
  hit.sort((a, b) => {
    if (s.sort === "new") {
      if (showClusters && (a.k === "c") !== (b.k === "c")) return a.k === "c" ? -1 : 1; // clusters pinned on top
      return b.d.localeCompare(a.d) || val(b) - val(a) || idOf(b) - idOf(a);
    }
    if (s.sort === "large") return val(b) - val(a) || b.d.localeCompare(a.d) || idOf(b) - idOf(a);
    const ca = chg(a), cb = chg(b);
    if ((ca == null) !== (cb == null)) return ca == null ? 1 : -1;
    return (cb ?? 0) - (ca ?? 0) || val(b) - val(a) || b.d.localeCompare(a.d) || idOf(b) - idOf(a);
  });
  return hit;
}

// ── top lists and figures (7 days) ─────────────────────────────────────────────────────────
export interface TopEntry { label: string; href: string | null; sub: string; value: string; }
export interface TopLists {
  since: string; newest: string;
  insidersBuying: TopEntry[]; largestBuys: TopEntry[]; largestSales: TopEntry[]; activeMembers: TopEntry[]; congressStocks: TopEntry[];
  figures: { notable: number; buyRows: number; saleRows: number; members: number };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function topLists(rows: NRow[], data: Pick<NotableData, "newest" | "items" | "clusters">, days = 7, fmt: (n: number) => string = (n) => `$${Math.round(n).toLocaleString("en-US")}`): TopLists {
  const since = sinceOf(data.newest, days);
  const inWin = rows.filter((r) => eligible(r) && r.disclosedAt! >= since && r.disclosedAt! <= data.newest);
  const buys = inWin.filter((r) => reasonsOf(r).includes("insider-buy"));
  const sales = inWin.filter((r) => isForm4(r) && r.code === "S" && r.side === "sell" && !r.is10b51);
  const cong = inWin.filter((r) => reasonsOf(r).includes("congress"));

  const group = <K,>(xs: NRow[], key: (r: NRow) => K) => { const m = new Map<K, NRow[]>(); for (const r of xs) { const k = key(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); } return m; };
  const distinct = (xs: NRow[]) => new Set(xs.map((r) => r.personId ?? `n:${r.name}`)).size;
  const sum = (xs: NRow[]) => xs.reduce((s, r) => s + (r.value ?? 0), 0);

  const insidersBuying = [...group(buys, (r) => r.ticker!).entries()]
    .map(([tk, xs]) => ({ tk, xs, n: distinct(xs), usd: sum(xs) }))
    .sort((a, b) => b.n - a.n || b.usd - a.usd || a.tk.localeCompare(b.tk)).slice(0, TOP_N)
    .map((g) => ({ label: g.tk, href: g.xs[0]!.stockPath, sub: g.xs[0]!.company, value: `${plural(g.n, "insider")}, ${fmt(g.usd)}` }));
  const byValue = (xs: NRow[]) => [...xs].sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || b.id - a.id).slice(0, TOP_N)
    .map((r) => ({ label: r.ticker!, href: r.stockPath, sub: r.name, value: fmt(r.value ?? 0) }));
  const activeMembers = [...group(cong, (r) => r.personId ?? `n:${r.name}`).entries()]
    .map(([, xs]) => ({ xs, n: xs.length, stocks: new Set(xs.map((r) => r.ticker)).size }))
    .sort((a, b) => b.n - a.n || b.stocks - a.stocks || a.xs[0]!.name.localeCompare(b.xs[0]!.name)).slice(0, TOP_N)
    .map((g) => ({ label: g.xs[0]!.name, href: g.xs[0]!.path, sub: g.xs[0]!.role, value: plural(g.n, "trade") }));
  const congressStocks = [...group(cong, (r) => r.ticker!).entries()]
    .map(([tk, xs]) => ({ tk, xs, n: distinct(xs) }))
    .sort((a, b) => b.n - a.n || b.xs.length - a.xs.length || a.tk.localeCompare(b.tk)).slice(0, TOP_N)
    .map((g) => ({ label: g.tk, href: g.xs[0]!.stockPath, sub: g.xs[0]!.company, value: plural(g.n, "member") }));

  const notable = selectFeed(data, { ...DEFAULT_STATE, win: days as Win }).length;
  return { since, newest: data.newest, insidersBuying, largestBuys: byValue(buys), largestSales: byValue(sales), activeMembers, congressStocks,
    figures: { notable, buyRows: buys.length, saleRows: sales.length, members: distinct(cong) } };
}

// ── wording shared by the build and the browser ────────────────────────────────────────────
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string): string { return `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`; }
export function longDate(iso: string): string { return `${shortDate(iso)}, ${iso.slice(0, 4)}`; }

export function countLine(total: number, shown: number, s: FeedState, newest: string): string {
  const when = s.win === 1 ? `on ${longDate(newest)}` : `from ${shortDate(sinceOf(newest, s.win))} to ${longDate(newest)}`;
  const what = `${total.toLocaleString("en-US")} notable ${total === 1 ? "item" : "items"} filed ${when}`;
  return total > shown ? `${what}. Showing the first ${shown.toLocaleString("en-US")}.` : `${what}.`;
}

export function emptyLine(s: FeedState): string {
  const tips: string[] = [];
  if (s.win !== 30) tips.push("a longer window");
  if (s.preset !== "all") tips.push("the All preset");
  if (s.q.trim()) tips.push("a shorter search");
  return tips.length ? `Nothing matched. Loosen a filter: try ${tips.join(", ")}.` : "Nothing matched: no notable trades were filed in this window.";
}
