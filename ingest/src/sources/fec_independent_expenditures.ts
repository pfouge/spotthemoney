// Source: OpenFEC Schedule E, independent expenditures (migration 0036, table
// independent_expenditures). Stored only; no page reads it yet.
//
//   GET <base>/schedules/schedule_e/?cycle=<even year>&most_recent=true&is_notice=true&is_notice=false
//       &sort=-expenditure_date&per_page=100[&min_date=<day>][&<cursor keys>]
//
// An independent expenditure is spending a committee reports making on its own, not coordinated
// with a campaign, to support or oppose a candidate. One row is one reported line (`sub_id`); the
// 24/48-hour notice and the later report of the same spending are separate lines and both are
// stored as filed (`is_notice`). Nothing is added together or derived. Names are as filed.
//
// CATCH-UP, then DAILY. The first runs page the whole cycle newest first, using the FEC's cursor
// ("seek") paging: pagination.last_indexes holds `last_index` and `last_<sort field>`, which are
// sent back as request parameters. The cursor is kept in ingest_runs.stats.cursor; a budget stop
// (FEC_IE_MAX_REQUESTS, FEC_IE_MAX_MINUTES) ends the run "partial" and the next run resumes from
// it. When a run pages to the end, stats.catch_up_complete = true and later runs only ask for
// min_date = newest stored spent_at minus 30 days (late reports and amendments land in that
// window). A cursor from another cycle is ignored.
//
// WRITING. Upsert by sub_id in batches; a row that already holds the same values is not touched
// (rows_updated counts real changes only). A date that is not a real date, or is in the future,
// is stored NULL and counted (future_dates_nulled, bad_dates). A member link (person_id) is made
// only through the Bioguide ID: the congress-legislators roster lists each member's FEC candidate
// ids; candidate id -> bioguide -> people.bioguide_id. Never by name. An existing link is not
// cleared by a run that could not read the roster.
//
// SHAPE GUARD. The first page's `results` must be an array; if it has rows, at least one must carry
// sub_id, committee_id and expenditure_amount, otherwise the run ends "failed" and writes nothing.
// FEC_IE_MAX_CONSECUTIVE_FAILURES (5) failed requests in a row end it "failed". A 429 ends it
// "partial" (rate limit reached; the cursor is kept).
//
// No FEC_API_KEY: skipped exactly like fec_schedule_a (stats.skipped), status success.
//
// Env: FEC_API_KEY, FEC_CYCLE, FEC_API_BASE (tests only), CONGRESS_ROSTER_URL, FEC_IE_MAX_REQUESTS (140: it runs after fec_schedule_a in one job and shares its key's 1,000 requests an hour),
// FEC_IE_MAX_MINUTES (12), FEC_IE_MAX_CONSECUTIVE_FAILURES (5), FEC_IE_PER_PAGE (100),
// FEC_IE_MIN_GAP_MS (3700: about 970 requests an hour at most, under the key's 1,000),
// FEC_IE_RETRIES (1).

import { fetchJson } from "../lib/http.js";
import { scrubDeep } from "../lib/sanitize.js";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";
import {
  fecToBioguide, hasIeShape, ieUrl, minusDays, nextCursor, parseIeRow,
  type IePage, type IeRow, type Legislator, type ParseNotes,
} from "../lib/fecie.js";

const SOURCE = "fec_independent_expenditures";
const API = (process.env.FEC_API_BASE ?? "https://api.open.fec.gov/v1").replace(/\/$/, ""); // override: tests only
const ROSTER_URL = process.env.CONGRESS_ROSTER_URL ?? "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const BATCH = 200;

function currentCycle(): number {
  const y = new Date().getUTCFullYear();
  return y % 2 === 0 ? y : y + 1;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

interface PrevState { cycle: number | null; complete: boolean; cursor: Record<string, string> | null }

function readCursor(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && val && /^[a-z_]+$/i.test(k)) out[k] = val;
  }
  return out.last_index ? out : null;
}

export async function ingestFecIndependentExpenditures(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const apiKey = process.env.FEC_API_KEY;
  if (!apiKey) {
    ctx.warn("FEC_API_KEY not set — skipped (no-op). Free key: https://api.data.gov/signup/");
    ctx.extra["skipped"] = "FEC_API_KEY not set";
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }
  const key = apiKey;
  const startedAt = Date.now();
  const cycle = Number(process.env.FEC_CYCLE ?? currentCycle());
  const maxRequests = Math.max(1, Math.floor(envNumber("FEC_IE_MAX_REQUESTS", 140)));
  const budgetMin = envNumber("FEC_IE_MAX_MINUTES", 12);
  const budgetMs = budgetMin > 0 ? budgetMin * 60_000 : null;
  const failLimit = Math.max(1, Math.floor(envNumber("FEC_IE_MAX_CONSECUTIVE_FAILURES", 5)));
  const perPage = Math.min(100, Math.max(1, Math.floor(envNumber("FEC_IE_PER_PAGE", 100))));
  const minGapMs = envNumber("FEC_IE_MIN_GAP_MS", 3700);
  const retries = Math.max(0, Math.floor(envNumber("FEC_IE_RETRIES", 1)));
  const today = new Date().toISOString().slice(0, 10);
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;

  // What an earlier run left: complete, or a cursor to resume from (same cycle only).
  const [prevRow] = await sql<{ stats: Record<string, unknown> | null }[]>`
    select r.stats
      from ingest_runs r join sources s on s.id = r.source_id
     where s.code = ${SOURCE} and r.status in ('success', 'partial') and r.stats is not null
       and r.stats->>'cycle' = ${String(cycle)} and r.stats ? 'catch_up_complete'
     order by r.id desc limit 1`;
  const prev: PrevState = {
    cycle: prevRow?.stats ? Number(prevRow.stats["cycle"]) : null,
    complete: prevRow?.stats?.["catch_up_complete"] === true,
    cursor: readCursor(prevRow?.stats?.["cursor"]),
  };

  let minDate: string | null = null;
  if (prev.complete) {
    const [m] = await sql<{ d: string | null }[]>`select max(spent_at)::text as d from independent_expenditures where spent_at <= ${today}::date`;
    if (m?.d) minDate = minusDays(m.d, 30);
  }
  let cursor: Record<string, string> | null = prev.complete ? null : prev.cursor;
  const mode = prev.complete ? "daily" : cursor ? "resume" : "catch_up";

  const c: Record<string, number> = {
    requests: 0, rows_seen: 0, rows_new: 0, rows_updated: 0, support_rows: 0, oppose_rows: 0,
    notice_rows: 0, candidates: 0, with_person: 0, no_person_match: 0, future_dates_nulled: 0, bad_dates: 0,
    failures: 0, roster_candidates_mapped: 0,
  };
  const notes: ParseNotes = { futureDate: 0, badDate: 0 };
  const candidates = new Set<string>();
  let stoppedOn: string | null = null;
  let complete = false;
  let fatal: string | null = null;
  let lastFailure = "";
  let consecutive = 0;
  let shapeChecked = false;
  let rosterError: string | null = null;

  const sync = () => {
    Object.assign(ctx.extra, c);
    ctx.extra["cycle"] = cycle;
    ctx.extra["mode"] = mode;
    ctx.extra["min_date"] = minDate;
    ctx.extra["catch_up_complete"] = complete || prev.complete;
    ctx.extra["cursor"] = complete || prev.complete ? null : cursor;
    ctx.extra["stopped_on"] = stoppedOn;
    ctx.extra["candidates"] = candidates.size;
    ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
    if (rosterError) ctx.extra["roster_error"] = rosterError;
  };

  // Member link: FEC candidate id -> Bioguide ID (roster) -> people.id.
  let fecBio = new Map<string, string>();
  try {
    const roster = await fetchJson<Legislator[]>(ROSTER_URL, { retries: 1 });
    if (Array.isArray(roster)) fecBio = fecToBioguide(roster);
    else rosterError = "roster is not a list";
  } catch (err) {
    rosterError = err instanceof Error ? err.message : String(err);
    ctx.warn(`congress roster not read (${rosterError}); person links skipped this run`);
  }
  c.roster_candidates_mapped = fecBio.size;
  const bioId = new Map<string, number>();
  for (const p of await sql<{ id: string; bioguide_id: string }[]>`select id::text as id, bioguide_id from people where bioguide_id is not null`) {
    bioId.set(p.bioguide_id, Number(p.id));
  }

  const personFor = (cand: string | null): number | null => {
    if (!cand) return null;
    const bio = fecBio.get(cand.toUpperCase());
    return bio ? bioId.get(bio) ?? null : null;
  };

  const write = async (rows: IeRow[]): Promise<void> => {
    const items = rows.map((r) => {
      const clean = scrubDeep(r);
      return { ...clean, person_id: personFor(clean.candidate_fec_id) };
    });
    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      try {
        const res = (await sql`
          insert into independent_expenditures ${sql(chunk,
            "sub_id", "committee_fec_id", "committee_name", "candidate_fec_id", "candidate_name", "candidate_office",
            "candidate_state", "candidate_district", "candidate_party", "person_id", "support_oppose", "amount",
            "spent_at", "disseminated_at", "description", "payee_name", "is_notice", "source_url")}
          on conflict (sub_id) do update set
            committee_fec_id = excluded.committee_fec_id, committee_name = excluded.committee_name,
            candidate_fec_id = excluded.candidate_fec_id, candidate_name = excluded.candidate_name,
            candidate_office = excluded.candidate_office, candidate_state = excluded.candidate_state,
            candidate_district = excluded.candidate_district, candidate_party = excluded.candidate_party,
            person_id = coalesce(excluded.person_id, independent_expenditures.person_id),
            support_oppose = excluded.support_oppose, amount = excluded.amount, spent_at = excluded.spent_at,
            disseminated_at = excluded.disseminated_at, description = excluded.description,
            payee_name = excluded.payee_name, is_notice = excluded.is_notice, source_url = excluded.source_url
          where (independent_expenditures.committee_fec_id, independent_expenditures.committee_name,
                 independent_expenditures.candidate_fec_id, independent_expenditures.candidate_name,
                 independent_expenditures.candidate_office, independent_expenditures.candidate_state,
                 independent_expenditures.candidate_district, independent_expenditures.candidate_party,
                 independent_expenditures.person_id, independent_expenditures.support_oppose,
                 independent_expenditures.amount, independent_expenditures.spent_at,
                 independent_expenditures.disseminated_at, independent_expenditures.description,
                 independent_expenditures.payee_name, independent_expenditures.is_notice,
                 independent_expenditures.source_url)
            is distinct from
                (excluded.committee_fec_id, excluded.committee_name, excluded.candidate_fec_id, excluded.candidate_name,
                 excluded.candidate_office, excluded.candidate_state, excluded.candidate_district, excluded.candidate_party,
                 coalesce(excluded.person_id, independent_expenditures.person_id), excluded.support_oppose,
                 excluded.amount, excluded.spent_at, excluded.disseminated_at, excluded.description,
                 excluded.payee_name, excluded.is_notice, excluded.source_url)
          returning (xmax = 0) as inserted`) as unknown as { inserted: boolean }[];
        for (const r of res) { if (r.inserted) c.rows_new!++; else c.rows_updated!++; }
        ctx.rowsChanged += res.length;
      } catch (err) {
        for (const r of chunk) ctx.quarantine(r.sub_id, `write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  while (true) {
    if (c.requests! >= maxRequests) { stoppedOn = "requests"; break; }
    if (overBudget()) { stoppedOn = "minutes"; break; }
    const url = ieUrl({ base: API, key, cycle, perPage, minDate, cursor });
    let page: IePage;
    try {
      c.requests!++;
      page = await fetchJson<IePage>(url, { retries, minGapMs, noRetryOn429: true });
      consecutive = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      c.failures!++;
      lastFailure = msg;
      if (/HTTP 429\b/.test(msg)) { stoppedOn = "rate_limit"; break; }
      consecutive++;
      if (consecutive >= failLimit) { fatal = `${consecutive} requests in a row failed; last: ${lastFailure}`; break; }
      continue;
    }

    if (!Array.isArray(page.results)) { fatal = "unexpected answer: `results` is not a list"; break; }
    const results = page.results as unknown[];
    if (!shapeChecked) {
      shapeChecked = true;
      if (results.length > 0 && !results.some(hasIeShape)) {
        fatal = "unexpected layout: no row on the first page has sub_id, committee_id and expenditure_amount; nothing written";
        break;
      }
    }

    const good: IeRow[] = [];
    for (const raw of results) {
      const parsed = parseIeRow(raw, today, notes);
      if (typeof parsed === "string") {
        const id = raw && typeof raw === "object" && "sub_id" in (raw as object) ? String((raw as { sub_id: unknown }).sub_id) : "?";
        ctx.quarantine(id, parsed);
        continue;
      }
      if (!ctx.markSeen(parsed.sub_id)) continue;
      ctx.rowsSeen++;
      c.rows_seen!++;
      if (parsed.support_oppose === "S") c.support_rows!++;
      else if (parsed.support_oppose === "O") c.oppose_rows!++;
      if (parsed.is_notice === true) c.notice_rows!++;
      if (parsed.candidate_fec_id) {
        candidates.add(parsed.candidate_fec_id);
        if (personFor(parsed.candidate_fec_id) != null) c.with_person!++; else c.no_person_match!++;
      }
      good.push(parsed);
    }
    await write(good);
    c.future_dates_nulled = notes.futureDate;
    c.bad_dates = notes.badDate;

    const next = results.length >= perPage ? nextCursor(page) : null;
    if (!next || results.length === 0) { complete = true; cursor = null; break; }
    cursor = next;
  }

  if (fatal) {
    // Nothing from this run is trusted as a resume point: a failed run is never read back.
    sync();
    ctx.extra["error"] = fatal;
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", stats: ctx.stats() };
  }

  const [tot] = await sql<{ n: number; newest: string | null }[]>`select count(*)::int as n, max(spent_at)::text as newest from independent_expenditures`;
  ctx.extra["table_rows"] = tot?.n ?? 0;
  ctx.extra["table_newest_spent_at"] = tot?.newest ?? null;
  sync();
  const status = complete || (prev.complete && stoppedOn == null) ? "success" : "partial";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestFecIndependentExpenditures()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
