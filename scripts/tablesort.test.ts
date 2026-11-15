import { test } from "node:test";
import assert from "node:assert/strict";
import { firstDir, nextState, sortedOrder, parseValue, dayKey, numKey } from "../web/src/lib/tablesort";

test("first direction: numbers and dates descending, text ascending", () => {
  assert.equal(firstDir("num"), "desc");
  assert.equal(firstDir("text"), "asc");
});

test("click cycle: first, reverse, original; a different column restarts", () => {
  let s = nextState(null, 3, "num");
  assert.deepEqual(s, { col: 3, dir: "desc" });
  s = nextState(s, 3, "num");
  assert.deepEqual(s, { col: 3, dir: "asc" });
  assert.equal(nextState(s, 3, "num"), null);
  let t = nextState(null, 0, "text");
  assert.deepEqual(t, { col: 0, dir: "asc" });
  t = nextState(t, 0, "text");
  assert.deepEqual(t, { col: 0, dir: "desc" });
  assert.equal(nextState(t, 0, "text"), null);
  assert.deepEqual(nextState({ col: 0, dir: "desc" }, 2, "text"), { col: 2, dir: "asc" });
});

test("numbers sort both ways, empties last in both", () => {
  const raws = ["5", "", "100", "7", null, "-3"];
  assert.deepEqual(sortedOrder(raws, { col: 0, dir: "desc" }, "num"), [2, 3, 0, 5, 1, 4]);
  assert.deepEqual(sortedOrder(raws, { col: 0, dir: "asc" }, "num"), [5, 0, 3, 2, 1, 4]);
});

test("numbers compare as numbers, not strings", () => {
  assert.deepEqual(sortedOrder(["9", "10", "100"], { col: 0, dir: "asc" }, "num"), [0, 1, 2]);
});

test("text sorts case-insensitively; empties last", () => {
  const raws = ["beta", "", "Alpha", "alpha"];
  assert.deepEqual(sortedOrder(raws, { col: 0, dir: "asc" }, "text"), [2, 3, 0, 1]);
  assert.deepEqual(sortedOrder(raws, { col: 0, dir: "desc" }, "text"), [0, 2, 3, 1]);
});

test("stable: ties keep original order in both directions", () => {
  const raws = ["1", "2", "1", "2", "1"];
  assert.deepEqual(sortedOrder(raws, { col: 0, dir: "asc" }, "num"), [0, 2, 4, 1, 3]);
  assert.deepEqual(sortedOrder(raws, { col: 0, dir: "desc" }, "num"), [1, 3, 0, 2, 4]);
});

test("no state returns the original order", () => {
  assert.deepEqual(sortedOrder(["3", "1", "2"], null, "num"), [0, 1, 2]);
});

test("parse and keys", () => {
  assert.equal(parseValue("abc", "num"), null);
  assert.equal(parseValue(" 12 ", "num"), 12);
  assert.equal(parseValue("0", "num"), 0);
  assert.equal(dayKey("1970-01-02"), "1");
  assert.equal(dayKey("2026-01-05T00:00:00Z") > dayKey("2026-01-04"), true);
  assert.equal(dayKey(null), "");
  assert.equal(numKey(null), "");
  assert.equal(numKey(0), "0");
  assert.equal(numKey(NaN), "");
});
