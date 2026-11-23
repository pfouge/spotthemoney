// Company financials screener: the rules in web/src/lib/finscreen.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packFinScreen, unpackFinScreen, rowsFor, finMatches, finScreen, sortFsRows, fsSummaryLine, parseFinHash, toFinHash, isFsViewHash, isDefaultFsFilter, finScreenCounts, finScreenerHref,
  fsCellText, fsPayText, fsViewCsv, fsViewCsvName, finScreenLog, usd, stepLabel, revMinLabel,
  columnsOf, sortKeysOf, withCols, colsOf, fsRatio, fsRatioText, FS_STORED, FS_COLUMNS, RATIO_VIEW_NOTE,
  recentCutoff, isRecent, RECENT_DAYS, RECENT_OPTION,
  NO_FS_FILTER, DEFAULT_FS_VIEW, FS_CONCEPTS, FS_KEYS, REV_MIN_STEPS, REV_MAX_STEPS, ASSET_MIN_STEPS, type FsCompany, type FsPeriod, type FsConcept,
} from "../web/src/lib/finscreen";

const period = (end: string, v: Partial<Record<FsConcept, number | null>>, held: FsConcept[] = []): FsPeriod => ({
  end, start: null, filed: "2026-02-01", form: "10-K", accession: "0000000001-26-000001",
  v: { revenue: null, net_income: null, eps_diluted: null, assets: null, equity: null, liabilities: null, ...v },
  held: Object.fromEntries(FS_STORED.map((c) => [c.key, held.includes(c.key)])) as Record<FsConcept, boolean>,
});
const MFG = { name: "Manufacturing", slug: "manufacturing" }, SVC = { name: "Services", slug: "services" };
const co = (name: string, x: Partial<FsCompany>): FsCompany => ({ name, path: `/companies/${name.toLowerCase()}/`, ticker: name.slice(0, 3).toUpperCase(), cik: "0000000001", division: null, sic: "", unit: "USD", year: null, quarter: null, ...x });
const companies: FsCompany[] = [
  co("Alpha", { cik: "0000000001", division: MFG, sic: "3674", year: period("2025-12-31", { revenue: 5e10, net_income: 4e9, eps_diluted: 3.2, assets: 9e10, equity: 4e10 }), quarter: period("2026-06-30", { revenue: 1.4e10, net_income: -2e8, eps_diluted: -0.1, assets: 9.5e10, equity: 4e10 }) }),
  co("Beta", { cik: "0000000002", division: SVC, sic: "7372", year: period("2026-06-30", { revenue: 8e8, net_income: -5e7, eps_diluted: -0.4, assets: 2e9, equity: 1e9 }) }),
  co("Gamma", { cik: "0000000003", division: MFG, sic: "3711", unit: "JPY", year: period("2026-03-31", { revenue: 4.5e13, net_income: 4e12, eps_diluted: 300, assets: 9e13, equity: 3e13 }) }),
  co("Delta", { cik: "0000000004", year: period("2025-09-30", { revenue: 2e11, net_income: 1e10, eps_diluted: 790000, assets: 3e11, equity: 1e11 }, ["eps_diluted", "assets"]) }),
  co("Epsilon", { cik: "0000000005", division: SVC, sic: "7370", quarter: period("2026-09-30", { revenue: 3e7, net_income: 1e6 }) }),
  co("alpha two", { cik: "0000000006", division: MFG, year: period("2025-12-31", { net_income: 0, assets: 5e9 }) }),
];
const all = unpackFinScreen(packFinScreen("2026-11-22", companies));
const names = (f: Partial<typeof NO_FS_FILTER>) => rowsFor(all, f.period ?? "year").filter((r) => finMatches(r, { ...NO_FS_FILTER, ...f })).map((r) => r.c.name).sort();

test("packing keeps every figure and drops the held ones", () => {
  const d = packFinScreen("2026-11-22", companies);
  assert.deepEqual(d.divisions, [MFG, SVC]);
  assert.equal(all.length, 6);
  const alpha = all[0]!, delta = all.find((c) => c.name === "Delta")!;
  assert.equal(alpha.year!.v.revenue, 5e10);
  assert.equal(alpha.quarter!.v.net_income, -2e8);
  assert.deepEqual(alpha.division, MFG);
  assert.equal(delta.division, null);
  assert.equal(delta.year!.held.eps_diluted, true);
  assert.equal(delta.year!.v.eps_diluted, null, "a held figure is not in the data file");
  assert.equal(delta.year!.v.assets, null);
  assert.equal(delta.year!.v.revenue, 2e11);
  assert.ok(!JSON.stringify(d).includes("790000"));
  assert.equal(all.find((c) => c.name === "Beta")!.quarter, null);
});

test("a view holds only companies with that period", () => {
  assert.deepEqual(rowsFor(all, "year").map((r) => r.c.name), ["Alpha", "Beta", "Gamma", "Delta", "alpha two"]);
  assert.deepEqual(rowsFor(all, "quarter").map((r) => r.c.name), ["Alpha", "Epsilon"]);
});

test("dollar filters read dollar figures only; the sign of net income reads every currency", () => {
  assert.deepEqual(names({ rmin: REV_MIN_STEPS[1] }), ["Alpha", "Delta"]);          // Gamma is in JPY, Beta is under, alpha two has none
  assert.deepEqual(names({ rmax: REV_MAX_STEPS[1] }), ["Beta"]);
  assert.deepEqual(names({ rmin: REV_MIN_STEPS[0], rmax: REV_MAX_STEPS[1] }), ["Beta"]);
  assert.deepEqual(names({ rmin: REV_MIN_STEPS[3], rmax: REV_MAX_STEPS[0] }), []);
  assert.deepEqual(names({ amin: ASSET_MIN_STEPS[0] }), ["Alpha", "Beta", "alpha two"]); // Delta's assets are held back, Gamma's are in JPY
  assert.deepEqual(names({ ni: "pos" }), ["Alpha", "Delta", "Gamma"]);
  assert.deepEqual(names({ ni: "neg" }), ["Beta"]);                                 // zero is neither
  assert.deepEqual(names({ ni: "neg", period: "quarter" }), ["Alpha"]);
  assert.deepEqual(names({ unit: "JPY" }), ["Gamma"]);
  assert.deepEqual(names({ division: "manufacturing" }), ["Alpha", "Gamma", "alpha two"]);
  assert.deepEqual(names({ division: "manufacturing", unit: "USD", ni: "pos" }), ["Alpha"]);
  assert.deepEqual(names({ q: "alpha" }), ["Alpha", "alpha two"]);
  assert.deepEqual(names({ q: "GAM" }), ["Gamma"]);
  assert.deepEqual(names({ q: "two alpha" }), ["alpha two"]);
  assert.equal(usd(rowsFor(all, "year")[2]!, "revenue"), null);
});

test("sorting: amounts in another currency, held figures and empty cells go last either way", () => {
  const y = rowsFor(all, "year");
  assert.deepEqual(sortFsRows(y, "revenue", "desc").map((r) => r.c.name), ["Delta", "Alpha", "Beta", "alpha two", "Gamma"]);
  assert.deepEqual(sortFsRows(y, "revenue", "asc").map((r) => r.c.name), ["Beta", "Alpha", "Delta", "alpha two", "Gamma"]);
  assert.deepEqual(sortFsRows(y, "assets", "desc").map((r) => r.c.name), ["Alpha", "alpha two", "Beta", "Delta", "Gamma"]);
  assert.deepEqual(sortFsRows(y, "company", "asc").map((r) => r.c.name), ["Alpha", "alpha two", "Beta", "Delta", "Gamma"]);
  assert.deepEqual(sortFsRows(y, "end", "desc").map((r) => r.c.name), ["Beta", "Gamma", "Alpha", "alpha two", "Delta"]);
  assert.deepEqual(sortFsRows(y, "net_income", "asc").map((r) => r.c.name).slice(0, 2), ["Beta", "alpha two"]);
});

test("paging and the count line", () => {
  const many = unpackFinScreen(packFinScreen("2026-11-22", Array.from({ length: 60 }, (_, i) => co(`Co ${String(i).padStart(2, "0")}`, { cik: String(i).padStart(10, "0"), year: period("2025-12-31", { revenue: (i + 1) * 1e9 }) }))));
  const p1 = finScreen(many, DEFAULT_FS_VIEW);
  assert.equal(p1.rows.length, 50); assert.equal(p1.pages, 2); assert.equal(p1.total, 60); assert.equal(p1.rows[0]!.c.name, "Co 59");
  assert.equal(fsSummaryLine(p1, "year"), "All 60 companies with a fiscal year on file. Showing 1 to 50.");
  const p2 = finScreen(many, { ...DEFAULT_FS_VIEW, page: 9 });
  assert.equal(p2.page, 2); assert.equal(p2.from, 51); assert.equal(p2.to, 60);
  const some = finScreen(many, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, rmin: REV_MIN_STEPS[2] }, per: 25 });
  assert.equal(some.total, 51);
  assert.equal(fsSummaryLine(some, "year"), "51 companies of 60 with a fiscal year on file. Showing 1 to 25.");
  assert.equal(fsSummaryLine(finScreen(many, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, q: "zzz" } }), "year"), "No company matches these filters.");
  assert.equal(fsSummaryLine(finScreen(many, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, period: "quarter" } }), "quarter"), "No company has a quarter on file yet.");
  assert.match(fsSummaryLine(finScreen(all, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, ni: "neg" } }), "year"), /^1 company of 5 /);
});

test("the address: round trip, defaults left out, junk ignored", () => {
  assert.equal(toFinHash(DEFAULT_FS_VIEW), "");
  const v = { f: { ...NO_FS_FILTER, period: "quarter" as const, division: "manufacturing", unit: "USD", rmin: 1e9, rmax: 1e10, ni: "pos" as const, amin: 1e10, q: "al pha" }, sort: "assets" as const, dir: "asc" as const, page: 3, per: 25, cols: "figures" as const };
  const hash = toFinHash(v);
  assert.deepEqual(parseFinHash(hash), v);
  assert.ok(new URLSearchParams(hash.slice(1)).has("division"));
  for (const k of new URLSearchParams(hash.slice(1)).keys()) assert.ok(FS_KEYS.includes(k), k);
  assert.deepEqual(parseFinHash("#period=decade&division=<script>&unit=dollars&rmin=7&rmax=abc&ni=maybe&amin=-1&sort=quality&dir=up&page=0&per=7"), DEFAULT_FS_VIEW);
  assert.equal(parseFinHash("#sort=company").dir, "asc");
  assert.equal(parseFinHash("#unit=jpy").f.unit, "JPY");
  assert.equal(isFsViewHash("#about"), false);
  assert.equal(isFsViewHash("#x=1"), false);
  assert.equal(isFsViewHash("#division=services"), true);
  assert.equal(isDefaultFsFilter(parseFinHash("#sort=assets&per=25").f), true);
  assert.equal(isDefaultFsFilter(parseFinHash("#period=quarter").f), false);
  assert.equal(finScreenerHref({ division: "services" }), "/company-financials/#division=services");
  assert.equal(finScreenerHref({}), "/company-financials/");
});

test("what a link from an industry page opens on", () => {
  const c = finScreenCounts(all);
  assert.equal(c.total, 5);
  assert.deepEqual([...c.division].sort(), [["manufacturing", 3], ["services", 1]]);
  assert.equal(finScreen(all, parseFinHash("#division=manufacturing")).total, c.division.get("manufacturing"));
});

test("cells, labels and the file of the rows on screen", () => {
  const y = rowsFor(all, "year");
  const alpha = y[0]!, gamma = y[2]!, delta = y[3]!, two = y[4]!;
  assert.equal(fsCellText(alpha, "revenue"), "$50.00B");
  assert.equal(fsCellText(alpha, "eps_diluted"), "$3.20");
  assert.equal(fsCellText(gamma, "revenue"), "JPY 45.00T");
  assert.equal(fsCellText(gamma, "eps_diluted"), "JPY 300.00");
  assert.equal(fsCellText(delta, "eps_diluted"), "not shown");
  assert.equal(fsCellText(two, "revenue"), "");
  assert.equal(fsCellText(two, "net_income"), "$0");
  assert.equal(stepLabel(1e8), "$100 million"); assert.equal(revMinLabel(1e11), "Revenue $100 billion or more");
  const csv = fsViewCsv(all, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, ni: "pos" } });
  const lines = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[0]!.startsWith("company,ticker,cik,sic_code,sic_division,period,period_start,period_end,currency,revenue,net_income,eps_diluted,assets,liabilities,equity,net_margin_pct,liabilities_to_equity,not_shown,"));
  assert.ok(lines[1]!.startsWith("Delta,"), "largest dollar revenue first");
  assert.ok(lines[1]!.includes("eps_diluted; assets"));
  assert.ok(!lines[1]!.includes("790000"));
  assert.ok(lines[3]!.startsWith("Gamma,"));
  assert.ok(lines[2]!.includes("https://www.sec.gov/Archives/edgar/data/1/000000000126000001/0000000001-26-000001-index.htm"));
  assert.equal(fsViewCsvName({ ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, division: "manufacturing", rmin: 1e9 } }, "2026-11-22"), "company-financials-fiscal-year-manufacturing-revmin1000000000-2026-11-22.csv");
  const log = finScreenLog(all);
  assert.match(log, /^financials screener: 6 companies, 5 with a fiscal year, 2 with a quarter; 1 not in dollars;/);
  assert.match(log, /net income above zero 3, below zero 1/);
  assert.match(log, /figures not shown 2 \(fiscal year\), 0 \(quarter\)/);
  for (const bad of ["score", "rating", "best", "worst", "cheap", "undervalued"]) assert.ok(!log.toLowerCase().includes(bad));
});

test("executive pay: packed, filtered by pay=1, sorted with none last, in the file and the address", () => {
  const withPay = companies.map((c) => (c.name === "Alpha" ? { ...c, pay: { peo: 21_400_000, fye: "2025-12-31" } } : c.name === "Gamma" ? { ...c, pay: { peo: 3_000_000, fye: "2026-03-31" } } : c.name === "Beta" ? { ...c, pay: { peo: 9_900_000, fye: "2026-06-30" } } : c));
  const d = packFinScreen("2026-11-22", withPay);
  assert.deepEqual(Object.keys(d), ["built", "divisions", "companies"]);
  const pa = unpackFinScreen(d);
  assert.deepEqual(pa.find((c) => c.name === "Alpha")!.pay, { peo: 21_400_000, fye: "2025-12-31" });
  assert.equal(pa.find((c) => c.name === "Delta")!.pay, null);
  // An older file with no pay items still reads.
  const old = { ...d, companies: d.companies.map((c) => c.slice(0, 9)) } as unknown as typeof d;
  assert.equal(unpackFinScreen(old)[0]!.pay, null);
  const rows = (f: Partial<typeof NO_FS_FILTER>) => finScreen(pa, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, ...f }, sort: "pay", dir: "desc" }).rows.map((r) => r.c.name);
  assert.deepEqual(rows({ pay: 1 }), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(rows({}), ["Alpha", "Beta", "Gamma", "alpha two", "Delta"]);
  const asc = finScreen(pa, { ...DEFAULT_FS_VIEW, sort: "pay", dir: "asc" }).rows.map((r) => r.c.name);
  assert.deepEqual(asc, ["Gamma", "Beta", "Alpha", "alpha two", "Delta"], "no pay sorts last in either direction, ties by name");
  // Pay is dollars whatever the company's reporting currency, so a yen reporter is sorted with the rest.
  assert.equal(fsPayText(pa.find((c) => c.name === "Gamma")!), "$3.0M");
  assert.equal(fsPayText(pa.find((c) => c.name === "Delta")!), "");
  // Address.
  const v = parseFinHash("#pay=1&sort=pay");
  assert.equal(v.f.pay, 1); assert.equal(v.sort, "pay"); assert.equal(v.dir, "desc");
  assert.equal(toFinHash(v), "#pay=1&sort=pay&dir=desc");
  assert.equal(parseFinHash("#pay=2").f.pay, 0);
  assert.ok(isFsViewHash("#pay=1") && !isDefaultFsFilter(v.f) && FS_KEYS.includes("pay"));
  // CSV.
  const csv = fsViewCsv(pa, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, pay: 1 } });
  const lines = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).trim().split("\r\n");
  const head = lines[0]!.split(",");
  assert.ok(head.includes("ceo_pay_total") && head.includes("ceo_pay_fiscal_year_end"));
  assert.equal(lines.length, 4);
  assert.ok(lines[1]!.includes("21400000") && lines[1]!.includes("2025-12-31"));
  assert.ok(fsViewCsvName({ ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, pay: 1 } }, "2026-11-22").includes("pay-on-file"));
});

// ── the ratio columns ────────────────────────────────────────────────────────────────────
const rc: FsCompany[] = [
  co("Able", { cik: "0000000011", year: period("2025-12-31", { revenue: 1000, net_income: 556, liabilities: 400, equity: 1000 }) }),
  co("Baker", { cik: "0000000012", unit: "JPY", year: period("2026-03-31", { revenue: 2e12, net_income: -2.48e11, liabilities: 9e12, equity: 3e12 }) }),
  co("Cargo", { cik: "0000000013", year: period("2025-12-31", { revenue: 0, net_income: -5, liabilities: 50, equity: -10 }) }),
  co("Dune", { cik: "0000000014", year: period("2025-12-31", { revenue: 10, net_income: -400, liabilities: 5000, equity: 10 }) }),
  co("Echo", { cik: "0000000015", year: period("2025-12-31", { revenue: 500, net_income: 50, equity: 200 }) }),
  co("Fox", { cik: "0000000016", year: period("2025-12-31", { revenue: 900, net_income: 90, liabilities: 300, equity: 600 }, ["net_income", "liabilities"]) }),
];
const ra = unpackFinScreen(packFinScreen("2026-11-23", rc));
const rrow = (name: string) => rowsFor(ra, "year").find((r) => r.c.name === name)!;

test("total liabilities travels in the data file, after the mask, and a held one does not", () => {
  const d = packFinScreen("2026-11-23", rc);
  const able = d.companies[0]![7] as unknown[];
  assert.equal(able.length, 12);
  assert.equal(able[11], 400);
  assert.equal(rrow("Able").p.v.liabilities, 400);
  const fox = d.companies[5]![7] as unknown[];
  assert.equal(fox[11], null, "a held figure is not in the data file");
  assert.equal(rrow("Fox").p.held.liabilities, true);
  assert.equal(rrow("Fox").p.held.net_income, true);
  // A file written before the column existed still unpacks: no liabilities, nothing held.
  const old = { ...d, companies: d.companies.map((c) => { const x = [...c] as typeof c; x[7] = (c[7] as unknown[]).slice(0, 11) as never; return x; }) };
  const oa = unpackFinScreen(old);
  assert.equal(oa[0]!.year!.v.liabilities, null);
  assert.equal(oa[0]!.year!.held.liabilities, false);
  assert.equal(oa[0]!.year!.v.revenue, 1000);
});

test("a ratio is worked out from the row's own two amounts, as on a company's page", () => {
  assert.deepEqual(fsRatio(rrow("Able"), "net_margin"), { status: "ok", value: 55.6 });
  assert.equal(fsRatioText(rrow("Able"), "net_margin"), "55.6%");
  assert.equal(fsRatioText(rrow("Able"), "liabilities_to_equity"), "0.40");
  // Another currency: a ratio needs none.
  assert.equal(fsRatioText(rrow("Baker"), "net_margin"), "\u221212.4%");
  assert.equal(fsRatioText(rrow("Baker"), "liabilities_to_equity"), "3.00");
  // Revenue of zero, equity below zero: n/a, no number.
  assert.deepEqual(fsRatio(rrow("Cargo"), "net_margin"), { status: "base", value: null });
  assert.equal(fsRatioText(rrow("Cargo"), "net_margin"), "n/a");
  assert.equal(fsRatioText(rrow("Cargo"), "liabilities_to_equity"), "n/a");
  // Beyond the limits the cell says so in words; the number is kept for sorting and the download.
  assert.equal(fsRatio(rrow("Dune"), "net_margin").value, -4000);
  assert.equal(fsRatioText(rrow("Dune"), "net_margin"), "under \u22121,000%");
  assert.equal(fsRatioText(rrow("Dune"), "liabilities_to_equity"), "over 100");
  // A missing amount, or one held back: an empty cell.
  assert.deepEqual(fsRatio(rrow("Echo"), "liabilities_to_equity"), { status: "none", value: null });
  assert.equal(fsRatioText(rrow("Echo"), "liabilities_to_equity"), "");
  assert.equal(fsRatioText(rrow("Fox"), "net_margin"), "");
  assert.equal(fsRatioText(rrow("Fox"), "liabilities_to_equity"), "");
});

test("the two sets of columns: each ratio stands right after its two amounts", () => {
  assert.deepEqual(columnsOf("figures").map((c) => c.key), ["revenue", "net_income", "eps_diluted", "assets", "equity", "pay", "payyear"]);
  assert.deepEqual(columnsOf("ratios").map((c) => c.key), ["revenue", "net_income", "net_margin", "liabilities", "equity", "liabilities_to_equity"]);
  assert.ok(columnsOf("figures").every((c) => c.kind !== "ratio"), "the opening view holds no worked-out column");
  assert.equal(new Set(FS_COLUMNS.map((c) => c.key)).size, FS_COLUMNS.length);
  assert.deepEqual(sortKeysOf("figures"), ["company", "end", "revenue", "net_income", "eps_diluted", "assets", "equity", "pay"]);
  assert.deepEqual(sortKeysOf("ratios"), ["company", "end", "revenue", "net_income", "net_margin", "liabilities", "equity", "liabilities_to_equity"]);
  assert.ok(/not figures the company filed/.test(RATIO_VIEW_NOTE) && /no verdict/.test(RATIO_VIEW_NOTE));
});

test("sorting by a ratio: every currency takes part, n/a and empty last either way", () => {
  const order = (k: "net_margin" | "liabilities_to_equity", dir: "asc" | "desc") => sortFsRows(rowsFor(ra, "year"), k, dir).map((r) => r.c.name);
  assert.deepEqual(order("net_margin", "desc"), ["Able", "Echo", "Baker", "Dune", "Cargo", "Fox"]);
  assert.deepEqual(order("net_margin", "asc"), ["Dune", "Baker", "Echo", "Able", "Cargo", "Fox"]);
  assert.deepEqual(order("liabilities_to_equity", "desc"), ["Dune", "Baker", "Able", "Cargo", "Echo", "Fox"]);
  assert.deepEqual(order("liabilities_to_equity", "asc"), ["Able", "Baker", "Dune", "Cargo", "Echo", "Fox"]);
  // Total liabilities is an amount: dollars only, like the other amounts.
  assert.deepEqual(sortFsRows(rowsFor(ra, "year"), "liabilities", "desc").map((r) => r.c.name), ["Dune", "Able", "Cargo", "Baker", "Echo", "Fox"]);
});

test("the address keeps the set of columns; a sort the set cannot show is ignored", () => {
  const v = { ...DEFAULT_FS_VIEW, cols: "ratios" as const, sort: "net_margin" as const, dir: "asc" as const };
  assert.equal(toFinHash(v), "#cols=ratios&sort=net_margin&dir=asc");
  assert.deepEqual(parseFinHash(toFinHash(v)), v);
  assert.equal(toFinHash({ ...DEFAULT_FS_VIEW, cols: "ratios" }), "#cols=ratios");
  assert.ok(isFsViewHash("#cols=ratios") && FS_KEYS.includes("cols"));
  assert.equal(parseFinHash("#cols=everything").cols, "figures");
  assert.equal(parseFinHash("#sort=net_margin&dir=desc").sort, "revenue", "a ratio sort without the ratio columns");
  assert.equal(parseFinHash("#cols=ratios&sort=pay&dir=desc").sort, "revenue", "a pay sort with the ratio columns");
  assert.equal(parseFinHash("#cols=ratios&sort=equity&dir=asc").sort, "equity");
  // Switching the set: a sort both sets show is kept, another goes back to the opening order.
  assert.deepEqual(withCols({ ...DEFAULT_FS_VIEW, sort: "equity", dir: "asc", page: 3 }, "ratios"), { ...DEFAULT_FS_VIEW, sort: "equity", dir: "asc", page: 1, cols: "ratios" });
  const back = withCols(v, "figures");
  assert.equal(back.sort, "revenue"); assert.equal(back.dir, "desc"); assert.equal(colsOf(back), "figures");
  assert.equal(colsOf({ ...DEFAULT_FS_VIEW, cols: undefined }), "figures");
  // The set of columns is not a filter.
  assert.ok(isDefaultFsFilter({ ...NO_FS_FILTER }));
});

test("the download carries total liabilities and both ratios, blank where a cell is n/a or empty", () => {
  const lines = fsViewCsv(ra, { ...DEFAULT_FS_VIEW, sort: "company", dir: "asc" }).replace(/^\uFEFF/, "").trim().split("\r\n");
  const head = lines[0]!.split(",");
  const col = (name: string) => head.indexOf(name);
  assert.ok(col("liabilities") > col("assets") && col("net_margin_pct") > col("equity") && col("liabilities_to_equity") > col("net_margin_pct"));
  const cell = (i: number, name: string) => lines[i]!.split(",")[col(name)];
  assert.equal(cell(1, "liabilities"), "400"); assert.equal(cell(1, "net_margin_pct"), "55.6"); assert.equal(cell(1, "liabilities_to_equity"), "0.4");
  assert.equal(cell(3, "net_margin_pct"), ""); assert.equal(cell(3, "liabilities_to_equity"), "");
  assert.equal(cell(4, "net_margin_pct"), "-4000"); assert.equal(cell(4, "liabilities_to_equity"), "500");
  assert.equal(cell(6, "liabilities"), ""); assert.ok(lines[6]!.includes("net_income; liabilities"));
  assert.ok(/ratio columns, fiscal year: total liabilities on file 4; net margin worked out for 4 \(1 beyond 1000%\), n\/a for 1; liabilities to equity worked out for 3 \(1 beyond 100\), n\/a for 1/.test(finScreenLog(ra)), finScreenLog(ra));
});

test("ended in the last 18 months: by the period's last day, counted back from the build day", () => {
  assert.equal(RECENT_DAYS, 548);
  assert.equal(recentCutoff("2026-11-22"), "2025-05-23");
  assert.equal(isRecent("2025-05-23", "2026-11-22"), true, "the cutoff day itself is in");
  assert.equal(isRecent("2025-05-22", "2026-11-22"), false);
  assert.equal(isRecent("2026-11-22", "2026-11-22"), true);
  assert.equal(isRecent("2026-11-23", "2026-11-22"), false, "a period that ends after the build day is not recent");
  assert.equal(isRecent("2026-01-01", ""), false, "no build day, nothing is recent");
  assert.equal(isRecent("2026-01-01", "junk"), false);
  const old: FsCompany[] = [
    ...companies,
    co("Zeta", { cik: "0000000007", division: MFG, year: period("2023-12-31", { revenue: 9e9, net_income: 1e8 }), quarter: period("2025-05-22", { revenue: 2e9 }) }),
    co("Eta", { cik: "0000000008", year: period("2025-05-23", { revenue: 1e9 }), quarter: period("2024-03-31", { revenue: 1e8 }) }),
  ];
  const packed = packFinScreen("2026-11-22", old);
  assert.ok(!JSON.stringify(packed).includes("recent"), "the flag is worked out when the file is read, not stored in it");
  assert.equal(packed.companies[0]![7] && (packed.companies[0]![7] as unknown[]).length, 12, "a packed period keeps its twelve entries");
  const got = unpackFinScreen(packed);
  const pick = (f: Partial<typeof NO_FS_FILTER>) => rowsFor(got, f.period ?? "year").filter((r) => finMatches(r, { ...NO_FS_FILTER, ...f })).map((r) => r.c.name).sort();
  assert.deepEqual(pick({}), ["Alpha", "Beta", "Delta", "Eta", "Gamma", "Zeta", "alpha two"]);
  assert.deepEqual(pick({ recent: 1 }), ["Alpha", "Beta", "Delta", "Eta", "Gamma", "alpha two"], "Zeta's newest fiscal year ended in 2023");
  assert.deepEqual(pick({ period: "quarter" }), ["Alpha", "Epsilon", "Eta", "Zeta"]);
  assert.deepEqual(pick({ period: "quarter", recent: 1 }), ["Alpha", "Epsilon"], "one day before the cutoff is out");
  assert.deepEqual(pick({ recent: 1, division: "manufacturing", ni: "pos" }), ["Alpha", "Gamma"], "it combines with the other filters");
  // The address.
  assert.equal(toFinHash({ ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, recent: 1 } }), "#recent=1");
  assert.equal(parseFinHash("#recent=1").f.recent, 1);
  assert.equal(parseFinHash("#recent=yes").f.recent, 0, "any other value is ignored");
  assert.equal(parseFinHash("#recent=0").f.recent, 0);
  assert.equal(isFsViewHash("#recent=1"), true);
  assert.equal(isDefaultFsFilter({ ...NO_FS_FILTER, recent: 1 }), false);
  assert.equal(isDefaultFsFilter(parseFinHash("#recent=1&cols=ratios").f), false);
  assert.ok(FS_KEYS.includes("recent"));
  // The count line, the download and its name.
  const res = finScreen(got, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, recent: 1 } });
  assert.equal(res.total, 6); assert.equal(res.all, 7);
  assert.match(fsSummaryLine(res, "year"), /^6 companies of 7 with a fiscal year on file/);
  const csv = fsViewCsv(got, { ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, recent: 1 } });
  assert.ok(!csv.includes("Zeta") && csv.includes("Eta"));
  assert.match(fsViewCsvName({ ...DEFAULT_FS_VIEW, f: { ...NO_FS_FILTER, recent: 1 } }, "2026-11-22"), /fiscal-year-ended-last-18-months-2026-11-22\.csv$/);
  assert.match(finScreenLog(got), /ended in the last 548 days: 6 of 7 fiscal years, 2 of 4 quarters;/);
  assert.match(RECENT_OPTION, /18 months/);
  // A file with no build day (or rows built by hand): the filter keeps nothing rather than everything.
  assert.deepEqual(rowsFor(companies, "year").filter((r) => finMatches(r, { ...NO_FS_FILTER, recent: 1 })), []);
});
