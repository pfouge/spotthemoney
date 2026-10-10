// Tests for the pure account helpers (web/src/lib/account.ts): return-address safety, cookies,
// the origin check, the action whitelist and how feed rows are worded.
//   npx tsx --test scripts/account.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, feedAmount, feedVerb, isKey, itemPath, readCookie, safeReturnPath, sameOrigin, setCookie } from "../web/src/lib/account";

test("safeReturnPath keeps on-site paths and refuses everything else", () => {
  assert.equal(safeReturnPath("/stocks/aapl/"), "/stocks/aapl/");
  assert.equal(safeReturnPath("/watchlist/shared/#abc123def456"), "/watchlist/shared/#abc123def456");
  for (const bad of ["https://evil.example/", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "", null, "/auth/logout", "/api/me", "/x\u0000y", "x".repeat(600)]) {
    assert.equal(safeReturnPath(bad as string), "/watchlist/", String(bad).slice(0, 30));
  }
});

test("cookies are Secure, SameSite=Lax and HttpOnly unless asked otherwise", () => {
  const c = setCookie("stm_session", "a b;c", { maxAge: 60 });
  assert.match(c, /^stm_session=a%20b%3Bc; Path=\/; Max-Age=60; Secure; SameSite=Lax; HttpOnly$/);
  assert.doesNotMatch(setCookie("stm_signed_in", "1", { maxAge: 60, httpOnly: false }), /HttpOnly/);
  assert.equal(readCookie("x=1; stm_session=a%20b%3Bc; y=2", "stm_session"), "a b;c");
  assert.equal(readCookie("x=1", "stm_session"), undefined);
});

test("sameOrigin compares scheme and host exactly", () => {
  assert.equal(sameOrigin("https://spotthemoney.com", "https://spotthemoney.com/api/follow"), true);
  assert.equal(sameOrigin("https://www.spotthemoney.com", "https://spotthemoney.com"), false);
  assert.equal(sameOrigin("http://spotthemoney.com", "https://spotthemoney.com"), false);
  assert.equal(sameOrigin(null, "https://spotthemoney.com"), false);
  assert.equal(sameOrigin("null", "https://spotthemoney.com"), false);
});

test("actions accept only well-formed arguments", () => {
  assert.deepEqual(ACTIONS.follow.args({ kind: "stock", key: " AAPL ", label: "AAPL" }), { p_kind: "stock", p_key: "aapl", p_label: "AAPL", p_on: true, p_list: null });
  assert.equal(typeof ACTIONS.follow.args({ kind: "planet", key: "mars" }), "string");
  assert.equal(typeof ACTIONS.follow.args({ kind: "stock", key: "<b>" }), "string");
  assert.equal(typeof ACTIONS.follow.args({ kind: "stock", key: "aapl", list: "not-a-uuid" }), "string");
  assert.equal(typeof ACTIONS.list.args({}), "string", "a new list needs a name");
  assert.equal(typeof ACTIONS.copy.args({ slug: "../../etc" }), "string");
  assert.equal(ACTIONS.me.method, "GET");
  assert.equal(ACTIONS.follow.method, "POST");
  assert.ok(isKey("brk.b") && isKey("nancy-pelosi") && !isKey("Nancy Pelosi"));
});

test("item paths match the site's page addresses", () => {
  assert.equal(itemPath("member", "nancy-pelosi"), "/congress/nancy-pelosi/");
  assert.equal(itemPath("insider", "huang-jen-hsun"), "/insiders/huang-jen-hsun/");
  assert.equal(itemPath("stock", "brk.b"), "/stocks/brk.b/");
  assert.equal(itemPath("company", "nvidia-corp"), "/companies/nvidia-corp/");
});

test("feed rows say what was filed and never call an option a buy", () => {
  assert.equal(feedAmount({ amount_low: 1001, amount_high: 15000, shares: null, price: null }), "$1K–$15K");
  assert.equal(feedAmount({ amount_low: 50000001, amount_high: null, shares: null, price: null }), "over $50M");
  assert.equal(feedAmount({ amount_low: null, amount_high: null, shares: 1200, price: 41.5 }), "1,200 sh at $41.5");
  assert.equal(feedVerb({ side: "buy", is_derivative: true, txn_code: "P" }), "option or conversion");
  assert.equal(feedVerb({ side: "buy", is_derivative: false, txn_code: "P" }), "bought");
  assert.equal(feedVerb({ side: "other", is_derivative: false, txn_code: "A" }), "Form 4 code A");
});
