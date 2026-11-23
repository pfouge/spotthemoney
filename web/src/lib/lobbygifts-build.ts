// Lobbyist contributions (Form LD-203): the database read. lib/lobbygifts.ts has the pure rules.
// Called once per build from lib/flagship.ts in its own try/catch.
//
// The table can hold millions of items, so nothing reads them all into memory. Totals are SQL
// aggregates; the lists are SQL with a limit; the one pass over every item is the CSV, which is
// streamed from a cursor straight into temporary files (flat memory). downloads.ts reads those
// files when it needs the text.
import { createWriteStream, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { normalizeOrgName } from "@stm/shared";
import type { Company, Person } from "./flagship-core";
import { personPath } from "./flagship-core";
import { SITE_URL } from "./seo";
import { csvCell, BOM } from "./csv";
import {
  CSV_COLUMNS, CSV_MAX_BYTES, COMPANY_ROWS, FILER_ROWS, MEMBER_ROWS, NEWEST_ROWS, RECIPIENT_ROWS, buildMemberIndex, cleanText, emptyLobbyContrib, memberForItem, periodLabel, periodRank, periodSlug,
  type CompanyContrib, type CsvFile, type FilerRow, type ItemRow, type LobbyContribData, type MemberName, type PeriodStat, type RecipientRow, type Subject, type TypeRow, type YearStat,
} from "./lobbygifts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

// The counted filings: per registrant, lobbyist (or none), year and period, the newest posted one.
const COUNTED = `select distinct on (registrant_id, coalesce(lobbyist_name, ''), filing_year, filing_period) filing_uuid
                   from lobby_contribution_filings
                  order by registrant_id, coalesce(lobbyist_name, ''), filing_year, filing_period, posted_at desc nulls last, filing_uuid desc`;

const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/i;
export function memberNames(people: Iterable<Person>): (MemberName & { person: Person })[] {
  const out: (MemberName & { person: Person })[] = [];
  for (const p of people) {
    if (!p.isCongress || !p.slug) continue;
    const parts = p.name.replace(/[,.]/g, " ").split(/\s+/).filter((w) => w && !SUFFIX.test(w));
    out.push({ slug: p.slug, fullName: p.name, firstName: parts[0] ?? null, lastName: parts.length > 1 ? parts[parts.length - 1] : null, person: p });
  }
  return out;
}

interface ItemSql {
  date: string | null; contributor: string | null; type: string | null; payee: string | null; honoree: string | null; amount: number | null;
  registrant: string | null; lobbyist: string | null; year: number | null; period: string | null; posted: string | null; uuid: string; source_url: string | null;
}
const ITEM_COLS = `i.contributed_at::text as date, i.contributor_name as contributor, i.contribution_type as type, i.payee_name as payee, i.honoree_name as honoree, i.amount::float8 as amount,
  f.registrant_name as registrant, f.lobbyist_name as lobbyist, f.filing_year as year, f.filing_period as period, f.posted_at::date::text as posted, f.filing_uuid as uuid, f.source_url`;
const toItem = (r: ItemSql, slugOf: (honoree: string | null) => string | null): ItemRow => ({
  date: r.date && r.date <= new Date().toISOString().slice(0, 10) ? r.date : null, contributor: cleanText(r.contributor), type: cleanText(r.type, 120), payee: cleanText(r.payee), honoree: cleanText(r.honoree),
  amount: r.amount, registrant: cleanText(r.registrant), lobbyist: cleanText(r.lobbyist), year: r.year, period: r.period, posted: r.posted, filingUuid: r.uuid, sourceUrl: r.source_url, memberSlug: slugOf(r.honoree),
});

function yearStats(rows: { year: number; items: number; filers: number; amount: number }[]): YearStat[] {
  return rows.map((r) => ({ year: Number(r.year), items: Number(r.items), filers: Number(r.filers), amount: Number(r.amount ?? 0) })).sort((a, b) => b.year - a.year);
}

export async function loadLobbyContrib(sql: Sql, people: Iterable<Person>, companies: Iterable<Company>, outDir = join(tmpdir(), `stm-lobbycontrib-${process.pid}`)): Promise<LobbyContribData> {
  const out = emptyLobbyContrib();
  const tot = (await sql.unsafe(`select count(*)::int as n, (select count(*)::int from lobby_contribution_filings f join (${COUNTED}) c using (filing_uuid)) as counted,
        (select max(posted_at)::date::text from lobby_contribution_filings) as newest from lobby_contribution_filings`))[0] as { n: number; counted: number; newest: string | null };
  if (!tot.n) return out;
  out.available = true; out.filingsAll = tot.n; out.filingsCounted = tot.counted; out.filingsSuperseded = tot.n - tot.counted; out.newestPosted = tot.newest;

  // Periods: one row per year and period, counted filings only.
  const periods = (await sql.unsafe(`
    select f.filing_year as year, f.filing_period as period, count(distinct f.filing_uuid)::int as filings,
           count(distinct f.filing_uuid) filter (where i.id is not null)::int as with_items, count(i.id)::int as items, coalesce(sum(i.amount), 0)::float8 as amount
      from lobby_contribution_filings f join (${COUNTED}) c using (filing_uuid) left join lobby_contribution_items i on i.filing_uuid = f.filing_uuid
     where f.filing_year is not null group by 1, 2`)) as { year: number; period: string | null; filings: number; with_items: number; items: number; amount: number }[];
  out.periods = periods.map((p): PeriodStat => ({ year: p.year, period: p.period ?? "", label: periodLabel(p.period), filings: p.filings, withContributions: p.with_items, items: p.items, amount: p.amount }))
    .sort((a, b) => b.year - a.year || periodRank(b.period) - periodRank(a.period));
  out.newestYear = out.periods[0]?.year ?? null;
  const Y = out.newestYear;

  const members = memberNames(people);
  const idx = buildMemberIndex(members);
  const bySlug = new Map(members.map((m) => [m.slug, m.person]));
  const slugCache = new Map<string, string | null>();
  const slugOf = (h: string | null) => { if (!h) return null; if (slugCache.has(h)) return slugCache.get(h)!; const s = memberForItem({ honoree: h }, idx); slugCache.set(h, s); return s; };

  if (Y != null) {
    out.types = ((await sql.unsafe(`select coalesce(i.contribution_type, '') as type, count(*)::int as items, coalesce(sum(i.amount), 0)::float8 as amount
        from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid) join (${COUNTED}) c using (filing_uuid)
       where f.filing_year = ${Number(Y)} group by 1 order by 3 desc nulls last, 1`)) as TypeRow[]).map((r) => ({ type: r.type, items: Number(r.items), amount: Number(r.amount) }));
    out.filers = ((await sql.unsafe(`select f.registrant_name as registrant, count(distinct f.filing_uuid)::int as filings, count(i.id)::int as items, coalesce(sum(i.amount), 0)::float8 as amount
        from lobby_contribution_filings f join (${COUNTED}) c using (filing_uuid) join lobby_contribution_items i on i.filing_uuid = f.filing_uuid
       where f.filing_year = ${Number(Y)} and f.registrant_name is not null group by 1 order by 4 desc, 1 limit ${FILER_ROWS}`)) as FilerRow[])
      .map((r) => ({ registrant: cleanText(r.registrant) ?? "", filings: Number(r.filings), items: Number(r.items), amount: Number(r.amount) }));
    // Recipients: the honoree where one is typed, else the payee. Names as typed, not merged.
    const rec = (await sql.unsafe(`select coalesce(nullif(btrim(i.honoree_name), ''), nullif(btrim(i.payee_name), '')) as name,
            case when nullif(btrim(i.honoree_name), '') is not null then 'honoree' else 'payee' end as role,
            count(*)::int as items, count(distinct f.registrant_id)::int as filers, coalesce(sum(i.amount), 0)::float8 as amount
        from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid) join (${COUNTED}) c using (filing_uuid)
       where f.filing_year = ${Number(Y)} group by 1, 2 having coalesce(nullif(btrim(i.honoree_name), ''), nullif(btrim(i.payee_name), '')) is not null
       order by 3 desc, 5 desc, 1 limit ${RECIPIENT_ROWS}`)) as { name: string; role: "honoree" | "payee"; items: number; filers: number; amount: number }[];
    out.recipients = rec.map((r): RecipientRow => ({ name: cleanText(r.name) ?? "", role: r.role, items: Number(r.items), filers: Number(r.filers), amount: Number(r.amount), memberSlug: r.role === "honoree" ? slugOf(r.name) : null }));
  }
  out.newest = ((await sql.unsafe(`select ${ITEM_COLS} from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid) join (${COUNTED}) c using (filing_uuid)
       where i.contributed_at is null or i.contributed_at <= current_date order by i.contributed_at desc nulls last, f.posted_at desc nulls last, i.id desc limit ${NEWEST_ROWS}`)) as ItemSql[]).map((r) => toItem(r, slugOf));

  // Honoree names of counted items, with counts; matching is done once per distinct name.
  const honorees = (await sql.unsafe(`select i.honoree_name as h, f.filing_year as year, count(*)::int as n
      from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid) join (${COUNTED}) c using (filing_uuid)
     where i.honoree_name is not null and btrim(i.honoree_name) <> '' group by 1, 2`)) as { h: string; year: number; n: number }[];
  const matchedNames = new Set<string>();
  let totalNewest = 0, matchedNewest = 0;
  for (const r of honorees) { const s = slugOf(r.h); if (s) matchedNames.add(r.h); if (Y != null && r.year === Y) { matchedNewest += s ? r.n : 0; } }
  if (Y != null) totalNewest = Number((await sql.unsafe(`select count(*)::int as n from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid) join (${COUNTED}) c using (filing_uuid) where f.filing_year = ${Number(Y)}`))[0].n);
  out.match = { items: totalNewest, matched: matchedNewest };

  if (matchedNames.size) {
    const names = [...matchedNames];
    const ys = (await sql.unsafe(`select i.honoree_name as h, f.filing_year as year, count(*)::int as items, count(distinct f.registrant_id)::int as filers, coalesce(sum(i.amount), 0)::float8 as amount
        from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid) join (${COUNTED}) c using (filing_uuid)
       where i.honoree_name = any($1) and f.filing_year is not null group by 1, 2`, [names])) as { h: string; year: number; items: number; filers: number; amount: number }[];
    // Several spellings can name one member: add the items, take the larger filer count (an upper bound is not claimed: filers is the largest single spelling's).
    const bySubject = new Map<string, Map<number, YearStat>>();
    for (const r of ys) {
      const s = slugOf(r.h)!; const m = bySubject.get(s) ?? new Map<number, YearStat>(); bySubject.set(s, m);
      const y = m.get(r.year) ?? { year: Number(r.year), items: 0, filers: 0, amount: 0 }; m.set(r.year, y);
      y.items += Number(r.items); y.amount += Number(r.amount); y.filers = Math.max(y.filers, Number(r.filers));
    }
    const rows = (await sql.unsafe(`select ${ITEM_COLS} from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid) join (${COUNTED}) c using (filing_uuid)
       where i.honoree_name = any($1) order by i.contributed_at desc nulls last, f.posted_at desc nulls last, i.id desc`, [names])) as ItemSql[];
    const lists = new Map<string, ItemRow[]>();
    for (const r of rows) { const it = toItem(r, slugOf); const l = lists.get(it.memberSlug!) ?? []; if (l.length < MEMBER_ROWS) l.push(it); lists.set(it.memberSlug!, l); }
    for (const [slug, m] of bySubject) {
      if (!bySlug.has(slug)) continue;
      out.members.set(slug, { slug, years: [...m.values()].sort((a, b) => b.year - a.year), items: lists.get(slug) ?? [] } as Subject);
    }
  }

  // Companies: a filer whose exact normalised name equals exactly one company's name with a page.
  const co = new Map<string, number>(); const twice = new Set<string>();
  for (const c of companies) { const k = normalizeOrgName(c.name); if (!k || !c.slug) continue; if (co.has(k)) twice.add(k); else co.set(k, c.id); }
  for (const k of twice) co.delete(k);
  const regs = (await sql.unsafe(`select distinct registrant_id as id, registrant_name as name from lobby_contribution_filings where registrant_name is not null`)) as { id: number | null; name: string }[];
  const regsByCompany = new Map<number, { ids: number[]; names: Set<string> }>();
  for (const r of regs) { const cid = co.get(normalizeOrgName(r.name)); if (cid == null || r.id == null) continue; const e = regsByCompany.get(cid) ?? { ids: [], names: new Set() }; e.ids.push(Number(r.id)); e.names.add(cleanText(r.name) ?? r.name); regsByCompany.set(cid, e); }
  for (const [cid, e] of regsByCompany) {
    const ys = (await sql.unsafe(`select f.filing_year as year, count(i.id)::int as items, count(distinct f.registrant_id)::int as filers, coalesce(sum(i.amount), 0)::float8 as amount
        from lobby_contribution_filings f join (${COUNTED}) c using (filing_uuid) join lobby_contribution_items i on i.filing_uuid = f.filing_uuid
       where f.registrant_id = any($1) and f.filing_year is not null group by 1`, [e.ids])) as { year: number; items: number; filers: number; amount: number }[];
    if (!ys.length) continue;
    const items = ((await sql.unsafe(`select ${ITEM_COLS} from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid) join (${COUNTED}) c using (filing_uuid)
       where f.registrant_id = any($1) order by i.contributed_at desc nulls last, f.posted_at desc nulls last, i.id desc limit ${COMPANY_ROWS}`, [e.ids])) as ItemSql[]).map((r) => toItem(r, slugOf));
    out.companies.set(cid, { companyId: cid, registrants: [...e.names], years: yearStats(ys), items } as CompanyContrib);
  }

  out.csv = await writeCsvFiles(sql, outDir, (h) => { const s = slugOf(h); const p = s ? bySlug.get(s) : null; const pp = p ? personPath(p) : null; return pp ? SITE_URL + pp : null; });
  return out;
}

const HEADER = BOM + CSV_COLUMNS.map((c) => c.key).join(",") + "\r\n";
/** One streaming pass: every item of every filing, counted or not, written to a file per year (split by period if a year passes CSV_MAX_BYTES). */
async function writeCsvFiles(sql: Sql, dir: string, urlOf: (h: string | null) => string | null): Promise<CsvFile[]> {
  mkdirSync(dir, { recursive: true });
  const counted = new Set<string>((await sql.unsafe(`select filing_uuid from (${COUNTED}) c`)).map((r: { filing_uuid: string }) => r.filing_uuid));
  const q = sql.unsafe(`select f.filing_year as year, f.filing_period as period, f.filer_type, f.registrant_name, f.lobbyist_name, i.contribution_type, i.contributor_name, i.payee_name, i.honoree_name,
        i.amount::float8 as amount, i.contributed_at::text as date, f.posted_at::date::text as posted, f.filing_uuid, f.source_url
      from lobby_contribution_items i join lobby_contribution_filings f using (filing_uuid)
     where f.filing_year is not null order by f.filing_year, f.filing_period, f.filing_uuid, i.seq`);
  // First pass counts bytes per year; we write every year to its own file and split by period afterwards if needed.
  const files = new Map<string, { path: string; year: number; period: string | null; rows: number; bytes: number; updated: string | null; ws: ReturnType<typeof createWriteStream> }>();
  const today = new Date().toISOString().slice(0, 10);
  const open = (key: string, year: number, period: string | null) => {
    const path = join(dir, `${key}.csv`);
    const ws = createWriteStream(path); ws.write(HEADER);
    const f = { path, year, period, rows: 0, bytes: Buffer.byteLength(HEADER), updated: null as string | null, ws }; files.set(key, f); return f;
  };
  // To keep memory flat we write per period files first (a period is a fraction of a year), then merge small ones.
  for await (const batch of q.cursor(2000)) {
    for (const r of batch as (ItemSql & { year: number; period: string | null; filer_type: string | null; registrant_name: string | null; lobbyist_name: string | null; contribution_type: string | null; contributor_name: string | null; payee_name: string | null; honoree_name: string | null; filing_uuid: string })[]) {
      const key = `lobbyist-contributions-${r.year}-${periodSlug(r.period)}`;
      const f = files.get(key) ?? open(key, r.year, r.period);
      const date = r.date && r.date <= today ? r.date : "";
      const cells = [r.year, r.period ? periodLabel(r.period) : "", r.filer_type ?? "", cleanText(r.registrant_name, 300), cleanText(r.lobbyist_name, 300), cleanText(r.contribution_type, 200), cleanText(r.contributor_name, 300),
        cleanText(r.payee_name, 300), cleanText(r.honoree_name, 300), r.amount, date, r.posted, counted.has(r.filing_uuid), urlOf(r.honoree_name), r.filing_uuid, r.source_url];
      const line = cells.map((c) => csvCell(c as string | number | boolean | null)).join(",") + "\r\n";
      if (!f.ws.write(line)) await once(f.ws, "drain");
      f.rows++; f.bytes += Buffer.byteLength(line);
      if (date && (!f.updated || date > f.updated)) f.updated = date;
    }
  }
  for (const f of files.values()) { f.ws.end(); await once(f.ws, "close"); }
  // One file per year when it fits; a year past the limit stays split by period.
  const byYear = new Map<number, typeof files extends Map<string, infer V> ? V[] : never>();
  for (const f of files.values()) { const l = byYear.get(f.year) ?? []; l.push(f); byYear.set(f.year, l); }
  const list: CsvFile[] = [];
  for (const [year, fs] of byYear) {
    fs.sort((x, y) => periodRank(x.period) - periodRank(y.period));
    const total = fs.reduce((a, f) => a + statSync(f.path).size, 0);
    if (total <= CSV_MAX_BYTES) {
      const path = join(dir, `lobbyist-contributions-${year}.csv`);
      const ws = createWriteStream(path); ws.write(HEADER);
      for (const f of fs) { const text = readFileSync(f.path, "utf8").slice(HEADER.length); if (!ws.write(text)) await once(ws, "drain"); unlinkSync(f.path); }
      ws.end(); await once(ws, "close");
      list.push({ name: `lobbyist-contributions-${year}.csv`, year, period: null, rows: fs.reduce((a, f) => a + f.rows, 0), bytes: statSync(path).size, file: path, updated: fs.reduce<string | null>((a, f) => (f.updated && (!a || f.updated > a) ? f.updated : a), null) });
    } else {
      for (const f of fs) list.push({ name: `lobbyist-contributions-${year}-${periodSlug(f.period)}.csv`, year, period: f.period, rows: f.rows, bytes: statSync(f.path).size, file: f.path, updated: f.updated });
    }
  }
  return list.sort((a, b) => b.year - a.year || periodRank(b.period) - periodRank(a.period));
}

export const readCsvFile = (f: CsvFile) => readFileSync(f.file, "utf8");
export { CSV_MAX_BYTES };
