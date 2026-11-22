// Offline tests for the exec-pay source helpers. Run: npx tsx --test ingest/src/sources/sec_exec_pay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { framesUrl } from "./sec_exec_pay.js";
import { EXEC_PAY_MEASURES } from "@stm/shared";

test("framesUrl builds the ecd frames address", () => {
  assert.equal(
    framesUrl("https://data.sec.gov", "PeoTotalCompAmt", 2024),
    "https://data.sec.gov/api/xbrl/frames/ecd/PeoTotalCompAmt/USD/CY2024.json",
  );
});

test("the four measures have distinct keys and tags", () => {
  assert.equal(EXEC_PAY_MEASURES.length, 4);
  assert.equal(new Set(EXEC_PAY_MEASURES.map((m) => m.key)).size, 4);
  assert.equal(new Set(EXEC_PAY_MEASURES.map((m) => m.tag)).size, 4);
  assert.deepEqual(EXEC_PAY_MEASURES.map((m) => m.tag).sort(), [
    "NonPeoNeoAvgCompActuallyPaidAmt", "NonPeoNeoAvgTotalCompAmt", "PeoActuallyPaidCompAmt", "PeoTotalCompAmt",
  ]);
});
