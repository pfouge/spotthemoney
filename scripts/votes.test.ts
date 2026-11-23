// Roll-call votes: the rules in web/src/lib/votes.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rollFromRow, cleanVoteText, windowStart, inWindow, memberVotesFrom, memberVotesSentence, windowTotal, newestFirst, screen, matches, sortRolls, parseHash, toHash, isViewHash, votesHref,
  packVotes, unpackVotes, groupPositions, positionIn, countChars, votesCsv, viewCsv, viewCsvName, monthFilePath, MONTH_FILE_RE, DEFAULT_VIEW, NO_FILTER, VOTE_ROWS, VOTES_CAVEAT, CSV_COLUMNS,
  type Roll, type MonthFile,
} from "../web/src/lib/votes";

const BUILT = "2026-11-20";
const mk = (id: number, chamber: "house" | "senate", roll: number, date: string, x: Partial<Roll> = {}): Roll =>
  ({ id, chamber, congress: 119, session: 2, roll, date, question: "On Passage", result: "Passed", bill: "H R 1", type: "YEA-AND-NAY", yeas: 220, nays: 200, present: 0, notVoting: 12, url: `https://example.gov/${id}`, ...x });
const rolls = [
  mk(1, "house", 5, "2026-11-18"), mk(2, "senate", 5, "2026-11-18", { result: "Rejected", bill: null }), mk(3, "house", 4, "2026-10-01", { question: "On Motion to Recommit" }),
  mk(4, "house", 3, "2025-12-02", { result: "Agreed to" }), mk(5, "senate", 2, "2025-01-20", { result: "Confirmed", question: "On the Nomination", yeas: null }),
];

test("text is cleaned and cut at a word", () => {
  assert.equal(cleanVoteText("  a \u0000 b‮ c ", 50), "a b c");
  assert.equal(cleanVoteText("", 10), null);
  assert.equal(cleanVoteText(null, 10), null);
  const t = cleanVoteText("one two three four five six seven eight nine ten", 20)!;
  assert.ok(t.length <= 20 && t.endsWith("…") && !t.includes("  "), t);
  assert.equal(rollFromRow({ id: "7", chamber: "senate", congress: 119, session: 1, roll_number: 9, voted_at: "2025-03-04", question: "Q", result: "R", bill: null, vote_type: null, yeas: 1, nays: 2, present: 0, not_voting: 3, source_url: "javascript:x" }).url, null);
});
test("window counts back from the build day, edges inclusive, never the future", () => {
  assert.equal(windowStart(BUILT), "2025-11-20");
  assert.ok(inWindow("2025-11-20", BUILT) && inWindow(BUILT, BUILT));
  assert.ok(!inWindow("2025-11-19", BUILT) && !inWindow("2026-11-21", BUILT));
});
test("member counts and rows", () => {
  const pos = [
    { roll: rolls[0], position: "yea" as const }, { roll: rolls[1], position: "nay" as const }, { roll: rolls[2], position: "not_voting" as const },
    { roll: rolls[3], position: "present" as const }, { roll: rolls[4], position: "yea" as const },
  ];
  const v = memberVotesFrom(pos, BUILT);
  assert.deepEqual([v.yea, v.nay, v.present, v.notVoting, v.total], [1, 1, 1, 1, 5]);
  assert.equal(v.newest, "2026-11-18");
  assert.equal(windowTotal(v), 4);
  assert.equal(v.rows.length, 5);
  assert.deepEqual(v.rows.map((r) => r.roll.id), [2, 1, 3, 4, 5]);   // same day: senate before house (descending chamber)
  assert.match(memberVotesSentence("Jane Doe", v), /4 roll calls: 1 yea, 1 nay, 1 present and 1 not voting/);
  const many = Array.from({ length: 40 }, (_, i) => ({ roll: mk(100 + i, "house", i, "2026-10-01"), position: "yea" as const }));
  assert.equal(memberVotesFrom(many, BUILT).rows.length, VOTE_ROWS);
  assert.match(memberVotesSentence("A B", memberVotesFrom([{ roll: rolls[4], position: "yea" }], BUILT)), /No roll call in the last 12 months/);
});
test("caveat and wording keep clear of scoring", () => {
  assert.match(VOTES_CAVEAT, /does not score votes/);
  assert.doesNotMatch(memberVotesSentence("A B", memberVotesFrom([{ roll: rolls[0], position: "nay" }], BUILT)), /missed|loyal|attendance|%/i);
});
test("filters, order and paging", () => {
  const f = (o: Partial<typeof NO_FILTER>) => ({ ...NO_FILTER, w: "all" as const, ...o });
  assert.equal(rolls.filter((r) => matches(r, f({}), BUILT)).length, 5);
  assert.equal(rolls.filter((r) => matches(r, { ...NO_FILTER }, BUILT)).length, 3);       // default: 90 days
  assert.deepEqual(rolls.filter((r) => matches(r, f({ chamber: "senate" }), BUILT)).map((r) => r.id), [2, 5]);
  assert.deepEqual(rolls.filter((r) => matches(r, f({ result: "Agreed to" }), BUILT)).map((r) => r.id), [4]);
  assert.deepEqual(rolls.filter((r) => matches(r, f({ q: "recommit" }), BUILT)).map((r) => r.id), [3]);
  assert.deepEqual(rolls.filter((r) => matches(r, f({ q: "h r 1 passage" }), BUILT)).map((r) => r.id), [1, 4]);
  assert.deepEqual(sortRolls(rolls, "yeas", "desc").map((r) => r.id).slice(-1), [5]);       // empty last
  assert.deepEqual(sortRolls(rolls, "yeas", "asc").map((r) => r.id).slice(-1), [5]);
  const res = screen(rolls, { ...DEFAULT_VIEW, f: f({}), per: 25 }, BUILT);
  assert.deepEqual(res.rows.map((r) => r.id), rolls.slice().sort(newestFirst).map((r) => r.id));
  assert.equal(res.pages, 1);
});
test("address round trip, junk values and jump links", () => {
  const v = parseHash("#chamber=senate&w=all&member=jane-doe&sort=yeas&dir=asc&page=2&n=25&q=tax");
  assert.deepEqual([v.f.chamber, v.f.w, v.f.member, v.sort, v.dir, v.page, v.per, v.f.q], ["senate", "all", "jane-doe", "yeas", "asc", 2, 25, "tax"]);
  assert.deepEqual(parseHash(toHash(v)), v);
  assert.equal(toHash(DEFAULT_VIEW), "");
  const bad = parseHash("#chamber=x&w=9&member=../x&sort=zz&page=-1&n=7");
  assert.deepEqual(bad, DEFAULT_VIEW);
  assert.ok(isViewHash("#member=a-b") && !isViewHash("#about") && !isViewHash("#foo=1"));
  assert.equal(votesHref({ member: "jane-doe", chamber: "house" }), "/congress-votes/#chamber=house&member=jane-doe");
});
test("packed file round trip", () => {
  const d = packVotes(BUILT, rolls, [{ slug: "jane-doe", name: "Jane Doe" }]);
  assert.deepEqual(unpackVotes(JSON.parse(JSON.stringify(d))).map((r) => [r.id, r.date, r.result, r.bill, r.yeas, r.url]), rolls.map((r) => [r.id, r.date, r.result, r.bill, r.yeas, r.url]));
  assert.equal(d.results.length, new Set(rolls.map((r) => r.result)).size);
});
test("monthly files: counts, positions, groups", () => {
  const file: MonthFile = { chamber: "house", month: "2026-11", roster: [["A1", "Ann", "D", "TX", "ann-a"], ["B1", "Bob", "R", "OH", ""], ["C1", "Cy", "D", "NY", "cy-c"], ["D1", "Di", "R", "KY", ""]], rolls: { "1": "ynxp", "9": "----" } };
  assert.deepEqual(countChars(file.rolls["1"]), { yea: 1, nay: 1, present: 1, not_voting: 1 });
  assert.equal(positionIn(file, 1, "cy-c"), "not_voting");
  assert.equal(positionIn(file, 9, "cy-c"), null);
  assert.equal(positionIn(file, 1, "nobody"), null);
  const g = groupPositions(file, 1);
  assert.deepEqual(g.map((x) => [x.position, x.count]), [["yea", 1], ["nay", 1], ["present", 1], ["not_voting", 1]]);
  assert.equal(g[0].parties[0].members[0][1], "Ann");
  assert.ok(MONTH_FILE_RE.test("house-2026-11") && !MONTH_FILE_RE.test("house-2026-13") && !MONTH_FILE_RE.test("../house-2026-11"));
  assert.equal(monthFilePath("senate", "2025-02"), "/data/votes/senate-2025-02.json");
});
test("CSV: one row per roll call, columns as documented, view file in view order", () => {
  const csv = votesCsv(rolls);
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines.length, 6);
  assert.deepEqual(lines[0].split(","), CSV_COLUMNS.map((c) => c.key));
  assert.ok(!/person|member|name|position/.test(lines[0]));
  const v = { ...DEFAULT_VIEW, f: { ...NO_FILTER, w: "all" as const, chamber: "senate" as const } };
  assert.equal(viewCsv(rolls, v, BUILT).trim().split("\r\n").length, 3);
  assert.match(viewCsvName(v, BUILT), /^congress-votes-senate-all-2026-11-20\.csv$/);
});
