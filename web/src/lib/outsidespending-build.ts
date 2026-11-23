// Independent expenditures: the database read (lib/outsidespending.ts has the pure rules).
// The counted rule is written once here in SQL and once in countedFlags(); the loader compares
// them and the build log prints how many rows disagree (it should be 0).
import type { Flagship } from "./flagship-core";
import {
  emptyOutside, memberOutside, byCandidate, largestSpenders, newestCounted, cycleOf, countedFlags, cleanOutsideText, sourceUrlOk,
  NEWEST_ROWS, type Expenditure, type OutsideData, type Side,
} from "./outsidespending";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
interface Row {
  sub_id: string; committee_fec_id: string | null; committee_name: string | null; candidate_fec_id: string | null; candidate_name: string | null;
  candidate_office: string | null; candidate_state: string | null; candidate_district: string | null; candidate_party: string | null; person_id: number | null;
  support_oppose: string | null; amount: number | null; spent_at: string | null; disseminated_at: string | null; description: string | null;
  is_notice: boolean | null; source_url: string | null; counted: boolean;
}
const num = (x: unknown): number | null => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));

export async function loadOutside(sql: Sql, m: Flagship, builtAt: string): Promise<OutsideData> {
  const out = emptyOutside();
  out.builtAt = builtAt.slice(0, 10);
  const rows = (await sql`
    select e.sub_id, e.committee_fec_id, e.committee_name, e.candidate_fec_id, e.candidate_name, e.candidate_office, e.candidate_state, e.candidate_district,
           e.candidate_party, e.person_id, e.support_oppose, e.amount::float8 as amount, e.spent_at::text as spent_at, e.disseminated_at::text as disseminated_at,
           e.description, e.is_notice, e.source_url,
           (not coalesce(e.is_notice, false)
            or max(e.spent_at) filter (where not coalesce(e.is_notice, false)) over (partition by coalesce(e.committee_fec_id, 'name:' || coalesce(e.committee_name, ''))) is null
            or coalesce(e.spent_at > max(e.spent_at) filter (where not coalesce(e.is_notice, false)) over (partition by coalesce(e.committee_fec_id, 'name:' || coalesce(e.committee_name, ''))), false)) as counted
      from independent_expenditures e
     where e.spent_at is null or e.spent_at <= ${out.builtAt}::date
     order by e.sub_id`) as Row[];
  if (!rows.length) return out;
  const all: Expenditure[] = rows.map((r) => ({
    subId: r.sub_id, committeeId: r.committee_fec_id, committeeName: cleanOutsideText(r.committee_name, 200) ?? r.committee_fec_id ?? "Unnamed committee",
    candidateId: r.candidate_fec_id, candidateName: cleanOutsideText(r.candidate_name, 120),
    office: r.candidate_office === "H" || r.candidate_office === "S" || r.candidate_office === "P" ? r.candidate_office : null,
    state: cleanOutsideText(r.candidate_state, 4), district: cleanOutsideText(r.candidate_district, 6), party: cleanOutsideText(r.candidate_party, 10),
    personId: r.person_id != null ? r.person_id : null, side: r.support_oppose === "S" || r.support_oppose === "O" ? (r.support_oppose as Side) : null,
    amount: num(r.amount), spentAt: r.spent_at, disseminatedAt: r.disseminated_at, description: cleanOutsideText(r.description, 300),
    isNotice: !!r.is_notice, url: sourceUrlOk(r.source_url), counted: !!r.counted,
  }));
  const rule = countedFlags(all.map((r) => ({ committeeId: r.committeeId, committeeName: r.committeeName, isNotice: r.isNotice, spentAt: r.spentAt })));
  all.forEach((r, i) => { if (rule[i] !== r.counted) out.sqlMismatch++; });
  out.shown = true; out.rows = all; out.totalRows = all.length; out.countedRows = all.filter((r) => r.counted).length;
  out.cycle = cycleOf(all);
  const keep = new Set<number>();
  for (const p of m.people.values()) if (p.isCongress && p.slug && !p.od) keep.add(p.id);
  const per = new Map<number, Expenditure[]>();
  for (const r of all) if (r.personId != null && keep.has(r.personId)) { const a = per.get(r.personId); if (a) a.push(r); else per.set(r.personId, [r]); }
  for (const [id, rs] of per) if (rs.some((r) => r.counted)) out.byPerson.set(id, memberOutside(rs));
  out.candidates = byCandidate(all);
  out.spenders = largestSpenders(all);
  out.newest = newestCounted(all, NEWEST_ROWS);
  out.spenderCount = new Set(all.filter((r) => r.counted).map((r) => r.committeeId ?? `name:${r.committeeName}`)).size;
  out.candidateCount = new Set(all.filter((r) => r.counted).map((r) => r.candidateId ?? r.candidateName).filter(Boolean)).size;
  return out;
}
