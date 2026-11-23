// Roll-call votes: the database reads (lib/votes.ts has the pure rules). Nothing here reads every
// position into memory for the pages: member counts and the newest rows are aggregated in SQL, and
// the monthly position files are built by streaming a cursor.
import type { Flagship } from "./flagship-core";
import {
  emptyVotes, rollFromRow, MEMBER_QUESTION_MAX, VOTE_ROWS, VOTES_WINDOW_DAYS, windowStart, monthOf, newestFirst, cleanVoteText, POSITION_CHAR,
  type MemberVotes, type MonthFile, type Roll, type RollRow, type VotesModel, type Chamber, type Position,
} from "./votes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
const POS = new Set(["yea", "nay", "present", "not_voting"]);

const ROLL_COLS = `v.id, v.chamber, v.congress, v.session, v.roll_number, v.voted_at::text as voted_at, v.question, v.result, v.bill, v.vote_type,
  v.yeas, v.nays, v.present, v.not_voting, v.source_url`;

export const VOTES_FRESH_DAYS = 60;
async function loadIsWhole(sql: Sql, rolls: RollRow[], builtAt: string): Promise<boolean> {
  const cut = new Date(Date.parse(builtAt + "T00:00:00Z") - VOTES_FRESH_DAYS * 86400000).toISOString().slice(0, 10);
  for (const ch of ["house", "senate"]) {
    const newest = rolls.filter((r) => r.chamber === ch).map((r) => String(r.voted_at)).sort().pop();
    if (!newest || newest < cut) { console.log(`[web] roll-call votes: not shown yet (${ch}: newest roll call on file ${newest ?? "none"})`); return false; }
  }
  const ok = (await sql.unsafe(`select 1 from ingest_runs r join sources s on s.id = r.source_id where s.code = 'congress_votes' and r.status = 'success' limit 1`)) as unknown[];
  if (!ok.length) console.log("[web] roll-call votes: not shown yet (no run of congress_votes has finished whole)");
  return ok.length > 0;
}

/** Reads every roll call (no positions), then per-person counts and the newest rows for members with a page. */
export async function loadVotes(sql: Sql, m: Flagship, builtAt: string): Promise<VotesModel> {
  const out = emptyVotes();
  out.builtAt = builtAt.slice(0, 10);
  const rolls = (await sql.unsafe(`select ${ROLL_COLS} from congress_votes v where v.voted_at <= $1::date order by v.voted_at desc, v.chamber desc, v.roll_number desc`, [out.builtAt])) as RollRow[];
  if (!rolls.length) return out;
  // Shown only when the load is whole: the first catch-up (about 1,600 roll calls) takes several
  // runs, and a member's counts from half a record would be wrong. Whole = a run of the source has
  // ended "success" (a run that stops on its budget ends "partial") and each chamber's newest roll
  // call is within VOTES_FRESH_DAYS of the build (recesses run to about five weeks).
  if (!(await loadIsWhole(sql, rolls, out.builtAt))) return out;
  out.rolls = rolls.map((r) => rollFromRow(r));
  out.shown = true;

  // Person ids are used as the database returns them (the model keys people the same way), never converted.
  const pages = new Map<number, { slug: string; name: string }>();
  for (const p of m.people.values()) if (p.isCongress && p.slug && !p.od) pages.set(p.id, { slug: p.slug, name: p.name });
  const ids = [...pages.keys()];

  const tot = (await sql`select count(*)::int as n, count(person_id)::int as matched from congress_vote_positions`) as { n: number; matched: number }[];
  out.positions = tot[0]?.n ?? 0; out.matched = tot[0]?.matched ?? 0;

  if (ids.length) {
    const from = windowStart(out.builtAt, VOTES_WINDOW_DAYS);
    const counts = (await sql`
      select p.person_id,
             count(*)::int as total, max(v.voted_at)::text as newest,
             count(*) filter (where v.voted_at >= ${from}::date and v.voted_at <= ${out.builtAt}::date and p.position = 'yea')::int as yea,
             count(*) filter (where v.voted_at >= ${from}::date and v.voted_at <= ${out.builtAt}::date and p.position = 'nay')::int as nay,
             count(*) filter (where v.voted_at >= ${from}::date and v.voted_at <= ${out.builtAt}::date and p.position = 'present')::int as present,
             count(*) filter (where v.voted_at >= ${from}::date and v.voted_at <= ${out.builtAt}::date and p.position = 'not_voting')::int as not_voting
        from congress_vote_positions p join congress_votes v on v.id = p.vote_id
       where p.person_id in ${sql(ids)} and v.voted_at <= ${out.builtAt}::date
       group by p.person_id`) as { person_id: number; total: number; newest: string | null; yea: number; nay: number; present: number; not_voting: number }[];
    for (const c of counts) {
      out.byPerson.set(c.person_id, { yea: c.yea, nay: c.nay, present: c.present, notVoting: c.not_voting, total: c.total, newest: c.newest, rows: [] });
    }
    const byId = new Map(out.rolls.map((r) => [r.id, r]));
    const rows = (await sql`
      select person_id, vote_id, position from (
        select p.person_id, p.vote_id, p.position,
               row_number() over (partition by p.person_id order by v.voted_at desc, v.vote_time desc nulls last, v.id desc) as rn
          from congress_vote_positions p join congress_votes v on v.id = p.vote_id
         where p.person_id in ${sql(ids)} and v.voted_at <= ${out.builtAt}::date) t
       where rn <= ${VOTE_ROWS} order by person_id, rn`) as { person_id: number; vote_id: number; position: string }[];
    for (const r of rows) {
      const mv = out.byPerson.get(r.person_id); const roll = byId.get(Number(r.vote_id));
      if (!mv || !roll || !POS.has(r.position)) continue;
      mv.rows.push({ roll: { ...roll, question: cleanVoteText(roll.question, MEMBER_QUESTION_MAX) }, position: r.position as Position });
    }
    for (const [id, mv] of out.byPerson) { mv.rows.sort((a, b) => newestFirst(a.roll, b.roll)); const pg = pages.get(id); if (pg) out.members.push(pg); }
    out.members.sort((a, b) => a.name.localeCompare(b.name));
  }

  const months = (await sql`
    select v.chamber, to_char(v.voted_at, 'YYYY-MM') as month, count(*)::int as rolls
      from congress_votes v
     where v.voted_at <= ${out.builtAt}::date and exists (select 1 from congress_vote_positions p where p.vote_id = v.id)
     group by 1, 2 order by 2, 1`) as { chamber: string; month: string; rolls: number }[];
  out.months = months.map((x) => ({ chamber: x.chamber === "senate" ? "senate" : "house", month: x.month, rolls: x.rolls }));
  return out;
}

/** One monthly position file, built by streaming the month's positions. */
export async function buildMonthFile(sql: Sql, chamber: Chamber, month: string, slugOf: ReadonlyMap<number, string>, builtAt: string): Promise<MonthFile> {
  const start = `${month}-01`;
  // The roster: one entry per member key, the newest recorded name, party, state and person.
  const roster = (await sql`
    select distinct on (p.member_key) p.member_key, p.name, p.party, p.state, p.person_id
      from congress_vote_positions p join congress_votes v on v.id = p.vote_id
     where v.chamber = ${chamber} and v.voted_at >= ${start}::date and v.voted_at < (${start}::date + interval '1 month') and v.voted_at <= ${builtAt}::date
     order by p.member_key, v.voted_at desc, v.id desc`) as { member_key: string; name: string | null; party: string | null; state: string | null; person_id: number | null }[];
  roster.sort((a, b) => (a.name ?? a.member_key).localeCompare(b.name ?? b.member_key) || a.member_key.localeCompare(b.member_key));
  const index = new Map(roster.map((r, i) => [r.member_key, i]));
  const file: MonthFile = {
    chamber, month,
    roster: roster.map((r) => [r.member_key, cleanVoteText(r.name, 80) ?? r.member_key, cleanVoteText(r.party, 20) ?? "", cleanVoteText(r.state, 4) ?? "", r.person_id != null ? slugOf.get(r.person_id) ?? "" : ""]),
    rolls: {},
  };
  const ids = (await sql`
    select v.id from congress_votes v
     where v.chamber = ${chamber} and v.voted_at >= ${start}::date and v.voted_at < (${start}::date + interval '1 month') and v.voted_at <= ${builtAt}::date
     order by v.id`) as { id: number }[];
  const rows = new Map<number, string[]>();
  for (const r of ids) rows.set(Number(r.id), new Array(roster.length).fill("-"));
  const cursor = sql`
    select p.vote_id, p.member_key, p.position
      from congress_vote_positions p join congress_votes v on v.id = p.vote_id
     where v.chamber = ${chamber} and v.voted_at >= ${start}::date and v.voted_at < (${start}::date + interval '1 month') and v.voted_at <= ${builtAt}::date
     order by p.vote_id`.cursor(5000);
  for await (const batch of cursor as AsyncIterable<{ vote_id: number; member_key: string; position: string }[]>) {
    for (const r of batch) {
      const arr = rows.get(Number(r.vote_id)); const i = index.get(r.member_key);
      if (!arr || i == null || !POS.has(r.position)) continue;
      arr[i] = POSITION_CHAR[r.position as Position];
    }
  }
  for (const [id, arr] of rows) file.rolls[String(id)] = arr.join("");
  return file;
}

export function slugMap(m: Flagship): Map<number, string> {
  const out = new Map<number, string>();
  for (const p of m.people.values()) if (p.isCongress && p.slug && !p.od) out.set(p.id, p.slug);
  return out;
}

export type { Roll };
