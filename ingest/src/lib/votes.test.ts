import { test } from "node:test";
import assert from "node:assert/strict";
import {
  congressSession, hasVoteShape, houseVoteUrl, mapPosition, parseHouseDate, parseHouseVoteXml,
  parseSenateDate, parseSenateMenu, parseSenateVoteXml, senateMenuUrl, senateVoteUrl, withCounts,
} from "./votes.js";

const HOUSE = `<?xml version="1.0"?><rollcall-vote><vote-metadata><congress>119</congress><session>1st</session>
<rollcall-num>12</rollcall-num><legis-num>H R 1</legis-num><vote-question>On Passage</vote-question>
<vote-type>YEA-AND-NAY</vote-type><vote-result>Passed</vote-result><action-date>3-Jan-2025</action-date>
<action-time time-etz="13:00">1:00 PM</action-time><vote-desc>A &amp; B</vote-desc>
<vote-totals><totals-by-vote><yea-total>1</yea-total><nay-total>1</nay-total><present-total>0</present-total><not-voting-total>1</not-voting-total></totals-by-vote></vote-totals></vote-metadata>
<vote-data>
<recorded-vote><legislator name-id="A000001" party="D" state="NC">Adams</legislator><vote>Aye</vote></recorded-vote>
<recorded-vote><legislator name-id="B000002" party="R" state="TX">Brown &amp; Sons</legislator><vote>No</vote></recorded-vote>
<recorded-vote><legislator name-id="C000003" party="R" state="TX">Cruz</legislator><vote>Not Voting</vote></recorded-vote>
<recorded-vote><legislator name-id="E000005" party="R" state="OH">Evans</legislator><vote>Recused</vote></recorded-vote>
</vote-data></rollcall-vote>`;

const SENATE = `<roll_call_vote><congress>119</congress><session>1</session><vote_number>00005</vote_number>
<vote_date>January 9, 2025, 02:54 PM</vote_date><question>On the Motion</question>
<vote_document_text>Test</vote_document_text><vote_result>Agreed to</vote_result>
<document><document_name>S. 5</document_name></document><count><yeas>84</yeas><nays>9</nays><present></present><absent>6</absent></count>
<members><member><member_full>Alsobrooks (D-MD)</member_full><vote_cast>Yea</vote_cast><lis_member_id>S428</lis_member_id></member>
<member><member_full>Barrasso (R-WY)</member_full><vote_cast>Not Voting</vote_cast><lis_member_id>S300</lis_member_id></member></members></roll_call_vote>`;

test("dates", () => {
  assert.equal(parseHouseDate("3-Jan-2025"), "2025-01-03");
  assert.equal(parseHouseDate("garbage"), null);
  assert.equal(parseHouseDate(null), null);
  assert.deepEqual(parseSenateDate("January 9, 2025, 02:54 PM"), { date: "2025-01-09", time: parseSenateDate("January 9, 2025, 02:54 PM").time });
  assert.equal(parseSenateDate("nonsense").date, null);
});

test("mapPosition", () => {
  assert.equal(mapPosition("Yea"), "yea");
  assert.equal(mapPosition("Aye"), "yea");
  assert.equal(mapPosition("No"), "nay");
  assert.equal(mapPosition("Nay"), "nay");
  assert.equal(mapPosition("Present"), "present");
  assert.equal(mapPosition("Not Voting"), "not_voting");
  assert.equal(mapPosition("Guilty"), null);
  assert.equal(mapPosition(null), null);
});

test("house vote", () => {
  const v = parseHouseVoteXml(HOUSE);
  assert.equal(v.rollNumber, 12);
  assert.equal(v.congress, 119);
  assert.equal(v.session, 1);
  assert.equal(v.votedAt, "2025-01-03");
  assert.equal(v.bill, "H R 1");
  assert.equal(v.description, "A & B");
  assert.equal(v.positions.length, 4);
  assert.equal(v.positions[1]!.name, "Brown & Sons");
  assert.equal(v.positions[0]!.position, "yea");
  assert.equal(v.positions[3]!.position, null);
  assert.equal(v.yeas, 1);
  assert.equal(v.notVoting, 1);
  assert.ok(hasVoteShape(v));
});

test("senate vote", () => {
  const v = parseSenateVoteXml(SENATE);
  assert.equal(v.rollNumber, 5);
  assert.equal(v.votedAt, "2025-01-09");
  assert.equal(v.bill, "S. 5");
  assert.equal(v.yeas, 84);
  assert.equal(v.notVoting, 6);
  assert.equal(v.positions[0]!.memberKey, "S428");
  assert.equal(v.positions[0]!.party, "D");
  assert.equal(v.positions[0]!.state, "MD");
  assert.equal(v.positions[1]!.position, "not_voting");
  assert.ok(hasVoteShape(v));
});

test("unknown shape", () => {
  assert.equal(hasVoteShape(parseHouseVoteXml("<html>x</html>")), false);
  assert.equal(hasVoteShape(parseSenateVoteXml("<html>x</html>")), false);
});

test("withCounts fills from positions", () => {
  const v = withCounts(parseHouseVoteXml(HOUSE.replace(/<vote-totals>.*<\/vote-totals>/s, "")));
  assert.equal(v.yeas, 1);
  assert.equal(v.nays, 1);
  assert.equal(v.notVoting, 1);
});

test("menu and urls", () => {
  const menu = `<vote_summary><votes><vote><vote_number>00003</vote_number><vote_tally><yeas>1</yeas></vote_tally></vote><vote><vote_number>00001</vote_number></vote></votes></vote_summary>`;
  assert.deepEqual(parseSenateMenu(menu), [1, 3]);
  assert.equal(houseVoteUrl("http://x/", 2025, 7), "http://x/evs/2025/roll007.xml");
  assert.equal(houseVoteUrl("http://x", 2025, 1200), "http://x/evs/2025/roll1200.xml");
  assert.equal(senateMenuUrl("http://x", 119, 2), "http://x/legislative/LIS/roll_call_lists/vote_menu_119_2.xml");
  assert.equal(senateVoteUrl("http://x", 119, 1, 5), "http://x/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00005.xml");
});

test("congressSession", () => {
  assert.deepEqual(congressSession(2025), { congress: 119, session: 1 });
  assert.deepEqual(congressSession(2026), { congress: 119, session: 2 });
  assert.deepEqual(congressSession(2027), { congress: 120, session: 1 });
});
