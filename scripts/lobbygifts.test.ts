// Lobbyist contributions, LD-203 (web/src/lib/lobbygifts.ts). Run: npx tsx --test scripts/lobbygifts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { honoreeName, buildMemberIndex, memberForItem, countedFilings, sentenceCase, periodLabel, periodRank, nameKey, shareText } from "../web/src/lib/lobbygifts";

const idx = buildMemberIndex([
  { slug: "jordan-whitfield", fullName: "Jordan Whitfield", firstName: "Jordan", lastName: "Whitfield" },
  { slug: "elena-marsh", fullName: "Elena Marsh", firstName: "Elena", lastName: "Marsh" },
  { slug: "pat-lee-1", fullName: "Pat Lee", firstName: "Pat", lastName: "Lee" },
  { slug: "pat-lee-2", fullName: "Pat Lee", firstName: "Pat", lastName: "Lee" },
  { slug: "samuel-okafor", fullName: "Samuel R. Okafor", firstName: "Samuel", lastName: "Okafor" },
]);
const m = (honoree: string | null) => memberForItem({ honoree }, idx);

test("honoreeName removes titles and bracket tags", () => {
  assert.equal(honoreeName("The Honorable Mike Flood"), "Mike Flood");
  assert.equal(honoreeName("Rep. Elena Marsh"), "Elena Marsh");
  assert.equal(honoreeName("Senator Priya Lindqvist"), "Priya Lindqvist");
  assert.equal(honoreeName("Elena Marsh [Leadership PAC]"), "Elena Marsh");
  assert.equal(honoreeName("Elena Marsh (D-TX)"), "Elena Marsh");
});

test("several people or nothing gives null", () => {
  assert.equal(honoreeName("Samuel Okafor and Elena Marsh"), null);
  assert.equal(honoreeName("A Smith; B Jones"), null);
  assert.equal(honoreeName("A Smith, B Jones, C Park"), null);
  assert.equal(honoreeName(""), null);
  assert.equal(honoreeName(null), null);
  assert.equal(honoreeName("Dr. Jordan Whitfield <\"friend\"> & guests"), null);
});

test("member match: exact form, title, bracket tag", () => {
  assert.equal(m("Jordan Whitfield"), "jordan-whitfield");
  assert.equal(m("The Honorable Jordan Whitfield"), "jordan-whitfield");
  assert.equal(m("Elena Marsh [Leadership PAC]"), "elena-marsh");
  assert.equal(m("jordan   whitfield"), "jordan-whitfield");
});

test("first plus last matches where a middle initial is on the roster", () => {
  assert.equal(m("Samuel Okafor"), "samuel-okafor");
  assert.equal(m("Hon. Samuel R. Okafor"), "samuel-okafor");
});

test("must NOT match: surname alone, two people, an unknown name, a shared name", () => {
  assert.equal(m("Whitfield"), null);
  assert.equal(m("Marsh"), null);
  assert.equal(m("Samuel Okafor and Elena Marsh"), null);
  assert.equal(m("Priya Lindqvist"), null);
  assert.equal(m("Pat Lee"), null);
  assert.equal(m(null), null);
});

test("the payee never matches without a committee map (rule a is not applied)", () => {
  assert.equal(memberForItem({ honoree: null, payee: "WHITFIELD FOR CONGRESS" }, idx), null);
});

test("amended filings: the newest posting counts per registrant, lobbyist, year and period", () => {
  const f = (uuid: string, posted: string, extra: object = {}) => ({ uuid, posted, registrantId: 1, lobbyist: "A", year: 2026, period: "Mid-Year (Jan 1 - Jun 30)", ...extra });
  const s = countedFilings([f("a", "2026-08-01"), f("b", "2026-09-01"), f("c", "2026-09-01", { lobbyist: "B" }), f("d", "2026-09-05", { period: "Year-End (Jul 1 - Dec 31)" })]);
  assert.deepEqual([...s].sort(), ["b", "c", "d"]);
});

test("labels keep the API's mixed case", () => {
  assert.equal(periodLabel("Mid-Year (Jan 1 - Jun 30)"), "Mid-Year (Jan 1 - Jun 30)");
  assert.equal(sentenceCase("FECA"), "FECA");
  assert.equal(sentenceCase("HONORARY_ITEM"), "Honorary item");
  assert.equal(sentenceCase(null), "(not stated)");
  assert.ok(periodRank("Mid-Year (Jan 1 - Jun 30)") !== periodRank("Year-End (Jul 1 - Dec 31)"));
  assert.equal(nameKey("Rep. O'Brien"), "rep obrien");
});

test("match share wording has no forbidden words", () => {
  const s = shareText({ items: 10, matched: 3 });
  assert.ok(!/bought|in exchange|influence|after receiving/i.test(s));
});
