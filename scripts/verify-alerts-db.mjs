#!/usr/bin/env node
// Checks the email-alert layer (db/migrations/0025_email_alerts_stage1.sql) against a database
// that has it applied. Every call is made the way PostgREST makes it, as role `anon` or
// `authenticated` with the token's claims in request.jwt.claims, so the grants and the
// definer-rights functions are what is being tested, not the superuser's view.
//
//   node scripts/verify-alerts-db.mjs postgres://postgres@127.0.0.1:5433/stm
//
// Uses (and leaves behind nothing of) two made-up WorkOS users, and puts the database switch
// back the way it found it. Never point it at production: it creates and deletes accounts and
// turns the switch on for the length of the run.

import postgres from "postgres";

const url = process.argv[2] ?? process.env.ACCOUNTS_TEST_DATABASE_URL;
if (!url) { console.error("usage: node scripts/verify-alerts-db.mjs <database-url>"); process.exit(2); }
if (/supabase\.(co|com)/.test(url)) { console.error("refusing to run against a Supabase host"); process.exit(2); }
const sql = postgres(url, { max: 1, onnotice: () => {} });

const A = "user_test_alertA00000000001", B = "user_test_alertB00000000002", C = "user_test_alertC00000000003";
let failed = 0, ran = 0;
const ok = (cond, label) => { ran++; if (!cond) { failed++; console.log("  ✗", label); } };

async function as(sub, text, params = []) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${sub ? "authenticated" : "anon"}`);
    await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role: "authenticated" } : { role: "anon" })]);
    return tx.unsafe(text, params);
  });
}
const rpc = async (sub, fn, args = {}) => {
  const keys = Object.keys(args);
  const call = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  return (await as(sub, call, keys.map((k) => args[k])))[0].r;
};
const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };
const message = async (fn) => { try { await fn(); return ""; } catch (e) { return String(e.message ?? e); } };
const pref = async (id) => (await sql`select * from alert_prefs where account_id = ${id}`)[0];
const outbox = async (id) => sql`select id, status from alert_outbox where account_id = ${id} order by id`;
const queue = (id, end) => sql`insert into alert_outbox (account_id, kind, period_start, period_end, to_email, subject, body_text, item_count)
  values (${id}, 'digest_daily', ${end}::timestamptz - interval '1 day', ${end}, 'x@example.com', 'Test digest', 'One trade.', 1)`;

const [was] = await sql`select value from app_settings where key = 'alerts_enabled'`;
const setSwitch = (on) => sql`update app_settings set value = to_jsonb(${!!on}::boolean), updated_at = now() where key = 'alerts_enabled'`;
await sql`delete from accounts where id in (${A}, ${B}, ${C})`;

try {
  // 0. as shipped: the switch exists and is off
  ok(was && was.value === false, "the database switch exists and is off as migrated");
  await setSwitch(false);

  // 1. nobody reaches the tables directly
  for (const t of ["app_settings", "alert_prefs", "alert_outbox"]) {
    ok(await fails(() => as(null, `select * from ${t}`)), `anon cannot read ${t}`);
    ok(await fails(() => as(A, `select * from ${t}`)), `a signed-in visitor cannot read ${t}`);
  }
  ok(await fails(() => as(A, "insert into alert_prefs (account_id, digest) values ($1, 'daily')", [A])), "a signed-in visitor cannot insert a setting directly");
  ok(await fails(() => as(A, "update app_settings set value = 'true'::jsonb")), "a signed-in visitor cannot flip the switch");
  ok(await fails(() => as(A, "select alerts_enabled()")), "alerts_enabled() is not callable through the API");
  ok(await fails(() => rpc(null, "alert_state")), "anon cannot call alert_state");
  ok(await fails(() => rpc(null, "alert_save", { p_digest: "daily" })), "anon cannot call alert_save");
  const privs = await sql`select grantee, table_name from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('alert_prefs', 'alert_outbox') and grantee in ('anon', 'authenticated', 'site_build', 'PUBLIC')`;
  ok(privs.length === 0, "no grant on the private tables to anon, authenticated, site_build or PUBLIC");
  const rls = await sql`select relname, relrowsecurity from pg_class where relname in ('app_settings', 'alert_prefs', 'alert_outbox') and relnamespace = 'public'::regnamespace`;
  ok(rls.length === 3 && rls.every((r) => r.relrowsecurity), "row-level security is on for all three tables");
  const pol = await sql`select count(*)::int as n from pg_policies where schemaname = 'public' and tablename in ('app_settings', 'alert_prefs', 'alert_outbox')`;
  ok(pol[0].n === 0, "none of the three tables has a policy");
  const fn = await sql`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('alerts_enabled', 'alert_state', 'alert_save', 'alert_unsubscribe')`;
  ok(fn.length === 4 && fn.every((f) => f.prosecdef && f.cfg.includes("search_path=public, pg_temp")), "the four functions run with definer rights and a fixed search_path");

  // 2. switched off: no way in, state readable, turning off is harmless
  await rpc(A, "account_touch", { p_email: "a@example.com" });
  await rpc(B, "account_touch", { p_email: "b@example.com" });
  let s = await rpc(A, "alert_state");
  ok(s.available === false && s.digest === "off" && s.email === "a@example.com" && s.opted_in_at === null, "state with the switch off: not available, digest off");
  ok(/not available yet/.test(await message(() => rpc(A, "alert_save", { p_digest: "daily" }))), "with the switch off nobody can turn a digest on");
  ok((await pref(A)) === undefined, "a refused sign-up leaves no row");
  s = await rpc(A, "alert_save", { p_digest: "off" });
  ok(s.digest === "off" && (await pref(A)) === undefined, "turning off with nothing on works and stores nothing");

  // 3. switched on: choose, change, bad values
  await setSwitch(true);
  ok((await rpc(A, "alert_state")).available === true, "state reports the switch");
  ok(await fails(() => rpc(A, "alert_save", { p_digest: "hourly" })), "an unknown frequency is refused");
  ok(await fails(() => rpc(A, "alert_save", { p_digest: null })), "an empty frequency is refused");
  const before = Date.now();
  s = await rpc(A, "alert_save", { p_digest: " Daily " });
  let p = await pref(A);
  ok(s.digest === "daily" && p.digest === "daily" && p.opted_in_at && p.unsubscribed_at === null, "choose a daily digest");
  ok(/^[0-9a-f]{64}$/.test(p.unsub_token), "the setting gets a 64-character unsubscribe token");
  ok(Math.abs(new Date(p.last_digest_at).getTime() - before) < 60_000, "the clock starts when the digest is turned on");
  ok(!JSON.stringify(s).includes(p.unsub_token), "the state never carries the token");
  const optedIn = p.opted_in_at.getTime(), tokenA = p.unsub_token;
  await sql`update alert_prefs set last_digest_at = '2026-01-01' where account_id = ${A}`;
  s = await rpc(A, "alert_save", { p_digest: "weekly" });
  p = await pref(A);
  ok(p.digest === "weekly" && p.opted_in_at.getTime() === optedIn && p.unsub_token === tokenA, "changing daily to weekly keeps the opt-in time and the token");
  ok(new Date(p.last_digest_at).toISOString().startsWith("2026-01-01"), "changing the frequency does not move the clock");
  await sql`insert into accounts (id, email) values (${C}, null)`;
  ok(/no email address/.test(await message(() => rpc(C, "alert_save", { p_digest: "daily" }))), "an account with no address cannot turn a digest on");

  // 4. one visitor never touches another's setting
  s = await rpc(B, "alert_state");
  ok(s.digest === "off" && s.email === "b@example.com", "B's state is B's own");
  await rpc(B, "alert_save", { p_digest: "off" });
  ok((await pref(A)).digest === "weekly", "B turning off does not touch A");
  await rpc(B, "alert_save", { p_digest: "daily" });
  const tokenB = (await pref(B)).unsub_token;
  ok(tokenB !== tokenA, "each account has its own token");

  // 5. turning off by the account: pending mail cancelled, sent mail untouched, row kept
  await queue(A, "2026-11-02T00:00:00Z"); await queue(A, "2026-11-03T00:00:00Z"); await queue(B, "2026-11-03T00:00:00Z");
  await sql`update alert_outbox set status = 'sent', sent_at = now() where account_id = ${A} and period_end = '2026-11-02T00:00:00Z'`;
  s = await rpc(A, "alert_save", { p_digest: "off" });
  p = await pref(A);
  ok(s.digest === "off" && p.digest === "off" && p.unsubscribed_at && p.unsub_token === tokenA, "turning off keeps the row and records when");
  let ob = await outbox(A);
  ok(ob.length === 2 && ob[0].status === "sent" && ob[1].status === "cancelled", "turning off cancels pending mail and leaves sent mail as it is");
  ok((await outbox(B))[0].status === "pending", "A turning off does not cancel B's mail");
  // back on: a fresh clock and opt-in time, same token
  await sql`update alert_prefs set last_digest_at = '2026-01-01', opted_in_at = '2026-01-01' where account_id = ${A}`;
  await rpc(A, "alert_save", { p_digest: "daily" });
  p = await pref(A);
  ok(p.digest === "daily" && p.unsubscribed_at === null && p.unsub_token === tokenA
    && p.opted_in_at.getTime() > before - 60_000 && new Date(p.last_digest_at).getTime() > before - 60_000, "turning back on restarts the clock and the opt-in time");

  // 6. the link in the email: no sign-in, exact token only, safe to repeat, tells nothing
  await queue(A, "2026-11-04T00:00:00Z");
  for (const bad of [null, "", "abc", tokenA.slice(0, 63), tokenA.toUpperCase(), tokenA + "0", "' or 1=1 --", "0".repeat(64)]) {
    const r = await rpc(null, "alert_unsubscribe", { p_token: bad });
    ok(r && r.ok === false && Object.keys(r).length === 1, `a wrong token unsubscribes nobody (${bad === null ? "null" : JSON.stringify(bad).slice(0, 14)})`);
  }
  ok((await pref(A)).digest === "daily" && (await pref(B)).digest === "daily", "wrong tokens changed nothing");
  let r = await rpc(null, "alert_unsubscribe", { p_token: tokenA });
  p = await pref(A);
  ok(r.ok === true && Object.keys(r).length === 1, "the right token unsubscribes without a sign-in and returns only ok");
  ok(p.digest === "off" && p.unsubscribed_at, "the digest is off after the link");
  ob = await outbox(A);
  ok(ob.filter((o) => o.status === "pending").length === 0 && ob.some((o) => o.status === "sent"), "the link cancels pending mail and leaves sent mail");
  ok((await pref(B)).digest === "daily" && (await outbox(B))[0].status === "pending", "A's link does not touch B");
  const stamp = p.unsubscribed_at.getTime();
  r = await rpc(null, "alert_unsubscribe", { p_token: tokenA });
  ok(r.ok === true && (await pref(A)).unsubscribed_at.getTime() === stamp, "using the link twice is harmless");
  r = await rpc(B, "alert_unsubscribe", { p_token: tokenB });
  ok(r.ok === true && (await pref(B)).digest === "off", "the link also works while signed in");

  // 7. the link works with the switch off, and so does turning off
  await rpc(B, "alert_save", { p_digest: "weekly" });
  await setSwitch(false);
  ok(/not available yet/.test(await message(() => rpc(A, "alert_save", { p_digest: "daily" }))), "switch off again: no way back in");
  r = await rpc(null, "alert_unsubscribe", { p_token: tokenB });
  ok(r.ok === true && (await pref(B)).digest === "off", "the link works with the switch off");
  await setSwitch(true); await rpc(B, "alert_save", { p_digest: "weekly" }); await setSwitch(false);
  s = await rpc(B, "alert_save", { p_digest: "off" });
  ok(s.digest === "off" && s.available === false, "turning off works with the switch off");

  // 8. the outbox holds one digest per account, kind and period
  ok(await fails(() => queue(B, "2026-11-03T00:00:00Z")), "a second digest for the same period is refused");
  ok(await fails(() => sql`insert into alert_outbox (account_id, kind, period_start, period_end, to_email, subject, body_text, item_count)
    values (${B}, 'digest_daily', '2026-11-05', '2026-11-06', 'x@example.com', 'Empty', 'Nothing.', 0)`), "a digest with nothing in it is refused");

  // 9. deleting the account takes the setting and the mail with it
  ok((await sql`select count(*)::int as n from alert_outbox where account_id = ${A}`)[0].n > 0, "(A has outbox rows before deletion)");
  await rpc(A, "account_delete");
  ok((await pref(A)) === undefined, "deleting the account deletes its alert setting");
  ok((await sql`select count(*)::int as n from alert_outbox where account_id = ${A}`)[0].n === 0, "deleting the account deletes its outbox rows");
  r = await rpc(null, "alert_unsubscribe", { p_token: tokenA });
  ok(r.ok === false, "a deleted account's link no longer matches anything");
  ok((await pref(B)) !== undefined, "deleting A leaves B's setting");
} finally {
  await sql`delete from accounts where id in (${A}, ${B}, ${C})`;
  if (was) await setSwitch(was.value === true);
  await sql.end();
}
console.log(`${failed ? "✗" : "✓"} ${ran - failed}/${ran} email-alert checks passed`);
process.exit(failed ? 1 : 0);
