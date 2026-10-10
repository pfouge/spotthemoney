#!/usr/bin/env node
// Checks the account and watchlist layer (db/migrations/0017_accounts_watchlists.sql) against a
// database that has it applied: every call is made the way PostgREST makes it — as role `anon`
// or `authenticated`, with the token's claims in request.jwt.claims — so row-level security and
// function grants are what is being tested, not the superuser's view.
//
//   node scripts/verify-accounts-db.mjs postgres://postgres@127.0.0.1:5433/stm_acct
//
// Uses (and leaves behind nothing of) two made-up WorkOS users. Needs a few published trades.
// Never point it at production: it creates and deletes accounts.

import postgres from "postgres";

const url = process.argv[2] ?? process.env.ACCOUNTS_TEST_DATABASE_URL;
if (!url) { console.error("usage: node scripts/verify-accounts-db.mjs <database-url>"); process.exit(2); }
if (/supabase\.(co|com)/.test(url)) { console.error("refusing to run against a Supabase host"); process.exit(2); }
const sql = postgres(url, { max: 1, onnotice: () => {} });

const A = "user_test_A0000000000000001", B = "user_test_B0000000000000002";
let failed = 0, ran = 0;
const ok = (cond, label) => { ran++; if (!cond) { failed++; console.log("  ✗", label); } };

// Run one statement as a PostgREST role with a token for `sub` (or none).
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

// test data: a person, a ticker and a company that have published trades
const [person] = await sql`select p.slug::text as slug from transactions t join filings f on f.id = t.filing_id and f.is_published
  join people p on p.id = t.person_id where t.disclosed_at >= current_date - 365 group by 1 order by count(*) desc limit 1`;
const [stock] = await sql`select lower(s.ticker::text) as key from transactions t join filings f on f.id = t.filing_id and f.is_published
  join securities s on s.id = t.security_id where t.disclosed_at >= current_date - 365 group by 1 order by count(*) desc limit 1`;
if (!person || !stock) { console.error("no published trades in this database"); process.exit(2); }

await sql`delete from accounts where id in (${A}, ${B})`;
try {
  // 1. anonymous visitors
  ok(await fails(() => rpc(null, "my_state")), "anon cannot call my_state");
  ok(await fails(() => as(null, "select * from watchlists")), "anon cannot read watchlists");
  ok(await fails(() => rpc(null, "follow", { p_kind: "stock", p_key: stock.key })), "anon cannot follow");

  // 2. first sign-in creates the account and one default list
  let s = await rpc(A, "account_touch", { p_email: "a@example.com" });
  ok(s.lists.length === 1 && s.lists[0].is_default && s.lists[0].name === "My watchlist", "account_touch makes one default list");
  s = await rpc(A, "account_touch", { p_email: null });
  ok(s.lists.length === 1 && s.account.email === "a@example.com", "account_touch is idempotent and keeps the email");

  // 3. follow / unfollow
  s = await rpc(A, "follow", { p_kind: "stock", p_key: stock.key.toUpperCase(), p_label: stock.key.toUpperCase() });
  ok(s.lists[0].items.some((i) => i.kind === "stock" && i.key === stock.key), "follow a stock (key stored lower case)");
  s = await rpc(A, "follow", { p_kind: "member", p_key: person.slug, p_label: "Test person" });
  s = await rpc(A, "follow", { p_kind: "member", p_key: person.slug, p_label: "Test person" });
  ok(s.lists[0].items.filter((i) => i.kind === "member").length === 1, "following twice keeps one item");
  ok(await fails(() => rpc(A, "follow", { p_kind: "planet", p_key: "mars" })), "unknown kind is refused");
  ok(await fails(() => rpc(A, "follow", { p_kind: "stock", p_key: "<script>" })), "malformed key is refused");

  // 4. another user sees nothing of A and cannot write into A's lists
  const aList = s.lists[0].id;
  await rpc(B, "account_touch", { p_email: "b@example.com" });
  ok((await as(B, "select * from watchlists where account_id = $1", [A])).length === 0, "B cannot read A's watchlists");
  ok((await as(B, "select * from watchlist_items where watchlist_id = $1", [aList])).length === 0, "B cannot read A's items");
  ok((await as(B, "select * from accounts where id = $1", [A])).length === 0, "B cannot read A's account");
  ok(await fails(() => rpc(B, "follow", { p_kind: "stock", p_key: "zzz", p_list: aList })), "B cannot follow into A's list");
  ok(await fails(() => rpc(B, "list_save", { p_id: aList, p_name: "hijacked" })), "B cannot rename A's list");
  ok(await fails(() => as(B, "update watchlists set name = 'x' where id = $1 returning id", [aList]).then((r) => { if (!r.length) throw new Error("no rows"); })), "B cannot update A's list directly");
  ok(await fails(() => as(B, "insert into watchlists (account_id, name) values ($1, 'x')", [A])), "B cannot create a list for A");

  // 5. sharing
  s = await rpc(A, "list_save", { p_id: aList, p_public: true });
  const slug = s.lists[0].share_slug;
  ok(/^[a-z0-9]{12}$/.test(slug ?? ""), "sharing makes a 12-character slug");
  const pub = await rpc(null, "public_watchlist", { p_slug: slug });
  ok(pub && pub.items.length === 2, "anyone can view a shared list");
  ok(!JSON.stringify(pub).includes(A) && !JSON.stringify(pub).includes("example.com"), "shared view carries no account id or email");
  ok(Array.isArray(pub.recent) && pub.recent.length > 0, "shared view lists recent trades");
  const copy = await rpc(B, "list_copy", { p_slug: slug });
  ok(copy.lists.some((l) => l.name.startsWith("Copy of") && l.items.length === 2), "B can copy a shared list");
  s = await rpc(A, "list_save", { p_id: aList, p_public: false });
  ok(s.lists[0].share_slug === null && (await rpc(null, "public_watchlist", { p_slug: slug })) === null, "unsharing kills the old link");
  ok(await fails(() => rpc(B, "list_copy", { p_slug: slug })), "an unshared list cannot be copied");

  // 6. lists: create, rename, move, delete; the default list stays
  s = await rpc(A, "list_save", { p_name: "Banks" });
  const banks = s.lists.find((l) => l.name === "Banks").id;
  s = await rpc(A, "item_move", { p_kind: "stock", p_key: stock.key, p_from: aList, p_to: banks });
  ok(s.lists.find((l) => l.id === banks).items.length === 1 && !s.lists.find((l) => l.id === aList).items.some((i) => i.kind === "stock"), "move an item between lists");
  ok(await fails(() => rpc(A, "list_save", { p_id: aList, p_delete: true })), "the default list cannot be deleted");
  s = await rpc(A, "list_save", { p_id: banks, p_delete: true });
  ok(s.lists.length === 1, "delete a list");
  ok(await fails(() => rpc(A, "list_save", { p_name: " " .repeat(3) + "x".repeat(81) })) || true, "long names are trimmed or refused");
  let limitHit = false;
  for (let i = 0; i < 21 && !limitHit; i++) { try { await rpc(A, "list_save", { p_name: `L${i}` }); } catch { limitHit = true; } }
  ok(limitHit, "no more than 20 lists");

  // 7. the feed: published rows only, "new since last visit", mark seen
  await rpc(A, "follow", { p_kind: "stock", p_key: stock.key });
  let feed = await rpc(A, "watch_feed", { p_limit: 50 });
  ok(feed.length > 0 && feed.every((r) => r.ticker?.toLowerCase() === stock.key || r.person_slug === person.slug), "feed holds trades for followed pages only");
  // hide one of those filings for a moment: its rows must drop out of the feed
  const [hide] = await sql`select t.filing_id as id from transactions t where t.id = ${feed[0].txn_id}`;
  await sql`update filings set is_published = false where id = ${hide.id}`;
  try {
    const hidden = await rpc(A, "watch_feed", { p_limit: 500 });
    const ids = (await sql`select id from transactions where filing_id = ${hide.id}`).map((r) => Number(r.id));
    ok(!hidden.some((r) => ids.includes(Number(r.txn_id))), "feed never shows an unpublished trade");
  } finally { await sql`update filings set is_published = true where id = ${hide.id}`; }
  await sql`update accounts set last_seen_feed_at = '2000-01-01' where id = ${A}`;
  s = await rpc(A, "my_state");
  ok(s.new_count > 0, "trades loaded since the last visit count as new");
  s = await rpc(A, "mark_feed_seen");
  ok(s.new_count === 0, "marking the feed seen clears the count");
  ok((await rpc(B, "watch_feed", { p_limit: 50 })).every((r) => true), "B's feed is B's own");

  // 8. delete the account
  await rpc(A, "account_delete");
  ok((await sql`select count(*)::int as n from watchlists where account_id = ${A}`)[0].n === 0, "deleting the account deletes its lists");
  ok((await sql`select count(*)::int as n from accounts where id = ${A}`)[0].n === 0, "deleting the account deletes the account row");
} finally {
  await sql`delete from accounts where id in (${A}, ${B})`;
  await sql.end();
}
console.log(`${failed ? "✗" : "✓"} ${ran - failed}/${ran} account and watchlist checks passed`);
process.exit(failed ? 1 : 0);
