// Source: roll-call votes of the House and the Senate, 119th Congress on (from 2025-01-03).
// Keyless, stored only (tables congress_votes and congress_vote_positions, migration 0035); no
// page reads them yet.
//
//   House  <HOUSE_VOTES_BASE>/evs/<year>/roll<NNN>.xml           (NNN padded to 3 digits)
//   Senate <SENATE_VOTES_BASE>/legislative/LIS/roll_call_lists/vote_menu_<congress>_<session>.xml
//          <SENATE_VOTES_BASE>/legislative/LIS/roll_call_votes/vote<congress><session>/vote_<c>_<s>_<NNNNN>.xml
//
// Reading rules are in lib/votes.ts. A vote and its positions are written in ONE transaction
// (upsert of the vote, positions replaced), so a vote is never half stored.
//
// MEMBERS. House positions carry the Bioguide id; Senate positions the LIS id, translated to a
// Bioguide id through congress-legislators (legislators-current + legislators-historical, fetched
// once, lazily, per run). A member is matched to people.bioguide_id; otherwise person_id stays NULL
// and `*_unmatched_members` counts it. A position the table cannot hold (for example "Guilty" in an
// impeachment trial) is skipped and counted `*_positions_unmapped`.
//
// WALK (resumes purely from stored data). House: per calendar year from 2025, the stored rolls'
// gaps (at most VOTES_GAP_MAX per run), then roll max+1 upwards until VOTES_MISS_STOP (3) answers in
// a row are 404. Senate: per (congress, session) the menu file lists the vote numbers; every number
// not stored is fetched. The newest VOTES_RECHECK (3) stored votes of each chamber are fetched again
// (a vote can be corrected). The chambers run side by side (separate hosts, each paced 1.5 s).
//
// STOPPING. VOTES_MAX_MINUTES (40) ends the run "partial". SHAPE GUARD per chamber: an answer
// without the layout (House: rollcall-vote + recorded-vote; Senate: roll_call_vote + member, a
// vote number and a date) is held, never written, and counted odd; VOTES_ODD_STOP (5) in a row
// end that chamber's walk. VOTES_MAX_CONSECUTIVE_FAILURES (5) request failures in a row do the
// same. A chamber that ended that way having stored nothing makes the run "failed".
//
// Env: HOUSE_VOTES_BASE, SENATE_VOTES_BASE (tests only: local fakes), CONGRESS_ROSTER_URL,
// CONGRESS_ROSTER_HISTORICAL_URL, VOTES_MAX_MINUTES, VOTES_RECHECK, VOTES_MISS_STOP, VOTES_ODD_STOP,
// VOTES_GAP_MAX, VOTES_MAX_CONSECUTIVE_FAILURES, VOTES_RETRIES and VOTES_MIN_GAP_MS (tests only).

import { fetchJson, fetchText } from "../lib/http.js";
import { createRunContext } from "../lib/run.js";
import { getDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";
import { outageCounter } from "./sec_form4.js";
import {
  congressSession, hasVoteShape, houseVoteUrl, parseHouseVoteXml, parseSenateMenu, parseSenateVoteXml,
  senateMenuUrl, senateVoteUrl, withCounts, type ParsedVote,
} from "../lib/votes.js";

const SOURCE = "congress_votes";
const HOUSE_BASE = (process.env.HOUSE_VOTES_BASE ?? "https://clerk.house.gov").replace(/\/$/, "");
const SENATE_BASE = (process.env.SENATE_VOTES_BASE ?? "https://www.senate.gov").replace(/\/$/, "");
const ROSTER_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const ROSTER_HIST_URL = "https://unitedstates.github.io/congress-legislators/legislators-historical.json";
const FIRST_YEAR = 2025; // the 119th Congress
const USER_AGENT = "spotthemoney.com ingest (+https://spotthemoney.com/contact/)";
const BATCH = 500;

type Chamber = "house" | "senate";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /HTTP 404\b/.test(err.message);
}

interface Legislator { id?: { bioguide?: string; lis?: string } }

export async function ingestCongressVotes(): Promise<IngestRunResult> {
  const sql = getDb();
  const ctx = createRunContext(SOURCE);
  const startedAt = Date.now();

  const budgetMin = envNumber("VOTES_MAX_MINUTES", 40);
  const budgetMs = budgetMin > 0 ? budgetMin * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const recheckN = Math.max(0, Math.floor(envNumber("VOTES_RECHECK", 3)));
  const missStop = Math.max(1, Math.floor(envNumber("VOTES_MISS_STOP", 3)));
  const oddStop = Math.max(1, Math.floor(envNumber("VOTES_ODD_STOP", 5)));
  const gapMax = Math.max(0, Math.floor(envNumber("VOTES_GAP_MAX", 50)));
  const failStop = Math.max(1, Math.floor(envNumber("VOTES_MAX_CONSECUTIVE_FAILURES", 5)));
  const retriesEnv = process.env.VOTES_RETRIES;
  const gapEnv = process.env.VOTES_MIN_GAP_MS;
  const reqOpts = () => ({
    userAgent: USER_AGENT,
    ...(gapEnv != null && gapEnv !== "" && Number.isFinite(Number(gapEnv)) ? { minGapMs: Number(gapEnv) } : {}),
    ...(retriesEnv != null && retriesEnv !== "" && Number.isFinite(Number(retriesEnv)) ? { retries: Number(retriesEnv) } : {}),
  });

  const nowYear = new Date().getUTCFullYear();

  // Bioguide id -> people.id, once.
  const people = new Map<string, number>();
  for (const p of await sql<{ id: number; bioguide_id: string }[]>`select id, bioguide_id from people where bioguide_id is not null`) {
    people.set(p.bioguide_id, Number(p.id));
  }

  // LIS id -> Bioguide id, lazily, once.
  let lisMap: Map<string, string> | null = null;
  let rosterError = 0;
  const lisToBioguide = async (): Promise<Map<string, string>> => {
    if (lisMap) return lisMap;
    const m = new Map<string, string>();
    for (const url of [process.env.CONGRESS_ROSTER_URL ?? ROSTER_URL, process.env.CONGRESS_ROSTER_HISTORICAL_URL ?? ROSTER_HIST_URL]) {
      try {
        const list = await fetchJson<Legislator[]>(url, { userAgent: USER_AGENT });
        for (const l of Array.isArray(list) ? list : []) {
          if (l.id?.lis && l.id.bioguide) m.set(l.id.lis, l.id.bioguide);
        }
      } catch (err) {
        rosterError++;
        console.log(`${SOURCE}: legislators file not read (${url}): ${err instanceof Error ? err.message : err}`);
      }
    }
    lisMap = m;
    return m;
  };

  interface Counts {
    votes_new: number; votes_rechecked: number; positions_written: number; unmatched_members: number;
    positions_unmapped: number; odd_answers: number; failures: number; not_found: number;
    newest_roll: number; newest_date: number; remaining: number; stopped: number;
  }
  const mk = (): Counts => ({
    votes_new: 0, votes_rechecked: 0, positions_written: 0, unmatched_members: 0, positions_unmapped: 0,
    odd_answers: 0, failures: 0, not_found: 0, newest_roll: 0, newest_date: 0, remaining: 0, stopped: 0,
  });
  const counts: Record<Chamber, Counts> = { house: mk(), senate: mk() };
  const unmatchedKeys: Record<Chamber, Set<string>> = { house: new Set(), senate: new Set() };
  let stoppedOnBudget = false;

  const sync = () => {
    for (const ch of ["house", "senate"] as const) {
      const c = counts[ch];
      for (const [k, v] of Object.entries(c)) ctx.extra[`${ch}_${k}`] = v;
      ctx.extra[`${ch}_unmatched_distinct`] = unmatchedKeys[ch].size;
    }
    ctx.extra["roster_errors"] = rosterError;
    ctx.extra["stopped_on_budget"] = stoppedOnBudget;
    ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;
  };

  type Outcome = "stored" | "notfound" | "odd" | "failed" | "skipped";
  interface ChamberEnd { fatal: string | null; stored: number }

  /** Fetch one vote and store it in one transaction. */
  async function fetchAndStore(
    ch: Chamber, congress: number, session: number, roll: number, url: string,
    existed: boolean, outage: ReturnType<typeof outageCounter>,
  ): Promise<{ outcome: Outcome; error?: string }> {
    const c = counts[ch];
    let parsed: ParsedVote;
    try {
      const xml = await fetchText(url, reqOpts());
      outage.ok();
      parsed = withCounts(ch === "house" ? parseHouseVoteXml(xml) : parseSenateVoteXml(xml));
    } catch (err) {
      if (isNotFound(err)) { outage.ok(); c.not_found++; return { outcome: "notfound" }; }
      outage.fail();
      c.failures++;
      return { outcome: "failed", error: err instanceof Error ? err.message : String(err) };
    }
    if (!hasVoteShape(parsed)) { c.odd_answers++; return { outcome: "odd" }; }

    const lis = ch === "senate" ? await lisToBioguide() : null;
    const seen = new Set<string>();
    const rows: { member_key: string; person_id: number | null; name: string | null; party: string | null; state: string | null; position: string }[] = [];
    for (const p of parsed.positions) {
      if (!p.position) { c.positions_unmapped++; continue; }
      if (seen.has(p.memberKey)) continue;
      seen.add(p.memberKey);
      const bio = ch === "house" ? p.memberKey : lis!.get(p.memberKey) ?? null;
      const pid = bio ? people.get(bio) ?? null : null;
      if (pid == null) { c.unmatched_members++; unmatchedKeys[ch].add(p.memberKey); }
      rows.push({ member_key: p.memberKey, person_id: pid, name: p.name, party: p.party, state: p.state, position: p.position });
    }

    await sql.begin(async (tx) => {
      const [v] = await tx<{ id: string }[]>`
        insert into congress_votes (chamber, congress, session, roll_number, voted_at, vote_time, question, vote_type, result,
                                    bill, description, yeas, nays, present, not_voting, source_url)
        values (${ch}, ${congress}, ${session}, ${roll}, ${parsed.votedAt!}, ${parsed.voteTime}, ${parsed.question}, ${parsed.voteType},
                ${parsed.result}, ${parsed.bill}, ${parsed.description}, ${parsed.yeas}, ${parsed.nays}, ${parsed.present},
                ${parsed.notVoting}, ${url})
        on conflict (chamber, congress, session, roll_number) do update
          set voted_at = excluded.voted_at, vote_time = excluded.vote_time, question = excluded.question,
              vote_type = excluded.vote_type, result = excluded.result, bill = excluded.bill,
              description = excluded.description, yeas = excluded.yeas, nays = excluded.nays,
              present = excluded.present, not_voting = excluded.not_voting, source_url = excluded.source_url
        returning id`;
      const id = v!.id;
      await tx`delete from congress_vote_positions where vote_id = ${id}`;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH).map((r) => ({ vote_id: id, ...r }));
        await tx`insert into congress_vote_positions ${tx(chunk, "vote_id", "member_key", "person_id", "name", "party", "state", "position")}`;
      }
    });
    if (existed) c.votes_rechecked++; else c.votes_new++;
    c.positions_written += rows.length;
    ctx.rowsChanged += rows.length;
    const d = Number(parsed.votedAt!.replace(/-/g, ""));
    if (d > c.newest_date || (d === c.newest_date && roll > c.newest_roll)) { c.newest_date = d; c.newest_roll = roll; }
    return { outcome: "stored" };
  }

  async function storedRolls(ch: Chamber, congress: number, session: number): Promise<Set<number>> {
    const r = await sql<{ roll_number: number }[]>`
      select roll_number from congress_votes where chamber = ${ch} and congress = ${congress} and session = ${session}`;
    return new Set(r.map((x) => Number(x.roll_number)));
  }

  /** The newest stored votes of a chamber, for a second look. */
  async function recheckList(ch: Chamber): Promise<{ congress: number; session: number; roll: number }[]> {
    if (recheckN === 0) return [];
    const r = await sql<{ congress: number; session: number; roll_number: number }[]>`
      select congress, session, roll_number from congress_votes where chamber = ${ch}
       order by voted_at desc, congress desc, session desc, roll_number desc limit ${recheckN}`;
    return r.map((x) => ({ congress: Number(x.congress), session: Number(x.session), roll: Number(x.roll_number) }));
  }

  const runChamber = async (ch: Chamber): Promise<ChamberEnd> => {
    const c = counts[ch];
    const outage = outageCounter(failStop);
    let oddRun = 0;
    let fatal: string | null = null;
    let stored = 0;
    let lastError = "";
    const urlOf = (congress: number, session: number, year: number, roll: number) =>
      ch === "house" ? houseVoteUrl(HOUSE_BASE, year, roll) : senateVoteUrl(SENATE_BASE, congress, session, roll);

    /** One fetch with the shared bookkeeping; returns false when the chamber must stop. */
    const step = async (congress: number, session: number, year: number, roll: number, existed: boolean): Promise<{ go: boolean; outcome: Outcome }> => {
      const key = `${ch}:${congress}:${session}:${roll}:${existed ? "r" : "n"}`;
      if (!ctx.markSeen(key)) return { go: true, outcome: "skipped" };
      ctx.rowsSeen++;
      const res = await fetchAndStore(ch, congress, session, roll, urlOf(congress, session, year, roll), existed, outage);
      if (res.outcome === "stored") { stored++; oddRun = 0; }
      else if (res.outcome === "odd") {
        oddRun++;
        if (oddRun >= oddStop) {
          fatal = `${oddRun} answers in a row did not have the ${ch} vote layout: the data is not in the shape this job expects`;
          return { go: false, outcome: res.outcome };
        }
      } else if (res.outcome === "failed") {
        lastError = res.error ?? "";
        if (outage.tripped) {
          fatal = `${outage.count} ${ch} requests in a row failed (last: ${lastError.slice(0, 160)})`;
          return { go: false, outcome: res.outcome };
        }
      }
      return { go: true, outcome: res.outcome };
    };

    // 1. Second look at the newest stored votes.
    for (const r of await recheckList(ch)) {
      if (overBudget()) { stoppedOnBudget = true; c.stopped = 1; return { fatal, stored }; }
      const year = FIRST_YEAR + (r.congress - 119) * 2 + (r.session - 1);
      const res = await step(r.congress, r.session, year, r.roll, true);
      if (!res.go) return { fatal, stored };
    }

    if (ch === "house") {
      let houseOnFile = false;
      for (let year = FIRST_YEAR; year <= nowYear; year++) {
        const { congress, session } = congressSession(year);
        const have = await storedRolls(ch, congress, session);
        const max = have.size ? Math.max(...have) : 0;
        if (max > 0) houseOnFile = true;
        // 2. Gaps below the highest stored roll.
        let gaps = 0;
        for (let r = 1; r < max && gaps < gapMax; r++) {
          if (have.has(r)) continue;
          gaps++;
          if (overBudget()) { stoppedOnBudget = true; c.stopped = 1; return { fatal, stored }; }
          const res = await step(congress, session, year, r, false);
          if (!res.go) return { fatal, stored };
        }
        // 3. Forward from the highest stored roll until the Clerk has no more.
        let roll = max + 1;
        let miss = 0;
        while (miss < missStop) {
          if (overBudget()) { stoppedOnBudget = true; c.stopped = 1; return { fatal, stored }; }
          const res = await step(congress, session, year, roll, false);
          if (!res.go) return { fatal, stored };
          // Past a year's last roll call the Clerk answers with a web page, not a 404 (seen on the
          // first live run: 2025 ended at roll 362 and five such answers stopped the House before
          // 2026). Once the House layout is proven (a roll stored this run, or on file for this
          // year or an earlier one), an answer without the layout here is the end of the year.
          if (res.outcome === "odd" && (stored > 0 || max > 0 || houseOnFile)) { miss++; oddRun = 0; c.odd_answers--; c.not_found++; }
          else if (res.outcome === "notfound") miss++;
          else if (res.outcome === "stored" || res.outcome === "odd") miss = 0;
          // failed or skipped: move on; a failed roll below the highest stored one is a gap next run
          roll++;
        }
      }
      return { fatal, stored };
    }

    // Senate: the menu lists the numbers; fetch those not stored.
    for (let year = FIRST_YEAR; year <= nowYear; year++) {
      const { congress, session } = congressSession(year);
      let menu: number[];
      try {
        menu = parseSenateMenu(await fetchText(senateMenuUrl(SENATE_BASE, congress, session), reqOpts()));
        outage.ok();
      } catch (err) {
        if (isNotFound(err)) { outage.ok(); continue; } // a session that has not begun
        outage.fail();
        c.failures++;
        lastError = err instanceof Error ? err.message : String(err);
        if (outage.tripped) { fatal = `${outage.count} senate requests in a row failed (last: ${lastError.slice(0, 160)})`; return { fatal, stored }; }
        continue;
      }
      if (menu.length === 0) { c.odd_answers++; continue; }
      const have = await storedRolls(ch, congress, session);
      const todo = menu.filter((n) => !have.has(n));
      for (let i = 0; i < todo.length; i++) {
        if (overBudget()) { stoppedOnBudget = true; c.stopped = 1; c.remaining += todo.length - i; break; }
        const res = await step(congress, session, year, todo[i]!, false);
        if (!res.go) { c.remaining += todo.length - i; return { fatal, stored }; }
      }
      if (stoppedOnBudget) {
        return { fatal, stored };
      }
    }
    return { fatal, stored };
  };

  const [h, s] = await Promise.all([runChamber("house"), runChamber("senate")]);
  sync();

  const [tot] = await sql<{ votes: number; positions: number }[]>`
    select (select count(*) from congress_votes)::int as votes, (select count(*) from congress_vote_positions)::int as positions`;
  ctx.extra["table_votes"] = tot?.votes ?? 0;
  ctx.extra["table_positions"] = tot?.positions ?? 0;
  for (const ch of ["house", "senate"] as const) {
    const c = counts[ch];
    console.log(`${SOURCE} ${ch}: ${c.votes_new} new, ${c.votes_rechecked} rechecked, ${c.positions_written} positions, ${c.unmatched_members} unmatched, ${c.odd_answers} odd, ${c.failures} failed, newest roll ${c.newest_roll}`);
  }

  const failedChambers = ([["house", h], ["senate", s]] as const).filter(([, e]) => e.fatal && e.stored === 0);
  if (failedChambers.length > 0) {
    const error = failedChambers.map(([ch, e]) => `${ch}: ${e.fatal}`).join("; ");
    return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() };
  }
  const anyFatal = h.fatal != null || s.fatal != null;
  const failures = counts.house.failures + counts.senate.failures;
  const status = stoppedOnBudget || anyFatal || failures > 0 ? "partial" : "success";
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status, stats: ctx.stats() };
}
