// Build-time model for the Follow-the-Money pages. Loaded ONCE per build (module-level
// promise) with a handful of bulk queries, then every entity page, collection page, feed and
// sitemap derives from the same in-memory graph. That keeps the build to seconds of DB time
// however many pages there are, and guarantees every page and its sitemap entry agree.
//
// Publish gate: a row renders only if its filing's review is approved and confidence ≥ 0.9
// (never pending / needs_ocr rows). Filings Peter has not yet sample-approved
// (is_published = false) DO render, flagged `underReview`, and every page that shows one
// carries a visible "under review" note — the decision recorded in CLAUDE.md SESSION STATE
// 2026-09-27 ("publish partial rather than wait"). The API (RLS, migration 0006) hides them.
//
// Everything is null-safe: with no DATABASE_URL, or empty tables, the model is empty and the
// pages render their empty-state reason lines instead of blank tables.

import postgres from "postgres";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ── connection (same rules as lib/db.ts; duplicated to keep that module untouched) ──────
let _sql: ReturnType<typeof postgres> | null | undefined;
function loadRootEnv() {
  try {
    if (process.env.DATABASE_URL) return;
    let dir = process.cwd();
    for (let i = 0; i < 4; i++) {
      const envFile = join(dir, ".env");
      if (existsSync(envFile)) { process.loadEnvFile?.(envFile); return; }
      const parent = dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  } catch { /* rely on the real environment */ }
}
function db() {
  if (_sql !== undefined) return _sql;
  loadRootEnv();
  const url = process.env.DATABASE_URL ?? import.meta.env.DATABASE_URL;
  _sql = url ? postgres(url, { max: 1 }) : null;
  return _sql;
}

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
}
export interface Person {
  id: number; name: string; slug: string | null; bioguideId: string | null; cik: string | null;
  roles: Role[];
  txns: Txn[];                 // rendered transactions, newest first
  filings: Filing[];           // newest first
  isCongress: boolean; isInsider: boolean;
  lastFiledAt: string | null; firstFiledAt: string | null;
  underReview: boolean;
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
}
export interface Security {
  id: number; ticker: string; type: string; name: string | null; companyId: number | null;
  txns: Txn[];                 // all rendered transactions in this security
  insiderTxns: Txn[]; congressTxns: Txn[];
  underReview: boolean;
}
export interface Filing {
  id: number; source: string; externalId: string | null; personId: number | null; companyId: number | null;
  filedAt: string | null; sourceUrl: string | null; confidence: number; review: string; isPublished: boolean;
  txnCount: number;
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
}
export interface LobbyingRow {
  id: number; registrant: string | null; client: string | null; issueArea: string | null; amount: number | null;
  year: number | null; quarter: number | null; filingType: string | null; sourceRef: string | null; createdAt: string;
}
export interface ContractRow {
  id: number; recipient: string | null; agency: string | null; amount: number | null; actionDate: string | null;
  naics: string | null; sourceRef: string | null; createdAt: string;
}
export interface CommitteeRow { id: number; fecId: string | null; name: string; party: string | null; type: string | null; total: number; count: number; latest: string | null }
export interface DonationAgg { key: string; total: number; count: number }

export interface Flagship {
  builtAt: string;
  connected: boolean;
  people: Map<number, Person>;
  companies: Map<number, Company>;
  securities: Map<number, Security>;
  filings: Map<number, Filing>;
  txns: Txn[];                          // all rendered transactions, newest disclosed first
  lobbying: LobbyingRow[];              // last 8 quarters, newest first
  contracts: ContractRow[];             // last 180 days, largest first
  committees: CommitteeRow[];           // committees with donation totals in the window
  donationsByEmployer: DonationAgg[];   // aggregates only — no individual donor names at launch
  donationsByState: DonationAgg[];
  donationWindowDays: number;
  counts: Record<string, number>;
  latestByPath: Map<string, string>;   // page path → lastmod (ISO date) for sitemaps
}

const APPROVED = new Set(["auto_approved", "approved"]);
export const CONGRESS_DEADLINE_DAYS = 45;
export const FORM4_DEADLINE_DAYS = 4; // 2 business days ≈ 4 calendar days, conservative

export function normalizeOrgName(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[.,'"()]/g, " ")
    .replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|LTD|LIMITED|PLC|THE|HOLDINGS?|GROUP)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function load(): Promise<Flagship> {
  const builtAt = new Date().toISOString();
  const empty: Flagship = {
    builtAt, connected: false, people: new Map(), companies: new Map(), securities: new Map(), filings: new Map(),
    txns: [], lobbying: [], contracts: [], committees: [], donationsByEmployer: [], donationsByState: [],
    donationWindowDays: 90, counts: {}, latestByPath: new Map(),
  };
  const sql = db();
  if (!sql) { console.warn("[web] DATABASE_URL not set — flagship pages render empty states."); return empty; }

  try {
    const [peopleRows, roleRows, companyRows, securityRows, filingRows, txnRows, lobbyingRows, contractRows, committeeRows, donorEmployerRows, donorStateRows] = await Promise.all([
      sql<{ id: number; full_name: string; slug: string | null; bioguide_id: string | null; cik: string | null }[]>`
        select id, full_name, slug::text as slug, bioguide_id, cik from people`,
      sql<{ person_id: number; role_kind: string; chamber: string | null; state: string | null; district: string | null; party: string | null; company_id: number | null; officer_title: string | null; is_director: boolean | null }[]>`
        select person_id, role_kind, chamber::text as chamber, state, district, party, company_id, officer_title, is_director
          from person_roles order by id`,
      sql<{ id: number; name: string; cik: string | null; slug: string | null; primary_ticker: string | null; sector: string | null }[]>`
        select id, name, cik, slug::text as slug, primary_ticker::text as primary_ticker, sector from companies`,
      sql<{ id: number; ticker: string; type: string; name: string | null; company_id: number | null }[]>`
        select id, ticker::text as ticker, type::text as type, name, company_id from securities where is_active`,
      sql<{ id: number; source: string; external_id: string | null; filer_person_id: number | null; filer_company_id: number | null; filed_at: string | null; source_url: string | null; confidence: number; review: string; is_published: boolean }[]>`
        select id, source::text as source, external_id, filer_person_id, filer_company_id, filed_at::text as filed_at, source_url,
               confidence::float8 as confidence, review::text as review, is_published
          from filings
         where review in ('auto_approved','approved') and confidence >= 0.9
           and source in ('sec_form4','house_ptr','senate_ptr')`,
      sql<{ id: number; filing_id: number; person_id: number | null; security_id: number | null; side: string; txn_code: string | null; is_derivative: boolean | null; txn_date: string | null; disclosed_at: string | null; amount_low: number | null; amount_high: number | null; shares: number | null; price: number | null; disclosure_lag_days: number | null; is_10b5_1: boolean | null; owner_type: string | null; asset_type: string | null }[]>`
        select t.id, t.filing_id, t.person_id, t.security_id, t.side::text as side, t.txn_code, t.is_derivative,
               t.txn_date::text as txn_date, t.disclosed_at::text as disclosed_at,
               t.amount_low::float8 as amount_low, t.amount_high::float8 as amount_high,
               t.shares::float8 as shares, t.price::float8 as price, t.disclosure_lag_days,
               t.is_10b5_1, t.owner_type, t.asset_type
          from transactions t join filings f on f.id = t.filing_id
         where t.review in ('auto_approved','approved') and t.confidence >= 0.9
           and f.review in ('auto_approved','approved') and f.confidence >= 0.9
         order by coalesce(t.disclosed_at, f.filed_at::date) desc, t.id desc`,
      sql<{ id: number; registrant: string | null; client: string | null; issue_area: string | null; amount: number | null; period_year: number | null; period_quarter: number | null; filing_type: string | null; source_ref: string | null; created_at: string }[]>`
        select id, registrant, client, issue_area, amount::float8 as amount, period_year, period_quarter, filing_type, source_ref, created_at::text as created_at
          from lobbying
         where period_year >= extract(year from current_date)::int - 2
         order by period_year desc nulls last, period_quarter desc nulls last, amount desc nulls last
         limit 20000`,
      sql<{ id: number; recipient: string | null; awarding_agency: string | null; amount: number | null; action_date: string | null; naics: string | null; source_ref: string | null; created_at: string }[]>`
        select id, recipient, awarding_agency, amount::float8 as amount, action_date::text as action_date, naics, source_ref, created_at::text as created_at
          from contracts
         where action_date >= current_date - 180
         order by amount desc nulls last
         limit 20000`,
      sql<{ id: number; fec_id: string | null; name: string; party: string | null; committee_type: string | null; total: number; count: number; latest: string | null }[]>`
        select c.id, c.fec_id, c.name, c.party, c.committee_type,
               coalesce(sum(d.amount), 0)::float8 as total, count(d.id)::int as count, max(d.donated_at)::text as latest
          from committees c left join donations d on d.committee_id = c.id and d.donated_at >= current_date - 90
         group by c.id order by total desc, c.name limit 500`,
      sql<{ key: string; total: number; count: number }[]>`
        select coalesce(nullif(trim(donor_employer), ''), '(not stated)') as key, sum(amount)::float8 as total, count(*)::int as count
          from donations where donated_at >= current_date - 90 group by 1 order by total desc limit 100`,
      sql<{ key: string; total: number; count: number }[]>`
        select coalesce(nullif(trim(donor_state), ''), '(not stated)') as key, sum(amount)::float8 as total, count(*)::int as count
          from donations where donated_at >= current_date - 90 group by 1 order by total desc limit 60`,
    ]);

    const model: Flagship = { ...empty, connected: true };

    for (const c of companyRows) {
      model.companies.set(c.id, { id: c.id, name: c.name, cik: c.cik, slug: c.slug, primaryTicker: c.primary_ticker, sector: c.sector,
        securityIds: [], insiders: [], txns: [], contracts: [], lobbying: [], underReview: false });
    }
    for (const s of securityRows) {
      model.securities.set(s.id, { id: s.id, ticker: s.ticker, type: s.type, name: s.name, companyId: s.company_id, txns: [], insiderTxns: [], congressTxns: [], underReview: false });
      if (s.company_id != null) model.companies.get(s.company_id)?.securityIds.push(s.id);
    }
    for (const p of peopleRows) {
      model.people.set(p.id, { id: p.id, name: p.full_name, slug: p.slug, bioguideId: p.bioguide_id, cik: p.cik, roles: [], txns: [], filings: [],
        isCongress: false, isInsider: false, lastFiledAt: null, firstFiledAt: null, underReview: false });
    }
    for (const r of roleRows) {
      const p = model.people.get(r.person_id);
      if (!p) continue;
      const role: Role = { kind: r.role_kind as Role["kind"], chamber: r.chamber as Role["chamber"], state: r.state, district: r.district, party: r.party,
        companyId: r.company_id, officerTitle: r.officer_title, isDirector: r.is_director };
      p.roles.push(role);
      if (role.kind === "congress") p.isCongress = true;
      if (role.kind === "insider") { p.isInsider = true; if (role.companyId != null) model.companies.get(role.companyId)?.insiders.push(p); }
    }
    for (const f of filingRows) {
      const filing: Filing = { id: f.id, source: f.source, externalId: f.external_id, personId: f.filer_person_id, companyId: f.filer_company_id,
        filedAt: f.filed_at, sourceUrl: f.source_url, confidence: f.confidence, review: f.review, isPublished: f.is_published, txnCount: 0 };
      model.filings.set(f.id, filing);
      if (f.filer_person_id != null) {
        const p = model.people.get(f.filer_person_id);
        if (p) {
          p.filings.push(filing);
          if (!f.is_published) p.underReview = true;
        }
      }
    }
    for (const t of txnRows) {
      const f = model.filings.get(t.filing_id);
      if (!f) continue;
      const value = t.shares != null && t.price != null && t.price > 0 ? t.shares * t.price : t.amount_high ?? null;
      const txn: Txn = { id: t.id, filingId: t.filing_id, personId: t.person_id, securityId: t.security_id, side: t.side, code: t.txn_code,
        isDerivative: t.is_derivative, txnDate: t.txn_date, disclosedAt: t.disclosed_at ?? f.filedAt?.slice(0, 10) ?? null,
        amountLow: t.amount_low, amountHigh: t.amount_high, shares: t.shares, price: t.price, lagDays: t.disclosure_lag_days,
        is10b51: t.is_10b5_1, ownerType: t.owner_type, assetType: t.asset_type, source: f.source, sourceUrl: f.sourceUrl,
        filedAt: f.filedAt, isPublished: f.isPublished, value };
      f.txnCount++;
      model.txns.push(txn);
      const p = t.person_id != null ? model.people.get(t.person_id) : undefined;
      if (p) p.txns.push(txn);
      const s = t.security_id != null ? model.securities.get(t.security_id) : undefined;
      if (s) {
        s.txns.push(txn);
        if (f.source === "sec_form4") s.insiderTxns.push(txn); else s.congressTxns.push(txn);
        if (!f.isPublished) s.underReview = true;
        if (s.companyId != null) {
          const c = model.companies.get(s.companyId);
          if (c) { c.txns.push(txn); if (!f.isPublished) c.underReview = true; }
        }
      }
    }
    for (const p of model.people.values()) {
      p.filings.sort((a, b) => (b.filedAt ?? "").localeCompare(a.filedAt ?? ""));
      p.lastFiledAt = p.filings[0]?.filedAt ?? null;
      p.firstFiledAt = p.filings.length ? p.filings[p.filings.length - 1]!.filedAt : null;
    }

    model.lobbying = lobbyingRows.map((l) => ({ id: l.id, registrant: l.registrant, client: l.client, issueArea: l.issue_area, amount: l.amount,
      year: l.period_year, quarter: l.period_quarter, filingType: l.filing_type, sourceRef: l.source_ref, createdAt: l.created_at }));
    model.contracts = contractRows.map((c) => ({ id: c.id, recipient: c.recipient, agency: c.awarding_agency, amount: c.amount, actionDate: c.action_date,
      naics: c.naics, sourceRef: c.source_ref, createdAt: c.created_at }));
    model.committees = committeeRows.map((c) => ({ id: c.id, fecId: c.fec_id, name: c.name, party: c.party, type: c.committee_type, total: c.total, count: c.count, latest: c.latest }));
    model.donationsByEmployer = donorEmployerRows;
    model.donationsByState = donorStateRows;

    // Name-match contracts + lobbying onto companies (exact normalized-name match only).
    const byName = new Map<string, Company>();
    for (const c of model.companies.values()) { const k = normalizeOrgName(c.name); if (k) byName.set(k, c); }
    for (const r of model.contracts) { const c = byName.get(normalizeOrgName(r.recipient)); if (c) c.contracts.push(r); }
    for (const r of model.lobbying) { const c = byName.get(normalizeOrgName(r.client)); if (c) c.lobbying.push(r); }

    model.counts = {
      people: model.people.size, companies: model.companies.size, securities: model.securities.size, filings: model.filings.size,
      txns: model.txns.length, insiderTxns: model.txns.filter((t) => t.source === "sec_form4").length,
      congressTxns: model.txns.filter((t) => t.source !== "sec_form4").length,
      lobbying: model.lobbying.length, contracts: model.contracts.length, committees: model.committees.filter((c) => c.count > 0).length,
    };
    return model;
  } catch (err) {
    console.warn("[web] flagship load failed:", (err as Error).message);
    return empty;
  }
}

let _model: Promise<Flagship> | null = null;
export function getFlagship(): Promise<Flagship> {
  if (!_model) _model = load();
  return _model;
}

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
