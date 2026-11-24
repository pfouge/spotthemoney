// Military parts orders: Defense Logistics Agency (DLA) awards posted on DIBBS, read at build time
// from nsnexplorer.com's database (lib/dla-build.ts does the reading). Pure rules here; tests in
// scripts/dla.test.ts.
//
// What a row is. nsnexplorer stores every DLA award record DIBBS posts (pub.contract_actions rows
// whose raw record has a CAGE code): the part (NSN and its name), the supplier's CAGE code, the
// order or contract number, the date and the amount.
//
// Orders, not ceilings. A DLA base contract (PIID type letter D, an indefinite-delivery contract;
// G and A, ordering agreements) is posted with its ceiling, not with money spent: one respirator
// cartridge contract reads $60 billion. Such a record is never counted. What counts is a delivery
// order under a contract (a record with a delivery order number) and a stand-alone purchase order or
// definitive contract (type letters P, V, C, M and others). Measured 2026-11-24: base contracts
// $149 billion in 8,283 records; orders about $17.6 billion over 12 months.
//
// Which company. DIBBS names the supplier by CAGE code; nsnexplorer adds the supplier's name. A
// supplier is matched to a company with a page by three rules, in this order:
//   1. name: the supplier name, cut at " DIV " or " DBA ", equals the company's name under the site's
//      one name rule (shared/orgname: normalizeOrgName, SEC state suffixes such as "/DE/" dropped),
//      and only one company has that name;
//   2. prefix: the supplier name starts with the company's full name followed by more words
//      ("NORTHROP GRUMMAN SYSTEMS" for Northrop Grumman), for company names of two or more words and
//      at least PREFIX_MIN_CHARS characters; the longest such company wins;
//   3. alias: a short list of subsidiaries whose names do not contain the parent's (SUBSIDIARIES
//      below), each a well-known, current ownership.
// A supplier with no name on file, or no match, is left out. So the figures are a floor: orders
// placed with a company's other subsidiaries are not counted.

import { normalizeOrgName } from "@stm/shared";

export const DLA_WINDOW_DAYS = 365;
/** Base contracts and agreements carry a ceiling, never counted (the PIID's ninth character). */
export const CEILING_TYPES = ["D", "G", "A"] as const;
export const PREFIX_MIN_CHARS = 8;
export const TOP_PARTS = 25;
export const LATEST_ORDERS = 25;
export const NSN_SITE = "https://nsnexplorer.com";

/**
 * Subsidiaries whose names do not start with the listed parent's name. Normalised names (as
 * normalizeOrgName gives them); a supplier name that starts with the key belongs to the ticker.
 * Only ownerships that are well known and current go here.
 */
export const SUBSIDIARIES: Record<string, string> = {
  "SIKORSKY AIRCRAFT": "LMT",          // Lockheed Martin since 2015
  "HAMILTON SUNDSTRAND": "RTX",        // Collins Aerospace, RTX
  "COLLINS AEROSPACE": "RTX",
  "ROCKWELL COLLINS": "RTX",
  "RAYTHEON": "RTX",
  "PRATT & WHITNEY": "RTX",
  "BELL TEXTRON": "TXT",
  "TEXTRON": "TXT",
  "AVIALL": "BA",                      // Boeing Distribution
  "ELECTRIC BOAT": "GD",
  "BATH IRON WORKS": "GD",
  "GULFSTREAM AEROSPACE": "GD",
  "NEWPORT NEWS SHIPBUILDING": "HII",
  "INGALLS SHIPBUILDING": "HII",
  "OSHKOSH DEFENSE": "OSK",
  "AAR MANUFACTURING": "AIR",
  "AAR SUPPLY CHAIN": "AIR",
  "AAR AIRLIFT": "AIR",
  "L3 TECHNOLOGIES": "LHX",
  "L3HARRIS": "LHX",
  "GE AVIATION": "GE",
  "MEDLINE INDUSTRIES": "MDLN",
};
/**
 * Supplier names that share a company's name but are a different business (checked by hand against
 * the 12-month supplier list, 2026-11-24). Never matched by the name rule.
 */
export const NOT_THE_COMPANY = new Set(["VIKING"]); // Viking Incorporated, not Viking Holdings (cruises)
/** Exact names only (too short to use as a start): LORD Corporation is Parker-Hannifin's since 2019. */
export const SUBSIDIARIES_EXACT: Record<string, string> = { "LORD": "PH" };

export type MatchRule = "name" | "prefix" | "subsidiary";
export interface MatchCompany { id: number; name: string; ticker: string | null }
export interface Match { companyId: number; rule: MatchRule }

/** The supplier name cut at " DIV ..." or " DBA ..." (a division or trade name of the same entity). */
export const trimDivision = (s: string): string => s.replace(/\s+(DIV|DBA|D\/B\/A)\s.*$/i, "").trim();
/** The matching key: the site's name rule, with SEC state suffixes ("/DE/") and a division or trade name cut off. */
export const orgKey = (s: string): string => normalizeOrgName(trimDivision(s)).replace(/(\s*\/[A-Z]{2,3}\/?)+$/, "").replace(/\s+/g, " ").trim();

/** True for a record that is an order (counted), false for a base contract or agreement (a ceiling). */
export function isOrder(deliveryOrder: string | null | undefined, awardNumber: string | null | undefined): boolean {
  if (deliveryOrder && deliveryOrder.trim()) return true;
  const t = (awardNumber ?? "").trim().toUpperCase().charAt(8);
  return !(CEILING_TYPES as readonly string[]).includes(t);
}

/** A matcher over the companies that have a page. Returns null for a supplier no rule ties to one company. */
export function makeMatcher(companies: MatchCompany[]): (names: (string | null | undefined)[]) => Match | null {
  const byName = new Map<string, number[]>();
  const byTicker = new Map<string, number>();
  for (const c of companies) {
    const k = orgKey(c.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), c.id]);
    if (c.ticker) byTicker.set(c.ticker.toUpperCase(), c.id);
  }
  const prefixes = [...byName].filter(([k, ids]) => ids.length === 1 && k.length >= PREFIX_MIN_CHARS && k.includes(" ")).sort((a, b) => b[0].length - a[0].length);
  const subs = Object.entries(SUBSIDIARIES).sort((a, b) => b[0].length - a[0].length);
  return (names) => {
    const keys = names.filter((n): n is string => !!n && !!n.trim()).map(orgKey).filter(Boolean);
    for (const k of keys) { const ids = NOT_THE_COMPANY.has(k) ? undefined : byName.get(k); if (ids?.length === 1) return { companyId: ids[0]!, rule: "name" }; }
    for (const k of keys) { const hit = prefixes.find(([p]) => k.startsWith(p + " ")); if (hit) return { companyId: hit[1][0]!, rule: "prefix" }; }
    for (const k of keys) {
      const t = SUBSIDIARIES_EXACT[k] ?? subs.find(([p]) => k === p || k.startsWith(p + " "))?.[1];
      const id = t ? byTicker.get(t) : undefined;
      if (id != null) return { companyId: id, rule: "subsidiary" };
    }
    return null;
  };
}

export interface OrderRow { cage: string; date: string; nsn: string; item: string | null; piid: string | null; value: number; url: string | null }
export interface SupplierRef { cage: string; name: string; rule: MatchRule; orders: number; value: number }
export interface PartRow { nsn: string; item: string | null; orders: number; value: number; last: string }
export interface CompanyDla {
  suppliers: SupplierRef[]; orders: number; value: number; parts: number; first: string; last: string;
  months: { key: string; label: string; value: number; orders: number }[]; topParts: PartRow[]; latest: OrderRow[];
}
export interface DlaData { connected: boolean; newest: string | null; builtOn: string | null; byCompany: Map<number, CompanyDla>; cages: number; matchedCages: number }
export const emptyDla = (): DlaData => ({ connected: false, newest: null, builtOn: null, byCompany: new Map(), cages: 0, matchedCages: 0 });

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The 12 calendar months ending with the build month, oldest first ("2025-12" ... "2026-11"). */
export function monthKeys(builtOn: string): string[] {
  const [y, m] = builtOn.split("-").map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; });
}
const monthLabel = (k: string) => `${MON[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;

/** One company's summary from its matched suppliers' order rows. */
export function companyDla(suppliers: SupplierRef[], rows: OrderRow[], builtOn: string): CompanyDla | null {
  const live = rows.filter((r) => Number.isFinite(r.value) && r.value > 0);
  if (!live.length) return null;
  const keys = monthKeys(builtOn);
  const months = keys.map((k) => ({ key: k, label: monthLabel(k), value: 0, orders: 0 }));
  const mi = new Map(keys.map((k, i) => [k, i]));
  const parts = new Map<string, PartRow>();
  let value = 0, first = live[0]!.date, last = live[0]!.date;
  for (const r of live) {
    value += r.value;
    if (r.date < first) first = r.date; if (r.date > last) last = r.date;
    const i = mi.get(r.date.slice(0, 7)); if (i != null) { months[i]!.value += r.value; months[i]!.orders++; }
    const p = parts.get(r.nsn) ?? { nsn: r.nsn, item: r.item, orders: 0, value: 0, last: r.date };
    p.orders++; p.value += r.value; if (r.date >= p.last) { p.last = r.date; if (r.item) p.item = r.item; }
    parts.set(r.nsn, p);
  }
  const topParts = [...parts.values()].sort((a, b) => b.value - a.value || b.orders - a.orders || a.nsn.localeCompare(b.nsn)).slice(0, TOP_PARTS);
  const latest = [...live].sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value || (a.piid ?? "").localeCompare(b.piid ?? "")).slice(0, LATEST_ORDERS);
  const sup = [...suppliers].sort((a, b) => b.value - a.value || a.cage.localeCompare(b.cage));
  return { suppliers: sup, orders: live.length, value, parts: parts.size, first, last, months, topParts, latest };
}

/** "5340013494824" -> "5340-01-349-4824"; anything else as given. */
export function dashedNsn(nsn: string): string {
  const d = nsn.replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 9)}-${d.slice(9)}` : nsn;
}
export const nsnUrl = (nsn: string): string => `${NSN_SITE}/nsn/${dashedNsn(nsn)}/`;
export const supplierUrl = (cage: string): string => `${NSN_SITE}/supplier/${encodeURIComponent(cage.trim().toUpperCase())}/`;
/** Item names arrive in capitals, cut at 20 characters by DIBBS ("CARTRIDGE, RESPIRATO"); shown as filed. */
export const itemText = (s: string | null): string => (s ?? "").trim() || "Item name not given";

export const RULE_TEXT: Record<MatchRule, string> = {
  name: "same name",
  prefix: "name starts with the company's",
  subsidiary: "known subsidiary",
};
export const DLA_CAVEAT = "Orders the Defense Logistics Agency posted on DIBBS for suppliers matched to this company by name, over the last 12 months. Base contracts are posted with a ceiling, not money spent, and are not counted; orders placed with subsidiaries under other names are missed, so the figures are a floor.";

/** One build-log line to compare with SQL. */
export function dlaLog(d: DlaData, label: (companyId: number) => string = String): string {
  if (!d.connected) return "military parts orders (DLA via nsnexplorer): not read (no NSN_DATABASE_URL or the read failed)";
  const cos = [...d.byCompany.values()];
  const orders = cos.reduce((a, c) => a + c.orders, 0), value = cos.reduce((a, c) => a + c.value, 0);
  const top = [...d.byCompany].sort((a, b) => b[1].value - a[1].value).slice(0, 6).map(([id, c]) => `${label(id)} ${c.orders}/$${(c.value / 1e6).toFixed(1)}M`).join(", ");
  return `military parts orders (DLA via nsnexplorer): ${d.cages} supplier codes with orders in ${DLA_WINDOW_DAYS} days, ${d.matchedCages} matched to ${cos.length} companies; ${orders} orders, $${(value / 1e6).toFixed(1)}M; newest order ${d.newest ?? "none"}; top (orders/value): ${top}`;
}
