import { test } from "node:test";
import assert from "node:assert/strict";
import { eventsSubmissionsUrl } from "./sec_company_events.js";
import { EVENT_ITEMS, EVENTS_FLOOR } from "@stm/shared";

test("eventsSubmissionsUrl uses the 10-digit CIK path", () => {
  assert.equal(eventsSubmissionsUrl("https://data.sec.gov", "0001045810"), "https://data.sec.gov/submissions/CIK0001045810.json");
});

test("item table and floor", () => {
  assert.equal(EVENTS_FLOOR, "2025-10-01");
  assert.equal(Object.keys(EVENT_ITEMS).length, 32);
  assert.ok(EVENT_ITEMS["2.02"]);
  assert.ok(EVENT_ITEMS["9.01"]);
});
