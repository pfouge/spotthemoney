// The pure half of the build model: the types, the constants and the label / path / number
// helpers every page uses. No database, no Node APIs, so the on-demand Worker (lib/server/od.ts and
// the pages and components it renders) can import them without pulling in flagship.ts, which reads
// Postgres with Node-only code. flagship.ts re-exports everything here, so existing imports keep
// working unchanged.
import type { HoldingsChange } from "./holdings";

// ── types ────────────────────────────────────────────────────────────────────────────────
export interface Role {
  kind: "congress" | "insider";
  chamber: "house" | "senate" | null;
  state: string | null;
  district: string | null;
  party: string | null;
  companyId: number | null;
  officerTitle: string | null;
  isDirector: boolean | null;
  /** Congress: start of the current (or last) term; the end date is set once a member has left. */
  validFrom?: string | null; validTo?: string | null;
}
/** A current committee or subcommittee assignment (migration 0015; unitedstates/congress-legislators). */
export interface Seat {
  code: string; parent: string | null; chamber: "house" | "senate" | "joint"; name: string; url: string | null; jurisdiction: string | null;
  side: string | null; rank: number | null; title: string | null;
}
export interface Person {
  id: number; name: string; slug: string | null; bioguideId: string | null; cik: string | null;
  roles: Role[];
  txns: Txn[];                 // rendered transactions, newest first
  filings: Filing[];           // newest first
  isCongress: boolean; isInsider: boolean;
  lastFiledAt: string | null; firstFiledAt: string | null;
  underReview: boolean;
  /** Market scope only (stage 3b): the entity has no static page; the Worker renders it on request. */
  od?: true;
}
export interface Company {
  id: number; name: string; cik: string | null; slug: string | null; primaryTicker: string | null;
  sector: string | null;
  securityIds: number[];
  insiders: Person[];          // people with an insider role at this company
  txns: Txn[];
  contracts: ContractRow[];    // name-matched USAspending awards
  lobbying: LobbyingRow[];     // name-matched LDA filings (as client)
  underReview: boolean;
  od?: true;
}
export interface Security {
  id: number; ticker: string; type: string; name: string | null; companyId: number | null;
  txns: Txn[];                 // all rendered transactions in this security
  insiderTxns: Txn[]; congressTxns: Txn[];
  underReview: boolean;
  od?: true;
}
export interface Filing {
  id: number; source: string; externalId: string | null; personId: number | null; companyId: number | null;
  filedAt: string | null; sourceUrl: string | null; confidence: number; review: string; isPublished: boolean;
  txnCount: number;
  /** Form 4 only: non-derivative shares reported as held after the filing's last transaction. */
  heldAfter?: number | null;
}
export interface Txn {
  id: number; filingId: number; personId: number | null; securityId: number | null;
  side: string; code: string | null; isDerivative: boolean | null;
  txnDate: string | null; disclosedAt: string | null;
  amountLow: number | null; amountHigh: number | null; shares: number | null; price: number | null;
  lagDays: number | null; is10b51: boolean | null; ownerType: string | null; assetType: string | null;
  source: string; sourceUrl: string | null; filedAt: string | null; isPublished: boolean;
  /** shares × price for Form 4; the top of the range for PTRs. */
  value: number | null;
  /** Set when another filer's earlier Form 4 already reports this same transaction (lib/joint.ts): the id of that row. */
  jointOf?: number | null;
  /** Form 4 only: shares the insider owns after this transaction, as filed (non-derivative rows; lib/holdings.ts). */
  ownedAfter?: number | null;
  /** Form 4 only: change in the reported holding caused by this row, in percent; "new" for a first position (lib/holdings.ts). */
  holdingsChange?: HoldingsChange;
}
export interface LobbyingRow {
  id: number; registrant: string | null; client: string | null; issueArea: string | null; amount: number | null;
  year: number | null; quarter: number | null; filingType: string | null; sourceRef: string | null; createdAt: string;
  /** Every general issue code on the filing, in the filing's order (issueArea is the first). See lib/lobbyissues.ts. */
  issues?: string[];
}
export interface ContractRow {
  id: number; recipient: string | null; agency: string | null; amount: number | null; actionDate: string | null;
  naics: string | null; sourceRef: string | null; createdAt: string;
}
export interface CommitteeRow { id: number; fecId: string | null; name: string; party: string | null; type: string | null; total: number; count: number; latest: string | null }
export interface DonationAgg { key: string; total: number; count: number }

/** Market-scope Form 4 data (stage 3b). Separate from the tracked model on purpose: nothing but the home feed reads it. */
export interface MarketSlice {
  txns: Txn[]; people: Map<number, Person>; companies: Map<number, Company>; securities: Map<number, Security>;
  filings: Map<number, Filing>;
}
export const emptyMarket = (): MarketSlice => ({ txns: [], people: new Map(), companies: new Map(), securities: new Map(), filings: new Map() });

export interface Flagship {
  /** Market-scope Form 4 rows and the entities only they reference (empty when the load is skipped or fails). */
  market: MarketSlice;
  builtAt: string;
  connected: boolean;
  people: Map<number, Person>;
  companies: Map<number, Company>;
  securities: Map<number, Security>;
  filings: Map<number, Filing>;
  txns: Txn[];                          // all rendered transactions, newest disclosed first
  lobbying: LobbyingRow[];              // last 8 quarters, newest first
  contracts: ContractRow[];             // awards that started in the last 180 days, largest first
  committees: CommitteeRow[];           // committees with donation totals in the window
  donationsByEmployer: DonationAgg[];   // aggregates only — no individual donor names at launch
  donationsByState: DonationAgg[];
  donationWindowDays: number;
  counts: Record<string, number>;
  latestByPath: Map<string, string>;   // page path → lastmod (ISO date) for sitemaps
  issueNames: Map<string, string>;     // LDA general issue code → display name (for the charts)
  /** 10-digit CIK → size figures from SEC filings (company_size, migration 0013); see lib/capband.ts. */
  companySize: Map<string, { shares: number | null; sharesAsOf: string | null; float: number | null; floatAsOf: string | null }>;
  /** 10-digit CIK → the SEC's industry code for the company (company_sic, migration 0021); see industryOf in lib/entity.ts. Only companies that have a code. */
  companySic: Map<string, { sic: string; description: string | null }>;
  /** Person id → current committee and subcommittee seats. Empty until the roster job has run with migration 0015. */
  seats: Map<number, Seat[]>;
  /** Form 4 filing id → the filing's footnotes as clean text (lib/footnotes.ts). Only filings that have any. */
  footnotes: Map<number, string[]>;
}

/** "EVP &amp; CFO" → "EVP & CFO". Titles reached the database with XML escapes intact (migration 0016 repairs the stored rows). */
export function decodeEntities(s: string | null): string | null {
  if (!s || !s.includes("&")) return s;
  const once = (x: string) => x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
  return once(once(s));
}

export const CONGRESS_DEADLINE_DAYS = 45;
export const FORM4_DEADLINE_DAYS = 4; // 2 business days ≈ 4 calendar days, conservative

// ── derived helpers used by pages ────────────────────────────────────────────────────────
export function personPath(p: Person): string | null {
  if (!p.slug) return null;
  return p.isCongress ? `/congress/${p.slug}/` : `/insiders/${p.slug}/`;
}
export function companyPath(c: Company): string | null { return c.slug ? `/companies/${c.slug}/` : null; }
export function securityPath(s: Security): string { return `/stocks/${s.ticker.toLowerCase()}/`; }

export function sum(xs: (number | null | undefined)[]): number { return xs.reduce<number>((a, b) => a + (b ?? 0), 0); }
export function avg(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function daysAgo(n: number): string { return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10); }
export function withinDays(iso: string | null, n: number): boolean { return !!iso && iso.slice(0, 10) >= daysAgo(n); }
export function isLate(t: Txn): boolean {
  if (t.lagDays == null) return false;
  return t.source === "sec_form4" ? t.lagDays > FORM4_DEADLINE_DAYS : t.lagDays > CONGRESS_DEADLINE_DAYS;
}
export function roleLabel(p: Person, companies: Map<number, Company>): string {
  const cr = p.roles.find((r) => r.kind === "congress");
  if (cr) {
    const ch = cr.chamber === "senate" ? "Senator" : "Representative";
    const seat = [cr.state, cr.district ? `District ${cr.district}` : null].filter(Boolean).join(", ");
    return `${ch}${seat ? ` (${seat})` : ""}${cr.party ? `, ${cr.party}` : ""}`;
  }
  const ir = p.roles.find((r) => r.kind === "insider");
  if (ir) {
    const co = ir.companyId != null ? companies.get(ir.companyId)?.name : null;
    const title = ir.officerTitle ?? (ir.isDirector ? "Director" : "Insider");
    return `${title}${co ? ` at ${co}` : ""}`;
  }
  return "Filer";
}
export function sideLabel(t: Txn): string {
  switch (t.side) { case "buy": return "Buy"; case "sell": return "Sell"; case "option": return "Option / conversion"; case "exchange": return "Exchange"; default: return "Other"; }
}
/** Human label for a PTR asset class when the row has no ticker (e.g. municipal bonds, LP interests). */
export function assetLabel(assetType: string | null | undefined): string {
  switch (assetType) {
    case "stock": return "stock (no ticker)"; case "etf": return "ETF"; case "bond": return "bond";
    case "fund": return "fund"; case "hedge_fund": return "hedge fund"; case "private_equity": return "private equity";
    case "option": return "option"; case "crypto": return "crypto"; case "real_property": return "real property";
    case "bank_account": return "bank account"; case "other": return "other asset";
    default: return assetType ? assetType.replace(/_/g, " ") : "no ticker";
  }
}
export function amountLabel(t: Txn): string {
  if (t.value != null && t.shares != null && t.price != null && t.price > 0) return money(t.value);
  if (t.amountLow != null || t.amountHigh != null) {
    if (t.amountLow != null && t.amountHigh != null) return `${money(t.amountLow)}–${money(t.amountHigh)}`;
    if (t.amountHigh != null) return `up to ${money(t.amountHigh)}`;
    return `over ${money(t.amountLow!)}`;
  }
  return "—";
}
export function money(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts.compact !== false) {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e4) return `$${Math.round(n / 1e3)}K`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
export function num(n: number | null | undefined): string { return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }); }
export function plural(n: number, one: string, many = `${one}s`): string { return `${num(n)} ${n === 1 ? one : many}`; }

/** Tracked Form 4 rows followed by market-scope rows (the feed's insider universe). */
export function allFormFourTxns(m: Pick<Flagship, "txns" | "market">): Txn[] {
  const out: Txn[] = [];
  for (const t of m.txns) if (t.source === "sec_form4") out.push(t);
  for (const t of m.market.txns) out.push(t);
  return out;
}

export type EntityKind = "congress" | "insider" | "stock" | "company";
/** The one place an entity address is built (same pattern for tracked and market entities). */
export function entityPath(kind: EntityKind, e: { slug?: string | null; ticker?: string }): string | null {
  if (kind === "stock") return e.ticker ? `/stocks/${e.ticker.toLowerCase()}/` : null;
  if (!e.slug) return null;
  return `/${kind === "congress" ? "congress" : kind === "insider" ? "insiders" : "companies"}/${e.slug}/`;
}
