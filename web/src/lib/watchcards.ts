// Watchlist cards (2026-10-10, Peter: "widgets next to each thing I follow"). The shapes the
// build writes to /data/watch/<kind>-<n>.json and the watchlist pages read. This file is pure and
// imported by the browser, so it must never import the build model (lib/flagship.ts reads the
// database); the builder is lib/watchcards-build.ts.
//
// Why shards: one file per followed page would add ~14,000 files (one per insider) against
// Cloudflare's 20,000-file limit; one file per kind would make every watchlist download every
// insider. A page's card lives in shard shardOf(key, SHARDS[kind]) of its kind.
import type { Kind } from "./account";

/** Days counted back from the build, by disclosure date (the trade map's default window). */
export const WATCH_WINDOW_DAYS = 90;
/** Names listed per group on a stock or company card; the card says how many more there are. */
export const WATCH_TOP = 5;
/** Months shown in a member's or insider's activity bars, the current one last. */
export const WATCH_MONTHS = 12;
export const SHARDS: Record<Kind, number> = { stock: 16, company: 8, member: 4, insider: 32 };

/** FNV-1a over the key's UTF-16 code units: stable across Node and browsers. */
export function shardOf(key: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % n;
}
export const shardFile = (kind: Kind, n: number): string => `/data/watch/${kind}-${n}.json`;
export const shardFor = (kind: Kind, key: string): string => shardFile(kind, shardOf(key, SHARDS[kind]));

/** A corporate insider on a stock card: Form 4 rows in the window; "bought" is code P only. */
export interface WhoInsider { name: string; path: string | null; role: string; rows: number; buys: number; sells: number; bought: number; sold: number; last: string | null }
/** A member of Congress on a stock card: trades in the window and the sum of the filed ranges. */
export interface WhoMember { name: string; path: string | null; seat: string; trades: number; buys: number; sells: number; low: number; high: number; last: string | null }

/** A followed stock (key = lower-case ticker) or company (key = company slug). */
export interface StockCard {
  ticker: string | null; name: string; path: string;
  /** TradingView can chart it (equity, ETF or ADR — the same rule as the stock page). */
  chart: boolean;
  insiders: WhoInsider[]; insiderCount: number;
  members: WhoMember[]; memberCount: number;
}
/** One month of a person's trades: "YYYY-MM", buys, sales (Form 4: open-market P and all sales). */
export type MonthBar = [string, number, number];
export interface LastTrade { date: string; verb: string; ticker: string | null; amount: string }
/** A followed member of Congress or corporate insider. */
export interface PersonCard {
  name: string; path: string; role: string;
  months: MonthBar[];
  last: LastTrade | null;
  /** In the window: rows, buys, sales, and dollars (insiders: open-market value; members: top of each range). */
  rows: number; buys: number; sells: number; bought: number; sold: number;
  /** Members only: the sums of the low and high ends of the filed ranges in the window. */
  low?: number; high?: number;
  /** Tickers traded in the window, most rows first. */
  tickers: [string, number][];
}
export type Card = StockCard | PersonCard;
export interface WatchShard { built: string; window: number; cards: Record<string, Card> }

export const isStockCard = (c: Card): c is StockCard => "insiders" in c;
