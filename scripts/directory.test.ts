// Member directory rules (web/src/lib/directory.ts): rows, filters, hash round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { directoryRows, committeeOptions, matches, parseHash, toHash, isDefault, sortName, seatCode, partyKey, daysBetween, NO_FILTER, type DirFilter } from "../web/src/lib/directory";

const TODAY = "2026-11-16";
const txn = (d: string | null) => ({ disclosedAt: d });
const person = (id: number, name: string, role: any, txns: any[] = [], extra: any = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), isCongress: true, roles: [{ kind: "congress", ...role }], txns, ...extra });
const model: any = {
  people: new Map([
    [1, person(1, "Ann B. Zeta", { chamber: "house", state: "tx", district: "21", party: "Republican" }, [txn("2026-11-01"), txn("2026-01-10"), txn("2025-06-01")])],
    [2, person(2, "Carl Alpha Jr.", { chamber: "senate", state: "TX", district: null, party: "D" }, [txn("2026-03-01")])],
    [3, person(3, "Dee Mid", { chamber: "house", state: "AK", district: "0", party: "Independent", validTo: "2026-01-05" })],
    [4, person(4, "Eve Insider", {}, [], { isCongress: false, roles: [{ kind: "insider" }] })],
  ]),
  seats: new Map([
    [1, [{ code: "HSAG", parent: null, chamber: "house", name: "House Committee on Agriculture" }, { code: "HSAG15", parent: "HSAG", chamber: "house", name: "Livestock" }, { code: "HSAP01", parent: "HSAP", chamber: "house", name: "Sub only" }]],
    [2, [{ code: "SSAF", parent: null, chamber: "senate", name: "Senate Committee on Agriculture" }]],
  ]),
};
const path = (p: any) => `/congress/${p.slug}/`;
const rows = directoryRows(model, TODAY, path);
const f = (o: Partial<DirFilter>): DirFilter => ({ ...NO_FILTER, ...o });
const ids = (flt: DirFilter) => rows.filter((r) => matches(r, flt, TODAY)).map((r) => r.id);

test("rows: members only, surname order, counts by disclosure date", () => {
  assert.deepEqual(rows.map((r) => r.id), [2, 3, 1]); // alpha, mid, zeta
  const z = rows.find((r) => r.id === 1)!;
  assert.equal(z.trades, 3); assert.equal(z.trades12m, 2); assert.equal(z.latest, "2026-11-01");
  assert.equal(z.party, "R"); assert.equal(z.state, "TX"); assert.equal(z.seat, "TX-21");
  assert.deepEqual(z.committees, ["HSAG", "HSAP"]); // a subcommittee seat counts for its parent, once
  const m = rows.find((r) => r.id === 3)!;
  assert.equal(m.former, true); assert.equal(m.seat, "AK-AL"); assert.equal(m.latest, null); assert.equal(m.party, "I");
  assert.equal(rows.find((r) => r.id === 2)!.seat, "TX");
});

test("helpers", () => {
  assert.equal(sortName("Carl Alpha Jr."), "alpha carl");
  assert.equal(sortName('Earl L. "Buddy" Carter'), "carter earl l. buddy");
  assert.equal(seatCode("house", null, "3"), "");
  assert.equal(partyKey("Democrat"), "D"); assert.equal(partyKey(null), "");
  assert.equal(daysBetween("2026-11-01", TODAY), 15);
});

test("filters, alone and together", () => {
  assert.deepEqual(ids(NO_FILTER), [2, 3, 1]);
  assert.deepEqual(ids(f({ chamber: "senate" })), [2]);
  assert.deepEqual(ids(f({ party: "R" })), [1]);
  assert.deepEqual(ids(f({ state: "TX" })), [2, 1]);
  assert.deepEqual(ids(f({ state: "TX", chamber: "house" })), [1]);
  assert.deepEqual(ids(f({ committee: "HSAP" })), [1]);
  assert.deepEqual(ids(f({ committee: "SSAF", chamber: "house" })), []);
  assert.deepEqual(ids(f({ activity: "90" })), [1]);
  assert.deepEqual(ids(f({ activity: "365" })), [2, 1]);
  assert.deepEqual(ids(f({ activity: "some" })), [2, 1]);
  assert.deepEqual(ids(f({ activity: "none" })), [3]);
  assert.deepEqual(ids(f({ q: "  ZETA ann " })), [1]);
  assert.deepEqual(ids(f({ q: "nobody" })), []);
});

test("activity window edges: day 90 is in, day 91 is out, a future date is out", () => {
  const k = (latest: string) => ({ name: "x", chamber: "house", party: "D", state: "TX", committees: [], trades: 1, latest });
  assert.equal(matches(k("2026-08-18"), f({ activity: "90" }), TODAY), true);
  assert.equal(matches(k("2026-08-17"), f({ activity: "90" }), TODAY), false);
  assert.equal(matches(k("2026-12-01"), f({ activity: "90" }), TODAY), false);
});

test("committee options: full committees with a listed member, House first", () => {
  const opts = committeeOptions(model, rows);
  assert.deepEqual(opts.map((o) => o.code), ["HSAG", "SSAF"]); // HSAP has no full-committee row to name it
  assert.equal(opts[0].members, 1);
});

test("hash round trip; junk and jump links give no filter", () => {
  const flt = f({ chamber: "senate", party: "D", state: "TX", committee: "SSAF", activity: "365", q: "al pha" });
  assert.deepEqual(parseHash(toHash(flt)), flt);
  assert.equal(toHash(NO_FILTER), "");
  assert.equal(isDefault(parseHash("#about")), true);
  assert.equal(isDefault(parseHash("#chamber=lords&party=X&state=Texas&activity=7&committee=<b>")), true);
  assert.equal(parseHash("#party=d").party, "D");
});
