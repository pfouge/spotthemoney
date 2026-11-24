// Sparkline builders (lib/viz.ts): pure strings, "" below two points, a text label, no axis or fill.
import test from "node:test";
import assert from "node:assert/strict";
import { sparkSvg, sparkBars, sparklineSvg } from "../web/src/lib/viz";

test("sparkSvg returns empty for fewer than two points", () => {
  assert.equal(sparkSvg([]), "");
  assert.equal(sparkSvg([3]), "");
  assert.equal(sparkSvg([NaN, 4]), "");
});

test("sparkSvg draws one line and the last point, with a label", () => {
  const s = sparkSvg([1, 3, 2, 5], { label: "Trades per week" });
  assert.match(s, /^<svg class="vz spark"/);
  assert.match(s, /role="img" aria-label="Trades per week"/);
  assert.equal((s.match(/<path /g) ?? []).length, 1);
  assert.match(s, /class="sp-line"[^>]*stroke-width="1.5"/);
  assert.equal((s.match(/<circle /g) ?? []).length, 1);
  assert.match(s, /class="sp-end"/);
  assert.doesNotMatch(s, /<text|<line|fill="#|style=/);
  assert.match(s, /width="96"/);
});

test("sparkSvg: last point sits at the last x and a flat series is centred", () => {
  const s = sparkSvg([2, 2, 2], { w: 96, h: 24 });
  assert.match(s, /cy="12.0"/);
  assert.match(s, /cx="93.0"/);
});

test("sparkSvg stays inside its box", () => {
  const s = sparkSvg([-5, 10, 0, 7, 3], { w: 100, h: 30 });
  for (const m of s.matchAll(/[ML]([\d.]+),([\d.]+)/g)) {
    assert.ok(+m[1]! >= 0 && +m[1]! <= 100 && +m[2]! >= 0 && +m[2]! <= 30, m[0]);
  }
});

test("sparkBars returns empty for fewer than two points", () => {
  assert.equal(sparkBars([]), "");
  assert.equal(sparkBars([4]), "");
  assert.equal(sparkBars([{ up: 1, down: 0 }]), "");
});

test("sparkBars: plain counts are muted bars, one per period", () => {
  const s = sparkBars([0, 2, 5, 1], { label: "Filings per month" });
  assert.match(s, /aria-label="Filings per month"/);
  assert.equal((s.match(/class="sp-bar"/g) ?? []).length, 4); // the zero period is a hairline mark
  assert.doesNotMatch(s, /sp-up|sp-down/);
});

test("sparkBars: buys go up in the positive colour, sells down in the negative one", () => {
  const s = sparkBars([{ up: 3, down: 0 }, { up: 0, down: 2 }, { up: 1, down: 1 }]);
  assert.equal((s.match(/class="sp-up"/g) ?? []).length, 2);
  assert.equal((s.match(/class="sp-down"/g) ?? []).length, 2);
  assert.match(s, /class="sp-base"/);
  const base = Number(/<line [^>]*y1="([\d.]+)"/.exec(s)![1]);
  for (const m of s.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" class="sp-up"/g)) assert.ok(+m[1]! + +m[2]! <= base + 0.11);
  for (const m of s.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" class="sp-down"/g)) assert.ok(+m[1]! >= base - 0.11);
});

test("sparkBars: negative plain numbers hang below the baseline", () => {
  const s = sparkBars([2, -3, 1]);
  assert.match(s, /sp-base/);
  assert.equal((s.match(/class="sp-bar"/g) ?? []).length, 3);
});

test("the home tiles' sparklineSvg is the same builder", () => {
  assert.equal(sparklineSvg([1, 2, 3], "x"), sparkSvg([1, 2, 3], { w: 200, h: 36, label: "x" }));
  assert.equal(sparklineSvg([1], "x"), "");
});
