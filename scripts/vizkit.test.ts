// The summary-first chart builders (lib/viz.ts): monthBarsSvg and stackBarSvg. Run: npx tsx --test scripts/vizkit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { monthBarsSvg, stackBarSvg, calendarSvg, flowSvg, PHONE_W } from "../web/src/lib/viz";

const months = Array.from({ length: 12 }, (_, i) => ({ label: `M${i + 1}`, up: (i % 4) * 1000, down: ((i + 2) % 5) * 500 }));

test("monthBarsSvg: bought above, sold below, one baseline, last month labelled, tips on bars", () => {
  const s = monthBarsSvg(months);
  assert.match(s, /^<svg class="vz /);
  assert.equal((s.match(/class="v-axis"/g) ?? []).length, 1, "baseline only");
  assert.ok(!s.includes("v-plot") && !s.includes("v-grid"), "no frame, no gridlines");
  const buys = (s.match(/class="v-buy"/g) ?? []).length, sells = (s.match(/class="v-sell"/g) ?? []).length;
  assert.equal(buys, months.filter((m) => m.up > 0).length);
  assert.equal(sells, months.filter((m) => m.down > 0).length);
  assert.ok(s.includes(">M12<") && s.includes(">M1<"), "first and last month named");
  assert.ok(s.includes('data-tip="M12|'), "hover text on the last month");
  assert.ok(s.includes(`viewBox="0 0 ${PHONE_W} `));
});

test("monthBarsSvg: scale is shared, so the biggest bar is the same height up and down", () => {
  const s = monthBarsSvg([{ label: "a", up: 100, down: 0 }, { label: "b", up: 0, down: 100 }]);
  const hs = [...s.matchAll(/<rect [^>]*height="([\d.]+)"[^>]*class="v-(buy|sell)"/g)].map((m) => m[1]);
  assert.equal(hs.length, 2);
  assert.equal(hs[0], hs[1]);
});

test("monthBarsSvg: empty for nothing to draw, honours a formatter", () => {
  assert.equal(monthBarsSvg([]), "");
  assert.equal(monthBarsSvg([{ label: "a", up: 0, down: 0 }, { label: "b", up: 0, down: 0 }]), "");
  assert.equal(monthBarsSvg([{ label: "a", up: NaN, down: 1 }]), "");
  assert.ok(monthBarsSvg(months, { fmt: (n) => `${n} trades` }).includes("trades"));
});

test("stackBarSvg: one bar, parts add to the total width, every part named, never a pie", () => {
  const parts = [{ label: "Alpha", value: 60, cls: "v-c1" }, { label: "Beta", value: 30, cls: "v-c2" }, { label: "Others", value: 10, cls: "v-muted" }];
  const s = stackBarSvg(parts, { fmt: (n) => String(n) });
  assert.equal((s.match(/<rect /g) ?? []).length, 3);
  for (const p of parts) assert.ok(s.includes(p.label), p.label);
  assert.ok(!/<circle|<path|arc/.test(s), "no pie or donut");
  const ws = [...s.matchAll(/<rect [^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(ws[0]! > ws[1]! && ws[1]! > ws[2]!, "widths follow values");
  assert.ok(Math.abs(ws.reduce((a, b) => a + b, 0) + 4 - (PHONE_W - 4)) < 3, "parts fill the bar");
});

test("stackBarSvg: empty when the total is not positive; zero parts are skipped", () => {
  assert.equal(stackBarSvg([]), "");
  assert.equal(stackBarSvg([{ label: "a", value: 0, cls: "v-c1" }]), "");
  assert.equal((stackBarSvg([{ label: "a", value: 5, cls: "v-c1" }, { label: "b", value: 0, cls: "v-c2" }]).match(/<rect /g) ?? []).length, 1);
});

test("width parameters: calendar and weekly flow scale to a phone-width card", () => {
  const days = new Map([["2026-11-01", { buy: 10, sell: 0, n: 1 }], ["2026-10-01", { buy: 0, sell: 5, n: 1 }]]);
  assert.ok(calendarSvg(days, "2026-11-20", PHONE_W).includes(`viewBox="0 0 ${PHONE_W} `));
  assert.ok(calendarSvg(days, "2026-11-20").includes('viewBox="0 0 584 '));
  assert.ok(flowSvg([{ label: "a", buy: 1, sell: 2 }, { label: "b", buy: 3, sell: 0 }], PHONE_W).includes(`viewBox="0 0 ${PHONE_W} `));
});
