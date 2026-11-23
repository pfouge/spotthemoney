import { test } from "node:test";
import assert from "node:assert/strict";
import { orderTiles, newestFirst, newestOf, countInWindow, washAnswer, washLog, weekTiles, weekLog, WEEK_MIN_TILES, type Tile } from "../web/src/lib/washhub";

const tile = (key: Tile["key"], phrase = `${key} phrase`): Tile => ({ key, title: key, path: `/${key}/`, blurb: "b", window: "w", figures: [{ key: "n", label: "N", value: "5" }], newest: "2026-11-01", newestLabel: "n", items: [], phrase, short: key });

test("tiles come in the page's order and absent ones are dropped", () => {
  const out = orderTiles([tile("votes"), null, tile("lobbying"), tile("grants"), undefined]);
  assert.deepEqual(out.map((t) => t.key), ["lobbying", "grants", "votes"]);
});
test("a key given twice appears once", () => {
  assert.equal(orderTiles([tile("votes"), tile("votes")]).length, 1);
});
test("newestFirst: newest first, ties keep input order, missing dates last", () => {
  const xs = [{ n: "a", d: "2026-01-02" }, { n: "b", d: null }, { n: "c", d: "2026-03-01" }, { n: "d", d: "2026-01-02" }, { n: "e", d: "2026-02-01" }];
  assert.deepEqual(newestFirst(xs, (x) => x.d).map((x) => x.n), ["c", "e", "a"]);
  assert.deepEqual(newestFirst(xs, (x) => x.d, 5).map((x) => x.n), ["c", "e", "a", "d", "b"]);
});
test("newestOf ignores junk", () => {
  assert.equal(newestOf(["2026-01-02", null, "x", "2026-03-04T10:00:00Z", undefined]), "2026-03-04");
  assert.equal(newestOf([]), null);
});
test("the 7 day window is inclusive at both edges and never reaches past the build day", () => {
  const built = "2026-11-22";
  const dates = ["2026-11-22", "2026-11-15", "2026-11-14", "2026-11-23", null, "bad", "2026-11-18T09:00:00Z"];
  assert.equal(countInWindow(dates, built), 3);
  assert.equal(countInWindow(dates, built, 30), 4);
});
test("the answer names only the tiles it is given", () => {
  const a = washAnswer([tile("lobbying", "3 lobbying filings"), tile("votes", "9 roll calls")]);
  assert.match(a, /3 lobbying filings and 9 roll calls/);
  assert.doesNotMatch(a, /contracts/i);
  assert.match(washAnswer([]), /No Washington records/);
  assert.match(washAnswer([tile("lobbying", "A"), tile("grants", "B"), tile("votes", "C")]), /A, B, and C/);
});
test("answer text has no dash punctuation", () => {
  assert.doesNotMatch(washAnswer([tile("lobbying"), tile("votes")]), /[–—]/);
});
test("week tiles: hidden datasets are absent, zero stays, fewer than three means none", () => {
  const full = weekTiles({ events: 10, votes: 0, outside: 4, holders: 2, planned: 1, lobbycontrib: null, grants: 7 });
  assert.deepEqual(full.map((t) => t.key), ["events", "votes", "outside", "holders", "planned", "grants"]);
  assert.equal(full[1]!.count, 0);
  assert.equal(weekTiles({ events: 10, votes: 3 }).length, 0);
  assert.equal(weekTiles({ events: 10, votes: 3, grants: 1 }).length, WEEK_MIN_TILES);
  assert.equal(weekTiles({}).length, 0);
});
test("logs are one line each", () => {
  assert.doesNotMatch(washLog([tile("votes")]), /\n/);
  assert.match(weekLog("2026-11-22", weekTiles({ events: 1, votes: 2, grants: 3 })), /events 1, votes 2, grants 3/);
  assert.match(weekLog("2026-11-22", []), /not shown/);
});
