// The one-line description of a single disclosed trade that the share menu pre-fills
// ("Jane Doe sold $1M–$5M of NVDA on Sep 3, 2026; disclosed Sep 20, 2026, 17 days later.").
// Pure: no database, no model — the table passes in the labels it already shows, so the
// shared sentence can never say something the row does not. It states the filing, never a motive.

export interface TradeLine {
  name: string | null;          // filer as shown on the row
  side: string;                 // buy | sell | exchange | option | other
  amount: string | null;        // the row's value label ("$41.2M", "$1K–$15K"); null or "—" when none
  what: string | null;          // ticker, or the asset label when the row has no ticker
  txnDate: string | null;       // ISO date
  disclosedAt: string | null;   // ISO date or timestamp
  lagDays: number | null;
}

const shortDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

export function tradeSentence(t: TradeLine): string {
  const who = t.name?.trim() || "A filer";
  const what = t.what?.trim() || "an asset";
  const amt = t.amount && t.amount !== "—" ? t.amount : null;
  let act: string;
  switch (t.side) {
    case "buy": act = amt ? `bought ${amt} of ${what}` : `bought ${what}`; break;
    case "sell": act = amt ? `sold ${amt} of ${what}` : `sold ${what}`; break;
    case "exchange": act = amt ? `exchanged ${amt} of ${what}` : `exchanged ${what}`; break;
    case "option": act = `reported an option or conversion in ${what}${amt ? ` worth ${amt}` : ""}`; break;
    default: act = `reported a transaction in ${what}${amt ? ` worth ${amt}` : ""}`;
  }
  const on = shortDate(t.txnDate), filed = shortDate(t.disclosedAt);
  let s = `${who} ${act}${on ? ` on ${on}` : ""}`;
  if (filed) {
    s += `; disclosed ${filed}`;
    if (t.lagDays != null && t.lagDays > 0 && on) s += `, ${t.lagDays} day${t.lagDays === 1 ? "" : "s"} later`;
  }
  return s + ".";
}

/** A stable in-page anchor for a chart card, from its title ("Weekly flow" → "chart-weekly-flow"). */
export function chartId(title: string): string {
  return "chart-" + title.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
