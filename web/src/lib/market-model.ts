// Market-scope Form 4 data for the build model (stage 3b). Read from the BASE tables (the site_*
// views hide market scope) through the same transformation code the tracked rows use (txnbuild.ts:
// price-box rule, option rows, future-date drop, holdings, joint-filing rule), so a number here
// cannot disagree with the same row on an on-demand page. The result goes into model.market and
// nowhere else: only the home feed reads it, which is what keeps every other page byte-identical.
import type postgres from "postgres";
import { FORM4_FLOOR } from "@stm/shared";
import { refStatsMap, buildTxn, jointMap, unusablePriceLog } from "./txnbuild";
import { markExerciseSales, exerciseLog } from "./exercise";
import type { RawTxn } from "./txnbuild";
import { decodeEntities, emptyMarket, type Flagship, type MarketSlice, type Person, type Role, type Txn } from "./flagship-core";

type Sql = ReturnType<typeof postgres>;

export async function loadMarketSlice(sql: Sql, model: Pick<Flagship, "people" | "companies" | "securities">): Promise<MarketSlice> {
  const out = emptyMarket();
  try {
    const filingRows = await sql<{ id: number; external_id: string | null; filer_person_id: number | null; filer_company_id: number | null; filed_at: string | null; source_url: string | null; confidence: number; review: string; is_published: boolean }[]>`
      select id, external_id, filer_person_id, filer_company_id, filed_at::text as filed_at, source_url,
             confidence::float8 as confidence, review::text as review, is_published
        from filings
       where source = 'sec_form4' and scope = 'market'
         and review in ('auto_approved','approved') and confidence >= 0.9
         and filed_at >= ${FORM4_FLOOR}::date`;
    for (const f of filingRows) {
      out.filings.set(f.id, { id: f.id, source: "sec_form4", externalId: f.external_id, personId: f.filer_person_id, companyId: f.filer_company_id,
        filedAt: f.filed_at, sourceUrl: f.source_url, confidence: f.confidence, review: f.review, isPublished: f.is_published, txnCount: 0 });
    }
    const txnRows = await sql<RawTxn[]>`
      with t as (select x.*, (row_number() over (partition by x.filing_id order by x.id) - 1)::int as ord
                   from transactions x where x.filing_id in (select id from filings where source = 'sec_form4' and scope = 'market'))
      select t.id, t.filing_id, t.person_id, t.security_id, t.side::text as side, t.txn_code, t.is_derivative,
             t.txn_date::text as txn_date, t.disclosed_at::text as disclosed_at,
             t.amount_low::float8 as amount_low, t.amount_high::float8 as amount_high,
             t.shares::float8 as shares, t.price::float8 as price, t.disclosure_lag_days,
             t.is_10b5_1, t.owner_type, t.asset_type,
             case when (f.payload->'transactions'->t.ord->>'shares') ~ '^[0-9]+(\\.[0-9]+)?$'
                   and (f.payload->'transactions'->t.ord->>'shares')::float8 = t.shares::float8
                   and (f.payload->'transactions'->t.ord->>'sharesOwnedAfter') ~ '^[0-9]+(\\.[0-9]+)?$'
                  then (f.payload->'transactions'->t.ord->>'sharesOwnedAfter')::float8 end as owned_after
        from t join filings f on f.id = t.filing_id
       where t.review in ('auto_approved','approved') and t.confidence >= 0.9
         and f.review in ('auto_approved','approved') and f.confidence >= 0.9 and f.filed_at >= ${FORM4_FLOOR}::date
       order by coalesce(t.disclosed_at, f.filed_at::date) desc, t.id desc`;

    const personIds = new Set<number>(), securityIds = new Set<number>();
    for (const f of out.filings.values()) if (f.personId != null) personIds.add(f.personId);
    for (const t of txnRows) { if (t.person_id != null) personIds.add(t.person_id); if (t.security_id != null) securityIds.add(t.security_id); }
    const newPeople = [...personIds].filter((id) => !model.people.has(id));
    const newSecs = [...securityIds].filter((id) => !model.securities.has(id));

    const peopleRows = newPeople.length ? await sql<{ id: number; full_name: string; slug: string | null; bioguide_id: string | null; cik: string | null }[]>`
      select id, full_name, slug::text as slug, bioguide_id, cik from people where id = any(${sql.array(newPeople)}::bigint[])` : [];
    const roleRows = newPeople.length ? await sql<{ person_id: number; role_kind: string; company_id: number | null; officer_title: string | null; is_director: boolean | null; valid_from: string | null; valid_to: string | null }[]>`
      select person_id, role_kind, company_id, officer_title, is_director, valid_from::text as valid_from, valid_to::text as valid_to
        from person_roles where role_kind = 'insider' and person_id = any(${sql.array(newPeople)}::bigint[]) order by id` : [];
    const secRows = newSecs.length ? await sql<{ id: number; ticker: string; type: string; name: string | null; company_id: number | null }[]>`
      select id, ticker::text as ticker, type::text as type, name, company_id from securities where id = any(${sql.array(newSecs)}::bigint[])` : [];
    const companyIds = new Set<number>();
    for (const s of secRows) if (s.company_id != null && !model.companies.has(s.company_id)) companyIds.add(s.company_id);
    for (const r of roleRows) if (r.company_id != null && !model.companies.has(r.company_id)) companyIds.add(r.company_id);
    const coRows = companyIds.size ? await sql<{ id: number; name: string; cik: string | null; slug: string | null; primary_ticker: string | null; sector: string | null }[]>`
      select id, name, cik, slug::text as slug, primary_ticker::text as primary_ticker, sector from companies where id = any(${sql.array([...companyIds])}::bigint[])` : [];

    for (const c of coRows) out.companies.set(c.id, { id: c.id, name: c.name, cik: c.cik, slug: c.slug, primaryTicker: c.primary_ticker, sector: c.sector,
      securityIds: [], insiders: [], txns: [], contracts: [], lobbying: [], underReview: false, od: true });
    // never touch tracked entities: only market-only companies get their lists filled
    const coOf = (id: number | null) => (id == null ? undefined : out.companies.get(id));
    for (const s of secRows) {
      out.securities.set(s.id, { id: s.id, ticker: s.ticker, type: s.type, name: s.name, companyId: s.company_id, txns: [], insiderTxns: [], congressTxns: [], underReview: false, od: true });
      const c = s.company_id != null ? out.companies.get(s.company_id) : undefined;
      if (c) c.securityIds.push(s.id);
    }
    for (const p of peopleRows) out.people.set(p.id, { id: p.id, name: p.full_name, slug: p.slug, bioguideId: p.bioguide_id, cik: p.cik, roles: [], txns: [], filings: [],
      isCongress: false, isInsider: false, lastFiledAt: null, firstFiledAt: null, underReview: false, od: true });
    for (const r of roleRows) {
      const p = out.people.get(r.person_id); if (!p) continue;
      const role: Role = { kind: "insider", chamber: null, state: null, district: null, party: null, companyId: r.company_id,
        officerTitle: decodeEntities(r.officer_title), isDirector: r.is_director, validFrom: r.valid_from, validTo: r.valid_to };
      p.roles.push(role); p.isInsider = true;
      coOf(r.company_id)?.insiders.push(p);
    }

    const refStats = refStatsMap(txnRows);
    const soByCik = new Map<string, number>();
    try {
      for (const r of await sql<{ cik: string; so: number }[]>`select cik, shares_outstanding::float8 as so from company_size where shares_outstanding > 0`) soByCik.set(r.cik.padStart(10, "0"), r.so);
    } catch (err) { console.warn("[web] market: shares outstanding not read:", (err as Error).message); }
    const secOf = (sid: number) => out.securities.get(sid) ?? model.securities.get(sid);
    const soOf = (sid: number): number | null => {
      const cid = secOf(sid)?.companyId; if (cid == null) return null;
      const cik = (out.companies.get(cid) ?? model.companies.get(cid))?.cik;
      return cik ? soByCik.get(cik.padStart(10, "0")) ?? null : null;
    };
    console.log(unusablePriceLog(txnRows, refStats, soOf, (sid) => secOf(sid)?.ticker ?? null, "market"));
    const built: Txn[] = []; const owned = new Map<number, number | null>();
    for (const t of txnRows) {
      const f = out.filings.get(t.filing_id); if (!f) continue;
      const rs = t.security_id != null ? refStats.get(t.security_id) : undefined;
      const txn = buildTxn(t, f, rs?.price ?? null, { rows: rs?.rows ?? 0, sharesOutstanding: t.security_id != null ? soOf(t.security_id) : null });
      f.txnCount++; built.push(txn); owned.set(txn.id, t.owned_after);
    }
    markExerciseSales(built);
    console.log(exerciseLog(built, "market"));
    const joint = jointMap(built, owned);
    for (const own of built) {
      const jointOf = joint.get(own.id) ?? null;
      if (jointOf != null) own.jointOf = jointOf;
      const txn: Txn = jointOf != null ? { ...own, side: "other" } : own;
      out.txns.push(txn);
      const p = own.personId != null ? out.people.get(own.personId) : undefined;
      if (p) p.txns.push(own);
      const s = own.securityId != null ? out.securities.get(own.securityId) : undefined;
      if (s) { s.txns.push(txn); s.insiderTxns.push(txn); coOf(s.companyId)?.txns.push(txn); }
    }
    for (const f of out.filings.values()) {
      const p = f.personId != null ? out.people.get(f.personId) : undefined;
      if (p) p.filings.push(f);
    }
    for (const p of out.people.values() as Iterable<Person>) {
      p.filings.sort((a, b) => (b.filedAt ?? "").localeCompare(a.filedAt ?? ""));
      p.lastFiledAt = p.filings[0]?.filedAt ?? null;
    }
    console.log(`[web] market: ${out.filings.size} filings, ${out.txns.length} rows, ${out.people.size} people, ${out.companies.size} companies, ${out.securities.size} securities`);
    return out;
  } catch (err) {
    console.warn("[web] market slice skipped:", (err as Error).message);
    return emptyMarket();
  }
}
