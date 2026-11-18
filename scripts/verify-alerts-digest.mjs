#!/usr/bin/env node
// End-to-end check of the digest builder (ingest/src/jobs/alerts_digest.ts, email alerts
// stage 2) against a LOCAL database with the migrations and scripts/seed-local.sql applied.
// It runs the real job through the real runner (`tsx ingest/src/index.ts alerts_digest`) with
// the clock set by ALERTS_NOW, and reads what the job left in alert_outbox, alert_prefs and
// ingest_runs. Expected item counts are recounted here with separate SQL.
//
//   node scripts/verify-alerts-digest.mjs postgres://postgres@127.0.0.1:5433/stm
//
// It makes five made-up accounts, moves the load time of a few seeded filings, adds two rows
// to one seeded Form 4 and turns the database switch on for part of the run; everything is put
// back at the end, also after a failure. Never point it at production.

import postgres from "postgres";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.argv[2] ?? process.env.ACCOUNTS_TEST_DATABASE_URL;
if (!url) { console.error("usage: node scripts/verify-alerts-digest.mjs <database-url>"); process.exit(2); }
if (/supabase\.(co|com)/.test(url)) { console.error("refusing to run against a Supabase host"); process.exit(2); }
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = postgres(url, { max: 1, onnotice: () => {} });

const A = "user_test_digestA0000000001", B = "user_test_digestB0000000002", C = "user_test_digestC0000000003",
  D = "user_test_digestD0000000004", E = "user_test_digestE0000000005";
const ALL = [A, B, C, D, E];
const MEMBER = "samuel-okafor", INSIDER = "karp-alexander-c", TICKER = "nvda";
let failed = 0, ran = 0;
const ok = (cond, label) => { ran++; if (!cond) { failed++; console.log("  ✗", label); } };
const iso = (d) => new Date(d).toISOString();
const HOUR = 3_600_000, DAY = 24 * HOUR;

function job(now, env = {}) {
  const r = spawnSync("npx", ["tsx", "ingest/src/index.ts", "alerts_digest"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, DATABASE_URL: url, ALERTS_NOW: iso(now), ALERTS_DRY_RUN: "", ALERTS_DRY_RUN_OUT: "", ...env },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const lastRun = async () => (await sql`
  select r.status::text as status, r.stats, r.rows_changed from ingest_runs r join sources s on s.id = r.source_id
   where s.code = 'alerts_digest' order by r.id desc limit 1`)[0];
const pref = async (id) => (await sql`select * from alert_prefs where account_id = ${id}`)[0];
const outbox = (id) => sql`select * from alert_outbox where account_id = ${id} order by id`;
const setSwitch = (on) => sql`update app_settings set value = to_jsonb(${!!on}::boolean), updated_at = now() where key = 'alerts_enabled'`;

// The oracle: items a period should hold for a set of followed people and tickers. Written
// apart from the job's query: congressional rows one each, a Form 4 one per filing and class.
async function expectItems({ people = [], tickers = [] }, start, end) {
  const rows = await sql`
    select distinct t.id, f.id as filing_id, f.source::text as source, t.txn_code, t.side::text as side, coalesce(t.is_derivative, false) as deriv
      from transactions t join filings f on f.id = t.filing_id
      left join people p on p.id = t.person_id left join securities s on s.id = t.security_id
     where f.is_published and (f.payload->>'superseded_by') is null
       and f.created_at > ${start} and f.created_at <= ${end}
       and t.disclosed_at >= (${end}::timestamptz at time zone 'UTC')::date - 30
       and (p.slug::text = any(${people}) or lower(s.ticker::text) = any(${tickers}))`;
  const keys = new Set();
  for (const r of rows) {
    if (r.source !== "sec_form4") { keys.add(`t${r.id}`); continue; }
    const cls = r.deriv ? "other" : r.txn_code === "P" && r.side === "buy" ? "buy" : r.txn_code === "S" && r.side === "sell" ? "sell" : "other";
    keys.add(`f${r.filing_id}-${cls}`);
  }
  return { items: keys.size, txnIds: rows.map((r) => Number(r.id)) };
}

const [was] = await sql`select value from app_settings where key = 'alerts_enabled'`;
const saved = { filings: [], txns: [], added: [] };
const tmp = mkdtempSync(join(tmpdir(), "stm-digest-"));

try {
  await sql`delete from accounts where id = any(${ALL})`;
  // The seed loads every filing at one moment; call it T0 and set the clock from it.
  const [{ t0 }] = await sql`select max(created_at) as t0 from filings`;
  const T0 = new Date(t0).getTime();
  ok(Date.now() - T0 < 20 * DAY, "the seed is recent enough for the 30-day rule (re-seed if this fails)");

  const mf = await sql`select f.id, f.created_at, f.is_published, f.review::text as review, max(t.disclosed_at) as newest
    from filings f join transactions t on t.filing_id = f.id join people p on p.id = t.person_id
    where p.slug = ${MEMBER} and f.is_published group by f.id order by newest desc, f.id`;
  ok(mf.length >= 6, `the seed has at least six published filings by ${MEMBER}`);
  const [, , hidden, old, later, late] = mf;   // the two newest stay as they are
  for (const f of mf) saved.filings.push({ id: f.id, created_at: f.created_at, is_published: f.is_published, review: f.review });

  // a Form 4 sale by the followed insider gets two more lots, so its item covers three rows
  const [sale] = await sql`select t.id, t.filing_id from transactions t join filings f on f.id = t.filing_id join people p on p.id = t.person_id
    where p.slug = ${INSIDER} and f.source = 'sec_form4' and f.is_published and t.txn_code = 'S' and not coalesce(t.is_derivative, false)
    order by t.disclosed_at desc limit 1`;
  ok(!!sale, `the seed has an open-market sale by ${INSIDER}`);
  for (const bump of [1, 2]) {
    const [n] = await sql`
      insert into transactions (filing_id, person_id, security_id, side, txn_date, disclosed_at, shares, price, disclosure_lag_days,
                                confidence, review, txn_code, is_derivative, owner_type, asset_type, is_10b5_1)
      select filing_id, person_id, security_id, side, txn_date, disclosed_at, shares + ${bump}, price + ${bump}, disclosure_lag_days,
             confidence, review, txn_code, is_derivative, owner_type, asset_type, is_10b5_1
        from transactions where id = ${sale.id} returning id`;
    saved.added.push(n.id);
  }

  // accounts: A daily (a member and a ticker), B weekly (an insider), C daily and follows nothing,
  // D off, E daily with no address
  const last0 = new Date(T0 - DAY), lastWeekly = new Date(T0 - 9 * DAY);
  for (const [id, email] of [[A, "a.digest@example.com"], [B, "b.digest@example.com"], [C, "c.digest@example.com"], [D, "d.digest@example.com"], [E, null]]) {
    await sql`insert into accounts (id, email) values (${id}, ${email})`;
  }
  const follow = async (id, items) => {
    const [w] = await sql`insert into watchlists (account_id, name, is_default) values (${id}, 'My watchlist', true) returning id`;
    for (const [kind, key, label] of items) await sql`insert into watchlist_items (watchlist_id, kind, key, label) values (${w.id}, ${kind}, ${key}, ${label})`;
  };
  await follow(A, [["member", MEMBER, "Samuel Okafor"], ["stock", TICKER, "NVDA"]]);
  await follow(B, [["insider", INSIDER, "Karp Alexander C"]]);
  await follow(D, [["member", MEMBER, "Samuel Okafor"]]);
  await follow(E, [["member", MEMBER, "Samuel Okafor"]]);
  for (const [id, digest, last] of [[A, "daily", last0], [B, "weekly", lastWeekly], [C, "daily", last0], [D, "off", last0], [E, "daily", last0]]) {
    await sql`insert into alert_prefs (account_id, digest, opted_in_at, last_digest_at) values (${id}, ${digest}, ${last}, ${last})`;
  }
  const tokA = (await pref(A)).unsub_token, tokB = (await pref(B)).unsub_token;

  // rows that must stay out: an unpublished filing, and a filing disclosed long ago
  // (review 'pending' too: the runner publishes approved filings at the end of every run)
  await sql`update filings set is_published = false, review = 'pending' where id = ${hidden.id}`;
  // (the seed spreads this member's reports over months: bring the four used here inside the 30 days first)
  const moved = await sql`select id, filing_id, disclosed_at::text as d from transactions where filing_id = any(${[hidden.id, old.id, later.id, late.id]})`;
  for (const t of moved) saved.txns.push(t);
  await sql`update transactions set disclosed_at = ${new Date(T0 - 5 * DAY)}::date where filing_id = any(${[hidden.id, later.id, late.id]})`;
  const oldTx = moved.filter((t) => Number(t.filing_id) === Number(old.id));
  await sql`update transactions set disclosed_at = ${new Date(T0 - 60 * DAY)}::date where filing_id = ${old.id}`;
  // two filings are loaded later (steps 5 and 6)
  const now1 = new Date(T0 + 3 * HOUR), end1 = new Date(now1.getTime() - 2 * HOUR);
  const now2 = new Date(now1.getTime() + DAY);
  const now3 = new Date(now2.getTime() + DAY), end3 = new Date(now3.getTime() - 2 * HOUR);
  const now4 = new Date(now3.getTime() + DAY), end4 = new Date(now4.getTime() - 2 * HOUR);
  const now5 = new Date(now4.getTime() + DAY), end5 = new Date(now5.getTime() - 2 * HOUR);
  await sql`update filings set created_at = ${new Date(now2.getTime() + 6 * HOUR)} where id = ${later.id}`;
  await sql`update filings set created_at = ${new Date(now4.getTime() - 30 * 60_000)} where id = ${late.id}`;

  // housekeeping fixtures
  const mk = (status, created, sent) => sql`
    insert into alert_outbox (account_id, kind, period_start, period_end, to_email, subject, body_text, body_html, item_count, status, created_at, sent_at)
    values (${D}, 'digest_daily', ${new Date(created.getTime() - DAY)}, ${created}, 'd.digest@example.com', 'Old', 'Body', '<p>Body</p>', 1, ${status}, ${created}, ${sent})
    returning id`;
  const [stalePending] = await mk("pending", new Date(now1.getTime() - 4 * DAY), null);
  const [freshPending] = await mk("pending", new Date(now1.getTime() - 1 * DAY), null);
  const [oldSent] = await mk("sent", new Date(now1.getTime() - 32 * DAY), new Date(now1.getTime() - 31 * DAY));
  const [newSent] = await mk("sent", new Date(now1.getTime() - 6 * DAY), new Date(now1.getTime() - 5 * DAY));
  const ob = async (id) => (await sql`select * from alert_outbox where id = ${id}`)[0];

  // 1. switch off: a skip, nothing built, housekeeping still done
  await setSwitch(false);
  let r = job(now1), run = await lastRun();
  ok(r.code === 0, "switch off: the job exits 0");
  ok(run.status === "success" && typeof run.stats?.skipped === "string" && run.stats.switch_on === false, "switch off: the run reports a skip");
  ok((await outbox(A)).length === 0 && (await outbox(B)).length === 0, "switch off: no digest is written");
  ok(iso((await pref(A)).last_digest_at) === iso(last0), "switch off: the account's clock does not move");
  ok((await ob(stalePending.id)).status === "cancelled", "a pending row older than 3 days is cancelled");
  ok((await ob(freshPending.id)).status === "pending", "a pending row from yesterday is left alone");
  ok((await ob(oldSent.id)).body_text === "" && (await ob(oldSent.id)).body_html === null && (await ob(oldSent.id)).status === "sent", "a body sent over 30 days ago is blanked, the row kept");
  ok((await ob(newSent.id)).body_text === "Body", "a body sent 5 days ago is kept");

  // 2. dry run with the switch off: builds, writes nothing
  r = job(now1, { ALERTS_DRY_RUN: "1", ALERTS_DRY_RUN_OUT: tmp }); run = await lastRun();
  const expA1 = await expectItems({ people: [MEMBER], tickers: [TICKER] }, last0, end1);
  const expB1 = await expectItems({ people: [INSIDER] }, lastWeekly, end1);
  ok(expA1.items > 3 && expB1.items > 0, "the oracle finds items for both accounts");
  ok(r.code === 0 && run.stats?.dry_run === true && run.stats.digests_written === 2 && run.rows_changed === 0, "dry run: two digests built, none written");
  ok(run.stats.items === expA1.items + expB1.items, `dry run: ${run.stats?.items} items, expected ${expA1.items + expB1.items}`);
  ok((await outbox(A)).length === 0 && iso((await pref(A)).last_digest_at) === iso(last0), "dry run: no outbox row, the clock does not move");
  ok(readdirSync(tmp).filter((f) => f.endsWith(".txt")).length === 2 && readdirSync(tmp).filter((f) => f.endsWith(".html")).length === 2, "dry run: the digests are saved for review when a folder is given");
  ok(readFileSync(join(tmp, `${A}.txt`), "utf8").startsWith("Subject: "), "dry run: the saved text starts with the subject");

  // 3. switch on: the real thing
  await setSwitch(true);
  r = job(now1); run = await lastRun();
  ok(r.code === 0 && run.status === "success", "switch on: the job succeeds");
  const a1 = await outbox(A), b1 = await outbox(B);
  ok(a1.length === 1 && b1.length === 1, "one outbox row each for the daily and the weekly account");
  const a = a1[0], b = b1[0];
  // SHOW=1 prints the two digests (and saves the HTML when SHOW_DIR is set) for a look by eye
  if (process.env.SHOW) console.log(`${a.subject}\n\n${a.body_text}\n=====\n${b.subject}\n\n${b.body_text}\n=====`);
  if (process.env.SHOW_DIR) { writeFileSync(join(process.env.SHOW_DIR, "digest-a.html"), a.body_html); writeFileSync(join(process.env.SHOW_DIR, "digest-b.html"), b.body_html); }
  ok(a.kind === "digest_daily" && b.kind === "digest_weekly", "the kinds are digest_daily and digest_weekly");
  ok(a.status === "pending" && a.sent_at === null && a.provider_message_id === null, "the row is pending: nothing was sent");
  ok(a.to_email === "a.digest@example.com" && b.to_email === "b.digest@example.com", "each digest is addressed to its own account");
  ok(iso(a.period_start) === iso(last0) && iso(a.period_end) === iso(end1), "the period runs from the last digest to the run time less two hours");
  ok(a.item_count === expA1.items, `account A: ${a.item_count} items, expected ${expA1.items}`);
  ok(b.item_count === expB1.items, `account B: ${b.item_count} items, expected ${expB1.items}`);
  ok(a.subject.startsWith(`${a.item_count} new disclosures from the pages you follow, `), "the subject states the count");
  ok(b.subject.includes("week to "), "the weekly subject says so");
  ok(a.body_text.includes(tokA) && !a.body_text.includes(tokB) && b.body_text.includes(tokB) && !b.body_text.includes(tokA), "each body carries its own unsubscribe link only");
  ok(a.body_html.includes(`/alerts/unsubscribe/?token=${tokA}`), "the HTML carries the unsubscribe link");
  ok(a.body_text.includes("Samuel Okafor\n") && a.body_text.includes("NVDA\n"), "account A's digest is grouped by the pages it follows");
  ok(!b.body_text.includes("Okafor"), "account B's digest holds nothing from a page it does not follow");
  const anchors = (body) => [...body.matchAll(/#t(\d+)/g)].map((m) => Number(m[1]));
  ok(anchors(a.body_text).length > 0 && anchors(a.body_text).every((id) => expA1.txnIds.includes(id)), "every linked row is one the oracle expects");
  const hiddenTx = (await sql`select id from transactions where filing_id = ${hidden.id}`).map((t) => Number(t.id));
  ok(!anchors(a.body_text).some((id) => hiddenTx.includes(id)), "an unpublished filing is not in the digest");
  ok(!anchors(a.body_text).some((id) => oldTx.some((t) => Number(t.id) === id)), "a filing disclosed 60 days ago is not in the digest");
  ok(/reported 3 open-market sales of \w+, [\d,]+ shares in all at \$[\d,.]+ to \$[\d,.]+ a share/.test(b.body_text), "a Form 4 sale in three lots is one item with shares and the price range as filed");
  ok((a.body_text.match(/Original filing: /g) ?? []).length > 0, "items link to the original filing");
  ok(iso((await pref(A)).last_digest_at) === iso(end1) && iso((await pref(B)).last_digest_at) === iso(end1), "both clocks move to the end of the period");
  ok((await outbox(C)).length === 0 && iso((await pref(C)).last_digest_at) === iso(end1), "an account that follows nothing gets no row and its clock moves");
  ok((await outbox(D)).filter((x) => x.subject !== "Old").length === 0 && iso((await pref(D)).last_digest_at) === iso(last0), "an account with the digest off is not touched");
  ok((await outbox(E)).length === 0 && iso((await pref(E)).last_digest_at) === iso(last0) && run.stats.no_email === 1, "an account with no address gets nothing and keeps its period");
  ok(run.stats.digests_written === 2 && run.stats.digests_daily === 1 && run.stats.digests_weekly === 1 && run.stats.nothing_new === 1, "the stats count what happened");
  const statText = JSON.stringify(run.stats);
  ok(!statText.includes("@") && !statText.includes("user_test") && !statText.includes(tokA), "the stats hold no address, account id or token");
  ok(!r.out.includes("@example.com") && !r.out.includes(tokA), "the job log holds no address or token");

  // 4. the same run again: nothing more
  r = job(now1); run = await lastRun();
  ok((await outbox(A)).length === 1 && (await outbox(B)).length === 1 && run.stats.digests_written === 0 && run.stats.not_due >= 2, "a second run at the same time writes nothing");

  // 5. next day, nothing new for A (one filing was loaded after the period): no row, clock moves
  r = job(now2); run = await lastRun();
  ok((await outbox(A)).length === 1 && iso((await pref(A)).last_digest_at) === iso(new Date(now2.getTime() - 2 * HOUR)), "a day with nothing new writes no row and moves the clock");
  ok((await outbox(B)).length === 1, "the weekly account gets no second digest a day later");

  // 6. the day after: only the filing loaded since
  r = job(now3); run = await lastRun();
  const a3 = await outbox(A);
  const laterTx = (await sql`select id from transactions where filing_id = ${later.id}`).map((t) => Number(t.id));
  ok(a3.length === 2 && a3[1].item_count === laterTx.length, `the next digest holds only the filing loaded since (${a3[1]?.item_count} items, expected ${laterTx.length})`);
  ok(a3[1] && anchors(a3[1].body_text).sort().join() === [...laterTx].sort().join(), "and links exactly its rows");
  ok(a3[1] && iso(a3[1].period_start) === iso(new Date(now2.getTime() - 2 * HOUR)) && iso(a3[1].period_end) === iso(end3), "its period follows the last one with no gap");

  // 7. a filing loaded 30 minutes before a run waits for the next one
  r = job(now4);
  ok((await outbox(A)).length === 2 && iso((await pref(A)).last_digest_at) === iso(end4), "a filing loaded inside the settling time is not in that run");
  r = job(now5);
  const a5 = await outbox(A);
  const lateTx = (await sql`select id from transactions where filing_id = ${late.id}`).map((t) => Number(t.id));
  ok(a5.length === 3 && anchors(a5[2].body_text).sort().join() === [...lateTx].sort().join() && iso(a5[2].period_end) === iso(end5), "it is in the next run");

  // 8. unsubscribing cancels what has not been sent (0025), and the job then leaves the account alone
  const res = (await sql`select alert_unsubscribe(${tokA}) as r`)[0].r;
  ok(res?.ok === true && (await outbox(A)).every((x) => x.status === "cancelled"), "the unsubscribe link cancels the account's pending digests");
  r = job(new Date(now5.getTime() + DAY)); run = await lastRun();
  ok((await outbox(A)).length === 3 && run.stats.accounts_opted_in === 3, "after unsubscribing no further digest is built for the account");

  // 9. the weekly catch-up rule leaves a 2-day-old weekly alone unless it is Monday
  const wNow = new Date(Date.UTC(2031, 0, 8, 19)); // a Wednesday far from the seed
  await sql`update alert_prefs set last_digest_at = ${new Date(wNow.getTime() - 2 * DAY)} where account_id = ${B}`;
  r = job(wNow); run = await lastRun();
  ok((await outbox(B)).length === 1 && run.stats.not_due >= 1, "a weekly digest is not built on a Wednesday two days after the last");
} catch (err) {
  failed++;
  console.log("  ✗ the check itself failed:", err?.message ?? err);
} finally {
  await sql`delete from accounts where id = any(${ALL})`;
  for (const f of saved.filings) await sql`update filings set created_at = ${f.created_at}, is_published = ${f.is_published}, review = ${f.review}::review_status where id = ${f.id}`;
  for (const t of saved.txns) await sql`update transactions set disclosed_at = ${t.d}::date where id = ${t.id}`;
  if (saved.added.length) await sql`delete from transactions where id = any(${saved.added})`;
  if (was) await sql`update app_settings set value = to_jsonb(${was.value === true}::boolean), updated_at = now() where key = 'alerts_enabled'`;
  rmSync(tmp, { recursive: true, force: true });
  await sql.end();
}

console.log(failed ? `✗ verify-alerts-digest: ${failed} of ${ran} checks failed` : `✓ verify-alerts-digest: ${ran} checks passed`);
process.exit(failed ? 1 : 0);
