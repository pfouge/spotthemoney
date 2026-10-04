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
): Promise<{ personId: number; created: boolean }> {
  // Rule 1: already linked by bioguide_id.
  const [byBioguide] = await sql<{ id: number }[]>`
    select id from people where bioguide_id = ${bioguide} limit 1
  `;
  if (byBioguide) {
    // Rule 1b: a duplicate filer row for the same seat → merge it into the linked row.
    const dup = await findUnlinkedFilerBySeat(sql, name, chamber, state, district);
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
  const bySeat = await findUnlinkedFilerBySeat(sql, name, chamber, state, district);
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

      const { personId } = await resolvePerson(sql, ctx, bioguide, member.name, chamber, state, district);
      await upsertCongressRole(sql, ctx, personId, chamber, state, district, party, validFrom);
    } catch (err) {
      ctx.quarantine(bioguide, err instanceof Error ? err.message : String(err));
    }
  }

  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestCongressRoster()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
