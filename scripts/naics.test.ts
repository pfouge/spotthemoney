// npx tsx --test scripts/naics.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanNaics, naicsTitle, naicsLabel, naicsRows, naicsStats, naicsLog, NAICS_EDITIONS, NAICS_CURRENT } from "../web/src/lib/naics";
import type { ContractRow } from "../web/src/lib/flagship-core";

const row = (o: Partial<ContractRow>): ContractRow => ({ id: 1, recipient: "ACME", agency: "Department of Defense", amount: 100, actionDate: "2026-10-01", naics: null, sourceRef: "X", createdAt: "2026-10-02", subAgency: null, endDate: null, description: null, ...o });
const table = JSON.parse(readFileSync(new URL("../web/src/lib/naics-titles.json", import.meta.url), "utf8")) as Record<string, Record<string, string>>;

test("the table: 1,012 codes in the 2022 edition, older editions hold only codes no newer one has", () => {
  assert.deepEqual(Object.keys(table).sort(), NAICS_EDITIONS.map(String).sort());
  assert.equal(Object.keys(table["2022"]).length, 1012);
  const seen = new Set<string>();
  for (const e of NAICS_EDITIONS) {
    for (const [code, title] of Object.entries(table[String(e)])) {
      assert.match(code, /^\d{6}$/, `${e} ${code}`);
      assert.ok(!seen.has(code), `${code} is in two editions`);
      seen.add(code);
      assert.ok(title.length >= 4 && title.length <= 130 && title === title.trim() && !/\s{2,}/.test(title), `${e} ${code} title "${title}"`);
      assert.ok(/^[\x20-\x7e]+$/.test(title), `${e} ${code} title is plain text`);
      assert.ok(!/[<>]/.test(title), `${e} ${code} title has no markup`);
    }
  }
});

test("titles of codes seen on awards", () => {
  assert.deepEqual(naicsTitle("336411"), { code: "336411", title: "Aircraft Manufacturing", edition: 2022 });
  assert.equal(naicsTitle("541512")?.title, "Computer Systems Design Services");
  assert.equal(naicsTitle("325412")?.title, "Pharmaceutical Preparation Manufacturing");
  assert.equal(naicsTitle("236220")?.title, "Commercial and Institutional Building Construction");
  assert.equal(naicsTitle(541330)?.title, "Engineering Services");
  assert.equal(naicsTitle(" 561210 ")?.title, "Facilities Support Services");
});

test("a retired code takes its title from the edition that last had it, and the label says so", () => {
  assert.deepEqual(naicsTitle("336111"), { code: "336111", title: "Automobile Manufacturing", edition: 2017 });
  assert.equal(naicsLabel("336111"), "Automobile Manufacturing (2017 edition)");
  assert.equal(naicsLabel("511210"), "Software Publishers (2017 edition)");
  assert.equal(naicsTitle("541712")?.edition, 2012);
  assert.equal(naicsTitle("443120")?.edition, 2007);
  assert.equal(naicsLabel("336411"), "Aircraft Manufacturing");
  assert.equal(NAICS_CURRENT, 2022);
});

test("no title for what is not a six-digit code in the table", () => {
  for (const v of [null, undefined, "", "33641", "3364110", "ABCDEF", "999999", "000000", "336411; drop", "33 6411"]) {
    assert.equal(naicsTitle(v as string), null, String(v));
    assert.equal(naicsLabel(v as string), null, String(v));
  }
  assert.equal(cleanNaics("336411"), "336411");
  assert.equal(cleanNaics("33641"), null);
});

test("rows per code: only awards with a code, largest total first, ties by awards then code", () => {
  const rows = [
    row({ naics: "336411", amount: 500 }), row({ naics: "336411", amount: 250 }),
    row({ naics: "541512", amount: 750 }), row({ naics: "541512", amount: null }), row({ naics: "541512", amount: 0 }),
    row({ naics: "336111", amount: 40 }), row({ naics: "999999", amount: 30 }),
    row({ naics: null, amount: 9000 }), row({ naics: "12", amount: 9000 }),
  ];
  const by = naicsRows(rows);
  assert.deepEqual(by.map((r) => [r.code, r.awards, r.total]), [["541512", 3, 750], ["336411", 2, 750], ["336111", 1, 40], ["999999", 1, 30]]);
  assert.equal(by[2].label, "Automobile Manufacturing (2017 edition)");
  assert.equal(by[3].title, null);
  assert.equal(by[3].label, null);
  assert.deepEqual(naicsStats(rows), { awards: 9, withCode: 7, withTitle: 6, codes: 4, codesWithTitle: 3, retiredCodes: 1, awardsRetired: 1 });
  assert.match(naicsLog(rows), /^\[web\] contract industry codes: 9 awards in the window; with a NAICS code 7, with a title 6; 4 codes, 3 with a title, 1 from an older edition \(1 awards\); awards\/value: 541512 3\/750, 336411 2\/750/);
  assert.deepEqual(naicsRows([]), []);
  assert.match(naicsLog([]), /0 awards in the window/);
});
