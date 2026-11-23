// The on-demand model builder (stage 3a): one json document from the od_* SQL functions in
// (db/migrations/0020), the page model out. Pure: no database, no Node APIs, no fetch. Every number
// a page shows goes through the same rules as the static build (lib/txnbuild.ts: price-box fix,
// option rows, impossible dates, holdings, the joint-filing rule), so an on-demand page and a
// static page cannot disagree about a figure. Tests: scripts/od.test.ts.
import type { Flagship, Person, Company, Security, Filing, Txn, Role } from "../flagship-core";
import { personPath, emptyMarket, companyPath, securityPath, decodeEntities, roleLabel, isLate, num, money, plural } from "../flagship-core";
import { buildTxn, jointMap, type RawTxn, type FilingFacts } from "../txnbuild";
import { cleanFootnotes } from "../footnotes";
import { emptyForm144 } from "../form144";
import { emptySchedule13 } from "../schedule13";
import { emptyInst } from "../inst13f";
import { emptyFinancials } from "../financials";
import { emptyEvents } from "../events8k";
import { emptyPay } from "../execpay";
import { emptyVotes } from "../votes";
import { emptyOutside } from "../outsidespending";
import { emptyAssistance } from "../assistance";
import { emptyLobbyContrib } from "../lobbygifts";
import { insiderRows, codeRows, yearRows, insiderPeriods, isOpenBuy, isOpenSale, type InsiderRow, type CodeRow, type YearRow, type PeriodSummary } from "../entity";

export type OdKind = "insider" | "stock" | "company";

/** The json the od_* functions return (see the header of 0020_on_demand_entities.sql). */
export interface OdDoc {
  kind: OdKind;
  columns: string[];
  rows: unknown[][];
  peers: unknown[][];
  /** filing id → [source_url, filed_at, is_published, accession] */
  filings: Record<string, [string | null, string | null, boolean, string | null]>;
  /** person id → [name, slug, officer title, is_director] */
  people: Record<string, [string, string | null, string | null, boolean | null]>;
  /** security id → [ticker, type, name, company_id, is_active] */
  securities: Record<string, [string, string, string | null, number | null, boolean?]>;
  refPrices: Record<string, number>;
  footnotes: Record<string, unknown>;
  stats: { rowCount: number; filingCount: number; firstFiledAt: string | null; lastFiledAt: string | null; newestUrl: string | null } | null;
  truncated: boolean;
  entity: { id?: number; name?: string; slug?: string | null; cik?: string | null; ticker?: string; type?: string };
  roles?: { companyId: number | null; title: string | null; isDirector: boolean | null; company: { id: number; name: string; slug: string | null; ticker: string | null; cik: string | null } | null }[];
  /** [person id, name, slug, title, is_director, rows] */
  colleagues?: [number, string, string | null, string | null, boolean | null, number][];
  siblings?: { id: number; ticker: string; type: string; name: string | null }[];
  company?: { id: number; name: string; slug: string | null; cik: string | null; ticker: string | null } | null;
  insiderCount?: number;
}

export const COL = ["id", "filing_id", "person_id", "security_id", "side", "txn_code", "is_derivative", "txn_date", "disclosed_at",
  "amount_low", "amount_high", "shares", "price", "disclosure_lag_days", "is_10b5_1", "owner_type", "asset_type", "owned_after"] as const;

/** Rows shown in the trade table, and the "who" tables, on an on-demand page. */
export const TABLE_ROWS = 100;
export const WHO_ROWS = 25;
export const COLLEAGUE_ROWS = 10;

function raw(a: unknown[]): RawTxn {
  return { id: a[0] as number, filing_id: a[1] as number, person_id: a[2] as number | null, security_id: a[3] as number | null, side: a[4] as string,
    txn_code: a[5] as string | null, is_derivative: a[6] as boolean | null, txn_date: a[7] as string | null, disclosed_at: a[8] as string | null,
    amount_low: a[9] as number | null, amount_high: a[10] as number | null, shares: a[11] as number | null, price: a[12] as number | null,
    disclosure_lag_days: a[13] as number | null, is_10b5_1: a[14] as boolean | null, owner_type: a[15] as string | null, asset_type: a[16] as string | null,
    owned_after: a[17] as number | null };
}

export interface OdPage {
  kind: OdKind;
  /** A stub of the build model: just the maps the shared table components read. */
  model: Flagship;
  /** The rows the page's tables list, newest disclosed first (insider: the filer's own rows; stock, company: every filer's). */
  txns: Txn[];
  person: Person | null;
  company: Company | null;
  security: Security | null;
  siblings: Security[];
  stats: NonNullable<OdDoc["stats"]>;
  truncated: boolean;
  /** Indexable only when the entity has an open-market (code P or S, non-derivative) row. */
  noindex: boolean;
  lastUpdated: string;
  colleagues: { name: string; path: string; role: string; rows: number }[];
  insiderCount: number;
}

const EMPTY_STATS = { rowCount: 0, filingCount: 0, firstFiledAt: null, lastFiledAt: null, newestUrl: null };

/** Json from the SQL functions → what the page renders. `now` is the request time (for the "built at" stamp only). */
export function buildOd(doc: OdDoc, now: Date = new Date()): OdPage {
  const model: Flagship = { builtAt: now.toISOString(), connected: true, people: new Map(), companies: new Map(), securities: new Map(), filings: new Map(), txns: [],
    lobbying: [], contracts: [], committees: [], donationsByEmployer: [], donationsByState: [], donationWindowDays: 0, counts: {}, latestByPath: new Map(),
    issueNames: new Map(), companySize: new Map(), companySic: new Map(), seats: new Map(), footnotes: new Map(), form144: emptyForm144(), schedule13: emptySchedule13(), inst: emptyInst(), financials: emptyFinancials(), events: emptyEvents(), execPay: emptyPay(), market: emptyMarket(), votes: emptyVotes(), outside: emptyOutside() };
    issueNames: new Map(), companySize: new Map(), companySic: new Map(), seats: new Map(), footnotes: new Map(), form144: emptyForm144(), schedule13: emptySchedule13(), financials: emptyFinancials(), assistance: emptyAssistance(), lobbyContrib: emptyLobbyContrib(), market: emptyMarket() };

  // companies the page can name: the entity's own, its siblings' securities', the roles'
  const addCompany = (c: { id: number; name: string; slug: string | null; cik: string | null; ticker: string | null }) => {
    if (!model.companies.has(c.id)) model.companies.set(c.id, { id: c.id, name: c.name, cik: c.cik, slug: c.slug, primaryTicker: c.ticker, sector: null, securityIds: [], insiders: [], txns: [], contracts: [], lobbying: [], underReview: false });
  };
  if (doc.company) addCompany(doc.company);
  for (const r of doc.roles ?? []) if (r.company) addCompany(r.company);
  if (doc.kind === "company" && doc.entity.id != null) addCompany({ id: doc.entity.id, name: doc.entity.name ?? "", slug: doc.entity.slug ?? null, cik: doc.entity.cik ?? null, ticker: (doc.entity as { ticker?: string }).ticker ?? null });

  for (const [id, s] of Object.entries(doc.securities)) {
    const sec: Security = { id: Number(id), ticker: s[0], type: s[1], name: s[2], companyId: s[3], txns: [], insiderTxns: [], congressTxns: [], underReview: false };
    model.securities.set(sec.id, sec);
    if (s[3] != null) model.companies.get(s[3])?.securityIds.push(sec.id);
  }
  for (const s of doc.siblings ?? []) if (!model.securities.has(s.id)) model.securities.set(s.id, { id: s.id, ticker: s.ticker, type: s.type, name: s.name, companyId: doc.entity.id ?? null, txns: [], insiderTxns: [], congressTxns: [], underReview: false });
  for (const [id, p] of Object.entries(doc.people)) {
    const role: Role = { kind: "insider", chamber: null, state: null, district: null, party: null, companyId: null, officerTitle: decodeEntities(p[2]), isDirector: p[3] };
    model.people.set(Number(id), { id: Number(id), name: p[0], slug: p[1], bioguideId: null, cik: null, roles: [role], txns: [], filings: [], isCongress: false, isInsider: true, lastFiledAt: null, firstFiledAt: null, underReview: false });
  }
  // the page's own person: all roles, company-linked (the facts block and the title read them)
  let person: Person | null = null;
  if (doc.kind === "insider") {
    const id = doc.entity.id!;
    const roles: Role[] = (doc.roles ?? []).map((r) => ({ kind: "insider", chamber: null, state: null, district: null, party: null, companyId: r.companyId, officerTitle: decodeEntities(r.title), isDirector: r.isDirector }));
    person = { id, name: doc.entity.name!, slug: doc.entity.slug ?? null, bioguideId: null, cik: doc.entity.cik ?? null, roles: roles.length ? roles : [{ kind: "insider", chamber: null, state: null, district: null, party: null, companyId: null, officerTitle: null, isDirector: null }],
      txns: [], filings: [], isCongress: false, isInsider: true, lastFiledAt: doc.stats?.lastFiledAt ?? null, firstFiledAt: doc.stats?.firstFiledAt ?? null, underReview: false };
    model.people.set(id, person);
    for (const r of roles) if (r.companyId != null) model.companies.get(r.companyId)?.insiders.push(person);
  }

  // filings: which person filed each is the person on its first row
  const firstPerson = new Map<number, number | null>();
  for (const a of doc.rows) if (!firstPerson.has(a[1] as number)) firstPerson.set(a[1] as number, a[2] as number | null);
  const facts = new Map<number, FilingFacts>();
  for (const [id, f] of Object.entries(doc.filings)) {
    const fid = Number(id);
    facts.set(fid, { source: "sec_form4", filedAt: f[1], sourceUrl: f[0], isPublished: f[2] });
    model.filings.set(fid, { id: fid, source: "sec_form4", externalId: f[3], personId: firstPerson.get(fid) ?? null, companyId: null, filedAt: f[1], sourceUrl: f[0], confidence: 1, review: "approved", isPublished: f[2], txnCount: 0 } satisfies Filing);
  }
  for (const [id, notes] of Object.entries(doc.footnotes ?? {})) { const n = cleanFootnotes(notes); if (n.length) model.footnotes.set(Number(id), n); }

  // rows → Txn (the site's rules), then the joint-filing rule across the rows and the peers' rows
  const all = [...doc.rows, ...doc.peers];
  const built: Txn[] = []; const owned = new Map<number, number | null>();
  for (const a of all) {
    const t = raw(a); const f = facts.get(t.filing_id); if (!f) continue;
    const txn = buildTxn(t, f, t.security_id != null ? doc.refPrices[String(t.security_id)] : null);
    built.push(txn); owned.set(txn.id, t.owned_after);
  }
  for (const a of doc.rows) { const mf = model.filings.get(a[1] as number); if (mf) mf.txnCount++; }
  const joint = jointMap(built, owned);
  const byId = new Map(built.map((t) => [t.id, t]));
  const shown = new Set(doc.rows.map((a) => a[0] as number));
  const txns: Txn[] = [];
  for (const own of built) {
    if (!shown.has(own.id)) continue;
    const jointOf = joint.get(own.id) ?? null;
    if (jointOf != null) own.jointOf = jointOf;
    const dup: Txn = jointOf != null ? { ...own, side: "other" } : own;
    // an insider's own page keeps what they filed, unless the repeat is their own second filing
    txns.push(doc.kind === "insider" ? (jointOf != null && byId.get(jointOf)?.personId === own.personId ? dup : own) : dup);
  }
  if (doc.kind !== "insider") txns.sort((a, b) => (b.disclosedAt ?? "").localeCompare(a.disclosedAt ?? ""));

  let company: Company | null = null, security: Security | null = null;
  const siblings = (doc.siblings ?? []).map((s) => model.securities.get(s.id)!).filter(Boolean);
  if (doc.kind === "company") company = model.companies.get(doc.entity.id!) ?? null;
  if (doc.kind === "stock") {
    security = siblings[0] ?? null;
    company = doc.company ? model.companies.get(doc.company.id) ?? null : null;
  }
  if (doc.kind === "insider") {
    const cid = person!.roles.find((r) => r.companyId != null)?.companyId;
    company = cid != null ? model.companies.get(cid) ?? null : null;
  }
  if (person) person.txns = txns;

  const openMarket = built.some((t) => shown.has(t.id) && (t.code === "P" || t.code === "S") && t.isDerivative !== true);
  const stats = doc.stats ?? EMPTY_STATS;
  const colleagues = (doc.colleagues ?? []).filter((c) => c[2]).slice(0, COLLEAGUE_ROWS).map((c) => ({ name: c[1], path: `/insiders/${c[2]}/`, role: decodeEntities(c[3]) ?? (c[4] ? "Director" : "Insider"), rows: c[5] }));
  return { kind: doc.kind, model, txns, person, company, security, siblings, stats, truncated: doc.truncated, noindex: !openMarket,
    lastUpdated: (stats.lastFiledAt ?? now.toISOString()).slice(0, 10), colleagues, insiderCount: doc.insiderCount ?? 0 };
}

// ── figures the three pages share ───────────────────────────────────────────────────────────
export interface Figures { rows: number; buys: number; sells: number; bought: number; sold: number; latestTrade: string | null; codes: CodeRow[]; years: YearRow[]; periods: PeriodSummary[]; who: InsiderRow[]; insiderCount: number }
const sumV = (ts: Txn[]) => ts.reduce((a, t) => a + (t.value ?? 0), 0);

/** Counts, dollar totals and tables for the rows on the page. Open-market means code P or S, non-derivative (the site's rule). */
export function figures(page: OdPage, since?: (days: number) => string): Figures {
  const t = page.txns;
  const b = t.filter(isOpenBuy), s = t.filter(isOpenSale);
  const who = page.kind === "insider" ? [] : insiderRows(page.model, t);
  return { rows: page.stats.rowCount, buys: b.length, sells: s.length, bought: sumV(b), sold: sumV(s),
    latestTrade: t.map((x) => x.txnDate).filter((d): d is string => !!d).sort().at(-1) ?? null,
    codes: codeRows(t), years: yearRows(t), periods: page.kind === "insider" ? [] : insiderPeriods(t, since), who, insiderCount: who.length };
}

export function lateCount(page: OdPage): number { return page.txns.filter(isLate).length; }

/** The two-sentence answer for a page (counts, dates and dollars as reported; no reason for any trade). */
export function answerText(page: OdPage, name: string, title: string, f: Figures): string {
  const n = page.stats.rowCount;
  const shownNote = page.truncated ? ` The figures below cover the newest ${num(page.txns.length)} rows.` : "";
  if (page.txns.length === 0) return `${name} has no Form 4 transactions on record that met the publishing bar (approved review, confidence of at least 0.9, filed on or after October 1, 2025).`;
  const last = page.stats.lastFiledAt ? new Date(page.stats.lastFiledAt).toISOString().slice(0, 10) : null;
  const lastText = last ? ` The latest filing on record is dated ${last}.` : "";
  if (page.kind === "insider") {
    return `${name}${title ? `, ${title},` : ""} has ${plural(n, "Form 4 transaction")} on record, ${plural(f.buys, "open-market purchase")} worth ${money(f.bought)} and ${plural(f.sells, "open-market sale")} worth ${money(f.sold)} at the prices reported.${lastText}${shownNote}`;
  }
  return `${name} has ${plural(n, "insider Form 4 transaction")} from ${plural(new Set(page.txns.map((t) => t.personId)).size, "filer")} on record, including ${plural(f.buys, "open-market purchase")} worth ${money(f.bought)} and ${plural(f.sells, "open-market sale")} worth ${money(f.sold)} at the prices reported.${lastText}${shownNote}`;
}

export { personPath, companyPath, securityPath, roleLabel };
