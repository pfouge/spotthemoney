// Industry pages (web/src/lib/industries.ts): companies by SIC division, counts by disclosure date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndustries, divisionSlug, industryHref, industryLogLine, INDUSTRY_WINDOW_DAYS } from "../web/src/lib/industries";

const TODAY = "2026-11-17";
let nextId = 1;
const f4 = (d: string | null, code: string, side: string) => ({ id: nextId++, source: "sec_form4", disclosedAt: d, code, side });
const ptr = (d: string | null, side = "buy") => ({ id: nextId++, source: "house_ptr", disclosedAt: d, code: null, side });
const co = (id: number, name: string, cik: string | null, ticker: string | null, txns: any[] = [], slug: string | null = name.toLowerCase().replace(/\W+/g, "-")) => ({ id, name, cik, slug, primaryTicker: ticker, txns });
const model: any = {
  companies: new Map([
    [1, co(1, "Chip Co", "1001", "CHIP", [
      f4("2026-11-10", "P", "buy"), f4("2026-11-10T12:00:00Z", "S", "sell"), f4("2026-11-01", "S", "sell"),
      f4("2026-11-12", "A", "other"),            // an award: latest date, no count
      f4("2026-11-02", "F", "sell"),             // tax withholding: not an open-market sale
      f4("2026-11-03", "P", "option"),           // a derivative row keeps code P but not side buy
      f4("2026-11-04", "S", "other"),            // the same sale in another filing
      f4("2025-11-16", "P", "buy"),              // 366 days back: outside
      f4("2025-11-17", "P", "buy"),              // 365 days back: inside
      f4("2026-12-01", "P", "buy"),              // dated after the build day: ignored
      f4(null, "P", "buy"),
      ptr("2026-10-01"), ptr("2026-10-02", "sell"), ptr("2025-01-01"),
    ])],
    [2, co(2, "Drug Co", "0000001002", "DRUG")],
    [3, co(3, "Alpha Chips", "1003", null, [ptr("2026-11-01")])],
    [4, co(4, "Bank Co", "1004", "BANK", [f4("2026-06-01", "S", "sell")])],
    [5, co(5, "Fund With No Code", "1005", "FUND")],
    [6, co(6, "Odd Code Co", "1006", "ODD")],
    [7, co(7, "No Cik Co", null, "NOCK")],
    [8, co(8, "No Page Co", "1008", "NOPG", [], null)],
    [9, co(9, "Blank Wording Co", "1009", "BLNK")],
  ]),
  companySic: new Map([
    ["0000001001", { sic: "3674", description: "Semiconductors & Related Devices" }],
    ["0000001002", { sic: "2834", description: "Pharmaceutical Preparations" }],
    ["0000001003", { sic: "3674", description: "Semiconductors & Related Devices" }],
    ["0000001004", { sic: "6021", description: "National Commercial Banks" }],
    ["0000001006", { sic: "9800", description: "Somewhere Else" }], // major group 98 is in no division
    ["0000001008", { sic: "3674", description: "Semiconductors & Related Devices" }],
    ["0000001009", { sic: "100", description: "  " }],
  ]),
};
const paths = { company: (c: any) => (c.slug ? `/companies/${c.slug}/` : null), ticker: (t: string) => (t === "BANK" ? null : `/stocks/${t.toLowerCase()}/`) };
const x = buildIndustries(model, TODAY, paths);
const div = (code: string) => x.divisions.find((d) => d.code === code)!;

test("divisions in the manual's order, only those with a company; totals", () => {
  assert.deepEqual(x.divisions.map((d) => d.code), ["A", "D", "H"]);
  assert.equal(x.companies, 7);   // a CIK and a page: not No Cik Co, not No Page Co
  assert.equal(x.withCode, 6);
  assert.equal(x.noDivision, 1);  // Odd Code Co
  assert.equal(x.codes, 4);
  assert.equal(div("D").path, "/industries/manufacturing/");
  assert.equal(divisionSlug("Finance, insurance and real estate"), "finance-insurance-and-real-estate");
  assert.equal(new Set(x.divisions.map((d) => d.slug)).size, x.divisions.length);
});

test("companies by code then name; codes counted; a blank wording is null; a 3-digit code is padded", () => {
  const d = div("D");
  assert.deepEqual(d.companies.map((c) => c.name), ["Drug Co", "Alpha Chips", "Chip Co"]);
  assert.deepEqual(d.codes.map((c) => [c.sic, c.companies, c.anchor]), [["2834", 1, "sic-2834"], ["3674", 2, "sic-3674"]]);
  const a = div("A");
  assert.equal(a.companies[0]!.sic, "0100");
  assert.equal(a.companies[0]!.description, null);
  assert.equal(d.companies[2]!.tickerPath, "/stocks/chip/");
  assert.equal(div("H").companies[0]!.tickerPath, null);
  assert.equal(d.companies[1]!.ticker, null);
});

test("counts: code P and code S only, by disclosure date, 365 days back from the build day", () => {
  assert.equal(INDUSTRY_WINDOW_DAYS, 365);
  const chip = div("D").companies.find((c) => c.name === "Chip Co")!;
  assert.equal(chip.buys, 2);     // 2026-11-10 and the one exactly 365 days back
  assert.equal(chip.sells, 2);
  assert.equal(chip.congress, 2); // the 2025-01-01 row is outside
  assert.equal(chip.latest, "2026-11-12"); // newest Form 4 of any code, never a future date or a congressional row
  const d = div("D");
  assert.deepEqual([d.buys, d.sells, d.congress, d.withBuys, d.withSells, d.withCongress], [2, 2, 3, 1, 1, 2]);
  assert.equal(d.latest, "2026-11-12");
  assert.equal(div("H").withSells, 1);
  assert.equal(div("A").latest, null);
});

test("the Industry line's link: the division page at the code; none without a division", () => {
  assert.equal(industryHref("3674"), "/industries/manufacturing/#sic-3674");
  assert.equal(industryHref("100"), "/industries/agriculture-forestry-and-fishing/#sic-0100");
  assert.equal(industryHref("9800"), null);
  assert.equal(industryHref(null), null);
  assert.equal(industryHref("abc"), null);
});

test("log line", () => {
  assert.equal(industryLogLine(x), "industries: 3 divisions, 6 of 7 companies with a code, 4 codes, 1 in no division; companies/codes/purchases/sales/congress rows in 12 months: A 1/1/0/0/0, D 3/2/2/2/3, H 1/1/0/1/0");
});
