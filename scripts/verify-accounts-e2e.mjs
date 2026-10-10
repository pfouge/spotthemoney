#!/usr/bin/env node
// End-to-end check of accounts and watchlists on a local build: the real Worker (wrangler dev on
// web/dist/server/wrangler.json) against local fakes of WorkOS and Supabase
// (scripts/accounts-fakes.mjs) and a local Postgres with migration 0017 applied.
//
//   cd web && npm run build            (with DATABASE_URL pointing at the same local database)
//   node scripts/verify-accounts-e2e.mjs postgres://postgres@127.0.0.1:5433/stm_acct
//
// Needs Playwright (npm i --no-save playwright). Never point it at production.

import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";
import { startFakes } from "./accounts-fakes.mjs";

const dbUrl = process.argv[2];
if (!dbUrl || /supabase\.(co|com)/.test(dbUrl)) { console.error("usage: node scripts/verify-accounts-e2e.mjs <local-database-url>"); process.exit(2); }
const PORT = 8787, BASE = `http://localhost:${PORT}`;
const A = { id: "user_e2e_A00000000000000001", email: "a@example.test" };
const B = { id: "user_e2e_B00000000000000002", email: "b@example.test" };

let failed = 0, ran = 0;
const ok = (cond, label, extra = "") => { ran++; if (!cond) { failed++; console.log("  ✗", label, extra); } else if (process.env.VERBOSE) console.log("  ✓", label); };

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
await sql`delete from accounts where id in (${A.id}, ${B.id})`;
const [stock] = await sql`select lower(s.ticker::text) as key from transactions t join filings f on f.id = t.filing_id and f.is_published
  join securities s on s.id = t.security_id where t.disclosed_at >= current_date - 365 group by 1 order by count(*) desc limit 1`;
const [member] = await sql`select p.slug::text as slug from transactions t join filings f on f.id = t.filing_id and f.is_published and f.source <> 'sec_form4'
  join people p on p.id = t.person_id group by 1 order by count(*) desc limit 1`;

const fakes = await startFakes({ dbUrl });
const vars = {
  WORKOS_CLIENT_ID: "client_test", WORKOS_API_KEY: "sk_test_fake", WORKOS_COOKIE_PASSWORD: "x".repeat(40),
  SUPABASE_URL: "http://localhost:8702", SUPABASE_ANON_KEY: "anon-test-key", WORKOS_API_HOSTNAME: "localhost:8701", SITE_URL: BASE,
};
// Settings go in dist/server/.dev.vars (wrangler's --var flag cuts values at the first colon,
// which breaks every URL). The file is deleted again on the way out.
const devVars = new URL("../web/dist/server/.dev.vars", import.meta.url).pathname;
writeFileSync(devVars, Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n");
const wr = spawn("npx", ["wrangler", "dev", "--config", "dist/server/wrangler.json", "--port", String(PORT), "--ip", "127.0.0.1",
  // without this, wrangler dev presents every request as addressed to the custom domain in wrangler.jsonc
  "--local-upstream", `localhost:${PORT}`], { cwd: new URL("../web/", import.meta.url).pathname, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
let wlog = ""; wr.stdout.on("data", (d) => (wlog += d)); wr.stderr.on("data", (d) => (wlog += d));
const cleanup = async () => { wr.kill("SIGTERM"); rmSync(devVars, { force: true }); await fakes.close(); await sql`delete from accounts where id in (${A.id}, ${B.id})`.catch(() => {}); await sql.end(); };

let { chromium } = await import("playwright");
let browser;
try {
  // ready = three healthy answers in a row (the first requests after start can fail)
  for (let i = 0, good = 0; i < 120 && good < 3; i++) {
    try { const r = await fetch(`${BASE}/api/me`); good = r.status === 200 ? good + 1 : 0; } catch { good = 0; }
    await sleep(1000);
  }

  // ── API guards, no browser ──
  let r = await fetch(`${BASE}/api/me`); let j = await r.json();
  ok(r.status === 200 && j.signedIn === false && j.available === true, "GET /api/me signed out", JSON.stringify(j));
  ok((r.headers.get("cache-control") ?? "").includes("no-store"), "API answers are never cached");
  r = await fetch(`${BASE}/api/follow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok(r.status === 403, "POST without Origin is refused", r.status);
  r = await fetch(`${BASE}/api/follow`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
  ok(r.status === 403, "POST from another site is refused", r.status);
  r = await fetch(`${BASE}/api/follow`, { method: "POST", headers: { Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "stock", key: stock.key }) });
  ok(r.status === 401, "follow while signed out is 401", r.status);
  r = await fetch(`${BASE}/api/nope`); ok(r.status === 401 || r.status === 404, "unknown action is refused", r.status);
  r = await fetch(`${BASE}/auth/login?return=https://evil.example/`, { redirect: "manual" });
  const loc = r.headers.get("location") ?? "";
  ok(r.status === 302 && loc.startsWith("http://localhost:8701/user_management/authorize"), "login redirects to WorkOS", loc);
  const st = new URL(loc).searchParams.get("state") ?? "";
  ok(Buffer.from(st.split(".")[1] ?? "", "base64").toString() === "/watchlist/", "an outside return address becomes /watchlist/");
  r = await fetch(`${BASE}/auth/callback?code=x&state=${encodeURIComponent(st)}`, { redirect: "manual" });
  ok(r.status === 302 && (r.headers.get("location") ?? "").includes("signin=expired"), "callback without the state cookie is refused");
  r = await fetch(`${BASE}/auth/logout`, { redirect: "manual" });
  ok(r.status === 404 || r.status === 405, "sign-out by GET is not possible", r.status);
  r = await fetch(`${BASE}/stocks/${stock.key}/`);
  ok(r.status === 200 && (await r.text()).includes("data-follow"), "stock page is served with a Follow button");

  // ── the browser ──
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctxA.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  fakes.setNextUser(A);
  await page.goto(`${BASE}/stocks/${stock.key}/`, { waitUntil: "networkidle" });
  const follow = page.locator("[data-follow]").first();
  ok(await follow.isVisible(), "Follow button shows for a signed-out visitor");
  await Promise.all([page.waitForURL(`${BASE}/stocks/${stock.key}/`, { timeout: 20000 }), follow.click()]);
  await page.waitForFunction(() => document.querySelector("[data-follow]")?.getAttribute("aria-pressed") === "true", null, { timeout: 15000 }).catch(() => {});
  ok(await follow.getAttribute("aria-pressed") === "true", "after signing in, the page is followed");
  const cookies = await ctxA.cookies(BASE);
  const sess = cookies.find((c) => c.name === "stm_session");
  ok(sess && sess.httpOnly && sess.sameSite === "Lax", "session cookie is HttpOnly and SameSite=Lax");
  ok(cookies.some((c) => c.name === "stm_signed_in" && !c.httpOnly), "signed-in flag cookie is readable by scripts");
  ok(!(await page.evaluate(() => document.cookie)).includes("stm_session"), "page scripts cannot read the session cookie");

  // follow a member too, then the watchlist page
  await page.goto(`${BASE}/congress/${member.slug}/`, { waitUntil: "networkidle" });
  await page.locator("[data-follow]").first().click();
  await page.waitForFunction(() => document.querySelector("[data-follow]")?.getAttribute("aria-pressed") === "true", null, { timeout: 10000 }).catch(() => {});
  ok(await page.locator("[data-follow]").first().getAttribute("aria-pressed") === "true", "follow a member while signed in");
  await sql`update accounts set last_seen_feed_at = '2000-01-01' where id = ${A.id}`;
  await page.goto(`${BASE}/stocks/${stock.key}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok(!(await page.locator("#acctBtn .acct-badge").isHidden()), "header badge shows new trades");
  await page.goto(`${BASE}/watchlist/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-wl-body] h2", { timeout: 10000 }).catch(() => {});
  const body = await page.locator("[data-wl-body]").innerText().catch(() => "");
  ok(/New since your last visit \(\d+\)/.test(body), "watchlist page lists new trades", body.slice(0, 200));
  ok(body.includes(stock.key.toUpperCase()), "watchlist page shows the followed stock");
  ok((await page.locator("[data-wl-body] tr.is-new").count()) > 0, "new rows are marked");
  await page.waitForTimeout(800);
  const after = await sql`select last_seen_feed_at > now() - interval '1 minute' as fresh from accounts where id = ${A.id}`;
  ok(after[0]?.fresh === true, "opening the watchlist marks the feed as seen");

  // share the list; a signed-out visitor sees it; B copies it after signing in
  await page.locator("button", { hasText: "Share with a link" }).first().click();
  await page.waitForSelector(".wl-share input", { timeout: 10000 }).catch(() => {});
  const shareUrl = await page.locator(".wl-share input").first().inputValue().catch(() => "");
  ok(/\/watchlist\/shared\/#[a-z0-9]{12}$/.test(shareUrl), "sharing gives a link", shareUrl);
  const ctxB = await browser.newContext();
  const pb = await ctxB.newPage();
  await pb.goto(shareUrl, { waitUntil: "networkidle" });
  await pb.waitForSelector("[data-wl-shared] h2", { timeout: 10000 }).catch(() => {});
  const shared = await pb.locator("[data-wl-shared]").innerText().catch(() => "");
  ok(shared.includes("My watchlist") && shared.includes(stock.key.toUpperCase()), "a signed-out visitor sees the shared list");
  ok(!shared.includes(A.email) && !shared.includes(A.id), "shared view shows no email or account id");
  fakes.setNextUser(B);
  await Promise.all([pb.waitForURL(/\/watchlist\/shared\//, { timeout: 20000 }), pb.locator("button", { hasText: "Copy to my watchlist" }).click()]);
  await pb.waitForLoadState("networkidle");
  await pb.locator("button", { hasText: "Copy to my watchlist" }).click();
  await pb.waitForTimeout(800);
  const bLists = await sql`select w.name, count(i.*)::int as n from watchlists w left join watchlist_items i on i.watchlist_id = w.id where w.account_id = ${B.id} group by 1`;
  ok(bLists.some((l) => l.name === "Copy of My watchlist" && l.n === 2), "B copied the shared list", JSON.stringify(bLists));

  // B's session cannot read or change A's lists through the API
  const aList = (await sql`select id from watchlists where account_id = ${A.id} and is_default`)[0].id;
  const res = await pb.evaluate(async (id) => (await fetch("/api/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name: "hijacked" }) })).status, aList);
  ok(res >= 400, "B cannot rename A's list through the API", res);
  ok((await sql`select name from watchlists where id = ${aList}`)[0].name === "My watchlist", "A's list is unchanged");

  // an expired access token is refreshed from the session cookie
  fakes.setAccessTtl(3);
  fakes.setNextUser(A);
  const ctxC = await browser.newContext(); const pc = await ctxC.newPage();
  await pc.goto(`${BASE}/auth/login?return=/watchlist/`, { waitUntil: "networkidle" });
  fakes.setAccessTtl(300);
  await sleep(4500);   // the 3-second access token in this session's cookie has now expired
  const me = await pc.evaluate(async () => (await fetch("/api/me")).json());
  ok(me.signedIn === true, "an expired access token is refreshed", JSON.stringify(me).slice(0, 120));
  const refreshed = (await ctxC.cookies(BASE)).find((c) => c.name === "stm_session");
  ok(!!refreshed, "refresh keeps a session cookie");

  // two requests that both find the access token expired: WorkOS refresh tokens are single-use,
  // so one refresh fails. That failure must not sign the visitor out (live bug, 2026-10-10).
  fakes.setAccessTtl(3);
  fakes.setNextUser(A);
  const ctxD = await browser.newContext(); const pd = await ctxD.newPage();
  await pd.goto(`${BASE}/auth/login?return=/watchlist/`, { waitUntil: "networkidle" });
  fakes.setAccessTtl(300);
  await sleep(4500);
  const pair = await pd.evaluate(async () => Promise.all([fetch("/api/me").then((r) => r.json()), fetch("/api/me").then((r) => r.json())]));
  ok(pair.some((m) => m.signedIn === true), "one of two simultaneous refreshes succeeds", JSON.stringify(pair).slice(0, 160));
  const afterPair = await pd.evaluate(async () => (await fetch("/api/me")).json());
  ok(afterPair.signedIn === true, "a failed simultaneous refresh does not sign the visitor out", JSON.stringify(afterPair).slice(0, 120));
  ok((await ctxD.cookies(BASE)).some((c) => c.name === "stm_signed_in" && c.value === "1"), "the signed-in flag cookie survives");

  // the watchlist page asks /api/me once on load (header script and page share one request)
  const meCalls = [];
  pd.on("request", (r) => { if (r.url().endsWith("/api/me")) meCalls.push(r.url()); });
  await pd.goto(`${BASE}/watchlist/`, { waitUntil: "networkidle" });
  ok(meCalls.length === 1, "the watchlist page makes one /api/me request", meCalls.length);
  await ctxD.close();

  // unshare: the old link stops working
  await page.goto(`${BASE}/watchlist/`, { waitUntil: "networkidle" });
  await page.locator("button", { hasText: "Stop sharing" }).first().click();
  await page.waitForTimeout(800);
  await pb.goto("about:blank"); await pb.goto(shareUrl, { waitUntil: "networkidle" }); await pb.waitForTimeout(800);
  ok((await pb.locator("[data-wl-shared]").innerText()).includes("no longer exists"), "an unshared link no longer shows the list");

  // sign out
  await page.goto(`${BASE}/watchlist/`, { waitUntil: "networkidle" });
  await page.waitForSelector("button:has-text('Sign out')", { timeout: 10000 }).catch(() => {});
  await Promise.all([page.waitForURL(/localhost:8787\/$/, { timeout: 15000 }).catch(() => {}), page.locator("button", { hasText: "Sign out" }).click()]);
  const afterOut = await ctxA.cookies(BASE);
  ok(!afterOut.some((c) => c.name === "stm_session" && c.value), "signing out clears the session cookie");
  ok(fakes.log.includes("GET /user_management/sessions/logout"), "signing out also ends the WorkOS session");

  // delete account (B)
  pb.on("dialog", (d) => d.accept());
  await pb.goto(`${BASE}/watchlist/`, { waitUntil: "networkidle" });
  await pb.waitForSelector("button:has-text('Delete my account')", { timeout: 10000 }).catch(() => {});
  await Promise.all([pb.waitForURL(/account=deleted/, { timeout: 15000 }).catch(() => {}), pb.locator("button", { hasText: "Delete my account" }).click()]);
  ok((await sql`select count(*)::int as n from accounts where id = ${B.id}`)[0].n === 0, "deleting the account removes it from the database");
  ok(!fakes.users.has(B.id), "deleting the account removes the WorkOS user");
  ok(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
} catch (e) {
  failed++; console.log("  ✗ crashed:", e.message);
  if (process.env.VERBOSE) console.log(wlog.slice(-3000));
} finally {
  await browser?.close();
  await cleanup();
}
console.log(`${failed ? "✗" : "✓"} ${ran - (failed > ran ? ran : failed)}/${ran} end-to-end account checks passed`);
process.exit(failed ? 1 : 0);
