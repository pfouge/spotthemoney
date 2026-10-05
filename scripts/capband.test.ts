// Market-cap band rules (web/src/lib/capband.ts). Run: npx tsx --test scripts/capband.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateSize, bandOf } from "../web/src/lib/capband.ts";
const S = (shares: number | null, float: number | null) => ({ shares, sharesAsOf: "2026-06-30", float, floatAsOf: "2025-06-30" });
test("Novanta: trillion-dollar float typo loses to shares x price", () => { const e = estimateSize(S(37.8e6, 3.4965594e12), [130, 128, 131])!; assert.equal(e.basis, "shares"); assert.equal(e.band, "mid"); });
test("NetEase: no float on file -> unsized even with shares and a price", () => { assert.equal(estimateSize(S(3192.1e6, null), [130]), null); assert.equal(estimateSize(S(3192.1e6, 0), [130]), null); });
test("Apple: shares x price", () => { const e = estimateSize(S(14.59e9, 3.2e12), [250])!; assert.equal(e.band, "mega"); assert.equal(e.basis, "shares"); });
test("Alphabet: multi-class, no shares figure -> float", () => { const e = estimateSize(S(null, 1.9e12), [180])!; assert.equal(e.basis, "float"); assert.equal(e.band, "mega"); });
test("no recent price -> float", () => { const e = estimateSize(S(50e6, 900e6), [])!; assert.equal(e.basis, "float"); assert.equal(e.band, "small"); });
test("absurd shares x price falls back to float; absurd float alone -> null", () => { assert.equal(estimateSize(S(26e9, 500e9), [3000])!.basis, "float"); assert.equal(estimateSize(S(null, 7e12), []), null); });
test("median damps a typo price", () => { const e = estimateSize(S(100e6, 5e9), [50, 51, 5000, 49, 52])!; assert.equal(Math.round(e.value / 1e9), 5); });
test("bands", () => { assert.deepEqual([250e9, 50e9, 5e9, 1e9, 1e8].map(bandOf), ["mega", "large", "mid", "small", "micro"]); });
