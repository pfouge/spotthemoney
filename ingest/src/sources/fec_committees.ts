// Source: OpenFEC — the committee universe for fec_schedule_a (open decision #18, decided
// 2026-09-27 under the autonomous-session rules):
//
//   scope = principal campaign committees of every current member of Congress
//           (OpenFEC /candidates/search/ with incumbent_challenge=I in the current cycle, H + S)
//         ∪ the top 200 PACs by receipts in the current cycle (OpenFEC /totals/pac/,
//           sorted -receipts).
//
// This job only writes `committees` rows (fec_id, name, committee_type, party); the
// schedule_a job reads its scope from that table. Upsert on fec_id, never delete — a
// committee that drops out of the top 200 keeps its history.
//
// AUTH: FEC_API_KEY (falls back to DEMO_KEY with a warning — the DEMO key is throttled to
// a few dozen calls per hour, enough for a smoke run only). The key never appears in logs:
// lib/http.ts errors carry host+path only.
//
// Runtime note: ~735 committees × a 30-day schedule_a window is the bulk of the daily FEC
// call volume; FEC_TOP_PACS (default 200) and the ingest matrix in ingest.yml keep it inside
// the job budget. Set FEC_CYCLE to override the cycle (default: current even year).

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";

const SOURCE = "fec_committees";
const API = process.env.FEC_API_BASE ?? "https://api.open.fec.gov/v1"; // override is for the local mock test only

interface Candidate {
  candidate_id: string;
  name: string;
  party?: string | null;
  office?: string | null;
  principal_committees?: { committee_id: string; name?: string | null; committee_type?: string | null; party?: string | null }[];
}
interface CandidatesPage { pagination?: { pages?: number; page?: number }; results?: Candidate[] }
interface PacTotal { committee_id: string; committee_name?: string | null; receipts?: number | null; committee_type?: string | null; party?: string | null }
interface TotalsPage { pagination?: { pages?: number; page?: number }; results?: PacTotal[] }

function currentCycle(): number {
  const y = new Date().getUTCFullYear();
  return y % 2 === 0 ? y : y + 1;
}

export async function ingestFecCommittees(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const apiKey = process.env.FEC_API_KEY;
  if (!apiKey) {
    // api.open.fec.gov answers DEMO_KEY with 403 from GitHub runners (docs/04 #28), which
    // failed the whole "money" group and blocked the daily deploy for a week. Without a key
    // this source is "not configured", not "broken": no-op, and say so in the run stats so
    // scripts/freshness-check.mjs reports it as needing a key.
    ctx.warn("FEC_API_KEY not set — skipped (no-op). Free key: https://api.data.gov/signup/");
    ctx.extra["skipped"] = "FEC_API_KEY not set";
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }
  const key = apiKey;
  const cycle = Number(process.env.FEC_CYCLE ?? currentCycle());
  const topPacs = Number(process.env.FEC_TOP_PACS ?? 200);
  ctx.extra["cycle"] = cycle;

  type Row = { fec_id: string; name: string; committee_type: string | null; party: string | null; kind: string };
  const rows = new Map<string, Row>();

  // 1. Incumbent members' principal committees.
  for (const office of ["H", "S"]) {
    for (let page = 1; page <= 20; page++) {
      // /candidates/search/ — the plain /candidates/ endpoint does not return
      // principal_committees, so the first keyed run (2026-10-04) loaded 0 member
      // committees and only the 200 PACs.
      const u = new URL(`${API}/candidates/search/`);
      u.searchParams.set("api_key", key);
      u.searchParams.set("cycle", String(cycle));
      u.searchParams.set("office", office);
      u.searchParams.set("incumbent_challenge", "I");
      u.searchParams.set("candidate_status", "C");
      u.searchParams.set("per_page", "100");
      u.searchParams.set("page", String(page));
      u.searchParams.set("sort", "name");
      const data = await fetchJson<CandidatesPage>(u);
      const results = data.results ?? [];
      for (const c of results) {
        for (const pc of c.principal_committees ?? []) {
          if (!pc.committee_id || !ctx.markSeen(pc.committee_id)) continue;
          ctx.rowsSeen++;
          rows.set(pc.committee_id, {
            fec_id: pc.committee_id,
            name: pc.name ?? `${c.name} principal committee`,
            committee_type: pc.committee_type ?? office,
            party: pc.party ?? c.party ?? null,
            kind: "member",
          });
        }
      }
      ctx.extra[`candidates_${office}_page_${page}`] = results.length;
      if (results.length < 100 || (data.pagination?.pages ?? page) <= page) break;
    }
  }
  ctx.extra["member_committees"] = rows.size;
  if (rows.size === 0) ctx.warn("no member principal committees returned by /candidates/search/ — check the endpoint and filters");

  // 2. Top PACs by receipts this cycle.
  let pacCount = 0;
  for (let page = 1; pacCount < topPacs && page <= Math.ceil(topPacs / 100); page++) {
    const u = new URL(`${API}/totals/pac/`);
    u.searchParams.set("api_key", key);
    u.searchParams.set("cycle", String(cycle));
    u.searchParams.set("sort", "-receipts");
    u.searchParams.set("per_page", "100");
    u.searchParams.set("page", String(page));
    const data = await fetchJson<TotalsPage>(u);
    const results = data.results ?? [];
    for (const t of results) {
      if (pacCount >= topPacs) break;
      if (!t.committee_id) continue;
      pacCount++;
      if (!ctx.markSeen(t.committee_id)) continue; // a member's committee can also rank; keep the member row
      ctx.rowsSeen++;
      rows.set(t.committee_id, {
        fec_id: t.committee_id,
        name: t.committee_name ?? t.committee_id,
        committee_type: t.committee_type ?? "PAC",
        party: t.party ?? null,
        kind: "pac",
      });
    }
    if (results.length < 100) break;
  }
  ctx.extra["top_pacs"] = pacCount;

  for (const row of rows.values()) {
    const clean = scrubDeep(row);
    try {
      const res = await sql`
        insert into committees (fec_id, name, committee_type, party)
        values (${clean.fec_id}, ${clean.name}, ${clean.committee_type}, ${clean.party})
        on conflict (fec_id) do update
          set name = excluded.name,
              committee_type = coalesce(excluded.committee_type, committees.committee_type),
              party = coalesce(excluded.party, committees.party)
      `;
      ctx.rowsChanged += res.count ?? 0;
    } catch (err) {
      ctx.quarantine(clean.fec_id, err instanceof Error ? err.message : String(err));
    }
  }

  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "success", stats: ctx.stats() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestFecCommittees()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
