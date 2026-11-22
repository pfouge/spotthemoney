import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestCongressVotes } from "./congress_votes.js";
import { houseVoteUrl, senateVoteUrl } from "../lib/votes.js";

test("source is exported and urls use the test-only bases", () => {
  assert.equal(typeof ingestCongressVotes, "function");
  assert.equal(houseVoteUrl("http://127.0.0.1:8831", 2026, 4), "http://127.0.0.1:8831/evs/2026/roll004.xml");
  assert.match(senateVoteUrl("http://127.0.0.1:8831", 119, 2, 3), /vote1192\/vote_119_2_00003\.xml$/);
});
