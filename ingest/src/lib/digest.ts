// Email digest, the pure part (email alerts stage 2, 2026-11-18). No database, no network, no
// clock: the job (jobs/alerts_digest.ts) reads the rows and the time and passes them in, so
// every rule here is unit tested (digest.test.ts).
//
// A digest is a list of what newly loaded public filings show for the pages one account
// follows. Wording rules (the site's): state what the filing shows, never why; no advice, no
// score, no computed dollar figure. A Form 4 item gives shares and the price per share exactly
// as filed; a congressional item gives the range the report gives.
//
// What an item is:
//   - a House or Senate report row                         one item per row
//   - a Form 4's open-market purchases (code P)            one item per filing
//   - a Form 4's open-market sales (code S)                one item per filing
//   - everything else on a Form 4 (awards, exercises,
//     gifts, tax withholding, derivative rows)             one item per filing, a count only
// One sale is often filled in dozens of lots, each its own row, so a Form 4 is summed by filing
// the way the site's RSS feeds do it (web/src/lib/feeds.ts).

export type DigestKind = "daily" | "weekly";

/** One transaction row that matched a page the account follows. */
export interface DigestRow {
  txnId: number;
  filingId: number;
  source: string;               // sec_form4 | house_ptr | senate_ptr
  sourceUrl: string | null;
  personName: string | null;
  personSlug: string | null;
  personKind: string | null;    // congress | insider
  ticker: string | null;
  securityName: string | null;
  side: string;                 // buy | sell | exchange | option | other
  txnCode: string | null;
  isDerivative: boolean;
  txnDate: string | null;       // YYYY-MM-DD
  disclosedAt: string | null;   // YYYY-MM-DD
  lagDays: number | null;
  amountLow: number | null;
  amountHigh: number | null;
  shares: number | null;
  price: number | null;
  ownerType: string | null;
  assetType: string | null;     // what a row with no ticker is: bond, fund, ...
  /** The followed page this row is listed under: kind, key and the label the account sees. */
  matchKind: string;            // member | insider | stock | company
  matchKey: string;
  matchLabel: string;
}

export interface DigestItem {
  /** Stable within a digest: "t<txn id>" or "f<filing id>-buy|sell|other". */
  key: string;
  /** Heading the item is printed under (the followed page). */
  group: string;
  sentence: string;
  siteUrl: string;
  sourceUrl: string | null;
  rows: number;
  disclosedAt: string | null;
}

export interface Digest {
  subject: string;
  text: string;
  html: string;
  /** Every item the period holds, printed or not. */
  itemCount: number;
  printed: number;
}

/** At most this many items are printed; the rest are counted and the watchlist page linked. */
export const MAX_ITEMS = 40;
/** A daily digest is not built again within this many hours of the last one (a retry, a manual run). */
export const DAILY_MIN_HOURS = 12;
/** The weekly digest is built on this weekday (UTC; 1 = Monday), ... */
export const WEEKLY_DOW = 1;
/** ... or on any day once the last one is this old (a Monday run that never happened). */
export const WEEKLY_CATCH_UP_DAYS = 8;

const HOUR = 3_600_000;

/**
 * Is a digest due? `end` is the end of the period the run would cover (the run time less the
 * settling time), `now` the run time.
 *   daily   when the last digest is at least DAILY_MIN_HOURS old
 *   weekly  on Mondays (UTC) when the last digest is from before that Monday, or on any day
 *           once the last digest is WEEKLY_CATCH_UP_DAYS old
 * Turning a digest on sets `last` to that moment, so someone who opts in on a Monday afternoon
 * gets the first weekly digest the Monday after.
 */
export function isDue(kind: DigestKind, last: Date, end: Date, now: Date): boolean {
  if (!(end.getTime() > last.getTime())) return false;
  if (kind === "daily") return now.getTime() - last.getTime() >= DAILY_MIN_HOURS * HOUR;
  if (now.getTime() - last.getTime() >= WEEKLY_CATCH_UP_DAYS * 24 * HOUR) return true;
  if (now.getUTCDay() !== WEEKLY_DOW) return false;
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return last.getTime() < dayStart;
}

// ── small formatters ────────────────────────────────────────────────────────────────────────
const isoDay = (s: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
export function longDate(s: string | Date | null): string | null {
  const d = s instanceof Date ? s : isoDay(s);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
const whole = (n: number): string => Math.round(n).toLocaleString("en-US");
const dollars = (n: number): string => `$${whole(n)}`;
const perShare = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`;
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The range a congressional report gives, in words; null when the row has none. */
export function rangeWords(low: number | null, high: number | null): string | null {
  if (low != null && high != null) return low === high ? dollars(low) : high > low ? `${dollars(low)} to ${dollars(high)}` : null;
  if (low != null) return `over ${dollars(low)}`;
  if (high != null) return `up to ${dollars(high)}`;
  return null;
}

const OWNER_WORDS: Record<string, string> = {
  spouse: "the member's spouse", joint: "the member jointly with a spouse", child: "a dependent child",
  dependent: "a dependent child", dependent_child: "a dependent child",
};

const ASSET_WORDS: Record<string, string> = {
  stock: "a stock with no ticker", etf: "an ETF", bond: "a bond", fund: "a fund", hedge_fund: "a hedge fund interest",
  private_equity: "a private equity interest", option: "an option", crypto: "a crypto asset",
};
/** The ticker; without one the security's name; without that the kind of asset the report gives. */
const what = (r: DigestRow): string =>
  r.ticker?.trim() || r.securityName?.trim() || (r.assetType ? ASSET_WORDS[r.assetType.toLowerCase()] : undefined) || "an asset";
const who = (r: DigestRow): string => r.personName?.trim() || "A filer";

function datePhrase(rows: DigestRow[]): string {
  const days = [...new Set(rows.map((r) => r.txnDate).filter((d): d is string => !!d))].sort();
  if (days.length === 0) return "";
  const first = longDate(days[0]!), last = longDate(days[days.length - 1]!);
  if (!first || !last) return "";
  return days.length === 1 ? ` on ${first}` : ` between ${first} and ${last}`;
}
function disclosedPhrase(r: DigestRow, withLag: boolean): string {
  const d = longDate(r.disclosedAt);
  if (!d) return "";
  const lag = withLag && r.txnDate && r.lagDays != null && r.lagDays > 0
    ? `, ${whole(r.lagDays)} ${plural(r.lagDays, "day", "days")} after the trade` : "";
  return `; disclosed ${d}${lag}`;
}

/** One row of a House or Senate report. */
export function congressSentence(r: DigestRow): string {
  const amt = rangeWords(r.amountLow, r.amountHigh);
  const w = what(r);
  let act: string;
  switch (r.side) {
    case "buy": act = amt ? `bought ${amt} of ${w}` : `bought ${w}`; break;
    case "sell": act = amt ? `sold ${amt} of ${w}` : `sold ${w}`; break;
    case "exchange": act = amt ? `exchanged ${amt} of ${w}` : `exchanged ${w}`; break;
    default: act = `reported a transaction in ${w}${amt ? ` of ${amt}` : ""}`;
  }
  const owner = r.ownerType ? OWNER_WORDS[r.ownerType.toLowerCase()] : undefined;
  return `${who(r)} ${act}${datePhrase([r])}${disclosedPhrase(r, true)}.${owner ? ` The report gives the owner as ${owner}.` : ""}`;
}

/** A Form 4's open-market purchases or sales, added up. Shares and prices as filed; no total. */
export function form4Sentence(rows: DigestRow[], dir: "buy" | "sell"): string {
  const r0 = rows[0]!;
  const verb = dir === "buy" ? "bought" : "sold";
  const noun = dir === "buy" ? "purchases" : "sales";
  const shares = rows.reduce((s, r) => s + (r.shares != null && r.shares > 0 ? r.shares : 0), 0);
  const prices = rows.map((r) => r.price).filter((p): p is number => p != null && p > 0);
  const lo = prices.length ? Math.min(...prices) : null, hi = prices.length ? Math.max(...prices) : null;
  const price = lo == null ? "" : lo === hi ? ` at ${perShare(lo)} a share` : ` at ${perShare(lo)} to ${perShare(hi!)} a share`;
  const count = shares > 0 ? `${whole(shares)} ${plural(Math.round(shares), "share", "shares")} of ${what(r0)}` : what(r0);
  const lead = rows.length === 1
    ? `${who(r0)} ${verb} ${count}${price}`
    : `${who(r0)} reported ${whole(rows.length)} open-market ${noun} of ${what(r0)}${shares > 0 ? `, ${whole(shares)} shares in all` : ""}${price}`;
  return `${lead}${datePhrase(rows)}${disclosedPhrase(r0, false)}. Figures are as filed on Form 4.`;
}

/** The rest of a Form 4: a count, nothing more. */
export function form4OtherSentence(rows: DigestRow[]): string {
  const r0 = rows[0]!;
  const tickers = [...new Set(rows.map(what))];
  const where = tickers.length === 1 ? ` in ${tickers[0]}` : "";
  return `${who(r0)} reported ${whole(rows.length)} other ${plural(rows.length, "transaction", "transactions")}${where} on Form 4 `
    + `(an award, option exercise, gift, tax withholding or derivative row)${disclosedPhrase(r0, false)}.`;
}

const isForm4 = (r: DigestRow): boolean => r.source === "sec_form4";
const openMarket = (r: DigestRow): "buy" | "sell" | null =>
  r.isDerivative ? null : r.txnCode === "P" && r.side === "buy" ? "buy" : r.txnCode === "S" && r.side === "sell" ? "sell" : null;

function siteUrlFor(r: DigestRow, site: string): string {
  if (r.personSlug && (r.personKind === "congress" || r.personKind === "insider")) {
    return `${site}/${r.personKind === "congress" ? "congress" : "insiders"}/${encodeURIComponent(r.personSlug)}/#t${r.txnId}`;
  }
  if (r.ticker) return `${site}/stocks/${encodeURIComponent(r.ticker.toLowerCase())}/`;
  return `${site}/watchlist/`;
}

/**
 * Rows to items, newest disclosure first (then filing, purchases before sales before the rest),
 * so the order does not depend on the order the rows arrived in.
 */
export function buildItems(rows: DigestRow[], site: string): DigestItem[] {
  const seen = new Set<number>();
  const uniq = rows.filter((r) => (seen.has(r.txnId) ? false : (seen.add(r.txnId), true)))
    .sort((a, b) => a.txnId - b.txnId);
  const items: (DigestItem & { order: number; filingId: number })[] = [];
  const byFiling = new Map<string, DigestRow[]>();
  for (const r of uniq) {
    if (!isForm4(r)) {
      items.push({ key: `t${r.txnId}`, group: r.matchLabel, sentence: congressSentence(r), siteUrl: siteUrlFor(r, site),
        sourceUrl: r.sourceUrl, rows: 1, disclosedAt: r.disclosedAt, order: 0, filingId: r.filingId });
      continue;
    }
    const k = `${r.filingId}-${openMarket(r) ?? "other"}`;
    (byFiling.get(k) ?? byFiling.set(k, []).get(k)!).push(r);
  }
  for (const [k, group] of byFiling) {
    const dir = k.endsWith("-buy") ? "buy" : k.endsWith("-sell") ? "sell" : "other";
    const r0 = group[0]!;
    items.push({
      key: `f${k}`, group: r0.matchLabel,
      sentence: dir === "other" ? form4OtherSentence(group) : form4Sentence(group, dir),
      siteUrl: siteUrlFor(r0, site), sourceUrl: r0.sourceUrl, rows: group.length, disclosedAt: r0.disclosedAt,
      order: dir === "buy" ? 0 : dir === "sell" ? 1 : 2, filingId: r0.filingId,
    });
  }
  items.sort((a, b) =>
    (b.disclosedAt ?? "").localeCompare(a.disclosedAt ?? "") || b.filingId - a.filingId || a.order - b.order || a.key.localeCompare(b.key));
  return items.map(({ order: _o, filingId: _f, ...it }) => it);
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface ComposeInput {
  kind: DigestKind;
  items: DigestItem[];
  periodEnd: Date;
  site: string;             // no trailing slash
  unsubToken: string;
  /** The sender's postal address, when configured (a commercial email must carry one). */
  postalAddress?: string | null;
  maxItems?: number;
}

/** The address every email's unsubscribe link uses. Stage 3 builds the page that answers it. */
export function unsubscribeUrl(site: string, token: string): string {
  return `${site}/alerts/unsubscribe/?token=${encodeURIComponent(token)}`;
}

/** Subject, plain text and HTML for one account's digest. Items must not be empty. */
export function composeDigest(input: ComposeInput): Digest {
  const { kind, items, site } = input;
  if (items.length === 0) throw new Error("composeDigest: nothing to send");
  const max = input.maxItems ?? MAX_ITEMS;
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  const day = longDate(input.periodEnd) ?? "";
  const n = items.length;
  const subject = `${whole(n)} new ${plural(n, "disclosure", "disclosures")} from the pages you follow, `
    + `${kind === "weekly" ? "week to " : ""}${day}`;
  const intro = `Newly loaded public filings for the pages on your Spot the Money watchlist: `
    + `${whole(n)} ${plural(n, "item", "items")}, newest disclosure first.`;
  const moreLine = more > 0
    ? `${whole(more)} more ${plural(more, "item is", "items are")} not listed here. Your watchlist shows them all: ${site}/watchlist/` : "";
  const unsub = unsubscribeUrl(site, input.unsubToken);
  const why = `You are getting this email because you turned on the ${kind} digest for your watchlist at spotthemoney.com.`;
  const terms = "These are public records, shown as filed. A filing can be late or amended later. Nothing here is investment advice.";
  const postal = input.postalAddress?.trim() || "";

  // group by followed page, groups in the order their first item appears
  const groups: { name: string; items: DigestItem[] }[] = [];
  for (const it of shown) {
    const g = groups.find((x) => x.name === it.group);
    if (g) g.items.push(it); else groups.push({ name: it.group, items: [it] });
  }

  const t: string[] = [intro, ""];
  for (const g of groups) {
    t.push(g.name, "-".repeat(Math.min(g.name.length, 60)));
    for (const it of g.items) {
      t.push(it.sentence, `  On the site: ${it.siteUrl}`);
      if (it.sourceUrl) t.push(`  Original filing: ${it.sourceUrl}`);
      t.push("");
    }
  }
  if (moreLine) t.push(moreLine, "");
  t.push("--", why, `Change it or turn it off: ${site}/watchlist/`, `Unsubscribe with one click: ${unsub}`, "", terms);
  t.push("", `Spot the Money, ${site}`);
  if (postal) t.push(postal);
  const text = t.join("\n") + "\n";

  const h: string[] = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>`,
    `<body style="font-family:-apple-system,BlinkMacSystemFont,'Trebuchet MS',Roboto,Ubuntu,sans-serif;line-height:1.5;color:#111;max-width:640px;margin:0 auto;padding:16px">`,
    `<p>${esc(intro)}</p>`,
  ];
  for (const g of groups) {
    h.push(`<h2 style="font-size:17px;margin:24px 0 8px">${esc(g.name)}</h2>`, `<ul style="padding-left:18px;margin:0">`);
    for (const it of g.items) {
      const links = [`<a href="${esc(it.siteUrl)}">On the site</a>`];
      if (it.sourceUrl && /^https?:\/\//i.test(it.sourceUrl)) links.push(`<a href="${esc(it.sourceUrl)}">Original filing</a>`);
      h.push(`<li style="margin:0 0 12px">${esc(it.sentence)}<br><span style="font-size:14px">${links.join(" · ")}</span></li>`);
    }
    h.push(`</ul>`);
  }
  if (more > 0) {
    h.push(`<p>${esc(`${whole(more)} more ${plural(more, "item is", "items are")} not listed here.`)} `
      + `<a href="${esc(site)}/watchlist/">Your watchlist shows them all</a>.</p>`);
  }
  h.push(
    `<hr style="border:0;border-top:1px solid #ccc;margin:24px 0">`,
    `<p style="font-size:13px;color:#444">${esc(why)} <a href="${esc(site)}/watchlist/">Change it or turn it off</a>, or `
      + `<a href="${esc(unsub)}">unsubscribe with one click</a>.</p>`,
    `<p style="font-size:13px;color:#444">${esc(terms)}</p>`,
    `<p style="font-size:13px;color:#444">Spot the Money, <a href="${esc(site)}/">${esc(site.replace(/^https?:\/\//, ""))}</a>${postal ? `<br>${esc(postal)}` : ""}</p>`,
    `</body></html>`,
  );
  return { subject: subject.slice(0, 200), text, html: h.join("\n"), itemCount: n, printed: shown.length };
}
