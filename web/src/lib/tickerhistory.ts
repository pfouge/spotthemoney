// Ticker history flags for congressional trade rows: two plain facts read from the rows on
// record, nothing more.
//
//   first   the member's earliest trade in that ticker among the reports on record here.
//   run     the n-th trade date running on which the member only bought (or only sold) that
//           ticker, with no trade date of the other kind between.
//
// Pure (tests: scripts/tickerhistory.test.ts). The rows are grouped by member and ticker and
// ordered by TRADE date. Several rows on one trade date (lots, or the member and a spouse) are one
// day. A day with purchases and sales both is "mixed": it carries no run and ends any run. An
// exchange is neither a purchase nor a sale: it never carries a run and does not end one, but a
// day with only an exchange can still be the first day in the ticker.
//
// The record has a start: the site holds reports FILED since RECORD_START, so a trade made before
// that day is on record only if it was reported late or amended. "First" is therefore given only
// to trades made FIRST_MIN_DAYS or more after the start, when the reports on record cover at
// least that many days before the trade. It never says the member did not own the asset before.
// Rows with no ticker or no usable trade date take no part.

/** Reports filed on or after this day are on record (House backfill and Senate export, Oct 2026). */
export const RECORD_START = "2025-10-01";
/** "First on record" is given only to trades made at least this many days after RECORD_START. */
export const FIRST_MIN_DAYS = 90;
/** A run is flagged from this many trade dates. */
export const RUN_MIN = 3;

export interface HistRow { id: number; who: number | string; ticker: string | null | undefined; side: string; txn: string | null | undefined }
export interface Hist {
  /** The earliest trade date in the ticker for this member, and late enough after the record starts. */
  first: boolean;
  /** For a purchase or sale on a one-sided day: which day of the run this is (1, 2, 3 ...); otherwise 0. */
  run: number;
}
export const NO_HIST: Hist = { first: false, run: 0 };

/** The first trade date that can carry "first on record" (YYYY-MM-DD). */
export function firstEligibleFrom(start = RECORD_START, days = FIRST_MIN_DAYS): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** History facts per row id. A row that takes no part (no ticker, no trade date) is not in the map. */
export function tickerHistory(rows: HistRow[], start = RECORD_START): Map<number, Hist> {
  const eligible = firstEligibleFrom(start);
  const groups = new Map<string, Map<string, HistRow[]>>();
  for (const r of rows) {
    const ticker = (r.ticker ?? "").trim().toUpperCase(), day = (r.txn ?? "").slice(0, 10);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const key = `${r.who}|${ticker}`;
    let days = groups.get(key); if (!days) groups.set(key, (days = new Map()));
    const list = days.get(day); if (list) list.push(r); else days.set(day, [r]);
  }
  const out = new Map<number, Hist>();
  for (const days of groups.values()) {
    const order = [...days.keys()].sort();
    let last = "", n = 0;
    order.forEach((day, i) => {
      const list = days.get(day)!;
      const buy = list.some((r) => r.side === "buy"), sell = list.some((r) => r.side === "sell");
      const kind = buy && sell ? "mixed" : buy ? "buy" : sell ? "sell" : "";
      if (kind === "mixed") { last = ""; n = 0; }
      else if (kind) { n = kind === last ? n + 1 : 1; last = kind; }
      const first = i === 0 && day >= eligible;
      for (const r of list) out.set(r.id, { first, run: kind && kind !== "mixed" && r.side === kind ? n : 0 });
    });
  }
  return out;
}

function ordinal(n: number): string {
  const t = n % 100, s = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}
export const FIRST_FLAG = "first on record";
/** "3rd buy in a row", "4th sale in a row"; "" below RUN_MIN or for another side. */
export function runFlag(h: Hist, side: string): string {
  if (h.run < RUN_MIN || (side !== "buy" && side !== "sell")) return "";
  return `${ordinal(h.run)} ${side === "buy" ? "buy" : "sale"} in a row`;
}
/** True for either flag's text (the links from a flag to its guide use this). */
export function isHistFlag(flag: string): boolean { return flag === FIRST_FLAG || /^\d+(st|nd|rd|th) (buy|sale) in a row$/.test(flag); }
/** The flags a row shows, in order. */
export function histFlags(h: Hist | undefined, side: string): string[] {
  if (!h) return [];
  const run = runFlag(h, side);
  return [h.first ? FIRST_FLAG : "", run].filter(Boolean);
}
const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
/** The hover text of a flag: the fact in full, with the start of the record. */
export function histTitle(flag: string, ticker: string, start = RECORD_START): string {
  const t = ticker || "this ticker";
  if (flag === FIRST_FLAG) return `No earlier trade in ${t} in this member's reports on record here, which were filed from ${monthYear(start)} on`;
  const m = /^(\d+)\w+ (buy|sale)/.exec(flag);
  if (!m) return "";
  return m[2] === "buy"
    ? `${t} bought on ${m[1]} trade dates running with no sale between, in the reports on record here`
    : `${t} sold on ${m[1]} trade dates running with no purchase between, in the reports on record here`;
}
