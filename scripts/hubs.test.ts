import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packPlanned, unpackPlanned, plannedScreen, psMatches, parsePsHash, toPsHash, isPsViewHash, psViewCsv, psSummaryLine, DEFAULT_PS_VIEW, NO_PS_FILTER, type PsIn, type PsView,
} from "../web/src/lib/plannedsales";
import {
  packLarge, unpackLarge, largeScreen, lhMatches, parseLhHash, toLhHash, isLhViewHash, lhViewCsv, lhSummaryLine, DEFAULT_LH_VIEW, NO_LH_FILTER, type LhIn,
} from "../web/src/lib/largeholders";
import { paginate, inWindow, sortRows } from "../web/src/lib/hubscreen";

const BUILT = "2026-11-22";
const co = (n: string, cik: string, slug = "manufacturing") => ({ name: n, path: `/companies/${n.toLowerCase()}/`, ticker: n.slice(0, 3).toUpperCase(), cik, division: { name: "Manufacturing", slug } });
const ps = (o: Partial<PsIn> & { filed: string; acc: string }): PsIn => ({
  filed: o.filed, amend: false, company: co("Acme", "0000000001"), seller: { name: "Pat Smith", path: null, key: "c:1" }, relationship: "Director",
  shares: 1000, value: 500_000, held: false, sale: null, plan: null, accession: o.acc, url: null, ...o,
});

test("window: edge inclusive, never the future", () => {
  assert.equal(inWindow("2026-11-22", BUILT, 30), true);
  assert.equal(inWindow("2026-10-23", BUILT, 30), true);
  assert.equal(inWindow("2026-10-22", BUILT, 30), false);
  assert.equal(inWindow("2026-11-23", BUILT, 30), false);
  assert.equal(inWindow("junk", BUILT, 30), false);
});

test("paginate and sortRows put empty values last in both directions", () => {
  assert.equal(paginate([1, 2, 3, 4, 5], 9, 2).page, 3);
  const rows = [{ v: 2 }, { v: null }, { v: 5 }];
  for (const dir of ["asc", "desc"] as const) assert.equal(sortRows(rows, (r) => r.v, dir, () => 0).at(-1)!.v, null);
});

test("planned sales: pack, unpack, filters, count line adds nothing up", () => {
  const rows = [
    ps({ filed: "2026-11-20", acc: "a1", plan: "2026-05-01", value: 2_000_000 }),
    ps({ filed: "2026-11-18", acc: "a2", amend: true, seller: { name: "Lee Co", path: "/insiders/lee/", key: "c:2" }, held: true, value: null }),
    ps({ filed: "2026-09-01", acc: "a3", company: co("Beta", "0000000002", "services") }),
  ];
  const data = packPlanned(BUILT, rows), all = unpackPlanned(data);
  assert.equal(all.length, 3);
  assert.equal(all[1].s.path, "/insiders/lee/");
  assert.deepEqual(data.divisions.map((d) => d.slug), ["manufacturing", "services"]);
  assert.equal(all[2].c.division?.slug, "services");
  const w30 = plannedScreen(all, DEFAULT_PS_VIEW, BUILT);
  assert.equal(w30.total, 2);                          // opens on 30 days
  assert.equal(plannedScreen(all, { ...DEFAULT_PS_VIEW, f: { ...NO_PS_FILTER, w: 365 } }, BUILT).total, 3);
  const f = (p: Partial<typeof NO_PS_FILTER>) => plannedScreen(all, { ...DEFAULT_PS_VIEW, f: { ...NO_PS_FILTER, w: 365, ...p } }, BUILT).total;
  assert.equal(f({ form: "amendment" }), 1);
  assert.equal(f({ form: "notice" }), 2);
  assert.equal(f({ plan: "yes" }), 1);
  assert.equal(f({ plan: "no" }), 2);
  assert.equal(f({ min: 1_000_000 }), 1);              // a held-back value passes no value filter
  assert.equal(f({ division: "services" }), 1);
  assert.equal(f({ q: "lee" }), 1);
  assert.equal(f({ q: "bet" }), 1);
  assert.match(psSummaryLine(w30), /^2 notices about 1 company from 2 sellers\./);
  assert.ok(!/\$|shares/.test(psSummaryLine(w30)));
  assert.equal(psMatches(all[0], { ...NO_PS_FILTER, w: 7 }, BUILT), true);
});

test("planned sales: hash round trip, junk ignored, jump links are not views", () => {
  const v: PsView = { ...DEFAULT_PS_VIEW, f: { ...NO_PS_FILTER, division: "services", form: "amendment", plan: "yes", min: 1_000_000, w: 90, q: "acme" }, sort: "value", dir: "asc", page: 3, per: 25 };
  const h = toPsHash(v);
  assert.deepEqual(parsePsHash(h), v);
  assert.equal(toPsHash(DEFAULT_PS_VIEW), "");
  assert.equal(isPsViewHash("#about"), false);
  assert.equal(isPsViewHash("#w=7"), true);
  const junk = parsePsHash("#w=5&min=7&form=x&sort=nope&page=-1&n=3&division=Bad%20Slug");
  assert.deepEqual(junk, DEFAULT_PS_VIEW);
});

test("planned sales CSV: a held value is blank and marked", () => {
  const all = unpackPlanned(packPlanned(BUILT, [ps({ filed: "2026-11-20", acc: "z", held: true, value: null })]));
  const csv = psViewCsv(all, DEFAULT_PS_VIEW, BUILT);
  assert.match(csv, /value_not_shown/);
  assert.match(csv, /,true,/);
});

const lh = (o: Partial<LhIn> & { acc: string; filed: string }): LhIn => ({
  company: co("Acme", "0000000001"), holder: "Big Fund LP", path: null, schedule: "13G", amend: false, percent: 7.5, shares: 1_000_000, event: "2026-10-01", accession: o.acc, persons: 1, url: null, ...o,
});
test("large holders: filters, a missing percent passes no percent filter, count line adds nothing", () => {
  const rows = [
    lh({ acc: "b1", filed: "2026-11-20" }),
    lh({ acc: "b2", filed: "2026-11-19", percent: 12, schedule: "13D", holder: "Founder Trust", persons: 3 }),
    lh({ acc: "b3", filed: "2026-06-01", percent: 0, holder: "Exited LLC", company: co("Beta", "0000000002", "services") }),
    lh({ acc: "b4", filed: "2026-11-01", percent: null, shares: null, holder: "No Percent" }),
  ];
  const all = unpackLarge(packLarge(BUILT, rows));
  const n = (p: Partial<typeof NO_LH_FILTER>) => largeScreen(all, { ...DEFAULT_LH_VIEW, f: { ...NO_LH_FILTER, ...p } }, BUILT).total;
  assert.equal(n({}), 4);
  assert.equal(n({ pct: "5" }), 2);
  assert.equal(n({ pct: "10" }), 1);
  assert.equal(n({ pct: "below" }), 1);
  assert.equal(n({ schedule: "13D" }), 1);
  assert.equal(n({ w: 30 }), 3);
  assert.equal(n({ division: "services" }), 1);
  assert.equal(n({ q: "founder" }), 1);
  const first = largeScreen(all, DEFAULT_LH_VIEW, BUILT);
  assert.equal(first.rows[0].accession, "b1");           // opens newest filed first
  assert.match(lhSummaryLine(first), /^4 holders of 2 companies\./);
  assert.ok(!/%|shares/.test(lhSummaryLine(first)));
  assert.equal(lhMatches(all[3], { ...NO_LH_FILTER, pct: "below" }, BUILT), false);
  assert.match(lhViewCsv(all, DEFAULT_LH_VIEW, BUILT), /below_5_percent/);
});
test("large holders: hash round trip", () => {
  const v = { ...DEFAULT_LH_VIEW, f: { ...NO_LH_FILTER, division: "services", schedule: "13D" as const, pct: "10" as const, w: 90, q: "fund" }, sort: "percent" as const, dir: "asc" as const, page: 2, per: 100 };
  assert.deepEqual(parseLhHash(toLhHash(v)), v);
  assert.equal(toLhHash(DEFAULT_LH_VIEW), "");
  assert.equal(isLhViewHash("#faq"), false);
  assert.deepEqual(parseLhHash("#w=7&pct=9&schedule=14d&sort=x"), DEFAULT_LH_VIEW);
});
