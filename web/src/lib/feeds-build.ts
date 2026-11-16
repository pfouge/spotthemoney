// Builds the RSS feeds' items from the flagship model (the same rows, labels and paths the
// pages use). The rules are in lib/feeds.ts; this file only wires the model to them.
// Feeds cover the tracked set (model.txns), like the tables on /congress/ and /insiders/.
import { getFlagship, amountLabel, assetLabel, isLate, personPath, securityPath, money, num } from "./flagship";
import type { Flagship, Txn } from "./flagship-core";
import { edgarFilingUrl } from "./seo";
import { partyName } from "./profile";
import { congressItems, insiderItems, feedDef, feedLogLine, type FeedId, type FeedItem, type FeedLookup } from "./feeds";

function lookup(model: Flagship): FeedLookup {
  const person = (t: Txn) => (t.personId != null ? model.people.get(t.personId) : undefined);
  const security = (t: Txn) => (t.securityId != null ? model.securities.get(t.securityId) : undefined);
  return {
    name: (t) => person(t)?.name ?? null,
    path: (t) => { const p = person(t), s = security(t); return (p ? personPath(p) : null) ?? (s ? securityPath(s) : null); },
    ticker: (t) => security(t)?.ticker ?? null,
    amount: (t) => amountLabel(t),
    asset: (t) => assetLabel(t.assetType),
    source: (t) => (t.source === "sec_form4" ? edgarFilingUrl(t.sourceUrl) : t.sourceUrl),
    role: (t) => {
      const p = person(t);
      if (!p) return null;
      if (t.source !== "sec_form4") {
        const r = p.roles.find((x) => x.kind === "congress");
        if (!r) return null;
        const seat = [r.state, r.chamber === "house" && r.district ? `District ${r.district}` : null].filter(Boolean).join(", ");
        return [r.chamber === "senate" ? "Senator" : "Representative", partyName(r.party), seat || null].filter(Boolean).join(", ");
      }
      // The insider's role at the company whose stock the row is in, never a role held elsewhere.
      const co = security(t)?.companyId;
      const r = co != null ? p.roles.find((x) => x.kind === "insider" && x.companyId === co) : undefined;
      if (!r) return null;
      const title = r.officerTitle ?? (r.isDirector ? "Director" : null);
      const name = model.companies.get(co!)?.name;
      return title && name ? `${title} at ${name}` : null;
    },
    late: isLate,
    money: (n) => money(n),
    num: (n) => num(n),
  };
}

let cache: Promise<Map<FeedId, FeedItem[]>> | null = null;
/** Items of every feed, built once per build; the build log gets one line per feed. */
export function getFeeds(): Promise<Map<FeedId, FeedItem[]>> {
  return (cache ??= (async () => {
    const model = await getFlagship();
    const today = model.builtAt.slice(0, 10);
    const look = lookup(model);
    const out = new Map<FeedId, FeedItem[]>([
      ["congress-trades", congressItems(model.txns, look, today, feedDef("congress-trades").limit)],
      ["insider-purchases", insiderItems(model.txns, look, today, feedDef("insider-purchases").limit, true)],
      ["insider-trades", insiderItems(model.txns, look, today, feedDef("insider-trades").limit)],
    ]);
    for (const [id, items] of out) console.log(`[web] ${feedLogLine(id, items)}`);
    return out;
  })());
}
