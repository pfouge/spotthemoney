// Source: the public-domain unitedstates/congress-legislators dataset —
// legislators-current.json, published continuously by volunteers and used by
// Congress.gov, ProPublica, GovTrack, etc. One file, no auth, no rate limit.
//
// Why: house_ptr/congress_ptr create `people` rows from a bare display name (contract
// §3.1, `resolve_person` in ingest/py/congress_ptr_job.py) and never learn party, state,
// district, or the member's Bioguide ID. This job is the other half: it walks the current
// roster and (a) attaches `bioguide_id` to whichever `people` row the PTR job already
// created for that member, matching by name + active congress role in the same chamber —
// the same rule the Python job uses to avoid creating duplicates — or (b) creates the
// person itself if PTR hasn't seen them yet, and (c) keeps party/state/district on
// `person_roles` current every run. Never deletes a role (a member leaving Congress still
// has a historical row); "current" here means "as of the last term in `terms[]`".
//
// Kept to ONE HTTP request: the whole roster comes back in a single JSON array.

import { createHash } from "node:crypto";
import { fetchJson } from "../lib/http.js";
import { createRunContext, type RunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "congress_roster";
const DEFAULT_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const HISTORICAL_URL = "https://unitedstates.github.io/congress-legislators/legislators-historical.json";
const COMMITTEES_URL = "https://unitedstates.github.io/congress-legislators/committees-current.json";
const MEMBERSHIP_URL = "https://unitedstates.github.io/congress-legislators/committee-membership-current.json";
/** Fewer assignments than this means a broken file, not an empty Congress: keep what is stored. */
export const MIN_MEMBERSHIP_ROWS = 500;
/** A filer is only looked for among members whose last term ended this recently. */
export const FORMER_MEMBER_YEARS = 4;

export type Chamber = "house" | "senate";

export interface LegislatorName {
  first: string;
  last: string;
  middle_name?: string;
  nickname?: string;
  official_full?: string;
}

export interface LegislatorTerm {
  type: string; // 'rep' | 'sen'
  start?: string;
  end?: string;
  state?: string;
  district?: number;
  party?: string;
}

export interface Legislator {
  id: { bioguide: string };
  name: LegislatorName;
  terms: LegislatorTerm[];
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for offline tests; no DB, no network).
// ──────────────────────────────────────────────────────────────────────────

/** 'rep' -> 'house', 'sen' -> 'senate'; anything else is unrecognized (quarantine it). */
export function chamberForTermType(type: string): Chamber | null {
  if (type === "rep") return "house";
  if (type === "sen") return "senate";
  return null;
}

/** House district as the stored text form ('12', '0' for at-large); null for senators. */
export function districtForTerm(term: Pick<LegislatorTerm, "type" | "district">): string | null {
  if (term.type !== "rep") return null;
  if (term.district === null || term.district === undefined) return null;
  return String(term.district);
}

/** The last entry in terms[] is the member's current term, per the dataset's convention. */
export function currentTerm(terms: LegislatorTerm[]): LegislatorTerm | undefined {
  return terms.length > 0 ? terms[terms.length - 1] : undefined;
}

/**
 * Candidate display names to match against `people.full_name` (case-insensitively):
 * official_full as given, "first last", the nickname form ("nickname last") when present,
 * and official_full with any middle name/initial dropped (first + last token only) — this
 * is the "middle name/nickname removed" variant the matching rule calls for.
 */
export function nameCandidates(name: LegislatorName): string[] {
  const candidates = new Set<string>();
  const add = (s: string | undefined) => {
    const trimmed = s?.trim();
    if (trimmed) candidates.add(trimmed);
  };

  add(name.official_full);
  add(`${name.first} ${name.last}`.trim());
  if (name.nickname) add(`${name.nickname} ${name.last}`.trim());

  if (name.official_full) {
    const tokens = name.official_full.trim().split(/\s+/);
    if (tokens.length > 2) add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  }

  return [...candidates];
}

/**
 * Exact port of `slugify()` in ingest/py/congress_ptr_job.py: NFKD-normalize, drop
 * non-ASCII (accents fall off, e.g. "Raúl" -> "Raul"), lowercase, collapse any run of
 * non-alphanumerics to one hyphen, trim hyphens, cap at 80 chars, "member" if empty.
 * Must stay byte-for-byte identical so a person the Python job creates and this job later
 * touches resolves to the same slug family.
 */
export function slugify(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, ""); // drop what NFKD peeled off (matches Python's encode/ignore)
  const s = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "member";
}

/** Full name to store, preferring the dataset's official form. */
export function fullNameFor(name: LegislatorName): string {
  return name.official_full?.trim() || `${name.first} ${name.last}`.trim();
}

// ── former members ────────────────────────────────────────────────────────
// legislators-current.json holds sitting members only, so a filer who has left Congress never
// got a party, state or Bioguide ID: Marjorie Taylor Greene (resigned 2026-01-05), Markwayne
// Mullin (left the Senate 2026-03-23) and the late Lindsey Graham all showed with no party on
// 2026-10-06. Filers the current roster did not reach are looked up among everyone whose last
// term ended within FORMER_MEMBER_YEARS, in legislators-historical.json.

/** A `people` row that filed reports but has no Bioguide ID yet. */
export interface UnlinkedFiler { id: number; fullName: string; chamber: Chamber; state: string | null; district: string | null }

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "dr", "hon", "mr", "mrs", "ms"]);
const nameTokens = (s: string | undefined): string[] => foldName(s ?? "").split(" ").filter((t) => t && !NAME_SUFFIXES.has(t));

/**
 * Is this legislator the filer? Same chamber (last term), same state when the filer row has
 * one, every surname token present in the filed name, and a first name that agrees — equal
 * to, or the start of / started by (3+ letters), the legislator's first name, nickname or
 * the first word of the official name. A shared surname and seat is never enough: seats
 * change hands (Darline Graham holds Lindsey Graham's).
 */
export function isSameMember(filer: UnlinkedFiler, leg: Legislator): boolean {
  const term = currentTerm(leg.terms ?? []);
  if (!term || chamberForTermType(term.type) !== filer.chamber) return false;
  if (filer.state && term.state && filer.state !== term.state) return false;
  const filed = nameTokens(filer.fullName);
  const surname = nameTokens(leg.name.last);
  if (!surname.length || !surname.every((t) => filed.includes(t))) return false;
  const given = filed.filter((t) => !surname.includes(t));
  const theirs = [leg.name.first, leg.name.nickname, leg.name.official_full?.trim().split(/\s+/)[0]].flatMap((n) => nameTokens(n)).filter((t) => !surname.includes(t));
  return given.some((a) => theirs.some((b) => a.length > 1 && b.length > 1 && (a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))))));
}

/** The one legislator who is this filer, or null when nobody — or more than one — fits. */
export function findMember(filer: UnlinkedFiler, legislators: Legislator[], today: string, years = FORMER_MEMBER_YEARS): Legislator | null {
  const cutoff = `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
  const hits = legislators.filter((l) => {
    const end = currentTerm(l.terms ?? [])?.end;
    return (!end || end >= cutoff) && isSameMember(filer, l);
  });
  return hits.length === 1 ? hits[0]! : null;
}

// ── committees (migration 0015) ───────────────────────────────────────────────────────────
export interface SourceCommittee {
  type: string; // 'house' | 'senate' | 'joint'
  name: string;
  thomas_id: string;
  url?: string;
  jurisdiction?: string;
  subcommittees?: { name: string; thomas_id: string }[];
}
export interface SourceMember { name?: string; bioguide?: string; party?: string; rank?: number; title?: string }
export interface CommitteeRecord { code: string; parent_code: string | null; chamber: "house" | "senate" | "joint"; name: string; url: string | null; jurisdiction: string | null }
export interface SeatRecord { committee_code: string; bioguide: string; side: string | null; rank: number | null; title: string | null }

/** Full committees first, then their subcommittees (code = parent code + subcommittee id). */
export function flattenCommittees(list: SourceCommittee[]): CommitteeRecord[] {
  const out: CommitteeRecord[] = [];
  const seen = new Set<string>();
  const add = (r: CommitteeRecord) => { if (r.code && r.name && !seen.has(r.code)) { seen.add(r.code); out.push(r); } };
  for (const c of list) {
    if (c.type !== "house" && c.type !== "senate" && c.type !== "joint") continue;
    if (!c.thomas_id || !c.name) continue;
    add({ code: c.thomas_id, parent_code: null, chamber: c.type, name: c.name.trim(), url: c.url?.trim() || null, jurisdiction: c.jurisdiction?.replace(/\s+/g, " ").trim() || null });
  }
  for (const c of list) {
    if (!seen.has(c.thomas_id)) continue;
    for (const sc of c.subcommittees ?? []) {
      if (!sc.thomas_id || !sc.name) continue;
      add({ code: `${c.thomas_id}${sc.thomas_id}`, parent_code: c.thomas_id, chamber: c.type as CommitteeRecord["chamber"], name: sc.name.replace(/\s+/g, " ").trim(), url: null, jurisdiction: null });
    }
  }
  return out;
}

/** One seat per member per committee; seats on a committee the committee file does not list are dropped. */
export function seatRecords(membership: Record<string, SourceMember[]>, codes: Set<string>): SeatRecord[] {
  const out: SeatRecord[] = [];
  const seen = new Set<string>();
  for (const [code, members] of Object.entries(membership)) {
    if (!codes.has(code) || !Array.isArray(members)) continue;
    for (const m of members) {
      if (!m?.bioguide) continue;
      const key = `${code}|${m.bioguide}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ committee_code: code, bioguide: m.bioguide, side: m.party === "majority" || m.party === "minority" ? m.party : null,
        rank: Number.isFinite(m.rank) ? Number(m.rank) : null, title: m.title?.trim() || null });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// DB-backed ingest (untested offline; the pure helpers above carry the test coverage).
// ──────────────────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof getDb>;

async function nextAvailableSlug(sql: Sql, base: string): Promise<string> {
  const taken = await sql<{ slug: string }[]>`
    select slug from people where slug = ${base} or slug ~ ${`^${escapeRegex(base)}-\\d+$`}
  `;
  const takenSet = new Set(taken.map((r) => r.slug));
  if (!takenSet.has(base)) return base;
  let n = 2;
  let candidate = `${base}-${n}`;
  while (takenSet.has(candidate)) {
    n++;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase ASCII fold for name comparison ("Luján" → "lujan"). */
export function foldName(s: string): string {
  return s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A filer row the PTR job created under the name AS FILED ("Richard W. Allen") that the
 * name rule cannot reach from the roster's names ("Rick W. Allen" / "Richard Allen" /
 * "Rick Allen"). The seat identifies the member: same chamber + state + district (House) or
 * chamber + state (Senate), with the roster surname present in the filed name as a guard.
 * Without this the member had two `people` rows and their trades carried no party, so the
 * party filter silently dropped them (found on the live Congress map, 2026-10-04).
 */
async function findUnlinkedFilerBySeat(
  sql: Sql,
  name: LegislatorName,
  chamber: Chamber,
  state: string | null,
  district: string | null,
  termStart: string | null = null,
): Promise<number | null> {
  if (!state) return null;
  const rows = await sql<{ id: number; full_name: string }[]>`
    select p.id, p.full_name from people p
      join person_roles r on r.person_id = p.id
        and r.role_kind = 'congress'
        and r.chamber = ${chamber}
     where p.bioguide_id is null
       and r.state = ${state}
       and (${chamber} = 'senate' or r.district is not distinct from ${district})
       and (r.valid_to is null or r.valid_to >= current_date)
       -- A seat changes hands: a filer whose reports all predate this member's term is the
       -- predecessor (Lindsey Graham's reports are not Darline Graham's), not a duplicate.
       and (${termStart}::date is null
            or not exists (select 1 from filings f where f.filer_person_id = p.id)
            or exists (select 1 from filings f where f.filer_person_id = p.id and f.filed_at::date >= ${termStart}::date))
     order by p.id
  `;
  const last = foldName(name.last);
  if (!last) return null;
  const hit = rows.find((r) => ` ${foldName(r.full_name)} `.includes(` ${last} `));
  return hit?.id ?? null;
}

/** Fold a duplicate filer row into the roster's row: move its filings and trades, drop it. */
async function mergePerson(sql: Sql, fromId: number, intoId: number): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`update filings set filer_person_id = ${intoId} where filer_person_id = ${fromId}`;
    await tx`update transactions set person_id = ${intoId} where person_id = ${fromId}`;
    await tx`update leaderboard_snapshots set person_id = ${intoId} where person_id = ${fromId}`;
    // Committee seats of the dropped row go with it (cascade); the committee pass at the end of
    // this run writes the full set again under the surviving row.
    await tx`delete from person_roles where person_id = ${fromId}`;
    await tx`delete from people where id = ${fromId}`;
  });
}

async function resolvePerson(
  sql: Sql,
  ctx: RunContext,
  bioguide: string,
  name: LegislatorName,
  chamber: Chamber,
  state: string | null = null,
  district: string | null = null,
  termStart: string | null = null,
): Promise<{ personId: number; created: boolean }> {
  // Rule 1: already linked by bioguide_id.
  const [byBioguide] = await sql<{ id: number }[]>`
    select id from people where bioguide_id = ${bioguide} limit 1
  `;
  if (byBioguide) {
    // Rule 1b: a duplicate filer row for the same seat → merge it into the linked row.
    const dup = await findUnlinkedFilerBySeat(sql, name, chamber, state, district, termStart);
    if (dup != null && dup !== byBioguide.id) {
      await mergePerson(sql, dup, byBioguide.id);
      ctx.extra.merged_duplicates = ((ctx.extra.merged_duplicates as number) ?? 0) + 1;
      ctx.rowsChanged++;
    }
    ctx.extra.matched_by_bioguide = ((ctx.extra.matched_by_bioguide as number) ?? 0) + 1;
    return { personId: byBioguide.id, created: false };
  }

  // Rule 2: name match against an active congress role in the same chamber.
  const candidates = nameCandidates(name).map((c) => c.toLowerCase());
  if (candidates.length > 0) {
    const [byName] = await sql<{ id: number }[]>`
      select p.id from people p
        join person_roles r on r.person_id = p.id
          and r.role_kind = 'congress'
          and r.chamber = ${chamber}
       where lower(p.full_name) = any(${candidates})
         and (r.valid_to is null or r.valid_to >= current_date)
       order by p.id limit 1
    `;
    if (byName) {
      await sql`update people set bioguide_id = ${bioguide}, updated_at = now() where id = ${byName.id}`;
      ctx.extra.matched_by_name = ((ctx.extra.matched_by_name as number) ?? 0) + 1;
      ctx.rowsChanged++;
      return { personId: byName.id, created: false };
    }
  }

  // Rule 2b: the seat (see findUnlinkedFilerBySeat) when the name as filed differs.
  const bySeat = await findUnlinkedFilerBySeat(sql, name, chamber, state, district, termStart);
  if (bySeat != null) {
    await sql`update people set bioguide_id = ${bioguide}, updated_at = now() where id = ${bySeat}`;
    ctx.extra.matched_by_seat = ((ctx.extra.matched_by_seat as number) ?? 0) + 1;
    ctx.rowsChanged++;
    return { personId: bySeat, created: false };
  }

  // Rule 3: no match — create the person.
  const fullName = fullNameFor(name);
  const baseSlug = slugify(fullName);
  const slug = await nextAvailableSlug(sql, baseSlug);
  const [created] = await sql<{ id: number }[]>`
    insert into people (full_name, first_name, last_name, slug, bioguide_id)
    values (${fullName}, ${name.first}, ${name.last}, ${slug}, ${bioguide})
    returning id
  `;
  ctx.extra.created = ((ctx.extra.created as number) ?? 0) + 1;
  ctx.rowsChanged++;
  return { personId: created!.id, created: true };
}

async function upsertCongressRole(
  sql: Sql,
  ctx: RunContext,
  personId: number,
  chamber: Chamber,
  state: string | null,
  district: string | null,
  party: string | null,
  validFrom: string | null,
): Promise<void> {
  const [existing] = await sql<{ id: number }[]>`
    select id from person_roles
     where person_id = ${personId} and role_kind = 'congress' and chamber = ${chamber}
       and (valid_to is null or valid_to >= current_date)
     order by id limit 1
  `;

  if (existing) {
    const res = await sql`
      update person_roles
         set party = ${party}, state = ${state}, district = ${district}
       where id = ${existing.id}
         and (party is distinct from ${party}
              or state is distinct from ${state}
              or district is distinct from ${district})
    `;
    if ((res.count ?? 0) > 0) {
      ctx.rowsChanged++;
      ctx.extra.roles_updated = ((ctx.extra.roles_updated as number) ?? 0) + 1;
    }
    return;
  }

  await sql`
    insert into person_roles (person_id, role_kind, chamber, state, district, party, valid_from)
    values (${personId}, 'congress', ${chamber}, ${state}, ${district}, ${party}, ${validFrom})
  `;
  ctx.rowsChanged++;
  ctx.extra.roles_inserted = ((ctx.extra.roles_inserted as number) ?? 0) + 1;
}

export async function ingestCongressRoster(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const url = process.env.CONGRESS_ROSTER_URL ?? DEFAULT_URL;

  ctx.extra.matched_by_bioguide = 0;
  ctx.extra.matched_by_name = 0;
  ctx.extra.created = 0;
  ctx.extra.roles_updated = 0;
  ctx.extra.roles_inserted = 0;

  let legislators: Legislator[];
  try {
    legislators = await fetchJson<Legislator[]>(url);
  } catch (err) {
    return {
      source: SOURCE,
      rowsSeen: 0,
      rowsChanged: 0,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      stats: ctx.stats(),
    };
  }
  ctx.extra.api_rows = legislators.length;
  ctx.extra.source_url = url;
  ctx.extra.source_digest = createHash("sha256").update(JSON.stringify(legislators)).digest("hex").slice(0, 16);

  for (const member of legislators) {
    const bioguide = member.id?.bioguide;
    if (!bioguide) continue;
    if (!ctx.markSeen(bioguide)) continue;
    ctx.rowsSeen++;

    try {
      const term = currentTerm(member.terms ?? []);
      if (!term) {
        ctx.quarantine(bioguide, "no terms[] entries");
        continue;
      }
      const chamber = chamberForTermType(term.type);
      if (!chamber) {
        ctx.quarantine(bioguide, `unrecognized term type "${term.type}"`);
        continue;
      }

      const state = term.state ?? null;
      const district = districtForTerm(term);
      const party = term.party ?? null;
      const validFrom = term.start ?? null;

      const { personId } = await resolvePerson(sql, ctx, bioguide, member.name, chamber, state, district, validFrom);
      await upsertCongressRole(sql, ctx, personId, chamber, state, district, party, validFrom);
    } catch (err) {
      ctx.quarantine(bioguide, err instanceof Error ? err.message : String(err));
    }
  }

  try {
    await linkUnlinkedFilers(sql, ctx, legislators);
  } catch (err) {
    // Never fail the roster over the former-member pass; the next run tries again.
    ctx.extra.former_members_error = 1;
    console.error(`congress_roster: former-member pass failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await syncCommittees(sql, ctx);
  } catch (err) {
    // Committees are an extra on the member pages; the roster itself must not fail over them.
    // A missing table (migration 0015 not applied yet) lands here too.
    ctx.extra.committees_error = 1;
    console.error(`congress_roster: committee pass failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}

/**
 * Current committee and subcommittee assignments: two more requests to the same dataset.
 * The stored set is replaced in one transaction, so a member who leaves a committee leaves
 * it here on the next run. A file that is far too short is treated as broken and ignored.
 */
async function syncCommittees(sql: Sql, ctx: RunContext): Promise<void> {
  const committees = flattenCommittees(await fetchJson<SourceCommittee[]>(process.env.CONGRESS_COMMITTEES_URL ?? COMMITTEES_URL));
  const membership = await fetchJson<Record<string, SourceMember[]>>(process.env.CONGRESS_MEMBERSHIP_URL ?? MEMBERSHIP_URL);
  const seats = seatRecords(membership, new Set(committees.map((c) => c.code)));
  ctx.extra.committees = committees.length;
  ctx.extra.committee_seats_in_file = seats.length;
  if (seats.length < MIN_MEMBERSHIP_ROWS) {
    ctx.warn(`committee membership file has ${seats.length} seats (expected thousands) — stored assignments left as they are`);
    return;
  }
  const people = await sql<{ id: number; bioguide_id: string }[]>`select id, bioguide_id from people where bioguide_id is not null`;
  const idOf = new Map(people.map((p) => [p.bioguide_id, p.id]));
  const rows = seats.flatMap((s) => {
    const person_id = idOf.get(s.bioguide);
    return person_id == null ? [] : [{ committee_code: s.committee_code, person_id, side: s.side, rank: s.rank, title: s.title }];
  });
  ctx.extra.committee_seats = rows.length;
  ctx.extra.committee_seats_unmatched = seats.length - rows.length;
  await sql.begin(async (tx) => {
    await tx`delete from congress_committee_members`;
    // Parents before children: the first pass holds full committees only.
    for (const pass of [committees.filter((c) => !c.parent_code), committees.filter((c) => c.parent_code)]) {
      for (let i = 0; i < pass.length; i += 200) {
        await tx`
          insert into congress_committees ${tx(pass.slice(i, i + 200), "code", "parent_code", "chamber", "name", "url", "jurisdiction")}
          on conflict (code) do update set parent_code = excluded.parent_code, chamber = excluded.chamber, name = excluded.name,
            url = excluded.url, jurisdiction = excluded.jurisdiction, updated_at = now()`;
      }
    }
    await tx`delete from congress_committees where code not in ${tx(committees.map((c) => c.code))}`;
    for (let i = 0; i < rows.length; i += 500) {
      await tx`insert into congress_committee_members ${tx(rows.slice(i, i + 500), "committee_code", "person_id", "side", "rank", "title")}`;
    }
  });
}

/**
 * Filers with reports on file and still no Bioguide ID after the current roster: match each
 * against current + recently departed members and attach ID, party, state, district and the
 * term's dates (a term that has ended closes the role). The historical file (≈1.3 MB) is
 * fetched only when there is someone to look up.
 */
async function linkUnlinkedFilers(sql: Sql, ctx: RunContext, current: Legislator[]): Promise<void> {
  const filers = await sql<{ id: number; full_name: string; chamber: Chamber; state: string | null; district: string | null }[]>`
    select distinct on (p.id) p.id, p.full_name, r.chamber::text as chamber, r.state, r.district
      from people p
      join person_roles r on r.person_id = p.id and r.role_kind = 'congress' and r.chamber is not null
     where p.bioguide_id is null
       and exists (select 1 from filings f where f.filer_person_id = p.id and f.source in ('house_ptr', 'senate_ptr'))
     order by p.id, r.id desc
  `;
  ctx.extra.unlinked_filers = filers.length;
  if (!filers.length) return;

  const historical = await fetchJson<Legislator[]>(process.env.CONGRESS_ROSTER_HISTORICAL_URL ?? HISTORICAL_URL);
  ctx.extra.historical_rows = historical.length;
  const everyone = [...current, ...historical];
  const today = new Date().toISOString().slice(0, 10);
  let linked = 0, merged = 0, unmatched = 0;

  for (const f of filers) {
    const filer: UnlinkedFiler = { id: f.id, fullName: f.full_name, chamber: f.chamber, state: f.state, district: f.district };
    const leg = findMember(filer, everyone, today);
    if (!leg) { unmatched++; console.log(`congress_roster: no member found for filer "${f.full_name}" (${f.chamber}${f.state ? ", " + f.state : ""})`); continue; }
    const term = currentTerm(leg.terms)!;
    const bioguide = leg.id.bioguide;
    const [owner] = await sql<{ id: number }[]>`select id from people where bioguide_id = ${bioguide} limit 1`;
    let personId = f.id;
    if (owner && owner.id !== f.id) {
      await mergePerson(sql, f.id, owner.id);   // the roster already has this member: fold the filer row in
      personId = owner.id;
      merged++;
    } else {
      await sql`update people set bioguide_id = ${bioguide}, updated_at = now() where id = ${f.id}`;
      linked++;
    }
    const ended = term.end && term.end < today ? term.end : null;
    await sql`
      update person_roles
         set party = ${term.party ?? null}, state = ${term.state ?? null}, district = ${districtForTerm(term)},
             valid_from = coalesce(${term.start ?? null}::date, valid_from), valid_to = ${ended}::date
       where id = (select id from person_roles where person_id = ${personId} and role_kind = 'congress' and chamber = ${f.chamber} order by id desc limit 1)
    `;
    ctx.rowsChanged++;
    console.log(`congress_roster: filer "${f.full_name}" is ${fullNameFor(leg.name)} (${bioguide}, ${term.party ?? "?"}-${term.state ?? "?"}${ended ? ", left " + ended : ""})`);
  }
  ctx.extra.former_members_linked = linked;
  ctx.extra.former_members_merged = merged;
  ctx.extra.unlinked_filers_unmatched = unmatched;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestCongressRoster()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
