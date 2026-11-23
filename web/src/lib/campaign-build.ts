// Campaign committees: the database read. lib/campaign.ts has the pure rules.
// Called once per build from lib/flagship.ts in its own try/catch.
//
// Committees are linked to members by migration 0040's person_id (ids only, see lib/campaign.ts).
// Every linked committee is returned, with or without receipts: the LD-203 payee rule and the
// campaign-committees.csv file need the whole list. Receipts dated after today are ignored.
import type { Person } from "./flagship-core";
import { RECENT_DAYS, indexCampaign, topEmployers, topStates, type CampaignCommittee, type CampaignData } from "./campaign";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
const PER_COMMITTEE = 150;

// Ids from the database may arrive as numbers or as strings (bigint columns), so a person is looked up either way.
const personOf = (people: Map<number, Person>, id: unknown): Person | undefined => people.get(Number(id)) ?? people.get(String(id) as unknown as number);

export async function loadCampaign(sql: Sql, people: Map<number, Person>): Promise<CampaignData> {
  const cs = (await sql`
    select c.id, c.fec_id, c.name, c.person_id, c.donations_history_note as note
      from committees c where c.person_id is not null and c.fec_id is not null order by c.id`) as { id: number; fec_id: string; name: string; person_id: number; note: string | null }[];
  const linked = cs.filter((c) => { const p = personOf(people, c.person_id); return p && p.slug && p.isCongress; });
  if (!linked.length) return indexCampaign([]);
  const ids = linked.map((c) => Number(c.id));
  const agg = (await sql.unsafe(`
    select committee_id as id, count(*)::int as held, coalesce(sum(amount), 0)::float8 as sum,
           count(*) filter (where donated_at >= current_date - ${RECENT_DAYS})::int as held90,
           coalesce(sum(amount) filter (where donated_at >= current_date - ${RECENT_DAYS}), 0)::float8 as sum90,
           min(donated_at)::text as first, max(donated_at)::text as newest
      from donations where committee_id = any($1) and donated_at is not null and donated_at <= current_date group by 1`, [ids])) as
    { id: number; held: number; sum: number; held90: number; sum90: number; first: string | null; newest: string | null }[];
  const emp = (await sql.unsafe(`
    select id, key, sum, count from (
      select committee_id as id, coalesce(btrim(donor_employer), '') as key, coalesce(sum(amount), 0)::float8 as sum, count(*)::int as count,
             row_number() over (partition by committee_id order by coalesce(sum(amount), 0) desc, coalesce(btrim(donor_employer), '')) as rn
        from donations where committee_id = any($1) and donated_at is not null and donated_at <= current_date group by committee_id, coalesce(btrim(donor_employer), '')) t
     where rn <= ${PER_COMMITTEE} or key = ''`, [ids])) as { id: number; key: string; sum: number; count: number }[];
  const st = (await sql.unsafe(`
    select committee_id as id, upper(btrim(donor_state)) as key, coalesce(sum(amount), 0)::float8 as sum, count(*)::int as count
      from donations where committee_id = any($1) and donated_at is not null and donated_at <= current_date group by 1, 2`, [ids])) as { id: number; key: string; sum: number; count: number }[];
  const groupBy = <T extends { id: number }>(xs: T[]) => { const m = new Map<number, T[]>(); for (const x of xs) { const l = m.get(Number(x.id)) ?? []; l.push(x); m.set(Number(x.id), l); } return m; };
  const aggBy = new Map(agg.map((a) => [Number(a.id), a])); const empBy = groupBy(emp); const stBy = groupBy(st);
  const out: CampaignCommittee[] = linked.map((c) => {
    const p = personOf(people, c.person_id)!; const a = aggBy.get(Number(c.id));
    const e = topEmployers((empBy.get(Number(c.id)) ?? []).map((r) => ({ key: r.key, sum: Number(r.sum), count: Number(r.count) })));
    return {
      id: Number(c.id), fecId: c.fec_id, name: c.name, slug: p.slug!, memberName: p.name, personId: p.id,
      held: Number(a?.held ?? 0), sum: Number(a?.sum ?? 0), held90: Number(a?.held90 ?? 0), sum90: Number(a?.sum90 ?? 0), first: a?.first ?? null, newest: a?.newest ?? null,
      note: c.note ? c.note.replace(/\s+/g, " ").trim().slice(0, 400) : null,
      employers: e.rows, employerOmitted: e.omitted,
      states: topStates((stBy.get(Number(c.id)) ?? []).map((r) => ({ key: r.key, sum: Number(r.sum), count: Number(r.count) }))),
    };
  });
  return indexCampaign(out);
}
