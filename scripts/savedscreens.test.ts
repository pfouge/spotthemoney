import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, cleanHash, hashToSave, parseSaved, serializeSaved, addSaved, removeSaved, suggestName, MAX_SAVED, NAME_MAX, SAVED_KEY, SAVE_PROBLEM } from "../web/src/lib/savedscreens";
import { DEFAULT_VIEW, NO_FILTER, parseHash, toHash } from "../web/src/lib/screener";
import { readFileSync } from "node:fs";

test("a name is tidied and cut, and is only ever text", () => {
  assert.equal(cleanName("  Senate   buys \n over 100k "), "Senate buys over 100k");
  assert.equal(cleanName("a\u0000b\u202ec"), "a b c");
  assert.equal(cleanName("x".repeat(200)).length, NAME_MAX);
  assert.equal(cleanName(""), ""); assert.equal(cleanName(null), ""); assert.equal(cleanName(42), ""); assert.equal(cleanName({}), "");
  // Markup stays as the characters typed; the page puts names in as text nodes.
  assert.equal(cleanName("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>");
});

test("an address is rewritten by the screener itself and loses its page number", () => {
  assert.equal(cleanHash("#chamber=senate&side=buy&page=4"), "#chamber=senate&side=buy");
  assert.equal(cleanHash("chamber=senate"), "#chamber=senate");
  assert.equal(cleanHash("#side=buy&evil=<script>&min=7"), "#side=buy");
  assert.equal(cleanHash("#about"), "", "a jump link is not a view");
  assert.equal(cleanHash("#chamber=mars"), "", "a view with nothing valid in it is the default view");
  assert.equal(cleanHash("javascript:alert(1)"), "");
  assert.equal(cleanHash("https://example.com/#side=buy"), "", "only a hash is kept, never another address");
  assert.equal(cleanHash("#side=buy" + "&q=" + "a".repeat(700)), "", "over-long text is refused");
  assert.equal(cleanHash(undefined), ""); assert.equal(cleanHash(7), "");
  // What is kept always starts with # and reads back to the same view.
  const h = cleanHash("#party=d&state=tx&sort=amount&dir=desc&per=100");
  assert.equal(h, toHash(parseHash(h)));
  assert.ok(h.startsWith("#"));
});

test("the view the page opens on is not something to save", () => {
  assert.equal(hashToSave(DEFAULT_VIEW), "");
  assert.equal(hashToSave({ ...DEFAULT_VIEW, page: 3 }), "");
  assert.equal(hashToSave({ ...DEFAULT_VIEW, f: { ...NO_FILTER, side: "sell" }, page: 9 }), "#side=sell");
  assert.equal(addSaved([], "Everything", "").problem, "view");
  assert.equal(addSaved([], "Everything", "#page=2").problem, "view");
});

test("saving: newest first, a name in use is replaced, the list passed in is not changed", () => {
  const a = addSaved([], "Senate buys", "#chamber=senate&side=buy");
  assert.equal(a.problem, null); assert.equal(a.replaced, false);
  const b = addSaved(a.list, "Late sales", "#side=sell&late=late&page=2");
  assert.deepEqual(b.list, [{ n: "Late sales", h: "#side=sell&late=late" }, { n: "Senate buys", h: "#chamber=senate&side=buy" }]);
  const c = addSaved(b.list, "senate BUYS", "#chamber=senate&side=buy&min=100001");
  assert.equal(c.replaced, true);
  assert.deepEqual(c.list.map((s) => s.n), ["senate BUYS", "Late sales"]);
  assert.equal(c.list[0].h, "#chamber=senate&side=buy&min=100001");
  assert.equal(b.list.length, 2, "the earlier list is untouched");
  assert.equal(addSaved(b.list, "   ", "#side=buy").problem, "name");
  assert.deepEqual(removeSaved(c.list, "LATE SALES").map((s) => s.n), ["senate BUYS"]);
  assert.deepEqual(removeSaved(c.list, "not there"), c.list);
});

test("the list is capped and a save past the cap is refused, not swapped for an old one", () => {
  let list = [] as ReturnType<typeof parseSaved>;
  for (let i = 0; i < MAX_SAVED; i++) list = addSaved(list, `Screen ${i}`, "#side=buy").list;
  assert.equal(list.length, MAX_SAVED);
  const over = addSaved(list, "One more", "#side=sell");
  assert.equal(over.problem, "full"); assert.equal(over.list, list);
  // Replacing a name already there still works when the list is full.
  const rep = addSaved(list, "screen 3", "#side=sell");
  assert.equal(rep.problem, null); assert.equal(rep.list.length, MAX_SAVED); assert.equal(rep.list[0].h, "#side=sell");
  assert.ok(SAVE_PROBLEM.full.includes(String(MAX_SAVED)));
});

test("what comes back from storage is untrusted: junk is dropped piece by piece", () => {
  assert.deepEqual(parseSaved(null), []); assert.deepEqual(parseSaved(""), []); assert.deepEqual(parseSaved("{not json"), []);
  assert.deepEqual(parseSaved('{"n":"x","h":"#side=buy"}'), [], "not a list");
  const raw = JSON.stringify([
    { n: "Good", h: "#side=buy&page=7" }, null, 5, "text", { n: "", h: "#side=buy" }, { n: "No view", h: "#about" },
    { n: "Elsewhere", h: "https://example.com/" }, { n: "good", h: "#side=sell" }, { n: 12, h: "#side=buy" },
    { n: "  Second\tone ", h: "state=tx", extra: "ignored" },
  ]);
  assert.deepEqual(parseSaved(raw), [{ n: "Good", h: "#side=buy" }, { n: "Second one", h: "#state=TX" }]);
  const many = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ n: `S${i}`, h: "#side=buy" })));
  assert.equal(parseSaved(many).length, MAX_SAVED);
  // Round trip, and only names and addresses are written.
  const list = parseSaved(raw);
  assert.deepEqual(parseSaved(serializeSaved(list)), list);
  assert.deepEqual(Object.keys(JSON.parse(serializeSaved(list))[0]).sort(), ["h", "n"]);
});

test("a suggested name comes from the filter labels", () => {
  assert.equal(suggestName(["Senate", "", " Purchases ", "$100,001 or more"]), "Senate, Purchases, $100,001 or more");
  assert.equal(suggestName([]), "My screen");
  assert.ok(suggestName(Array.from({ length: 30 }, () => "Disclosed in the last 12 months")).length <= NAME_MAX);
});

test("the privacy page names the storage key, so the policy and the code cannot drift apart", () => {
  const privacy = readFileSync(new URL("../web/src/pages/privacy.astro", import.meta.url), "utf8");
  assert.ok(privacy.includes("SAVED_KEY"), "privacy.astro prints the key from lib/savedscreens.ts");
  assert.ok(/saved screens/i.test(privacy));
  assert.equal(SAVED_KEY, "stm.screens.congress");
});
