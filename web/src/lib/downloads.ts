// The free CSV downloads (/downloads/): what files exist, what is in each, and their columns.
// One catalogue feeds everything, so the hub page, the per-page "Download CSV" links, the
// files themselves and scripts/verify-downloads.mjs can never disagree about a file or a count.
//
// Rules (Peter, 2026-10-09: "Free CSV downloads"):
//   - Free means free: plain static files, no sign-up, no email, nothing recorded.
//   - A file holds the same rows the matching page shows, including rows flagged "under
//     review" (they carry under_review = true). Nothing is in a file that is not on the site.
//   - Never in a file: individual donors (FEC sale-and-use limits; the site lists none),
//     market prices (not licensed for display), or anything inferred about a filer.
//   - Every file stays far below Cloudflare's 25 MiB per-file limit: big sets are cut by
//     quarter, then by month, then into numbered parts (MAX_ROWS).
//   - One file per member with trades and per ticker with trades; none per corporate insider
//     (that would double the file count, which is capped at 20,000 on the current plan) —
//     an insider's rows are in the ticker file of the company they report for.
import type { Flagship, Person, Security, Txn, LobbyingRow, ContractRow } from "./flagship";
import { getFlagship, flagshipSql, personPath, roleLabel, isLate } from "./flagship";
import { SITE_URL, edgarFilingUrl } from "./seo";
import { toCsv, type Column } from "./csv";

export const MAX_ROWS = 50_000;
export type Group = "congress" | "insiders" | "washington" | "rates";
export const GROUP_LABEL: Record<Group, string> = { congress: "Congress", insiders: "Corporate insiders", washington: "Washington money", rates: "Rates" };

export interface DownloadFile {
  path: string;            // "/downloads/congress-trades.csv"
  name: string;            // file name
  group: Group;
  title: string;
  about: string;           // one line: what the rows are
  rows: number;
  updated: string | null;  // newest date in the file
  kind: "trades" | "members" | "seats" | "lobbying" | "contracts" | "rates";
  columns: { key: string; about: string }[];
  body: () => string;      // the CSV text (built once, then cached)
}

// ── trades ───────────────────────────────────────────────────────────────────────────────
const SOURCE_NAME: Record<string, string> = { sec_form4: "SEC Form 4", house_ptr: "House PTR", senate_ptr: "Senate PTR" };
const round2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

export function tradeColumns(m: Flagship): Column<Txn>[] {
  const person = (t: Txn): Person | undefined => (t.personId != null ? m.people.get(t.personId) : undefined);
  const sec = (t: Txn): Security | undefined => (t.securityId != null ? m.securities.get(t.securityId) : undefined);
  const seat = (t: Txn) => person(t)?.roles.find((r) => r.kind === "congress");
  const isPtr = (t: Txn) => t.source !== "sec_form4";
  return [
    { key: "trade_id", about: "This site's id for the row. Stable between downloads.", get: (t) => t.id },
    { key: "source", about: "The kind of report: House PTR, Senate PTR or SEC Form 4.", get: (t) => SOURCE_NAME[t.source] ?? t.source },
    { key: "filer", about: "Name of the member of Congress or corporate insider who filed.", get: (t) => person(t)?.name },
    { key: "filer_role", about: "Seat and party for a member; title and company for an insider.", get: (t) => { const p = person(t); return p ? roleLabel(p, m.companies) : null; } },
    { key: "chamber", about: "house or senate. Empty for corporate insiders.", get: (t) => (isPtr(t) ? seat(t)?.chamber : null) },
    { key: "state", about: "Two-letter state of the member's seat. Empty for insiders.", get: (t) => (isPtr(t) ? seat(t)?.state : null) },
    { key: "district", about: "House district number (0 = at-large). Empty for senators and insiders.", get: (t) => (isPtr(t) ? seat(t)?.district : null) },
    { key: "party", about: "The member's party as the roster states it. Empty for insiders.", get: (t) => (isPtr(t) ? seat(t)?.party : null) },
    { key: "ticker", about: "Ticker symbol. Empty when the asset has none (bonds, private funds).", get: (t) => sec(t)?.ticker },
    { key: "security", about: "Name of the security, when known.", get: (t) => { const s = sec(t); return s ? s.name ?? (s.companyId != null ? m.companies.get(s.companyId)?.name : null) : null; } },
    { key: "asset_type", about: "Asset class as recorded (stock, bond, fund, option …).", get: (t) => t.assetType },
    { key: "side", about: "buy, sell, exchange, option (a derivative row on Form 4) or other.", get: (t) => t.side },
    { key: "transaction_code", about: "Form 4 transaction code (P, S, A, M, F …). For a congressional report, the type code as filed, where the report gives one.", get: (t) => t.code },
    { key: "derivative", about: "true for a Form 4 row about options or other derivatives.", get: (t) => (t.source === "sec_form4" ? !!t.isDerivative : null) },
    { key: "owner", about: "Whose asset it was on a congressional report: self, spouse, joint or child.", get: (t) => (isPtr(t) ? t.ownerType : null) },
    { key: "trade_date", about: "The day of the trade (YYYY-MM-DD).", get: (t) => t.txnDate },
    { key: "disclosed_date", about: "The day the report was filed (YYYY-MM-DD).", get: (t) => t.disclosedAt },
    { key: "lag_days", about: "Days from trade to report.", get: (t) => t.lagDays },
    { key: "late", about: "true when lag_days is past the deadline this site applies (45 days for Congress, 4 calendar days for Form 4).", get: (t) => (t.lagDays == null ? null : isLate(t)) },
    { key: "amount_low", about: "Low end of the dollar range on a congressional report.", get: (t) => (isPtr(t) ? t.amountLow : null) },
    { key: "amount_high", about: "High end of the dollar range on a congressional report. Empty for an open-ended top range.", get: (t) => (isPtr(t) ? t.amountHigh : null) },
    { key: "shares", about: "Number of shares, Form 4 only.", get: (t) => (isPtr(t) ? null : t.shares) },
    { key: "price", about: "Price per share as reported on Form 4, in dollars. Empty when the form gives none (awards, gifts, shares withheld for tax).", get: (t) => (isPtr(t) || !(t.price != null && t.price > 0) ? null : round2(t.price)) },
    { key: "value", about: "shares × price for Form 4, in dollars. Empty for congressional reports, which give a range only.", get: (t) => (!isPtr(t) && t.shares != null && t.price != null && t.price > 0 ? round2(t.value) : null) },
    { key: "plan_10b5_1", about: "true when the Form 4 says the trade was made under a Rule 10b5-1 plan.", get: (t) => (t.source === "sec_form4" ? !!t.is10b51 : null) },
    { key: "also_in_another_filing", about: "true when another filer's earlier Form 4 already reports this same transaction; count it once.", get: (t) => t.jointOf != null },
    { key: "under_review", about: "true when the report has passed automatic checks but not yet a human sample check.", get: (t) => !t.isPublished },
    { key: "filing_id", about: "The report's id at the source (House or Senate document id, SEC accession number).", get: (t) => m.filings.get(t.filingId)?.externalId },
    { key: "filing_url", about: "Link to the original report. It is the authority for the row.", get: (t) => (t.source === "sec_form4" ? edgarFilingUrl(t.sourceUrl) : t.sourceUrl) },
    { key: "page_url", about: "The filer's page on this site.", get: (t) => { const p = person(t); const path = p ? personPath(p) : null; return path ? `${SITE_URL}${path}` : null; } },
  ];
}

// ── splitting a large set into files ─────────────────────────────────────────────────────
const quarterOf = (iso: string) => `${iso.slice(0, 4)}-q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
/** Cut rows into named pieces: by quarter, a too-large quarter by month, a too-large month into parts. */
export function splitByPeriod<T>(rows: T[], dateOf: (r: T) => string | null, max = MAX_ROWS): { period: string; label: string; rows: T[] }[] {
  const by = (key: (iso: string) => string, xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of xs) { const d = dateOf(r); const k = d && /^\d{4}-\d{2}/.test(d) ? key(d) : "undated"; const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
    return [...m].sort((a, b) => b[0].localeCompare(a[0]));
  };
  const label = (k: string) => (k === "undated" ? "no date" : /-q\d$/.test(k) ? `${k.slice(0, 4)} Q${k.slice(-1)}` : new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }));
  const out: { period: string; label: string; rows: T[] }[] = [];
  const parts = (k: string, xs: T[]) => {
    if (xs.length <= max) { out.push({ period: k, label: label(k), rows: xs }); return; }
    for (let i = 0, n = 1; i < xs.length; i += max, n++) out.push({ period: `${k}-part${n}`, label: `${label(k)}, part ${n}`, rows: xs.slice(i, i + max) });
  };
  for (const [q, xs] of by(quarterOf, rows)) {
    if (xs.length <= max || q === "undated") parts(q, xs);
    else for (const [mo, ys] of by((d) => d.slice(0, 7), xs)) parts(mo, ys);
  }
  return out;
}

/** Below this many rows an old quarter is not worth a file of its own. */
export const SMALL_PIECE = 1000;
/**
 * The oldest pieces are often a handful of rows each (old trades disclosed late, long before
 * coverage starts in earnest): fold the run of small pieces at the old end into one
 * "before <first full period>" file. Pieces come newest first; nothing is dropped.
 */
export function mergeOldSmall<T>(pieces: { period: string; label: string; rows: T[] }[], small = SMALL_PIECE, max = MAX_ROWS): { period: string; label: string; rows: T[] }[] {
  const dated = pieces.filter((p) => p.period !== "undated"), undated = pieces.filter((p) => p.period === "undated");
  let cut = dated.length;
  while (cut > 0 && dated[cut - 1]!.rows.length < small) cut--;
  const tail = dated.slice(cut);
  const total = tail.reduce((n, p) => n + p.rows.length, 0);
  if (tail.length < 2 || cut === 0 || total > max) return pieces;
  const first = dated[cut - 1]!;
  return [...dated.slice(0, cut), { period: `before-${first.period}`, label: `before ${first.label}`, rows: tail.flatMap((p) => p.rows) }, ...undated];
}

// ── catalogue ────────────────────────────────────────────────────────────────────────────
export interface Downloads {
  files: DownloadFile[];                       // the files listed on /downloads/
  member: Map<string, DownloadFile>;           // member slug → that member's trades
  stock: Map<string, DownloadFile>;            // lower-case ticker → every trade in that ticker
  rowTotal: number;
}
const newest = (xs: (string | null | undefined)[]) => xs.reduce<string | null>((a, b) => (b && (!a || b > a) ? b.slice(0, 10) : a), null);
function file<T>(f: Omit<DownloadFile, "body" | "columns" | "rows" | "path"> & { dir?: string }, columns: Column<T>[], rows: T[]): DownloadFile {
  let cached: string | null = null;
  return { ...f, path: `/downloads/${f.dir ? `${f.dir}/` : ""}${f.name}`, rows: rows.length, columns: columns.map((c) => ({ key: c.key, about: c.about })),
    body: () => (cached ??= toCsv(columns, rows)) };
}
export const memberCsvPath = (slug: string) => `/downloads/congress/${slug}.csv`;
export const stockCsvPath = (ticker: string) => `/downloads/stocks/${ticker.toLowerCase()}.csv`;

async function build(): Promise<Downloads> {
  const m = await getFlagship();
  const cols = tradeColumns(m);
  const files: DownloadFile[] = [];
  const add = (f: DownloadFile) => { if (f.rows > 0) files.push(f); };
  const isForm4 = (t: Txn) => t.source === "sec_form4";

  // Congress
  const congress = m.txns.filter((t) => !isForm4(t));
  add(file({ name: "congress-trades.csv", group: "congress", kind: "trades", title: "Every congressional trade on record", about: "One row per trade from House and Senate periodic transaction reports.", updated: newest(congress.map((t) => t.disclosedAt)) }, cols, congress));
  const members = [...m.people.values()].filter((p) => p.isCongress && p.slug).sort((a, b) => a.name.localeCompare(b.name));
  const seatOf = (p: Person) => p.roles.find((r) => r.kind === "congress");
  const memberCols: Column<Person>[] = [
    { key: "member", about: "Name as the roster gives it.", get: (p) => p.name },
    { key: "chamber", about: "house or senate.", get: (p) => seatOf(p)?.chamber },
    { key: "state", about: "Two-letter state.", get: (p) => seatOf(p)?.state },
    { key: "district", about: "House district (0 = at-large); empty for senators.", get: (p) => seatOf(p)?.district },
    { key: "party", about: "Party as the roster states it.", get: (p) => seatOf(p)?.party },
    { key: "bioguide_id", about: "Id in the Biographical Directory of the U.S. Congress.", get: (p) => p.bioguideId },
    { key: "term_start", about: "Start of the current (or last) term.", get: (p) => seatOf(p)?.validFrom },
    { key: "left_office", about: "End date for a former member; empty for a sitting one.", get: (p) => seatOf(p)?.validTo },
    { key: "committees", about: "Number of full committees the member sits on now.", get: (p) => (m.seats.get(p.id) ?? []).filter((s) => !s.parent).length },
    { key: "trades_on_record", about: "Trades shown on this site for the member.", get: (p) => p.txns.length },
    { key: "purchases", about: "Of those, purchases.", get: (p) => p.txns.filter((t) => t.side === "buy").length },
    { key: "sales", about: "Of those, sales.", get: (p) => p.txns.filter((t) => t.side === "sell").length },
    { key: "reported_late", about: "Trades reported more than 45 days after the trade.", get: (p) => p.txns.filter(isLate).length },
    { key: "first_trade", about: "Earliest trade date on record.", get: (p) => p.txns.map((t) => t.txnDate).filter(Boolean).sort()[0] },
    { key: "latest_trade", about: "Latest trade date on record.", get: (p) => p.txns.map((t) => t.txnDate).filter(Boolean).sort().at(-1) },
    { key: "trades_csv", about: "The member's own trade file, when they have trades.", get: (p) => (p.txns.length ? `${SITE_URL}${memberCsvPath(p.slug!)}` : null) },
    { key: "page_url", about: "The member's page on this site.", get: (p) => `${SITE_URL}${personPath(p)}` },
  ];
  add(file({ name: "congress-members.csv", group: "congress", kind: "members", title: "Members of Congress", about: "One row per member on the roster, with seat, party and trade counts.", updated: newest(members.map((p) => p.lastFiledAt)) ?? m.builtAt.slice(0, 10) }, memberCols, members));
  type SeatRow = { p: Person; s: NonNullable<ReturnType<Flagship["seats"]["get"]>>[number] };
  const seatRows: SeatRow[] = members.flatMap((p) => (m.seats.get(p.id) ?? []).map((s) => ({ p, s })));
  const nameOf = new Map(seatRows.map((r) => [r.s.code, r.s.name]));
  const seatCols: Column<SeatRow>[] = [
    { key: "member", about: "Member's name.", get: (r) => r.p.name },
    { key: "bioguide_id", about: "Id in the Biographical Directory of the U.S. Congress.", get: (r) => r.p.bioguideId },
    { key: "committee_code", about: "Committee code in the congress-legislators dataset.", get: (r) => r.s.code },
    { key: "committee", about: "Committee or subcommittee name.", get: (r) => r.s.name },
    { key: "parent_committee", about: "For a subcommittee, the full committee it belongs to (when the member also sits on it).", get: (r) => (r.s.parent ? nameOf.get(r.s.parent) ?? r.s.parent : null) },
    { key: "committee_chamber", about: "house, senate or joint.", get: (r) => r.s.chamber },
    { key: "title", about: "Leadership post, if any (Chair, Ranking Member …).", get: (r) => r.s.title },
    { key: "side", about: "majority or minority.", get: (r) => r.s.side },
    { key: "rank", about: "Seniority rank on that side of the committee.", get: (r) => r.s.rank },
    { key: "page_url", about: "The member's page on this site.", get: (r) => `${SITE_URL}${personPath(r.p)}` },
  ];
  add(file({ name: "congress-committee-assignments.csv", group: "congress", kind: "seats", title: "Committee assignments", about: "One row per member per current committee or subcommittee seat.", updated: m.builtAt.slice(0, 10) }, seatCols, seatRows));

  // Insiders
  const insiders = m.txns.filter(isForm4);
  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const recent = insiders.filter((t) => (t.disclosedAt ?? "") >= cutoff);
  add(file({ name: "insider-trades-latest.csv", group: "insiders", kind: "trades", title: "Insider transactions, last 90 days", about: "Form 4 rows disclosed in the last 90 days.", updated: newest(recent.map((t) => t.disclosedAt)) }, cols, recent.slice(0, MAX_ROWS)));
  for (const piece of mergeOldSmall(splitByPeriod(insiders, (t) => t.disclosedAt))) {
    add(file({ name: `insider-trades-${piece.period}.csv`, group: "insiders", kind: "trades", title: `Insider transactions, ${piece.label}`, about: `Form 4 rows disclosed in ${piece.label}.`, updated: newest(piece.rows.map((t) => t.disclosedAt)) }, cols, piece.rows));
  }

  // Washington
  const lobCols: Column<LobbyingRow>[] = [
    { key: "year", about: "Year the filing covers.", get: (l) => l.year },
    { key: "quarter", about: "Quarter the filing covers (1–4).", get: (l) => l.quarter },
    { key: "filing_type", about: "LDA filing type code (Q1 … Q4 for quarterly reports, RR for a registration, and so on).", get: (l) => l.filingType },
    { key: "registrant", about: "The lobbying firm or in-house lobbying organisation that filed.", get: (l) => l.registrant },
    { key: "client", about: "Who the lobbying was for.", get: (l) => l.client },
    { key: "issue_code", about: "First general issue area code on the filing.", get: (l) => l.issueArea },
    { key: "issue", about: "That code in words.", get: (l) => (l.issueArea ? m.issueNames.get(l.issueArea) ?? null : null) },
    { key: "amount", about: "Income or expense reported for the quarter, in dollars. Empty for registrations.", get: (l) => l.amount },
    { key: "posted_date", about: "Day the Senate posted the filing.", get: (l) => l.createdAt?.slice(0, 10) },
    { key: "filing_url", about: "Link to the filing at the Senate's lobbying disclosure site.", get: (l) => l.sourceRef },
  ];
  for (const piece of splitByPeriod(m.lobbying.filter((l) => l.year != null), (l) => `${l.year}-${String(((l.quarter ?? 1) - 1) * 3 + 1).padStart(2, "0")}`)) {
    add(file({ name: `lobbying-${piece.period}.csv`, group: "washington", kind: "lobbying", title: `Lobbying filings, ${piece.label}`, about: "One row per registrant, client and period; an amended report replaces the one it amends.", updated: newest(piece.rows.map((l) => l.createdAt)) }, lobCols, piece.rows));
  }
  const conCols: Column<ContractRow>[] = [
    { key: "start_date", about: "Award start date.", get: (c) => c.actionDate },
    { key: "recipient", about: "Company or organisation that received the award.", get: (c) => c.recipient },
    { key: "awarding_agency", about: "Federal agency that made the award.", get: (c) => c.agency },
    { key: "award_value", about: "Award value in dollars as USAspending reports it.", get: (c) => c.amount },
    { key: "naics", about: "Industry code (NAICS) of the award.", get: (c) => c.naics },
    { key: "award_id", about: "USAspending award id.", get: (c) => c.sourceRef },
    { key: "award_url", about: "Link to the award on USAspending.gov.", get: (c) => (c.sourceRef ? `https://www.usaspending.gov/award/${c.sourceRef}` : null) },
  ];
  add(file({ name: "federal-contracts.csv", group: "washington", kind: "contracts", title: "Federal contract awards", about: "The largest awards that started in the last 180 days, plus awards to tracked companies. Not every federal contract.", updated: newest(m.contracts.map((c) => c.actionDate)) }, conCols, m.contracts));

  // Rates
  for (const f of await rateFiles()) add(f);

  // One file per member and per ticker.
  const member = new Map<string, DownloadFile>();
  for (const p of members) {
    if (!p.txns.length) continue;
    member.set(p.slug!, file({ dir: "congress", name: `${p.slug}.csv`, group: "congress", kind: "trades", title: `${p.name}: disclosed trades`, about: `Every trade on record for ${p.name}.`, updated: newest(p.txns.map((t) => t.disclosedAt)) }, cols, p.txns));
  }
  const stock = new Map<string, DownloadFile>();
  // Same rows as /stocks/<ticker>/: securities that share a ticker (the share and its options, say) are one page, so one file.
  const byTicker = new Map<string, Txn[]>();
  for (const s of m.securities.values()) {
    const key = s.ticker.toLowerCase();
    const xs = byTicker.get(key); if (xs) xs.push(...s.txns); else byTicker.set(key, [...s.txns]);
  }
  for (const [key, txns] of byTicker) {
    if (!txns.length) continue;
    txns.sort((a, b) => (b.disclosedAt ?? "").localeCompare(a.disclosedAt ?? "") || b.id - a.id);
    const T = key.toUpperCase();
    stock.set(key, file({ dir: "stocks", name: `${key}.csv`, group: "insiders", kind: "trades", title: `${T}: insider and congressional trades`, about: `Every trade on record in ${T}.`, updated: newest(txns.map((t) => t.disclosedAt)) }, cols, txns));
  }
  return { files, member, stock, rowTotal: files.reduce((n, f) => n + f.rows, 0) };
}

// ── rates (read straight from the rate tables; not part of the flagship model) ───────────
const TENOR_ORDER = ["1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];
async function rateFiles(): Promise<DownloadFile[]> {
  const sql = flagshipSql();
  if (!sql) return [];
  try {
    const obs = await sql<{ code: string; d: string; v: number | null; meta: Record<string, number | null> | null }[]>`
      select s.code, o.obs_date::text as d, o.value::float8 as v, o.meta
        from rate_observations o join rate_series s on s.id = o.series_id
       where s.code like 'UST_PAR_%' or s.code like 'UST_REAL_%' or s.code in ('IBOND_COMPOSITE', 'CPI_U_NSA')
       order by o.obs_date desc`;
    const wide = (prefix: string, name: string, title: string, about: string, what: string): DownloadFile => {
      const rows = obs.filter((o) => o.code.startsWith(prefix));
      const tenors = [...new Set(rows.map((o) => o.code.slice(prefix.length)))].sort((a, b) => TENOR_ORDER.indexOf(a) - TENOR_ORDER.indexOf(b));
      const byDate = new Map<string, Map<string, number | null>>();
      for (const o of rows) { let r = byDate.get(o.d); if (!r) byDate.set(o.d, (r = new Map())); r.set(o.code.slice(prefix.length), o.v); }
      const cols: Column<[string, Map<string, number | null>]>[] = [
        { key: "date", about: "Business day (YYYY-MM-DD).", get: (r) => r[0] },
        ...tenors.map((t) => ({ key: `yield_${t.toLowerCase()}`, about: `${what} for the ${t.replace("M", "-month").replace("Y", "-year")} maturity, in percent.`, get: (r: [string, Map<string, number | null>]) => r[1].get(t) })),
      ];
      return file({ name, group: "rates", kind: "rates", title, about, updated: rows[0]?.d ?? null }, cols, [...byDate]);
    };
    const ib = obs.filter((o) => o.code === "IBOND_COMPOSITE"), cpi = obs.filter((o) => o.code === "CPI_U_NSA");
    type Obs = (typeof obs)[number];
    return [
      wide("UST_PAR_", "treasury-yields.csv", "Treasury par yield curve, daily", "One row per business day, one column per maturity. Source: U.S. Treasury.", "Treasury par yield"),
      wide("UST_REAL_", "tips-real-yields.csv", "TIPS real yield curve, daily", "One row per business day, one column per maturity. Source: U.S. Treasury.", "TIPS real yield"),
      file<Obs>({ name: "i-bond-rates.csv", group: "rates", kind: "rates", title: "Series I savings bond rates", about: "One row per six-month rate period. Source: U.S. Treasury.", updated: ib[0]?.d ?? null }, [
        { key: "effective_date", about: "First day of the six-month rate period.", get: (o) => o.d },
        { key: "composite_rate", about: "Composite annual rate for bonds issued in the period, in percent.", get: (o) => o.v },
        { key: "fixed_rate", about: "Fixed rate for bonds issued in the period, in percent.", get: (o) => o.meta?.fixedRate },
        { key: "semiannual_inflation_rate", about: "Six-month inflation rate for the period, in percent.", get: (o) => o.meta?.semiannualInflationRate },
      ], ib),
      file<Obs>({ name: "cpi-u.csv", group: "rates", kind: "rates", title: "Consumer Price Index (CPI-U), monthly", about: "All items, U.S. city average, not seasonally adjusted, 1982–84 = 100. Source: Bureau of Labor Statistics.", updated: cpi[0]?.d ?? null }, [
        { key: "month", about: "First day of the month the index is for.", get: (o) => o.d },
        { key: "cpi_u", about: "Index level.", get: (o) => o.v },
      ], cpi),
    ];
  } catch (err) {
    console.warn("[web] rate downloads skipped:", (err as Error).message);
    return [];
  }
}

let _downloads: Promise<Downloads> | null = null;
export function getDownloads(): Promise<Downloads> { return (_downloads ??= build()); }

export function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`;
}
export const byteSize = (f: DownloadFile) => Buffer.byteLength(f.body(), "utf8");
