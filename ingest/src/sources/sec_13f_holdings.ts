// Source: SEC "Form 13F Data Sets" (quarterly ZIPs of tab-separated tables) — what institutional
// managers report holding, KEPT ONLY for the companies this site tracks. Stored in inst_holdings
// (migration 0038); no page, file or feed reads it yet.
//
// INPUT: env INST_13F_DIR, a folder holding one unzipped folder per data set (for example
// `2026q1_form13f` or `01mar2026-31may2026_form13f`), or the table files themselves. No network
// here: the form13f-bulk workflow downloads and unzips. SUBMISSION, COVERPAGE and INFOTABLE are
// found by name (case-insensitive, extension optional) and columns by header name, never by
// position. A missing required column fails the run with a message naming it.
//
// WHAT IS KEPT: INFOTABLE lines whose CUSIP is in a map built at run start from
// schedule13_filings.issuer_cusip of tracked companies (CUSIP -> issuer CIK). A 9-character
// match is used first; an 8-character match (the issue without its check digit) is the fallback
// and is counted. A CUSIP two companies claim is dropped and counted. Lines that cannot be
// mapped are not stored (the 13F file holds millions of lines; the rest of the market is out of
// scope on purpose).
//
// THE 13F RULES (see lib/inst13f.ts): only 13F-HR and 13F-HR/A; per manager and report period the
// newest original or RESTATEMENT amendment wins as a whole; a NEW HOLDINGS amendment adds to it;
// lines with the same CUSIP and PUTCALL are summed; VALUE is thousands of dollars before
// 2023-01-03 and dollars after (stored in dollars); only the newest INST_KEEP_PERIODS periods
// are kept. A data set already recorded in inst_holdings_loaded is skipped unless INST_RELOAD=1.
//
// SAFETY: a data set is read completely first and written in ONE transaction, so a set that
// fails its shape check writes nothing. INST_MAX_MINUTES (default 40) ends the run as "partial"
// between sets (at least one set is always processed); a later run resumes with the unloaded sets.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRunContext } from "../lib/run.js";
import { getDb, closeDb } from "../lib/db.js";
import type { IngestRunResult } from "@stm/shared";
import { findTableFile, headerIndex, padCik, parseBulkDate, parseFlag, splitLine, toNum } from "./sec_form4_bulk.js";
import {
  OPTIONAL, REQUIRED, buildCusipMap, decide, keepCutoff, lookupCusip, normCusip, normPutCall, planFilings, valueToDollars,
  type Existing, type Plan, type Sub, type TableName,
} from "../lib/inst13f.js";

const SOURCE = "sec_13f_holdings";
const CHUNK = 5000;

type Sql = ReturnType<typeof getDb>;

export class ShapeError extends Error {}

// ── Reading ─────────────────────────────────────────────────────────────────

async function streamTable(
  dir: string,
  table: TableName,
  missing: Set<string>,
  each: (row: string[], idx: Record<string, number>) => void,
): Promise<number> {
  const file = findTableFile(dir, table);
  if (!file) throw new ShapeError(`${dir}: table file ${table} not found (looked for ${table}[.tsv|.txt], case-insensitive)`);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let idx: Record<string, number> | null = null;
  let n = 0;
  for await (const line of rl) {
    if (line.length === 0) continue;
    if (!idx) {
      try {
        const h = headerIndex(line, REQUIRED[table], OPTIONAL[table], table);
        idx = h.idx;
        h.missingOptional.forEach((m) => missing.add(m));
      } catch (e) {
        throw new ShapeError(e instanceof Error ? e.message : String(e));
      }
      continue;
    }
    each(splitLine(line), idx);
    n++;
  }
  if (!idx) throw new ShapeError(`${dir}: table ${table} is empty (no header line)`);
  return n;
}

const cell = (row: string[], idx: Record<string, number>, col: string): string => {
  const i = idx[col];
  return i === undefined ? "" : (row[i] ?? "").trim();
};

/** SUBMISSION joined with COVERPAGE: one Sub per 13F-HR or 13F-HR/A filing. */
export async function readSubs(dir: string, missing: Set<string>): Promise<{ subs: Sub[]; badRows: number; rowsSubmission: number }> {
  const bySub = new Map<string, Sub>();
  let badRows = 0;
  const rowsSubmission = await streamTable(dir, "SUBMISSION", missing, (row, idx) => {
    const type = cell(row, idx, "SUBMISSIONTYPE").toUpperCase();
    if (type !== "13F-HR" && type !== "13F-HR/A") return;
    const accession = cell(row, idx, "ACCESSION_NUMBER");
    const filed = parseBulkDate(cell(row, idx, "FILING_DATE"));
    const period = parseBulkDate(cell(row, idx, "PERIODOFREPORT"));
    const cik = padCik(cell(row, idx, "CIK"));
    if (!accession || !filed || !period || !cik) { badRows++; return; }
    bySub.set(accession, { accession, filed, type, managerCik: cik, period, isAmendment: type.endsWith("/A"), amendType: "", managerName: "" });
  });
  await streamTable(dir, "COVERPAGE", missing, (row, idx) => {
    const s = bySub.get(cell(row, idx, "ACCESSION_NUMBER"));
    if (!s) return;
    if (parseFlag(cell(row, idx, "ISAMENDMENT"))) s.isAmendment = true;
    s.amendType = cell(row, idx, "AMENDMENTTYPE");
    s.managerName = cell(row, idx, "FILINGMANAGER_NAME");
  });
  return { subs: [...bySub.values()], badRows, rowsSubmission };
}

export function setDirs(root: string): string[] {
  if (findTableFile(root, "SUBMISSION")) return [root];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .filter((d) => findTableFile(d, "SUBMISSION") !== null)
    .sort();
}

// ── One data set ────────────────────────────────────────────────────────────

interface Holding {
  period: string; manager: string; issuer: string; cusip: string; title: string; pc: string; atype: string;
  shares: number; value: number; rows: number; accession: string; filed: string;
}

interface SetCounts {
  infotableRows: number; matchedAccession: number; keptCusip: number; fallback: number;
  nonFinite: number; mixedTypes: number; written: number; managers: number;
  plansReplace: number; plansAdd: number; skippedOlder: number; skippedNoBase: number; skippedLoaded: number; skippedOldPeriod: number;
}

const newSetCounts = (): SetCounts => ({
  infotableRows: 0, matchedAccession: 0, keptCusip: 0, fallback: 0, nonFinite: 0, mixedTypes: 0, written: 0, managers: 0,
  plansReplace: 0, plansAdd: 0, skippedOlder: 0, skippedNoBase: 0, skippedLoaded: 0, skippedOldPeriod: 0,
});

interface SetInput {
  name: string; dir: string; subs: Sub[];
}

async function existingFor(sql: Sql, periods: string[]): Promise<Map<string, Existing>> {
  const out = new Map<string, Existing>();
  if (periods.length === 0) return out;
  const rows = await sql`
    select manager_cik, period::text as period, max(filed)::text as filed, max(accession) as accession
      from inst_holdings where period = any(${periods}::date[]) group by manager_cik, period`;
  for (const r of rows) out.set(`${r.manager_cik}|${r.period}`, { filed: String(r.filed), accession: String(r.accession) });
  return out;
}

async function processSet(
  sql: Sql, set: SetInput, map: ReturnType<typeof buildCusipMap>, cutoff: string | null, missing: Set<string>,
): Promise<SetCounts & { planned: ReturnType<typeof planFilings>; rowsKept: number }> {
  const c = newSetCounts();
  const planned = planFilings(set.subs);
  const plans: Plan[] = [];
  for (const p of planned.plans) {
    if (cutoff && p.period < cutoff) { c.skippedOldPeriod++; continue; }
    plans.push(p);
  }
  const periods = [...new Set(plans.map((p) => p.period))];
  const existing = await existingFor(sql, periods);

  // accession -> the plan it feeds
  const feeds = new Map<string, { plan: Plan; sub: Sub }>();
  const replaceKeys: Plan[] = [];
  const addKeys = new Set<string>();
  for (const p of plans) {
    const ex = existing.get(p.key);
    const { decision, adds } = decide(p, ex, new Set(ex ? [ex.accession] : []));
    if (decision === "replace") {
      c.plansReplace++;
      replaceKeys.push(p);
      if (p.base) feeds.set(p.base.accession, { plan: p, sub: p.base });
      for (const a of adds) feeds.set(a.accession, { plan: p, sub: a });
    } else if (decision === "add") {
      c.plansAdd++;
      addKeys.add(p.key);
      for (const a of adds) feeds.set(a.accession, { plan: p, sub: a });
    } else if (decision === "skip_older") c.skippedOlder++;
    else if (decision === "skip_no_base") c.skippedNoBase++;
    else c.skippedLoaded++;
  }

  const allAcc = new Set(set.subs.map((s) => s.accession));
  const acc = new Map<string, Holding>();
  const seenAccessionInSet = { n: 0 };
  c.infotableRows = await streamTable(set.dir, "INFOTABLE", missing, (row, idx) => {
    const a = cell(row, idx, "ACCESSION_NUMBER");
    if (allAcc.has(a)) seenAccessionInSet.n++;
    const feed = feeds.get(a);
    if (!feed) return;
    c.matchedAccession++;
    const hit = lookupCusip(map, cell(row, idx, "CUSIP"));
    if (!hit) return;
    const rawValue = toNum(cell(row, idx, "VALUE"));
    const rawShares = toNum(cell(row, idx, "SSHPRNAMT"));
    if (rawValue == null || rawShares == null) { c.nonFinite++; return; }
    c.keptCusip++;
    if (hit.fallback) c.fallback++;
    const pc = normPutCall(cell(row, idx, "PUTCALL"));
    const cusip = normCusip(cell(row, idx, "CUSIP"));
    const key = `${feed.plan.period}|${feed.plan.managerCik}|${cusip}|${pc}`;
    const value = valueToDollars(rawValue, feed.sub.filed);
    const atype = cell(row, idx, "SSHPRNAMTTYPE").toUpperCase();
    const cur = acc.get(key);
    if (!cur) {
      acc.set(key, {
        period: feed.plan.period, manager: feed.plan.managerCik, issuer: hit.cik, cusip, title: cell(row, idx, "TITLEOFCLASS"),
        pc, atype, shares: rawShares, value, rows: 1, accession: feed.sub.accession, filed: feed.sub.filed,
      });
    } else {
      if (cur.atype !== atype) c.mixedTypes++;
      cur.shares += rawShares;
      cur.value += value;
      cur.rows++;
      if (feed.sub.filed > cur.filed || (feed.sub.filed === cur.filed && feed.sub.accession > cur.accession)) {
        cur.filed = feed.sub.filed; cur.accession = feed.sub.accession;
      }
    }
  });
  if (c.infotableRows === 0) throw new ShapeError(`${set.dir}: INFOTABLE has a header but no rows`);
  if (seenAccessionInSet.n === 0) throw new ShapeError(`${set.dir}: no INFOTABLE row belongs to a 13F-HR filing in SUBMISSION (accession numbers do not line up)`);

  const holdings = [...acc.values()];
  const managers = new Map<string, string>();
  for (const p of plans) if (feeds.size > 0 && p.managerName) managers.set(p.managerCik, p.managerName);

  await sql.begin(async (tx) => {
    for (const p of replaceKeys) {
      await tx`delete from inst_holdings where period = ${p.period}::date and manager_cik = ${p.managerCik}`;
    }
    for (let i = 0; i < holdings.length; i += CHUNK) {
      const h = holdings.slice(i, i + CHUNK);
      await tx`
        insert into inst_holdings (period, manager_cik, issuer_cik, cusip, class_title, put_call, amount_type, shares, value, accession, filed, rows)
        select x.period::date, x.manager, x.issuer, x.cusip, x.title, x.pc, x.atype, x.shares::numeric, x.value::numeric, x.acc, x.filed::date, x.rows::integer
          from unnest(${h.map((r) => r.period)}::text[], ${h.map((r) => r.manager)}::text[], ${h.map((r) => r.issuer)}::text[],
                      ${h.map((r) => r.cusip)}::text[], ${h.map((r) => r.title)}::text[], ${h.map((r) => r.pc)}::text[],
                      ${h.map((r) => r.atype)}::text[], ${h.map((r) => String(r.shares))}::text[], ${h.map((r) => String(r.value))}::text[],
                      ${h.map((r) => r.accession)}::text[], ${h.map((r) => r.filed)}::text[], ${h.map((r) => String(r.rows))}::text[])
               as x(period, manager, issuer, cusip, title, pc, atype, shares, value, acc, filed, rows)
        on conflict (period, manager_cik, cusip, put_call) do update
           set shares = inst_holdings.shares + excluded.shares,
               value = inst_holdings.value + excluded.value,
               rows = inst_holdings.rows + excluded.rows,
               accession = greatest(inst_holdings.accession, excluded.accession),
               filed = greatest(inst_holdings.filed, excluded.filed)`;
    }
    const mk = [...managers.keys()];
    for (let i = 0; i < mk.length; i += CHUNK) {
      const m = mk.slice(i, i + CHUNK);
      await tx`
        insert into inst_managers (cik, name)
        select * from unnest(${m}::text[], ${m.map((k) => managers.get(k)!)}::text[])
        on conflict (cik) do update set name = excluded.name, updated_at = now()`;
    }
    await tx`
      insert into inst_holdings_loaded (set_name, submissions, rows_read, rows_kept, periods)
      values (${set.name}, ${set.subs.length}, ${c.infotableRows}, ${holdings.length}, ${periods.sort().join(",")})
      on conflict (set_name) do update
         set loaded_at = now(), submissions = excluded.submissions, rows_read = excluded.rows_read,
             rows_kept = excluded.rows_kept, periods = excluded.periods`;
  });
  c.written = holdings.length;
  c.managers = managers.size;
  return { ...c, planned, rowsKept: holdings.length };
}

// ── Job ─────────────────────────────────────────────────────────────────────

export async function ingestSec13fHoldings(): Promise<IngestRunResult> {
  const root = process.env.INST_13F_DIR;
  const ctx = createRunContext(SOURCE, 50);
  if (!root) {
    ctx.warn("INST_13F_DIR is not set — nothing to load");
    ctx.extra["skipped"] = 1;
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }
  const fail = (error: string): IngestRunResult => ({ source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: "failed", error, stats: ctx.stats() });
  if (!fs.existsSync(root)) return fail(`INST_13F_DIR does not exist: ${root}`);
  const dirs = setDirs(root);
  if (dirs.length === 0) return fail(`no 13F data set (a folder with a SUBMISSION table) found under ${root}`);

  const sql = getDb();
  const startedAt = Date.now();
  const minutes = Number(process.env.INST_MAX_MINUTES ?? 40);
  const budgetMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null;
  const overBudget = () => budgetMs != null && Date.now() - startedAt > budgetMs;
  const keepN = Math.max(1, Math.floor(Number(process.env.INST_KEEP_PERIODS ?? 2)) || 2);
  const reload = process.env.INST_RELOAD === "1";

  const map = buildCusipMap(await sql`
    select distinct s.issuer_cusip as cusip, s.issuer_cik as cik
      from schedule13_filings s join companies c on c.cik = s.issuer_cik
     where c.tracked and coalesce(s.issuer_cusip, '') <> ''`.then((r) => r.map((x) => ({ cusip: x.cusip as string, cik: x.cik as string }))));
  ctx.extra["cusip_map_size"] = map.full.size;
  ctx.extra["ambiguous_cusips"] = map.ambiguous;
  if (map.full.size === 0) {
    ctx.warn("no CUSIPs for tracked companies in schedule13_filings — nothing to match");
    ctx.extra["skipped"] = 1;
    return { source: SOURCE, rowsSeen: 0, rowsChanged: 0, status: "success", stats: ctx.stats() };
  }

  const loaded = new Set((await sql`select set_name from inst_holdings_loaded`).map((r) => String(r.set_name)));
  const missing = new Set<string>();
  const sets: SetInput[] = [];
  let skippedLoaded = 0;
  try {
    for (const dir of dirs) {
      const name = path.basename(dir);
      if (loaded.has(name) && !reload) { skippedLoaded++; continue; }
      const { subs, rowsSubmission } = await readSubs(dir, missing);
      if (rowsSubmission === 0 || subs.length === 0) throw new ShapeError(`${dir}: SUBMISSION holds no readable 13F-HR or 13F-HR/A row`);
      sets.push({ name, dir, subs });
    }
  } catch (e) {
    ctx.extra["failed_shape"] = 1;
    return fail(e instanceof Error ? e.message : String(e));
  }
  // Oldest filings first, so a restatement or addition in a later set meets its base in an earlier one.
  const minFiled = (s: SetInput) => s.subs.reduce((m, x) => (x.filed < m ? x.filed : m), "9999-12-31");
  sets.sort((a, b) => (minFiled(a) === minFiled(b) ? a.name.localeCompare(b.name) : minFiled(a).localeCompare(minFiled(b))));

  const periodRows = await sql`select distinct period::text as period from inst_holdings`;
  const allPeriods = [...periodRows.map((r) => String(r.period)), ...sets.flatMap((s) => planFilings(s.subs).plans.map((p) => p.period))];
  const cutoff = keepCutoff(allPeriods, keepN);
  ctx.extra["keep_periods"] = keepN;

  const t = { sets: 0, infotable: 0, matched: 0, kept: 0, fallback: 0, nonFinite: 0, mixed: 0, written: 0, restated: 0, added: 0, unknown: 0,
    replace: 0, add: 0, older: 0, noBase: 0, loadedPlans: 0, oldPeriod: 0, filings: 0 };
  let stoppedOnBudget = false;
  let error: string | null = null;

  for (const set of sets) {
    if (t.sets > 0 && overBudget()) { stoppedOnBudget = true; break; }
    try {
      const r = await processSet(sql, set, map, cutoff, missing);
      t.sets++;
      t.infotable += r.infotableRows; t.matched += r.matchedAccession; t.kept += r.keptCusip; t.fallback += r.fallback;
      t.nonFinite += r.nonFinite; t.mixed += r.mixedTypes; t.written += r.written;
      t.restated += r.planned.restated; t.added += r.planned.added; t.unknown += r.planned.unknownAmend;
      t.replace += r.plansReplace; t.add += r.plansAdd; t.older += r.skippedOlder; t.noBase += r.skippedNoBase; t.loadedPlans += r.skippedLoaded;
      t.oldPeriod += r.skippedOldPeriod; t.filings += r.planned.plans.length;
      ctx.rowsSeen += r.infotableRows;
      ctx.rowsChanged += r.written;
      console.log(`${SOURCE}: ${set.name}: ${r.infotableRows} lines read, ${r.keptCusip} for tracked companies, ${r.written} holdings written (${r.plansReplace} manager-periods replaced, ${r.plansAdd} added to)`);
    } catch (e) {
      error = `${set.name}: ${e instanceof Error ? e.message : String(e)}`;
      ctx.extra[e instanceof ShapeError ? "failed_shape" : "failed_write"] = 1;
      break;
    }
  }

  // Retention: nothing older than the newest N periods stays.
  let deleted = 0;
  if (!error) {
    const cut = keepCutoff((await sql`select distinct period::text as period from inst_holdings`).map((r) => String(r.period)), keepN);
    if (cut) {
      const d = await sql`delete from inst_holdings where period < ${cut}::date returning 1`;
      deleted = d.length;
    }
  }

  ctx.extra["sets_found"] = dirs.length;
  ctx.extra["sets_skipped_loaded"] = skippedLoaded;
  ctx.extra["sets_loaded"] = t.sets;
  ctx.extra["sets_remaining"] = Math.max(0, sets.length - t.sets);
  ctx.extra["filings_planned"] = t.filings;
  ctx.extra["restatements_applied"] = t.restated;
  ctx.extra["additions_applied"] = t.added;
  ctx.extra["unknown_amendment_types"] = t.unknown;
  ctx.extra["plans_replaced"] = t.replace;
  ctx.extra["plans_added_to"] = t.add;
  ctx.extra["plans_skipped_older"] = t.older;
  ctx.extra["plans_skipped_no_base"] = t.noBase;
  ctx.extra["plans_skipped_already_loaded"] = t.loadedPlans;
  ctx.extra["plans_skipped_old_period"] = t.oldPeriod;
  ctx.extra["infotable_rows_read"] = t.infotable;
  ctx.extra["rows_of_loaded_filings"] = t.matched;
  ctx.extra["rows_for_tracked_cusips"] = t.kept;
  ctx.extra["fallback_matches"] = t.fallback;
  ctx.extra["non_finite_skipped"] = t.nonFinite;
  ctx.extra["mixed_amount_types"] = t.mixed;
  ctx.extra["holdings_written"] = t.written;
  ctx.extra["old_period_rows_deleted"] = deleted;
  ctx.extra["missing_optional_columns"] = missing.size;
  ctx.extra["stopped_on_budget"] = stoppedOnBudget ? 1 : 0;
  ctx.extra["minutes"] = Math.round((Date.now() - startedAt) / 6000) / 10;

  if (error) return fail(error);
  return { source: SOURCE, rowsSeen: ctx.rowsSeen, rowsChanged: ctx.rowsChanged, status: stoppedOnBudget ? "partial" : "success", stats: ctx.stats() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSec13fHoldings()
    .then((r) => console.log(`✓ ${SOURCE}: ${r.rowsSeen} seen, ${r.rowsChanged} written (${r.status})`))
    .catch((e) => { console.error(`✗ ${SOURCE} failed:`, e.message); process.exitCode = 1; })
    .finally(closeDb);
}
