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

import { emptyForm144, form144Log, filerLog } from "./form144";
import { loadForm144, siteCompanyCiks, siteCompanyByCik, sitePersonCiks } from "./form144-build";
import { emptySchedule13, schedule13Log, holdingsLog } from "./schedule13";
import { loadSchedule13 } from "./schedule13-build";
import { emptyFinancials, financialsLog } from "./financials";
import { loadFinancials } from "./financials-build";
import { emptyAssistance, assistanceLog } from "./assistance";
import { loadAssistance } from "./assistance-build";
import { emptyLobbyContrib, lobbyContribLog } from "./lobbygifts";
import { loadLobbyContrib } from "./lobbygifts-build";
import { cleanFootnotes } from "./footnotes";
import { contractDetailLog } from "./contracts";
import { naicsLog } from "./naics";
import { foreignIssuerRows, sharedMainTickers, issuerLog } from "./issuer";
import postgres from "postgres";
import { normalizeOrgName, FORM4_FLOOR, cleanSicCode, sicDivision } from "@stm/shared";
import { refPriceMap, buildTxn, jointMap } from "./txnbuild";
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
  // process.env only. `import.meta.env.DATABASE_URL` is replaced by the VALUE at build time, which
  // wrote the connection string (with its password) into the Worker bundle (found 2026-11-17).
  const url = process.env.DATABASE_URL;
  _sql = url ? postgres(url, { max: 1 }) : null;
  return _sql;
}

/** The build's database connection (null when DATABASE_URL is not set) — for lib/coverage.ts. */
export function flagshipSql() { return db(); }

// types, constants and pure helpers live in flagship-core.ts (re-exported below)
import type { Role, Seat, Person, Company, Security, Filing, Txn, LobbyingRow, ContractRow, CommitteeRow, DonationAgg, Flagship } from "./flagship-core";
import { decodeEntities, emptyMarket } from "./flagship-core";
import { loadMarketSlice } from "./market-model";
export * from "./flagship-core";

const APPROVED = new Set(["auto_approved", "approved"]);

export { normalizeOrgName };

async function load(): Promise<Flagship> {
  const builtAt = new Date().toISOString();
  const empty: Flagship = {
    builtAt, connected: false, people: new Map(), companies: new Map(), securities: new Map(), filings: new Map(),
    market: emptyMarket(), txns: [], lobbying: [], contracts: [], committees: [], donationsByEmployer: [], donationsByState: [],
    donationWindowDays: 90, counts: {}, latestByPath: new Map(), issueNames: new Map(), companySize: new Map(), companySic: new Map(), seats: new Map(), footnotes: new Map(), form144: emptyForm144(), schedule13: emptySchedule13(), financials: emptyFinancials(), assistance: emptyAssistance(), lobbyContrib: emptyLobbyContrib(),
  };
  const sql = db();
  if (!sql) { console.warn("[web] DATABASE_URL not set — flagship pages render empty states."); return empty; }

  try {
    const [peopleRows, roleRows, companyRows, securityRows, filingRows, txnRows, lobbyingRows, contractRows, committeeRows, donorEmployerRows, donorStateRows] = await Promise.all([
      sql<{ id: number; full_name: string; slug: string | null; bioguide_id: string | null; cik: string | null }[]>`
        select id, full_name, slug::text as slug, bioguide_id, cik from site_people`,
      sql<{ person_id: number; role_kind: string; chamber: string | null; state: string | null; district: string | null; party: string | null; company_id: number | null; officer_title: string | null; is_director: boolean | null; valid_from: string | null; valid_to: string | null }[]>`
        select person_id, role_kind, chamber::text as chamber, state, district, party, company_id, officer_title, is_director,
               valid_from::text as valid_from, valid_to::text as valid_to
          from site_person_roles order by id`,
      sql<{ id: number; name: string; cik: string | null; slug: string | null; primary_ticker: string | null; sector: string | null }[]>`
        select id, name, cik, slug::text as slug, primary_ticker::text as primary_ticker, sector from site_companies`,
      sql<{ id: number; ticker: string; type: string; name: string | null; company_id: number | null }[]>`
        select id, ticker::text as ticker, type::text as type, name, company_id from site_securities`,
      sql<{ id: number; source: string; external_id: string | null; filer_person_id: number | null; filer_company_id: number | null; filed_at: string | null; source_url: string | null; confidence: number; review: string; is_published: boolean; issuer_symbol: string | null }[]>`
        select id, source::text as source, external_id, filer_person_id, filer_company_id, filed_at::text as filed_at, source_url,
               confidence::float8 as confidence, review::text as review, is_published,
               -- the trading symbol the Form 4 itself states for its issuer (lib/issuer.ts)
               case when source = 'sec_form4' then left(payload->'issuer'->>'ticker', 60) end as issuer_symbol
          from site_filings
         where review in ('auto_approved','approved') and confidence >= 0.9
           and source in ('sec_form4','house_ptr','senate_ptr')
           -- Form 4 filings filed before the site's record starts are left out (shared/src/floor.ts).
           and not (source = 'sec_form4' and filed_at < ${FORM4_FLOOR}::date)`,
      sql<{ id: number; filing_id: number; person_id: number | null; security_id: number | null; side: string; txn_code: string | null; is_derivative: boolean | null; txn_date: string | null; disclosed_at: string | null; amount_low: number | null; amount_high: number | null; shares: number | null; price: number | null; disclosure_lag_days: number | null; is_10b5_1: boolean | null; owner_type: string | null; asset_type: string | null; owned_after: number | null }[]>`
        -- owned_after: "shares owned following the transaction" from the stored Form 4 payload. Rows are
        -- written in payload order, so the n-th row of a filing is the n-th payload entry; the share
        -- count is checked so a mismatch gives null rather than a wrong holding (used by lib/joint.ts).
        with t as (select x.*, (row_number() over (partition by x.filing_id order by x.id) - 1)::int as ord from transactions x)
        select t.id, t.filing_id, t.person_id, t.security_id, t.side::text as side, t.txn_code, t.is_derivative,
               t.txn_date::text as txn_date, t.disclosed_at::text as disclosed_at,
               t.amount_low::float8 as amount_low, t.amount_high::float8 as amount_high,
               t.shares::float8 as shares, t.price::float8 as price, t.disclosure_lag_days,
               t.is_10b5_1, t.owner_type, t.asset_type,
               case when f.source = 'sec_form4'
                     and (f.payload->'transactions'->t.ord->>'shares') ~ '^[0-9]+(\\.[0-9]+)?$'
                     and (f.payload->'transactions'->t.ord->>'shares')::float8 = t.shares::float8
                     and (f.payload->'transactions'->t.ord->>'sharesOwnedAfter') ~ '^[0-9]+(\\.[0-9]+)?$'
                    then (f.payload->'transactions'->t.ord->>'sharesOwnedAfter')::float8 end as owned_after
          from t join site_filings f on f.id = t.filing_id
         where t.review in ('auto_approved','approved') and t.confidence >= 0.9
           and f.review in ('auto_approved','approved') and f.confidence >= 0.9
           and not (f.source = 'sec_form4' and f.filed_at < ${FORM4_FLOOR}::date)
         order by coalesce(t.disclosed_at, f.filed_at::date) desc, t.id desc`,
      sql<{ id: number; registrant: string | null; client: string | null; issue_area: string | null; issue_codes: string | null; amount: number | null; period_year: number | null; period_quarter: number | null; filing_type: string | null; source_ref: string | null; created_at: string }[]>`
        -- One row per registrant + client + period: an amended report replaces the report it
        -- amends (latest posted wins) so amounts are not counted twice; registrations and other
        -- filings without an amount are kept apart from reports. created_at carries the date
        -- the Senate POSTED the filing, so "newest" lists are not reordered by a history load.
        select id, registrant, client, issue_area, amount::float8 as amount, period_year, period_quarter, filing_type, source_ref, created_at,
               -- every issue code on the filing, in order (an entry is {code, display}; a bare string in old test data)
               (select string_agg(coalesce(x.e->>'code', x.e#>>'{}'), ',' order by x.o)
                  from jsonb_array_elements(case when jsonb_typeof(l.issues) = 'array' then l.issues else '[]'::jsonb end) with ordinality as x(e, o)) as issue_codes
          from (
            select distinct on (registrant, client, period_year, period_quarter, (amount is null))
                   id, registrant, client, issue_area, issues, amount, period_year, period_quarter, filing_type, source_ref,
                   coalesce(posted_at, created_at)::text as created_at
              from lobbying
             where period_year >= extract(year from current_date)::int - 2
             order by registrant, client, period_year, period_quarter, (amount is null), posted_at desc nulls last, id desc
          ) l
         order by period_year desc nulls last, period_quarter desc nulls last, amount desc nulls last
         limit 400000`,
      sql<{ id: number; recipient: string | null; awarding_agency: string | null; amount: number | null; action_date: string | null; naics: string | null; source_ref: string | null; created_at: string; awarding_sub_agency: string | null; end_date: string | null; description: string | null }[]>`
        select id, recipient, awarding_agency, amount::float8 as amount, action_date::text as action_date, naics, source_ref, created_at::text as created_at,
               awarding_sub_agency, end_date::text as end_date, description
          from contracts
         -- action_date holds the award start date; some are in the future (planned starts, typos); a
         -- "last 180 days" window ends today, or the newest-first pages lead with December.
         where action_date >= current_date - 180 and action_date <= current_date
         order by amount desc nulls last
         limit 20000`,
      sql<{ id: number; fec_id: string | null; name: string; party: string | null; committee_type: string | null; total: number; count: number; latest: string | null }[]>`
        select c.id, c.fec_id, c.name, c.party, c.committee_type,
               coalesce(sum(d.amount), 0)::float8 as total, count(d.id)::int as count, max(d.donated_at)::text as latest
          from committees c left join donations d on d.committee_id = c.id and d.donated_at >= current_date - 90 and d.donated_at <= current_date
         group by c.id order by total desc, c.name limit 500`,
      sql<{ key: string; total: number; count: number }[]>`
        select coalesce(nullif(trim(donor_employer), ''), '(not stated)') as key, sum(amount)::float8 as total, count(*)::int as count
          from donations where donated_at >= current_date - 90 and donated_at <= current_date group by 1 order by total desc limit 100`,
      sql<{ key: string; total: number; count: number }[]>`
        select coalesce(nullif(trim(donor_state), ''), '(not stated)') as key, sum(amount)::float8 as total, count(*)::int as count
          from donations where donated_at >= current_date - 90 and donated_at <= current_date group by 1 order by total desc limit 60`,
    ]);

    const model: Flagship = { ...empty, connected: true, issueNames: new Map(), companySize: new Map(), companySic: new Map(), seats: new Map(), footnotes: new Map(), form144: emptyForm144(), schedule13: emptySchedule13(), financials: emptyFinancials(), assistance: emptyAssistance(), lobbyContrib: emptyLobbyContrib() };

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
        companyId: r.company_id, officerTitle: decodeEntities(r.officer_title), isDirector: r.is_director, validFrom: r.valid_from, validTo: r.valid_to };
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
    // Typical share price per security (median of open-market insider trades): the yardstick
    // that tells a per-share price from a row total typed into the price box (shared/tradevalue).
    // A Form 4 row whose filing names another issuer than the company that owns the row's
    // ticker comes off that ticker (lib/issuer.ts): it is the issuer's row, not the stock's.
    const stated = new Map(filingRows.map((f) => [f.id, f.issuer_symbol]));
    // Filer numbers that have a ticker of their own in the SEC's list (migration 0031). Optional:
    // with no list, no row of another issuer is kept on a ticker.
    const listedCiks = new Set<string>();
    try {
      for (const r of await sql<{ cik: string }[]>`select distinct cik from sec_tickers`) listedCiks.add(r.cik.padStart(10, "0"));
    } catch (err) {
      console.warn(`[web] the SEC ticker list could not be read (${err instanceof Error ? err.message : String(err)}); rows are kept on a ticker only for its own company`);
    }
    const hasOwnTicker = (companyId: number): boolean => {
      const cik = model.companies.get(companyId)?.cik;
      return listedCiks.size === 0 || cik == null || listedCiks.has(cik.padStart(10, "0"));
    };
    const issuers = foreignIssuerRows(txnRows, model.filings, model.securities, stated, hasOwnTicker);
    const foreign = issuers.foreign;
    for (const t of txnRows) if (foreign.has(t.id)) t.security_id = null;
    console.log(issuerLog(issuers, model.securities, (id) => model.companies.get(id)?.name ?? `company ${id}`, sharedMainTickers(model.companies.values())));
    const refPrice = refPriceMap(txnRows.filter((t) => model.filings.get(t.filing_id)?.source === "sec_form4"));
    const built: Txn[] = []; const ownedAfter = new Map<number, number | null>();
    for (const t of txnRows) {
      const f = model.filings.get(t.filing_id);
      if (!f) continue;
      const txn = buildTxn(t, f, t.security_id != null ? refPrice.get(t.security_id) : null);
      f.txnCount++;
      built.push(txn); ownedAfter.set(txn.id, t.owned_after);
    }
    // The same trade reported in more than one filing counts once (lib/joint.ts). The filer's own
    // page keeps the row as filed; every list that spans filers gets it with side "other", which
    // takes it out of the buy/sell totals the same way a derivative row is.
    const joint = jointMap(built, ownedAfter);
    const byId = new Map(built.map((t) => [t.id, t]));
    for (const own of built) {
      const jointOf = joint.get(own.id) ?? null;
      if (jointOf != null) own.jointOf = jointOf;
      const txn: Txn = jointOf != null ? { ...own, side: "other" } : own;
      const f = model.filings.get(own.filingId)!;
      model.txns.push(txn);
      const p = own.personId != null ? model.people.get(own.personId) : undefined;
      // A filer's own page shows what they filed — unless the repeat is their own second filing.
      if (p) p.txns.push(jointOf != null && byId.get(jointOf)?.personId === own.personId ? txn : own);
      const s = own.securityId != null ? model.securities.get(own.securityId) : undefined;
      if (s) {
        s.txns.push(txn);
        if (f.source === "sec_form4") s.insiderTxns.push(txn); else s.congressTxns.push(txn);
        if (!f.isPublished) s.underReview = true;
        if (s.companyId != null) {
          const c = model.companies.get(s.companyId);
          if (c) { c.txns.push(txn); if (!f.isPublished) c.underReview = true; }
        }
      } else {
        // Taken off a ticker above: listed on the issuer's own company page.
        const fr = foreign.get(own.id);
        const c = fr ? model.companies.get(fr.issuerCompanyId) : undefined;
        if (c) { c.txns.push(txn); if (!f.isPublished) c.underReview = true; }
      }
    }
    if (joint.size) console.log(`flagship: ${joint.size} Form 4 rows repeat a transaction already reported in an earlier filing (joint filings) — counted once`);
    for (const p of model.people.values()) {
      p.filings.sort((a, b) => (b.filedAt ?? "").localeCompare(a.filedAt ?? ""));
      p.lastFiledAt = p.filings[0]?.filedAt ?? null;
      p.firstFiledAt = p.filings.length ? p.filings[p.filings.length - 1]!.filedAt : null;
    }

    model.lobbying = lobbyingRows.map((l) => ({ id: l.id, registrant: l.registrant, client: l.client, issueArea: l.issue_area, amount: l.amount,
      year: l.period_year, quarter: l.period_quarter, filingType: l.filing_type, sourceRef: l.source_ref, createdAt: l.created_at,
      issues: l.issue_codes ? [...new Set(l.issue_codes.split(",").filter(Boolean))] : (l.issue_area ? [l.issue_area] : []) }));
    model.contracts = contractRows.map((c) => ({ id: c.id, recipient: c.recipient, agency: c.awarding_agency, amount: c.amount, actionDate: c.action_date,
      naics: c.naics, sourceRef: c.source_ref, createdAt: c.created_at,
      subAgency: c.awarding_sub_agency, endDate: c.end_date, description: c.description }));
    console.log(contractDetailLog(model.contracts));
    console.log(naicsLog(model.contracts));
    model.committees = committeeRows.map((c) => ({ id: c.id, fecId: c.fec_id, name: c.name, party: c.party, type: c.committee_type, total: c.total, count: c.count, latest: c.latest }));
    model.donationsByEmployer = donorEmployerRows;
    model.donationsByState = donorStateRows;

    // Name-match contracts + lobbying onto companies (exact normalized-name match only).
    const byName = new Map<string, Company>();
    for (const c of model.companies.values()) { const k = normalizeOrgName(c.name); if (k) byName.set(k, c); }
    for (const r of model.contracts) { const c = byName.get(normalizeOrgName(r.recipient)); if (c) c.contracts.push(r); }
    for (const r of model.lobbying) { const c = byName.get(normalizeOrgName(r.client)); if (c) c.lobbying.push(r); }

    // Chart-only extras. Their own try/catch on purpose: the charts are optional, and a
    // failure here must never blank the pages the way a failure in the core queries does.
    try {
      const [heldRows, issueRows] = await Promise.all([
        sql<{ id: number; held: number | null }[]>`
          select f.id,
                 (select (e->>'sharesOwnedAfter')::float8
                    from jsonb_array_elements(case when jsonb_typeof(f.payload->'transactions') = 'array' then f.payload->'transactions' else '[]'::jsonb end) with ordinality as x(e, n)
                   where coalesce((e->>'isDerivative')::boolean, false) = false and (e->>'sharesOwnedAfter') ~ '^[0-9.]+$'
                   order by n desc limit 1) as held
            from site_filings f
           where f.source = 'sec_form4' and f.review in ('auto_approved','approved') and f.confidence >= 0.9`,
        sql<{ code: string; name: string | null }[]>`
          select e->>'code' as code, max(e->>'display') as name
            from lobbying l, jsonb_array_elements(case when jsonb_typeof(l.issues) = 'array' then l.issues else '[]'::jsonb end) as e
           where jsonb_typeof(e) = 'object' and e->>'code' is not null group by 1`,
      ]);
      for (const h of heldRows) { const f = model.filings.get(h.id); if (f) f.heldAfter = h.held; }
      for (const i of issueRows) if (i.name) model.issueNames.set(i.code, i.name);
    } catch (err) {
      console.warn("[web] chart extras skipped:", (err as Error).message);
    }

    // Form 4 footnotes, shown under the trade tables. Optional in the same way: without them
    // the tables simply have no footnote links.
    try {
      const noteRows = await sql<{ id: number; notes: unknown }[]>`
        select f.id, f.payload->'footnotes' as notes
          from site_filings f
         where f.source = 'sec_form4' and f.review in ('auto_approved','approved') and f.confidence >= 0.9
           and f.filed_at >= ${FORM4_FLOOR}::date
           and jsonb_typeof(f.payload->'footnotes') = 'array' and jsonb_array_length(f.payload->'footnotes') > 0`;
      for (const r of noteRows) {
        if (!model.filings.has(r.id)) continue;
        const notes = cleanFootnotes(r.notes);
        if (notes.length) model.footnotes.set(r.id, notes);
      }
      let noteTotal = 0; for (const n of model.footnotes.values()) noteTotal += n.length;
      console.log(`[web] Form 4 footnotes: ${model.footnotes.size} filings, ${noteTotal} notes`);
    } catch (err) {
      console.warn("[web] Form 4 footnotes skipped:", (err as Error).message);
    }

    // Company size for the Size filter. Optional in the same way: without it the filter
    // simply has nothing to match, the pages still build.
    try {
      const sizeRows = await sql<{ cik: string; shares: number | null; shares_as_of: string | null; float: number | null; float_as_of: string | null }[]>`
        select cik, shares_outstanding::float8 as shares, shares_as_of::text as shares_as_of,
               public_float::float8 as float, float_as_of::text as float_as_of
          from company_size`;
      for (const r of sizeRows) model.companySize.set(r.cik.padStart(10, "0"), { shares: r.shares, sharesAsOf: r.shares_as_of, float: r.float, floatAsOf: r.float_as_of });
    } catch (err) {
      console.warn("[web] company size skipped:", (err as Error).message);
    }

    // Industry codes (SIC) for the Industry fact on company and stock pages. Optional in the same
    // way: before migration 0021 is applied or the job has run, the pages leave the fact out.
    try {
      const sicRows = await sql<{ cik: string; sic: string; description: string | null }[]>`
        select cik, sic, sic_description as description from company_sic where sic is not null`;
      for (const r of sicRows) {
        const code = cleanSicCode(r.sic);
        if (code) model.companySic.set(r.cik.padStart(10, "0"), { sic: code, description: r.description });
      }
      // One line to compare with SQL on the production build: tracked companies with a code, and by division.
      const byDivision = new Map<string, number>();
      let withCode = 0, withCik = 0;
      for (const c of model.companies.values()) {
        if (!c.cik) continue;
        withCik++;
        const e = model.companySic.get(c.cik.padStart(10, "0"));
        if (!e) continue;
        withCode++;
        const d = sicDivision(e.sic)?.name ?? "no division";
        byDivision.set(d, (byDivision.get(d) ?? 0) + 1);
      }
      const parts = [...byDivision.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d, n]) => `${d} ${n}`);
      console.log(`[web] industry codes: ${withCode} of ${withCik} companies on the site have a SIC code (${model.companySic.size} codes on file)${parts.length ? "; " + parts.join(", ") : ""}`);
    } catch (err) {
      console.warn("[web] industry codes skipped:", (err as Error).message);
    }

    // SEC Form 144 notices (planned sales) for the stock and company pages. Optional like the
    // others, and read only once the load has reached today: until then form144.shown is false
    // and no page, file or count shows a partial record (lib/form144.ts, lib/form144-build.ts).
    try {
      const ciks = siteCompanyCiks(model);
      model.form144 = await loadForm144(sql, builtAt, ciks);
      console.log(`[web] ${form144Log(model.form144, builtAt, ciks)}`);
      console.log(`[web] ${filerLog(model.form144, builtAt, sitePersonCiks(model), new Set(siteCompanyByCik(model).keys()))}`);
    } catch (err) {
      console.warn("[web] Form 144 notices skipped:", (err as Error).message);
    }

    // SEC Schedules 13D and 13G (large holders) for the stock and company pages. The same
    // pattern: optional, and read only once the load has reached today, because with part of
    // the record on file a holder's "newest statement" would not be its newest
    // (lib/schedule13.ts, lib/schedule13-build.ts).
    try {
      const ciks = siteCompanyCiks(model);
      model.schedule13 = await loadSchedule13(sql, builtAt, ciks);
      console.log(`[web] ${schedule13Log(model.schedule13, builtAt, ciks)}`);
      console.log(`[web] ${holdingsLog(model.schedule13, builtAt, sitePersonCiks(model), new Set(siteCompanyByCik(model).keys()))}`);
    } catch (err) {
      console.warn("[web] Schedule 13 statements skipped:", (err as Error).message);
    }

    // Figures from companies' annual and quarterly reports (SEC XBRL), for the "Financials, as
    // filed" section of stock and company pages. Optional: a missing table leaves the section out
    // (lib/financials.ts, lib/financials-build.ts).
    try {
      const ciks = siteCompanyCiks(model);
      model.financials = await loadFinancials(sql, ciks);
      console.log(`[web] ${financialsLog(model.financials, ciks)}`);
    } catch (err) {
      console.warn("[web] company financials skipped:", (err as Error).message);
    }

    // Federal grants, loans and direct payments (migration 0037). Optional: a missing table leaves
    // the hub, the company section, the CSV and the guide section out (lib/assistance.ts).
    try {
      model.assistance = await loadAssistance(sql, model.companies.values());
      console.log(assistanceLog(model.assistance));
    } catch (err) {
      console.warn("[web] federal assistance skipped:", (err as Error).message);
    }

    // Lobbyist contributions, Form LD-203 (migration 0033). Aggregated in SQL; the CSV files are
    // streamed to temporary files (lib/lobbygifts-build.ts). Optional.
    try {
      model.lobbyContrib = await loadLobbyContrib(sql, model.people.values(), model.companies.values());
      console.log(lobbyContribLog(model.lobbyContrib));
    } catch (err) {
      console.warn("[web] lobbyist contributions skipped:", (err as Error).message);
    }

    // Committee seats for the member pages. Optional as well: before migration 0015 is applied the
    // table does not exist, and the pages simply leave the committee section out.
    try {
      const seatRows = await sql<{ person_id: number; code: string; parent_code: string | null; chamber: string; name: string; url: string | null; jurisdiction: string | null; side: string | null; rank: number | null; title: string | null }[]>`
        select m.person_id, c.code, c.parent_code, c.chamber, c.name, c.url, c.jurisdiction, m.side, m.rank, m.title
          from congress_committee_members m join congress_committees c on c.code = m.committee_code
         order by m.person_id, c.name`;
      for (const r of seatRows) {
        const seat: Seat = { code: r.code, parent: r.parent_code, chamber: r.chamber as Seat["chamber"], name: r.name, url: r.url, jurisdiction: r.jurisdiction, side: r.side, rank: r.rank, title: r.title };
        const xs = model.seats.get(r.person_id); if (xs) xs.push(seat); else model.seats.set(r.person_id, [seat]);
      }
    } catch (err) {
      console.warn("[web] committee seats skipped:", (err as Error).message);
    }

    // Market-scope Form 4 rows (stage 3b): own slice, own try/catch. Only the home feed reads it.
    model.market = await loadMarketSlice(sql, model);

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
/** True once at least one Senate report is public — pages switch their House-only wording on this. */
export function senateShown(m: Flagship): boolean {
  for (const f of m.filings.values()) if (f.source === "senate_ptr" && f.isPublished) return true;
  return false;
}

export function getFlagship(): Promise<Flagship> {
  if (!_model) _model = load();
  return _model;
}
