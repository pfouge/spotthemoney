// Turns the build model into the rows lib/notable.ts judges, and builds the home-page feed data,
// top lists and coverage figures from them. Server only (it reads the Flagship model).
import type { Flagship, Txn } from "./flagship";
import { amountLabel, money, num, entityPath, allFormFourTxns } from "./flagship";
import { changeLabel } from "./holdings";
import { edgarFilingUrl } from "./seo";
import { shortSeat } from "./watchcards-build";
import { buildFeed, topLists, capFeed, FEED_MAX_BYTES, type NRow, type NotableData, type TopLists } from "./notable";

const sourceLabel = (s: string) => (s === "sec_form4" ? "Form 4" : s === "house_ptr" ? "House PTR" : "Senate PTR");

/** Form 4 rows (tracked, then market scope) and the House and Senate rows: the feed's whole universe. */
export function feedTxns(m: Flagship): Txn[] {
  const out = allFormFourTxns(m);
  for (const t of m.txns) if (t.source !== "sec_form4") out.push(t);
  return out;
}

export function notableRows(m: Flagship): NRow[] {
  const rows: NRow[] = [];
  for (const t of feedTxns(m)) {
    if (!t.isPublished) continue;
    const s = t.securityId != null ? (m.securities.get(t.securityId) ?? m.market.securities.get(t.securityId)) : undefined;
    const p = t.personId != null ? (m.people.get(t.personId) ?? m.market.people.get(t.personId)) : undefined;
    if (!s || !p) continue;
    const co = s.companyId != null ? (m.companies.get(s.companyId) ?? m.market.companies.get(s.companyId)) : undefined;
    const form4 = t.source === "sec_form4";
    let role = "";
    if (form4) {
      const ir = p.roles.find((r) => r.kind === "insider" && r.companyId === s.companyId) ?? p.roles.find((r) => r.kind === "insider");
      role = ir?.officerTitle ?? (ir?.isDirector ? "Director" : "Insider");
    } else role = shortSeat(p);
    const href = form4 ? edgarFilingUrl(t.sourceUrl) : t.sourceUrl;
    const withPrice = t.shares != null && t.price != null && t.price > 0;
    rows.push({
      id: t.id, personId: p.id, name: p.name, path: entityPath(p.isCongress ? "congress" : "insider", p), role,
      companyKey: s.companyId != null ? `c${s.companyId}` : `t${s.ticker}`, company: co?.name ?? s.name ?? s.ticker, ticker: s.ticker, stockPath: entityPath("stock", s),
      source: t.source, code: t.code, side: t.side, isDerivative: t.isDerivative, is10b51: t.is10b51, jointOf: t.jointOf, isPublished: t.isPublished,
      txnDate: t.txnDate, disclosedAt: t.disclosedAt?.slice(0, 10) ?? null, value: t.value, shares: t.shares, price: t.price, amountLow: t.amountLow, change: t.holdingsChange,
      valueLabel: amountLabel(t), subLabel: form4 && withPrice ? `${num(t.shares)} × ${money(t.price, { compact: false })}` : "",
      changeLabel: form4 && t.holdingsChange != null ? changeLabel(t.holdingsChange) : "", srcUrl: href ?? null, srcLabel: sourceLabel(t.source),
    });
  }
  return rows;
}

/** data: what notable.json holds (capped when needed). full: every item, for counts on the page. */
export interface HomeFeed { data: NotableData; full: NotableData; top: TopLists; rows: NRow[] }
let cache: { m: Flagship; v: HomeFeed } | null = null;

export function homeFeed(m: Flagship): HomeFeed {
  if (cache?.m === m) return cache.v;
  const rows = notableRows(m);
  const companies = new Set(rows.filter((r) => r.source === "sec_form4").map((r) => r.companyKey)).size;
  let senateThrough: string | null = null;
  for (const f of m.filings.values()) if (f.source === "senate_ptr" && f.isPublished && f.filedAt && (!senateThrough || f.filedAt.slice(0, 10) > senateThrough)) senateThrough = f.filedAt.slice(0, 10);
  const fmt = (n: number) => money(n);
  const data = buildFeed(rows, m.builtAt.slice(0, 10), { companies, senateThrough, fmt });
  // Cap the file, tightening in steps if it still passes the size limit.
  let capped = capFeed(data), scale = 1;
  while (capped !== data && JSON.stringify(capped).length > FEED_MAX_BYTES * 0.97 && scale > 0.05) { scale *= 0.8; capped = capFeed(data, scale); }
  if (capped !== data) console.log(`[web] notable.json capped: ${JSON.stringify(capped).length} bytes, ${capped.items.length} of ${data.items.length} items (scale ${scale.toFixed(2)})`);
  const v = { data: capped, full: data, top: topLists(rows, data, 7, fmt), rows };
  cache = { m, v };
  return v;
}
