// Aggregations that turn the build-time model (lib/flagship.ts) into the inputs lib/viz.ts
// draws. Pure functions over arrays already in memory — no extra database reads. Conventions:
//   · "dollars" for a congressional trade is the TOP of its disclosed range (same rule as the
//     heatmap); for Form 4 it is shares × price.
//   · insider buy/sell flows count OPEN-MARKET trades only (codes P and S) and leave out
//     pre-scheduled 10b5-1 plans — grants, option exercises and tax withholding are not a
//     view on the stock. Timelines and "who is trading" show every transaction.
//   · dates are the TRADE date where known, else the disclosure date.

import { type Flagship, type Txn, type Person, type Security, type Company, isLate, personPath, securityPath, CONGRESS_DEADLINE_DAYS, FORM4_DEADLINE_DAYS } from "./flagship";

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const todayIso = () => iso(Date.now());
const when = (t: Txn) => t.txnDate ?? t.disclosedAt ?? null;
const val = (t: Txn) => t.value ?? 0;
export const isInsiderTxn = (t: Txn) => t.source === "sec_form4";
/** The trades that say something about direction: all congressional buys/sells; insider open-market, non-plan. */
export const isSignal = (t: Txn) => (t.side === "buy" || t.side === "sell") && (!isInsiderTxn(t) || ((t.code === "P" || t.code === "S") && !t.is10b51));
const since = (txns: Txn[], days: number) => { const c = iso(Date.now() - days * DAY); return txns.filter((t) => (when(t) ?? "") >= c); };
const split = (txns: Txn[]) => { let buy = 0, sell = 0; for (const t of txns) { if (t.side === "buy") buy += val(t); else if (t.side === "sell") sell += val(t); } return { buy, sell }; };
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 01 ticker tape
export function tapeItems(m: Flagship, n = 18) {
  const out: { ticker: string; href: string; side: "buy" | "sell"; amount: number; who: string; days: number }[] = [];
  for (const t of m.txns) {
    if (!t.isPublished || !isSignal(t) || t.securityId == null || !val(t)) continue;
    const s = m.securities.get(t.securityId), p = t.personId != null ? m.people.get(t.personId) : undefined;
    if (!s || !p) continue;
    const d = t.disclosedAt ? Math.max(0, Math.round((Date.now() - Date.parse(t.disclosedAt)) / DAY)) : 0;
    out.push({ ticker: s.ticker, href: securityPath(s), side: t.side as "buy" | "sell", amount: val(t), who: p.isCongress ? `Rep. ${p.name}` : p.name, days: d });
    if (out.length >= n) break;
  }
  return out;
}

// 02 headline tiles
export function headlineTiles(m: Flagship) {
  const pub = m.txns.filter((t) => t.isPublished);
  const byDisc = (a: number, b: number) => { const lo = iso(Date.now() - a * DAY), hi = iso(Date.now() - b * DAY); return pub.filter((t) => (t.disclosedAt ?? "") > lo && (t.disclosedAt ?? "") <= hi); };
  const weeks = Array.from({ length: 13 }, (_, i) => byDisc((13 - i) * 7, (12 - i) * 7));
  /** Buying as a share of open-market insider dollars (0–100), or null when there were none. A ratio would be undefined in a week with no sells. */
  const share = (ts: Txn[]) => { const s = split(ts.filter((t) => isInsiderTxn(t) && isSignal(t))); return s.buy + s.sell > 0 ? (s.buy / (s.buy + s.sell)) * 100 : null; };
  const cur = weeks[12]!, prev = weeks[11]!;
  const dollars = (ts: Txn[]) => ts.filter(isSignal).reduce((a, t) => a + val(t), 0);
  const late = (ts: Txn[]) => ts.filter(isLate).length;
  const delta = (a: number, b: number, fmt: (n: number) => string) => (a === b ? "same as the week before" : `${a > b ? "▲" : "▼"} ${fmt(Math.abs(a - b))} vs the week before`);
  return { weeks, cur, prev, dollars, late, share, delta };
}

// 03 gauge
export function gaugeData(txns: Txn[]) {
  const sig = txns.filter((t) => t.isPublished && isInsiderTxn(t) && isSignal(t));
  const cur = split(since(sig, 30));
  const now = new Date(), monthly: { label: string; share: number | null }[] = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)), key = d.toISOString().slice(0, 7);
    const s = split(sig.filter((t) => (when(t) ?? "").startsWith(key)));
    monthly.push({ label: MONTH[d.getUTCMonth()]!, share: s.buy + s.sell > 0 ? (s.buy / (s.buy + s.sell)) * 100 : null });
  }
  while (monthly.length > 2 && monthly[0]!.share == null) monthly.shift();
  return { ...cur, monthly };
}

// 04 calendar · 05 weekly flow
export function calendarData(txns: Txn[]) {
  const days = new Map<string, { buy: number; sell: number; n: number }>(), cut = iso(Date.now() - 372 * DAY);
  for (const t of txns) {
    const d = when(t);
    if (!t.isPublished || !d || d < cut || !isSignal(t)) continue;
    const o = days.get(d) ?? { buy: 0, sell: 0, n: 0 };
    o.n++; if (t.side === "buy") o.buy += val(t); else o.sell += val(t);
    days.set(d, o);
  }
  return days;
}
export function weeklyFlow(txns: Txn[], weeks = 26) {
  const end = Date.now(), out: { label: string; buy: number; sell: number }[] = [];
  const sig = txns.filter((t) => t.isPublished && isSignal(t));
  for (let k = weeks - 1; k >= 0; k--) {
    const lo = iso(end - (k + 1) * 7 * DAY), hi = iso(end - k * 7 * DAY);
    const s = split(sig.filter((t) => { const d = when(t) ?? ""; return d > lo && d <= hi; }));
    const dt = new Date(end - (k + 1) * 7 * DAY + DAY);
    out.push({ label: `${MONTH[dt.getUTCMonth()]} ${dt.getUTCDate()}`, ...s });
  }
  return out;
}

// 06 party & chamber · 07 state map · 08 lag histogram (Congress)
const congressRole = (p: Person | undefined) => p?.roles.find((r) => r.kind === "congress");
export function congressTxns(m: Flagship, days = 365) { return since(m.txns.filter((t) => t.isPublished && !isInsiderTxn(t)), days); }
export function partySplit(m: Flagship, txns: Txn[]) {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    const r = congressRole(t.personId != null ? m.people.get(t.personId) : undefined);
    if (!r) continue;
    const pa = (r.party ?? "").toLowerCase(), party = pa.startsWith("dem") ? "Democrats" : pa.startsWith("rep") ? "Republicans" : r.party ? "Independents" : "Party not on file";
    const key = `${r.chamber === "senate" ? "Senate" : "House"} ${party}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const order = ["House Democrats", "House Republicans", "Senate Democrats", "Senate Republicans"];
  return [...groups.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99 || a[0].localeCompare(b[0])).map(([label, ts]) => ({ label, ...split(ts.filter(isSignal)) }));
}
export function stateVolumes(m: Flagship, txns: Txn[]) {
  const vol = new Map<string, number>(), who = new Map<string, Set<string>>();
  for (const t of txns) {
    const p = t.personId != null ? m.people.get(t.personId) : undefined, st = congressRole(p)?.state;
    if (!p || !st || !isSignal(t)) continue;
    vol.set(st, (vol.get(st) ?? 0) + val(t));
    who.set(st, (who.get(st) ?? new Set()).add(p.name));
  }
  const detail = new Map([...who.entries()].map(([st, s]) => [st, [...s].slice(0, 3).join(", ") + (s.size > 3 ? ` and ${s.size - 3} more` : "")]));
  return { vol, detail };
}
export function lagStats(txns: Txn[], deadline: number) {
  const lags = txns.map((t) => t.lagDays).filter((d): d is number => d != null && d >= 0);
  const sorted = [...lags].sort((a, b) => a - b), late = lags.filter((d) => d > deadline).length;
  return { lags, median: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null, late, pctLate: lags.length ? (late / lags.length) * 100 : 0 };
}

// 09 cluster buys
export function clusterBuys(m: Flagship, days = 30, min = 3) {
  const by = new Map<number, Txn[]>();
  for (const t of since(m.txns, days)) if (t.isPublished && isInsiderTxn(t) && t.code === "P" && t.securityId != null) by.set(t.securityId, [...(by.get(t.securityId) ?? []), t]);
  const out: { ticker: string; href: string; buyers: number; total: number; roles: string }[] = [];
  for (const [sid, ts] of by) {
    const people = new Set(ts.map((t) => t.personId)), s = m.securities.get(sid);
    if (!s || people.size < min) continue;
    const roles = [...people].map((id) => { const r = id != null ? m.people.get(id)?.roles.find((x) => x.kind === "insider") : undefined; return r?.officerTitle ?? (r?.isDirector ? "Director" : "Insider"); });
    const tally = new Map<string, number>(); for (const r of roles) tally.set(r, (tally.get(r) ?? 0) + 1);
    out.push({ ticker: s.ticker, href: securityPath(s), buyers: people.size, total: ts.reduce((a, t) => a + val(t), 0), roles: [...tally.entries()].slice(0, 3).map(([r, n]) => (n > 1 ? `${n} × ${r}` : r)).join(", ") });
  }
  return out.sort((a, b) => b.buyers - a.buyers || b.total - a.total).slice(0, 6);
}

// 10 Congress vs insiders
export function agreementPoints(m: Flagship, days = 365) {
  const pts: { label: string; x: number; y: number; size: number; href: string }[] = [];
  for (const s of m.securities.values()) {
    const ins = split(since(s.insiderTxns.filter((t) => t.isPublished && isSignal(t)), days)), con = split(since(s.congressTxns.filter((t) => t.isPublished && isSignal(t)), days));
    if (ins.buy + ins.sell === 0 || con.buy + con.sell === 0) continue;
    pts.push({ label: s.ticker, x: ins.buy - ins.sell, y: con.buy - con.sell, size: ins.buy + ins.sell + con.buy + con.sell, href: securityPath(s) });
  }
  return pts;
}

// 11 leaderboards
export function leaderboards(m: Flagship, days = 90) {
  const recent = since(m.txns.filter((t) => t.isPublished), days);
  const members = new Map<number, number>(), tickers = new Map<number, number>();
  for (const t of recent) {
    if (!isInsiderTxn(t) && t.personId != null) members.set(t.personId, (members.get(t.personId) ?? 0) + 1);
    if (isSignal(t) && t.securityId != null) tickers.set(t.securityId, (tickers.get(t.securityId) ?? 0) + val(t));
  }
  const top = <K>(mm: Map<K, number>, n = 8) => [...mm.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
  return {
    members: top(members).map(([id, n]) => { const p = m.people.get(id)!; return { label: p.name, value: n, valueLabel: `${n} trade${n === 1 ? "" : "s"}`, href: personPath(p) }; }),
    buys: recent.filter((t) => t.side === "buy" && isSignal(t) && val(t) > 0).sort((a, b) => val(b) - val(a)).slice(0, 8).map((t) => { const p = t.personId != null ? m.people.get(t.personId) : undefined, s = t.securityId != null ? m.securities.get(t.securityId) : undefined; return { label: `${p?.name ?? "Filer"} · ${s?.ticker ?? "—"}`, value: val(t), valueLabel: usd(val(t)), href: p ? personPath(p) : null }; }),
    tickers: top(tickers).map(([id, v]) => { const s = m.securities.get(id)!; return { label: s.ticker, value: v, valueLabel: usd(v), href: securityPath(s) }; }),
  };
}

// 13 holdings · 14 who is trading (ticker pages)
export function holdingsSeries(m: Flagship, s: Security) {
  const byPerson = new Map<number, { date: string; value: number }[]>(), seen = new Set<number>();
  for (const t of s.insiderTxns) {
    if (seen.has(t.filingId) || t.personId == null) continue;
    seen.add(t.filingId);
    const f = m.filings.get(t.filingId);
    if (!f?.filedAt || f.heldAfter == null) continue;
    byPerson.set(t.personId, [...(byPerson.get(t.personId) ?? []), { date: f.filedAt.slice(0, 10), value: f.heldAfter }]);
  }
  return [...byPerson.entries()].map(([id, pts]) => ({ name: m.people.get(id)?.name ?? "Insider", points: pts.sort((a, b) => a.date.localeCompare(b.date)) }))
    .filter((x) => x.points.length >= 2).sort((a, b) => b.points.length - a.points.length).slice(0, 2);
}
/** 12b: open-market insider trades of one stock with the share price each Form 4 reported (last two years). */
export function tradePrices(m: Flagship, s: Security) {
  const cut = iso(Date.now() - 730 * DAY);
  return s.insiderTxns.filter((t) => t.isPublished && (t.code === "P" || t.code === "S") && !t.isDerivative && (t.side === "buy" || t.side === "sell") && (t.price ?? 0) > 0 && t.txnDate != null && t.txnDate >= cut)
    .map((t) => ({ date: t.txnDate!.slice(0, 10), price: t.price!, side: t.side, value: val(t), label: (t.personId != null ? m.people.get(t.personId)?.name : null) ?? "Insider" }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function whoIsTrading(m: Flagship, txns: Txn[], days = 365) {
  const by = new Map<number, Txn[]>();
  for (const t of since(txns, days)) if (t.personId != null && (t.side === "buy" || t.side === "sell")) by.set(t.personId, [...(by.get(t.personId) ?? []), t]);
  return [...by.entries()].map(([id, ts]) => { const p = m.people.get(id)!; return { label: p.isCongress ? `Rep. ${p.name}` : p.name, href: personPath(p), ...split(ts) }; })
    .sort((a, b) => b.buy + b.sell - (a.buy + a.sell)).slice(0, 8);
}

// 15 Washington exposure (company)
export function lobbyingByQuarter(c: Company, quarters = 8) {
  const now = new Date(), out: { label: string; value: number }[] = [];
  let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < quarters; i++) { out.unshift({ label: `Q${q} ${String(y).slice(2)}`, value: c.lobbying.filter((r) => r.year === y && r.quarter === q).reduce((a, r) => a + (r.amount ?? 0), 0) }); q--; if (q === 0) { q = 4; y--; } }
  return out;
}
const groupSum = <T>(rows: T[], key: (r: T) => string | null, v: (r: T) => number) => { const m = new Map<string, number>(); for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + v(r)); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
export function contractsByAgency(c: Company, n = 6) {
  const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
  return groupSum(c.contracts, (r) => r.agency, (r) => Math.max(0, r.amount ?? 0)).slice(0, n).map(([label, value]) => ({ label, value, valueLabel: usd(value) }));
}

// 16 timeline · 17 portfolio mix · 18 lag strip (person pages)
export function timelineDots(m: Flagship, txns: Txn[]) {
  return txns.filter((t) => when(t)).map((t) => ({ date: when(t)!, value: val(t), side: t.side, label: (t.securityId != null ? m.securities.get(t.securityId)?.ticker : null) ?? "No ticker" }));
}
export function portfolioMix(m: Flagship, txns: Txn[]) {
  const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
  const by = new Map<number, number>();
  for (const t of txns) if (t.securityId != null && (t.side === "buy" || t.side === "sell")) by.set(t.securityId, (by.get(t.securityId) ?? 0) + val(t));
  return [...by.entries()].map(([id, v]) => { const s = m.securities.get(id); return s ? { name: s.ticker, value: v, label: usd(v), href: securityPath(s) } : null; }).filter((x): x is NonNullable<typeof x> => !!x && x.value > 0);
}
export function lagBars(m: Flagship, p: Person) {
  const seen = new Set<number>(), out: { days: number; label: string; date: string }[] = [];
  for (const t of p.txns) {
    if (t.lagDays == null || seen.has(t.filingId)) continue;
    seen.add(t.filingId);
    const worst = Math.max(...p.txns.filter((x) => x.filingId === t.filingId && x.lagDays != null).map((x) => x.lagDays!));
    out.push({ days: worst, label: `Filed ${t.disclosedAt ?? "—"}`, date: t.disclosedAt ?? "" });
  }
  return { bars: out.sort((a, b) => a.date.localeCompare(b.date)), deadline: p.isCongress ? CONGRESS_DEADLINE_DAYS : FORM4_DEADLINE_DAYS };
}

// 19 lobbying by issue · 20 contract flow
export function lobbyingIssues(m: Flagship, year: number) {
  const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
  return groupSum(m.lobbying.filter((r) => r.year === year), (r) => r.issueArea, (r) => r.amount ?? 0).map(([code, value]) => ({ name: m.issueNames.get(code) ?? code, value, label: usd(value) }));
}
export function contractFlows(m: Flagship, nLeft = 5, nRight = 7) {
  const clean = (s: string) => s.replace(/^Department of (the )?/i, "").replace(/,? ?(INC|LLC|CORP|CORPORATION|COMPANY|CO|L\.?P\.?|LTD)\.?$/i, "").trim();
  const rows = m.contracts.filter((r) => r.agency && r.recipient && (r.amount ?? 0) > 0);
  const topL = new Set(groupSum(rows, (r) => r.agency, (r) => r.amount!).slice(0, nLeft).map((x) => x[0])), topR = new Set(groupSum(rows, (r) => r.recipient, (r) => r.amount!).slice(0, nRight).map((x) => x[0]));
  const m2 = new Map<string, { left: string; right: string; value: number }>();
  for (const r of rows) {
    const left = topL.has(r.agency!) ? clean(r.agency!) : "Other agencies", right = topR.has(r.recipient!) ? clean(r.recipient!) : "All other recipients", k = left + "→" + right;
    const o = m2.get(k) ?? { left, right, value: 0 }; o.value += r.amount!; m2.set(k, o);
  }
  return [...m2.values()];
}
