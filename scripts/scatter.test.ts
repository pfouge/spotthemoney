// Offline tests for the scatter view of the trade map (web/src/scripts/scatter.ts) and the
// cross-group totals file behind it (web/src/lib/trade-cross.ts). Run:
//   npx tsx --test scripts/scatter.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { scatterMarkup, shareColor, shareGradientCss, lg, decadesUpTo, decadeLabel, DEAD_ZONE, type Pt, type ScatterOpts } from "../web/src/scripts/scatter";
import { crossFile, CROSS_WINDOWS } from "../web/src/lib/trade-cross";
import type { CongressRow, InsiderRow } from "../web/src/lib/heatmap";

const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
test("colour runs red → yellow → green with the share of purchases", () => {
  const [r0, g0] = rgb(shareColor(0, false)), [r5, g5, b5] = rgb(shareColor(0.5, false)), [r1, g1] = rgb(shareColor(1, false));
  assert.ok(r0 > 150 && g0 < 90, "all sales is red");
  assert.ok(r5 > 200 && g5 > 150 && b5 < 60, "even is yellow");
  assert.ok(g1 > r1 + 60, "all purchases is green");
  assert.equal(shareColor(0.5, false), shareColor(NaN, false));
  assert.equal(shareColor(-3, false), shareColor(0, false));
  assert.equal(shareColor(7, true), shareColor(1, true));
  assert.notEqual(shareColor(1, true), shareColor(1, false));
  // monotone: more purchases never looks redder (green minus red channel never falls)
  let last = -999; for (let i = 0; i <= 20; i++) { const [r, g] = rgb(shareColor(i / 20, false)); assert.ok(g - r >= last - 1, `step ${i}`); last = g - r; }
  assert.match(shareGradientCss(false), /^linear-gradient\(90deg, #C0392B, .*#15824B\)$/);
});

test("scales: dead zone, decades and labels", () => {
  assert.equal(lg(0), 0);
  assert.ok(lg(DEAD_ZONE) < lg(1e6) && lg(-1e6) === lg(1e6));
  assert.deepEqual(decadesUpTo(5e6), [1e5, 1e6]);
  assert.deepEqual(decadesUpTo(5e4), [1e4]);
  assert.deepEqual(decadesUpTo(500), []);
  assert.deepEqual([1e4, 1e5, 1e6, 1e9].map(decadeLabel), ["$10K", "$100K", "$1M", "$1B"]);
});

const pts: Pt[] = [
  { ticker: "BIG", name: "Big Co", x: 5e8, y: 2e6, size: 6e8, share: 0.9 },
  { ticker: "MID", name: null, x: 4e6, y: -3e5, size: 5e6, share: 0.5 },
  { ticker: "SELL", name: "Seller & Sons", x: -8e7, y: -1e6, size: 9e7, share: 0.1 },
  { ticker: "ZERO", name: null, x: 0, y: 4e5, size: 4e5, share: 1 },
];
const opts = (half: ScatterOpts["half"], W = 900): ScatterOpts => ({ W, H: 560, half, dark: false, xTitle: "Corporate insiders: net", yTitle: "Congress: selling ←→ buying",
  corners: ["Congress buys, insiders sell", "Both buying", "Both selling", "Insiders buy, Congress sells"], strong: [false, true, true, false] });
const cx = (svg: string, t: string) => Number(new RegExp(`data-t="${t}"[^>]*><circle cx="([\\d.]+)"`).exec(svg)![1]);
const cy = (svg: string, t: string) => Number(new RegExp(`data-t="${t}"[^>]*><circle cx="[\\d.]+" cy="([\\d.]+)"`).exec(svg)![1]);
const rad = (svg: string, t: string) => Number(new RegExp(`data-t="${t}"[^>]*><circle cx="[\\d.]+" cy="[\\d.]+" r="([\\d.]+)"`).exec(svg)![1]);

test("net view: four quadrants, buyers right of sellers, Congress buying above selling, bigger dollars bigger dot", () => {
  const out = scatterMarkup(pts, opts("both"));
  assert.equal(out.dots, 4);
  assert.equal((out.svg.match(/class="hm-dot"/g) ?? []).length, 4);
  assert.ok(cx(out.svg, "SELL") < cx(out.svg, "ZERO") && cx(out.svg, "ZERO") < cx(out.svg, "MID") && cx(out.svg, "MID") < cx(out.svg, "BIG"));
  assert.ok(Math.abs(cx(out.svg, "ZERO") - 450) < 40, "a ticker with nothing across sits on the centre line");
  assert.ok(cy(out.svg, "BIG") < cy(out.svg, "MID") && cy(out.svg, "ZERO") < cy(out.svg, "SELL"));
  assert.ok(rad(out.svg, "BIG") > rad(out.svg, "SELL") && rad(out.svg, "SELL") > rad(out.svg, "MID") && rad(out.svg, "MID") > rad(out.svg, "ZERO"));
  for (const c of ["Both buying", "Both selling", "Congress buys, insiders sell", "Insiders buy, Congress sells"]) assert.ok(out.svg.includes(`>${c}</text>`), c);
  assert.ok(out.svg.includes('href="/stocks/big/"') && out.svg.includes("Seller &amp; Sons"));
  assert.equal(out.labelled, 4);
  for (const t of ["BIG", "MID", "SELL", "ZERO"]) assert.ok(out.svg.includes(`>${t}</text>`), `label ${t}`);
  // every dot is inside the frame
  for (const t of ["BIG", "MID", "SELL", "ZERO"]) { assert.ok(cx(out.svg, t) - rad(out.svg, t) >= 0 && cx(out.svg, t) + rad(out.svg, t) <= 900); assert.ok(cy(out.svg, t) - rad(out.svg, t) >= 0 && cy(out.svg, t) + rad(out.svg, t) <= 560); }
});

test("buying view is the right half only; selling view the left half only", () => {
  const buys = pts.filter((p) => p.x >= 0), sells = pts.filter((p) => p.x <= 0);
  const right = scatterMarkup(buys, { ...opts("right"), corners: ["", "Both buying", "", "Insiders buy, Congress sells"] });
  assert.ok(cx(right.svg, "ZERO") < 120, "zero sits at the left edge of the half");
  assert.ok(cx(right.svg, "BIG") > 700);
  assert.ok(!right.svg.includes("Both selling"));
  const left = scatterMarkup(sells, { ...opts("left"), corners: ["Congress buys, insiders sell", "", "Both selling", ""] });
  assert.ok(cx(left.svg, "ZERO") > 760 && cx(left.svg, "SELL") < 200);
  // the half view uses more of the width for the same dollars than the four-quadrant view
  assert.ok(cx(right.svg, "MID") - cx(right.svg, "ZERO") > cx(scatterMarkup(pts, opts("both")).svg, "MID") - 450);
});

test("labels never overlap a dot, another label or run off the plot; a crowd keeps its biggest names", () => {
  const crowd: Pt[] = Array.from({ length: 300 }, (_, i) => ({ ticker: `T${i}`, name: null, x: 1e6 * (1 + (i % 7) * 0.05), y: 1e5 * (1 + (i % 5) * 0.05), size: 1e6 + i, share: 0.5 }));
  crowd.push({ ticker: "LONE", name: null, x: -5e8, y: -5e7, size: 9e9, share: 0 });
  const out = scatterMarkup(crowd, opts("both"));
  assert.equal(out.dots, 301);
  assert.ok(out.labelled >= 1 && out.labelled < 60, `labelled ${out.labelled}`);
  assert.ok(out.svg.includes(">LONE</text>"));
  const phone = scatterMarkup(pts, opts("both", 360));
  assert.equal(phone.dots, 4);
  assert.ok(phone.svg.includes('viewBox="0 0 360 560"'));
  assert.equal(scatterMarkup([], opts("both")).dots, 0);
});

// ── cross-group totals ──────────────────────────────────────────────────────────────────
test("crossFile: windows by disclosure date; insiders are open-market and non-plan only", () => {
  const built = "2026-10-09T12:00:00.000Z";
  const c = (t: string, s: string, v: number, d: string, f: string | null): CongressRow => ({ t, n: null, p: "A", ps: "a", ch: "house", pa: null, st: null, s: s as CongressRow["s"], v, lo: null, hi: null, o: null, d, f, u: null });
  const i = (t: string, s: string, v: number, f: string, code: string, pl = false): InsiderRow => ({ t, n: null, p: "B", ps: "b", r: "officer", ti: null, c: code, s: s as InsiderRow["s"], v, sh: null, pr: null, pl, o: null, d: f, f, u: null });
  const file = crossFile(
    [c("AAA", "buy", 15000, "2026-08-01", "2026-10-05"), c("AAA", "sell", 50000, "2026-09-01", "2026-09-20"), c("AAA", "other", 99, "2026-10-01", "2026-10-02"), c("OLD", "buy", 1000, "2025-01-01", null)],
    [i("AAA", "buy", 1000.4, "2026-10-08", "P"), i("AAA", "sell", 500, "2026-10-08", "S", true), i("AAA", "buy", 700, "2026-10-08", "A"), i("BBB", "sell", 2000, "2026-07-20", "S")], built);
  assert.deepEqual(file.windows, [...CROSS_WINDOWS]);
  assert.deepEqual(file.congress.AAA, [15000, 0, 15000, 50000, 15000, 50000, 15000, 50000]); // trade in August, disclosed Oct 5: counts in the 7-day window
  assert.equal(file.congress.OLD, undefined);
  assert.deepEqual(file.insiders.AAA, [1000, 0, 1000, 0, 1000, 0, 1000, 0]); // plan sale and the award are left out
  assert.deepEqual(file.insiders.BBB, [0, 0, 0, 0, 0, 2000, 0, 2000]);
});
