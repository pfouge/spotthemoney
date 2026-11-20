// Email digests on the site (stage 3): the switch, the two API actions, the unsubscribe page.
//   npx tsx --test scripts/unsubscribe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIONS, ALERTS_ENABLED, ALERT_BODY_DAYS, ALERT_MAX_AGE_DAYS, ALERT_PENDING_DAYS, FEED_NEW_MAX_AGE_DAYS, DIGESTS, DIGEST_LABEL,
  alertActionAllowed, alertsLaunchProblem, crossSiteRefused, isDigest, isUnsubToken,
} from "../web/src/lib/account";
import { UNSUB_HEADERS, unsubPage, unsubPlan, type UnsubView } from "../web/src/lib/unsubscribe";
import { unsubscribeUrl } from "../ingest/src/lib/digest";

const TOKEN = "0123456789abcdef".repeat(4);
const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");

test("the site switch is off unless a preview build turns it on", () => {
  assert.equal(ALERTS_ENABLED, false);
  assert.match(read("../web/src/lib/account.ts"), /const ALERTS_LIVE = false;/, "the production switch stays off until stage 4");
});

test("the live switch cannot be turned on without a named provider and a date", () => {
  assert.equal(alertsLaunchProblem(false, { name: "", url: "" }, ""), null);
  assert.match(alertsLaunchProblem(true, { name: "", url: "" }, "2027-01-05") ?? "", /ALERTS_PROVIDER/);
  assert.match(alertsLaunchProblem(true, { name: "Mailer", url: "mailer.example" }, "2027-01-05") ?? "", /ALERTS_PROVIDER/);
  assert.match(alertsLaunchProblem(true, { name: "Mailer", url: "https://mailer.example/privacy" }, "") ?? "", /ALERTS_SINCE/);
  assert.equal(alertsLaunchProblem(true, { name: "Mailer", url: "https://mailer.example/privacy" }, "2027-01-05"), null);
});

test("the two digest actions take only off, daily or weekly", () => {
  assert.equal(ACTIONS.alerts.method, "GET");
  assert.equal(ACTIONS.alerts.fn, "alert_state");
  assert.deepEqual(ACTIONS.alerts.args({ anything: 1 }), {});
  assert.equal(ACTIONS["alerts-save"].method, "POST");
  assert.equal(ACTIONS["alerts-save"].fn, "alert_save");
  for (const d of DIGESTS) assert.deepEqual(ACTIONS["alerts-save"].args({ digest: d }), { p_digest: d });
  for (const bad of ["hourly", "DAILY", "", null, 1, undefined, { digest: "daily" }]) {
    assert.equal(typeof ACTIONS["alerts-save"].args({ digest: bad }), "string", `refuses ${JSON.stringify(bad)}`);
  }
  assert.ok(ACTIONS.alerts.alerts && ACTIONS["alerts-save"].alerts);
  assert.ok(!ACTIONS.follow.alerts && !ACTIONS.me.alerts, "watchlist actions are not behind the alerts switch");
  assert.ok(isDigest("weekly") && !isDigest("monthly"));
  assert.deepEqual(Object.keys(DIGEST_LABEL).sort(), [...DIGESTS].sort());
});

test("with the switch off only turning a digest off gets through", () => {
  assert.equal(alertActionAllowed("alerts", {}, false), false);
  assert.equal(alertActionAllowed("alerts-save", { p_digest: "daily" }, false), false);
  assert.equal(alertActionAllowed("alerts-save", { p_digest: "weekly" }, false), false);
  assert.equal(alertActionAllowed("alerts-save", { p_digest: "off" }, false), true);
  assert.equal(alertActionAllowed("alerts", {}, true), true);
  assert.equal(alertActionAllowed("alerts-save", { p_digest: "daily" }, true), true);
  assert.equal(alertActionAllowed("alerts", {}), false, "default follows the site switch, which is off");
});

test("an unsubscribe token is exactly 64 lower-case hex characters", () => {
  assert.ok(isUnsubToken(TOKEN));
  for (const bad of [TOKEN.slice(1), TOKEN + "0", TOKEN.toUpperCase(), TOKEN.slice(0, 63) + "g", "", null, undefined, 5, `${TOKEN}\n`, ` ${TOKEN}`]) {
    assert.equal(isUnsubToken(bad), false, JSON.stringify(bad));
  }
});

test("GET changes nothing, POST unsubscribes, a malformed token is told so", () => {
  assert.deepEqual(unsubPlan("GET", TOKEN), { view: "confirm", status: 200, call: false });
  assert.deepEqual(unsubPlan("POST", TOKEN), { view: "done", status: 200, call: true });
  for (const m of ["GET", "POST"]) {
    assert.deepEqual(unsubPlan(m, null), { view: "bad", status: 400, call: false });
    assert.deepEqual(unsubPlan(m, "abc"), { view: "bad", status: 400, call: false });
    assert.deepEqual(unsubPlan(m, `${TOKEN}'; drop table x;--`), { view: "bad", status: 400, call: false });
  }
});

test("the address the digest builder writes is the address the page answers", () => {
  const u = new URL(unsubscribeUrl("https://spotthemoney.com", TOKEN));
  assert.equal(u.pathname, "/alerts/unsubscribe/");
  assert.equal(u.searchParams.get("token"), TOKEN);
  assert.ok(unsubPage("confirm", TOKEN).includes(`action="/alerts/unsubscribe/?token=${TOKEN}"`));
  assert.match(read("../web/src/pages/alerts/unsubscribe.ts"), /prerender = false/);
});

test("every view is a complete page that is not indexed, sends no referrer and loads nothing", () => {
  const views: UnsubView[] = ["confirm", "done", "bad", "error"];
  for (const v of views) {
    const html = unsubPage(v, TOKEN);
    assert.ok(html.startsWith("<!doctype html>"), v);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/, v);
    assert.match(html, /<meta name="referrer" content="no-referrer">/, v);
    assert.match(html, /<meta name="viewport"/, v);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1, v);
    assert.ok(!/<script|<link|<img|<iframe|https?:\/\//.test(html), `${v}: no script and no outside file`);
    assert.ok(!html.includes("—"), `${v}: no em-dash`);
    assert.ok(!/\b(advice|recommend)/i.test(html), v);
    for (const a of html.match(/<a [^>]*>/g) ?? []) assert.match(a, /rel="noreferrer"/, `${v}: ${a}`);
  }
  assert.equal((unsubPage("confirm", TOKEN).match(/<form method="post"/g) ?? []).length, 1);
  assert.equal((unsubPage("error", TOKEN).match(/<form method="post"/g) ?? []).length, 1);
  assert.ok(!unsubPage("done", TOKEN).includes("<form"), "nothing left to press once unsubscribed");
  assert.ok(!unsubPage("bad", "x").includes("<form"));
});

test("a token that is not well-formed never reaches the page", () => {
  const evil = `"><script>alert(1)</script>`;
  for (const v of ["confirm", "done", "bad", "error"] as UnsubView[]) {
    const html = unsubPage(v, evil);
    assert.ok(!html.includes("alert(1)"), v);
    assert.ok(html.includes(`token=`) === (v === "confirm" || v === "error"), v);
  }
  assert.ok(unsubPage("confirm", evil).includes(`action="/alerts/unsubscribe/?token="`));
});

test("answers are never cached or indexed", () => {
  assert.equal(UNSUB_HEADERS["Cache-Control"], "private, no-store");
  assert.match(UNSUB_HEADERS["X-Robots-Tag"], /noindex/);
  assert.match(UNSUB_HEADERS["Content-Type"], /text\/html/);
});

test("the periods the privacy page states are the job's", () => {
  const job = read("../ingest/src/jobs/alerts_digest.ts");
  const num = (name: string): number => Number((job.match(new RegExp(`export const ${name} = (\\d+);`)) ?? [])[1]);
  assert.equal(num("PENDING_MAX_AGE_DAYS"), ALERT_PENDING_DAYS);
  assert.equal(num("SENT_BODY_DAYS"), ALERT_BODY_DAYS);
  assert.equal(num("MAX_AGE_DAYS"), ALERT_MAX_AGE_DAYS);
});

test("the watchlist's rule for a new trade is the one the guide states, and the digest's", () => {
  const sql = read("../db/migrations/0026_watch_feed_new_age.sql");
  const m = sql.match(/f\.created_at > \(select at from seen\) and t\.disclosed_at >= current_date - (\d+),/);
  assert.ok(m, "watch_feed_rows marks a row new by load time and disclosure age");
  assert.equal(Number(m![1]), FEED_NEW_MAX_AGE_DAYS);
  assert.equal(FEED_NEW_MAX_AGE_DAYS, ALERT_MAX_AGE_DAYS);
  assert.match(sql, /set search_path = public, pg_temp/);
});

test("with the switch off the privacy page, terms and guide keep their wording", () => {
  const privacy = read("../web/src/pages/privacy.astro");
  assert.match(privacy, /Not yet offered: new trades appear on your watchlist page only\./);
  // The date a change other than email alerts last moved (2026-11-20: saved screens in the browser).
  assert.match(privacy, /const BASE_UPDATED = "2026-11-20";/);
  assert.match(privacy, /alertsLaunchProblem\(\)/);
  assert.match(privacy, /We do not record whether you open an email/);
  assert.match(read("../web/src/pages/terms.astro"), /const BASE_UPDATED = "2026-10-10";/);
  assert.match(read("../web/src/lib/guides/site.ts"), /Email alerts are not offered yet\./);
});

test("every request that changes something needs this site's Origin, except the unsubscribe link", () => {
  const own = "https://spotthemoney.com";
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    assert.equal(crossSiteRefused(m, "/api/follow", null, own), true, `${m} with no Origin`);
    assert.equal(crossSiteRefused(m, "/api/follow", "https://evil.example", own), true, `${m} from elsewhere`);
    assert.equal(crossSiteRefused(m, "/api/follow", own, own), false, `${m} from this site`);
    assert.equal(crossSiteRefused(m, "/auth/logout", null, own), true);
    assert.equal(crossSiteRefused(m, "/insiders/someone/", null, own), true);
  }
  for (const m of ["GET", "HEAD", "OPTIONS"]) assert.equal(crossSiteRefused(m, "/api/me", null, own), false, m);
  assert.equal(crossSiteRefused("POST", "/alerts/unsubscribe/", null, own), false);
  assert.equal(crossSiteRefused("POST", "/alerts/unsubscribe", "https://mail.example", own), false);
  for (const p of ["/alerts/unsubscribe/x", "/alerts/", "/alerts/unsubscribe/../../api/follow", "/api/alerts/unsubscribe/", "/alerts/unsubscribe//"]) {
    assert.equal(crossSiteRefused("POST", p, null, own), true, p);
  }
  assert.match(read("../web/astro.config.mjs"), /checkOrigin: false/);
  assert.match(read("../web/src/middleware.ts"), /crossSiteRefused\(request\.method, url\.pathname/);
});
