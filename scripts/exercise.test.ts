import { test } from "node:test";
import assert from "node:assert/strict";
import { markExerciseSales } from "../web/src/lib/exercise.ts";
import { isSignal } from "../web/src/lib/vizdata.ts";
import { pack, unpack, type PackableRow } from "../web/src/lib/heatmap-pack.ts";

type R = { id: number; filingId: number; source: string; code: string | null; txnDate: string | null; exerciseSale?: boolean };
const r = (id: number, filingId: number, code: string, txnDate: string | null, source = "sec_form4"): R => ({ id, filingId, source, code, txnDate });

test("a sale is an exercise sale only with an exercise in the same filing on the same day", () => {
  const rows = [
    r(1, 10, "M", "2026-11-03"), r(2, 10, "S", "2026-11-03"),   // exercise and sell
    r(3, 10, "S", "2026-11-04"),                                // same filing, another day
    r(4, 11, "S", "2026-11-03"),                                // same day, another filing
    r(5, 12, "X", "2026-11-05"), r(6, 12, "S", "2026-11-05"),   // code X counts too
    r(7, 13, "M", null), r(8, 13, "S", null),                   // no trade date: never marked
    r(9, 14, "M", "2026-11-06"), r(10, 14, "P", "2026-11-06"),  // a purchase is never marked
    r(11, 15, "C", "2026-11-07"), r(12, 15, "S", "2026-11-07"), // a conversion is not an option exercise
    r(13, 16, "M", "2026-11-08", "house_ptr"), r(14, 16, "S", "2026-11-08", "house_ptr"),
  ];
  assert.equal(markExerciseSales(rows), 2);
  assert.deepEqual(rows.filter((x) => x.exerciseSale).map((x) => x.id), [2, 6]);
});

test("isSignal leaves exercise sales out, keeps other open-market sales", () => {
  const base = { source: "sec_form4", side: "sell", code: "S", is10b51: false } as Parameters<typeof isSignal>[0];
  assert.equal(isSignal(base), true);
  assert.equal(isSignal({ ...base, exerciseSale: true }), false);
});

test("the packed heatmap row keeps both flags", () => {
  const row = (pl: boolean, x: boolean): PackableRow => ({ t: "ABC", n: "Abc", p: "Jo", ps: "jo", r: "officer", ti: "CEO", c: "S", s: "sell", v: 1000, sh: 10, pr: 100, pl, x, o: "direct", d: "2026-11-03", f: "2026-11-04", u: null });
  const rows = [row(false, false), row(true, false), row(false, true), row(true, true)];
  const back = unpack(pack(rows));
  assert.deepEqual(back.map((b) => [b.pl, b.x]), [[false, false], [true, false], [false, true], [true, true]]);
});
