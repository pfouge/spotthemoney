import { test } from "node:test";
import assert from "node:assert/strict";
import { pack, unpack, type PackableRow } from "../web/src/lib/heatmap-pack.ts";
import { splitInsiders, RECENT_DAYS } from "../web/src/lib/heatmap.ts";

const row0 = (i: number): PackableRow => ({
  t: `T${i % 760}`, n: `Company Number ${i % 760}, Inc.`, p: `Filer ${i % 9000} Lastname`, ps: i % 50 ? `filer-${i % 9000}-lastname` : null,
  r: ["officer", "director", "owner"][i % 3]!, ti: i % 3 ? null : "Chief Financial Officer",
  c: ["S", "P", "A", "M", "F", null][i % 6]!, s: (["sell", "buy", "other"] as const)[i % 3]!, v: 0,
  sh: i % 11 ? i * 3 : null, pr: i % 7 ? 100 + (i % 500) / 4 : null, pl: i % 5 === 0, o: i % 4 ? "self" : i % 8 ? "indirect" : null,
  d: new Date(Date.UTC(2025, 9, 6) + (i % 365) * 86400000).toISOString().slice(0, 10),
  f: i % 97 ? new Date(Date.UTC(2025, 9, 8) + (i % 365) * 86400000).toISOString().slice(0, 10) : null,
  u: i % 101 ? `https://www.sec.gov/Archives/edgar/data/${1000000 + (i % 760)}/00011046592${String(600000 + Math.floor(i / 3)).padStart(7, "0")}/xslF345X05_form4-${Math.floor(i / 3)}.xml` : i % 2 ? null : "https://example.org/other.xml",
});
// most rows are worth shares × price exactly; some carry a corrected or missing value
const row = (i: number): PackableRow => { const r = row0(i); r.v = r.sh != null && r.pr != null && i % 13 ? r.sh * r.pr : i % 2 ? Math.round(i * 1234.567 * 100) / 100 : 0; return r; };

test("unpack(pack(rows)) returns the rows exactly", () => {
  const rows = Array.from({ length: 5000 }, (_, i) => row(i + 1));
  assert.deepEqual(unpack(JSON.parse(JSON.stringify(pack(rows)))), rows);
});
test("empty input", () => { assert.deepEqual(unpack(pack([])), []); });
const head = { kind: "insiders" as const, builtAt: "2026-10-06T11:00:00.000Z", windowDays: 365, caps: { T1: "mega", T2: "small" } };
const all = (f: { recent: string; older: string }) => [...unpack(JSON.parse(f.recent)), ...unpack(JSON.parse(f.older))];
const key = (r: PackableRow) => JSON.stringify(r);

test("split: every row lands in exactly one file, recent ones in the recent file", () => {
  const rows = Array.from({ length: 20000 }, (_, i) => row(i + 1));
  const f = splitInsiders(rows as never, head.builtAt, head);
  assert.equal(f.windowDays, 365);
  assert.equal(f.counts.recent + f.counts.older, rows.length);
  assert.deepEqual(all(f).map(key).sort(), rows.map(key).sort());
  const cut = "2026-07-08"; // 90 days before 2026-10-06
  assert.ok(unpack(JSON.parse(f.recent)).every((r) => (r.f ?? r.d) >= cut));
  assert.ok(unpack(JSON.parse(f.older)).every((r) => (r.f ?? r.d) < cut));
  const recent = JSON.parse(f.recent);
  assert.equal(recent.recentDays, RECENT_DAYS); assert.equal(recent.older, "/data/heatmap-insiders-older.json");
});
test("split: an oversized year is cut from the far end until it fits, never the recent file", () => {
  const rows = Array.from({ length: 20000 }, (_, i) => row(i + 1));
  const full = splitInsiders(rows as never, head.builtAt, head);
  const f = splitInsiders(rows as never, head.builtAt, head, Math.floor(full.bytes.older / 2));
  assert.ok(f.windowDays < 365 && f.windowDays > RECENT_DAYS);
  assert.ok(f.bytes.older <= Math.floor(full.bytes.older / 2));
  assert.equal(f.counts.recent, full.counts.recent);
  assert.equal(JSON.parse(f.recent).windowDays, f.windowDays);
});
test("a year of Form 4 rows: both files are far under the 25 MiB asset limit", () => {
  const rows = Array.from({ length: 160000 }, (_, i) => row(i + 1));
  const plain = Buffer.byteLength(JSON.stringify(rows));
  const f = splitInsiders(rows as never, head.builtAt, head);
  const mib = (n: number) => (n / 1048576).toFixed(1);
  console.log(`160,000 rows: ${mib(plain)} MiB as one file of objects; packed and split: recent ${mib(f.bytes.recent)} MiB, older ${mib(f.bytes.older)} MiB`);
  assert.equal(f.windowDays, 365);
  assert.ok(f.bytes.recent < 6 * 1048576 && f.bytes.older < 16 * 1048576);
});
