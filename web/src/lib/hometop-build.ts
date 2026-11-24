// The home first screen's figures, worked out from the build model with the same sets and dates the hubs use
// (washhub-build.ts). No query of its own.
import type { Flagship } from "./flagship";
import { allFormFourTxns, securityPath, personPath } from "./flagship";
import { siteEventsHub } from "./events8k-build";
import { sitePlanned } from "./plannedsales-build";
import { siteLarge } from "./largeholders-build";
import { siteCompanyByCik } from "./form144-build";
import { unpackHub } from "./events8k";
import { buildRoutes, topActive, type HomeInputs, type RouteTile, type ActiveItem } from "./hometop";

export function homeInputs(m: Flagship, companies: number, rates: { tenYear: string; ibond: string } | null): HomeInputs {
  const built = m.builtAt.slice(0, 10);
  const pub = m.txns.filter((t) => t.isPublished);
  const congressDates = pub.filter((t) => t.source !== "sec_form4").map((t) => t.disclosedAt);
  const members = [...m.people.values()].filter((p) => p.isCongress).length;
  const openMarket = allFormFourTxns(m).filter((t) => t.isPublished && !t.isDerivative && t.jointOf == null && ((t.code === "P" && t.side === "buy") || (t.code === "S" && t.side === "sell")));
  const ev = unpackHub(siteEventsHub(m).data);
  const pl = sitePlanned(m).all, lh = siteLarge(m).all;
  const siteCos = new Set([...siteCompanyByCik(m).entries()].filter(([, c]) => c.slug).map(([cik]) => cik));
  const seen = new Set<string>();
  const pages = [...m.securities.values()].filter((s) => { if (s.pagePath) return false; const k = s.ticker.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).length;
  const cm = m.committees.filter((c) => c.count > 0);
  return {
    built,
    congress: congressDates.length > 0 ? { dates: congressDates, members } : null,
    insiders: openMarket.length > 0 ? { dates: openMarket.map((t) => t.disclosedAt), companies } : null,
    stocks: pages > 0 ? { pages } : null,
    planned: pl.length > 0 ? { dates: pl.map((r) => r.filed) } : null,
    holders: lh.length > 0 ? { dates: [...m.schedule13.byCik.entries()].flatMap(([cik, xs]) => (siteCos.has(cik) ? xs.map((x) => x.filedAt) : [])) } : null,
    events: ev.length > 0 ? { dates: ev.map((r) => r.e.filed) } : null,
    votes: m.votes.shown ? { dates: m.votes.rolls.map((r) => r.date) } : null,
    lobbying: m.lobbying.length > 0 ? { dates: m.lobbying.map((l) => l.createdAt) } : null,
    contracts: m.contracts.length > 0 ? { dates: m.contracts.map((c) => c.actionDate) } : null,
    donations: cm.length > 0 ? { receipts: cm.reduce((a, c) => a + c.count, 0), committees: cm.length, windowDays: m.donationWindowDays } : null,
    rates,
  };
}

export function homeRoutes(m: Flagship, companies: number, rates: { tenYear: string; ibond: string } | null): RouteTile[] {
  return buildRoutes(homeInputs(m, companies, rates));
}

/** Three tickers and three members with the most trades disclosed in the last 30 days (counts only). */
export function recentlyActive(m: Flagship): { tickers: ActiveItem[]; members: ActiveItem[] } {
  const built = m.builtAt.slice(0, 10);
  const pub = m.txns.filter((t) => t.isPublished);
  const tick = pub.map((t) => {
    const s = t.securityId != null ? m.securities.get(t.securityId) : undefined;
    return { key: s?.ticker ?? "", text: s?.ticker ?? "", href: s ? securityPath(s) : null, date: t.disclosedAt };
  }).filter((r) => r.key);
  const mem = pub.filter((t) => t.source !== "sec_form4").map((t) => {
    const p = t.personId != null ? m.people.get(t.personId) : undefined;
    return { key: String(p?.id ?? ""), text: p?.name ?? "", href: p ? personPath(p) : null, date: t.disclosedAt };
  }).filter((r) => r.key);
  return { tickers: topActive(tick, built, 3), members: topActive(mem, built, 3) };
}
