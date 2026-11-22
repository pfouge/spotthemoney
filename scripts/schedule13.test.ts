import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, sharesStated, percentStated, percentLabel, belowThreshold, scheduleLabel, sortStatements, holderKey, holdersOf, holderSummary, summarySentence, schedule13Log, emptySchedule13, HOLDER_CAVEAT, HOLDER_ROWS, THRESHOLD_PERCENT, holdingsOf, holdingsSentence, holdingsLog, HOLDINGS_CAVEAT, type Statement } from "../web/src/lib/schedule13";
import { caughtUp, catchingUp, emptyStored, schedule13Sentence } from "../web/src/lib/coverage-stored";

const base: Statement = { accession: "0000000000-26-000001", formType: "SCHEDULE 13G", schedule: "13G", isAmendment: false, filedAt: "2026-11-10", eventDate: "2026-09-30",
  issuerCik: "0000000001", issuerCusip: "000000AA1", securityClass: "Common Stock", filerCik: "0000000101", reporterName: "Fund One LP", reporterCount: 1,
  shares: 1_000_000, percent: 6.5, rules: ["Rule 13d-1(b)"], purpose: null, sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/x-index.htm" };
const st = (over: Partial<Statement>): Statement => ({ ...base, ...over });
const built = "2026-11-20T08:00:00.000Z";

test("schedule 13: figures are shown as stated, zero included, and nothing outside 0 to 100 is a percent", () => {
  assert.equal(sharesStated(0), 0, "a holder can report none left");
  assert.equal(sharesStated(-1), null);
  assert.equal(sharesStated(null), null);
  assert.equal(sharesStated(Number.NaN), null);
  assert.equal(percentStated(0), 0);
  assert.equal(percentStated(100), 100);
  assert.equal(percentStated(100.5), null);
  assert.equal(percentStated(-0.1), null);
  assert.equal(percentLabel(9.32), "9.32%");
  assert.equal(percentLabel(11.5), "11.5%");
  assert.equal(percentLabel(7), "7%");
  assert.equal(percentLabel(0), "0%");
  assert.equal(percentLabel(4.999), "5%", "two decimals at most");
  assert.equal(percentLabel(null), null);
  assert.equal(belowThreshold(st({ percent: 4.99 })), true);
  assert.equal(belowThreshold(st({ percent: 0 })), true);
  assert.equal(belowThreshold(st({ percent: THRESHOLD_PERCENT })), false);
  assert.equal(belowThreshold(st({ percent: null })), false, "no percent is neither above nor below");
  assert.equal(scheduleLabel(st({})), "Schedule 13G");
  assert.equal(scheduleLabel(st({ schedule: "13D", isAmendment: true })), "Schedule 13D, amendment");
  assert.equal(cleanText("  The <b>Seed</b>\n Fund "), "The <b>Seed</b> Fund", "markup is kept as text, never interpreted");
});

test("schedule 13: one row per holder, its newest statement, by filer number", () => {
  const xs = [
    st({ accession: "a-1", filedAt: "2025-10-07", percent: 23.3, shares: 91_382_435 }),
    st({ accession: "a-2", filedAt: "2026-05-06", percent: 14.9, shares: 67_972_524, isAmendment: true, formType: "SCHEDULE 13G/A", reporterName: "FUND ONE, L.P." }),
    st({ accession: "b-1", filedAt: "2026-01-30", filerCik: "0000000202", reporterName: "Index Group", percent: 9.32, shares: 2_000_000 }),
    st({ accession: "b-2", filedAt: "2026-03-26", filerCik: "0000000202", reporterName: "Index Group", percent: 0, shares: 0, isAmendment: true }),
    st({ accession: "c-1", filedAt: "2026-02-01", filerCik: null, reporterName: "No Number Trust", percent: null, shares: 500 }),
    st({ accession: "c-2", filedAt: "2026-02-02", filerCik: null, reporterName: "NO  NUMBER trust", percent: 5.5, shares: 600 }),
    st({ accession: "d-1", filedAt: "2026-11-25", filerCik: "0000000303", reporterName: "Tomorrow LLC", percent: 50 }),
    st({ accession: "e-1", filedAt: "2026-06-01", filerCik: "0000000404", reporterName: "Activist LP", schedule: "13D", formType: "SCHEDULE 13D", percent: 7.1, shares: 900 }),
  ];
  const hs = holdersOf(xs, built);
  assert.deepEqual(hs.map((h) => h.latest.accession), ["a-2", "e-1", "c-2", "b-2"], "largest stated percent first; a statement dated after the build is out");
  assert.deepEqual(hs.map((h) => h.statements), [2, 1, 2, 2]);
  assert.equal(holderKey(xs[4]), holderKey(xs[5]), "with no number a name is matched whatever its capitals and spacing");
  // The older, larger figure never survives a newer statement.
  assert.equal(hs.find((h) => h.latest.filerCik === "0000000202")!.latest.percent, 0);
  const s = holderSummary(hs);
  assert.deepEqual({ holders: s.holders, atOrAbove: s.atOrAbove, below: s.below, noPercent: s.noPercent, on13D: s.on13D, statements: s.statements, newest: s.newest },
    { holders: 4, atOrAbove: 3, below: 1, noPercent: 0, on13D: 1, statements: 7, newest: "2026-06-01" });
  assert.equal(s.atOrAbove + s.below + s.noPercent, s.holders);
  assert.equal(summarySentence("Acme", s), "4 holders have filed an ownership statement (Schedule 13D or 13G) about Acme with the SEC since October 2025. In the newest statement of each, 3 report 5% or more of a class of shares, 1 reports less than 5%.");
  assert.equal(summarySentence("Acme", holderSummary([])), "");
  const one = holderSummary(holdersOf([st({ percent: null })], built));
  assert.equal(summarySentence("Acme", one), "1 holder has filed an ownership statement (Schedule 13D or 13G) about Acme with the SEC since October 2025. In the newest statement of each, 1 states no percentage.");
});

test("schedule 13: the order is the same in every build, and two statements on one day resolve by accession", () => {
  const a = st({ accession: "x-1", filedAt: "2026-03-26", percent: 7 }), b = st({ accession: "x-2", filedAt: "2026-03-26", percent: 0 });
  assert.deepEqual(sortStatements([a, b]).map((x) => x.accession), ["x-2", "x-1"]);
  assert.equal(holdersOf([a, b], built)[0].latest.accession, "x-2");
  assert.equal(holdersOf([b, a], built)[0].latest.accession, "x-2");
  const tie = [st({ accession: "t-1", filerCik: "0000000001", reporterName: "Zed", percent: 6 }), st({ accession: "t-2", filerCik: "0000000002", reporterName: "Abe", percent: 6 })];
  assert.deepEqual(holdersOf(tie, built).map((h) => h.latest.reporterName), ["Abe", "Zed"]);
  assert.deepEqual(holdersOf([...tie].reverse(), built).map((h) => h.latest.reporterName), ["Abe", "Zed"]);
});

test("schedule 13: the wording states a holding, never a trade, a motive or a verdict", () => {
  const texts = [HOLDER_CAVEAT, summarySentence("Acme", holderSummary(holdersOf([st({}), st({ filerCik: "0000000009", percent: 1 })], built)))];
  for (const t of texts) {
    assert.ok(!/\b(bought|sold|buying|selling|dumped|activist|stake-building|bullish|bearish|red flag|warning|signal|should|recommend)\b/i.test(t), t);
    assert.ok(!t.includes("—"), "no em-dash in site copy");
  }
  assert.ok(/not a report of a trade/.test(HOLDER_CAVEAT));
  assert.ok(/not to be added together/.test(HOLDER_CAVEAT));
  assert.ok(/not a full list of shareholders/.test(HOLDER_CAVEAT));
  assert.ok(/buy or sell total/.test(HOLDER_CAVEAT));
  assert.ok(HOLDER_ROWS >= 14, "the busiest company on production has 14 holders");
});

test("schedule 13: the build log line and the coverage sentence follow the one date test", () => {
  const d = emptySchedule13();
  d.lastFiled = "2026-08-13";
  assert.match(schedule13Log(d, built, new Set()), /not shown \(newest filing on file 2026-08-13; the load has not reached the build day 2026-11-20\)/);
  d.shown = true; d.lastFiled = "2026-11-18";
  d.byCik.set("0000000001", sortStatements([st({ accession: "a-1", filedAt: "2026-01-01", percent: 8 }), st({ accession: "a-2", percent: 3, isAmendment: true }), st({ accession: "b-1", filerCik: "0000000202", schedule: "13D", shares: 5_000_000 })]));
  d.byCik.set("0000000002", [st({ accession: "z-1", issuerCik: "0000000002" })]);
  assert.equal(schedule13Log(d, built, new Set(["0000000001"])),
    "large holders (Schedules 13D and 13G): shown; 3 statements for 1 companies on the site (1 amendments), newest 2026-11-10; 2 holders by newest statement, 1 of them under 5%, 1 on Schedule 13D; most holders for one company 2; 0 companies with more than 25; largest stated holding 5000000 shares");
  // Coverage sentence: "not shown" exactly while the load is behind.
  const src = { ...emptyStored(), rows: 7, amendments: 3, issuers: 4, trackedRows: 5, firstFiled: "2025-10-01", kinds: { "13D": 2, "13G": 5 } };
  for (const last of ["2026-11-10", "2026-11-09", "2026-08-12"]) {
    const s = schedule13Sentence({ ...src, lastFiled: last }, built);
    assert.equal(/not shown on any page yet/.test(s), !caughtUp(last, built), last);
    assert.equal(/are shown on the stock and company pages/.test(s), caughtUp(last, built), last);
    assert.equal(caughtUp(last, built), !catchingUp({ ...src, lastFiled: last }, built));
    assert.ok(/not a trade/.test(s) && s.includes("2 on Schedule 13D") && s.includes("5 on Schedule 13G"));
  }
  assert.ok(schedule13Sentence({ ...src, lastFiled: "2026-11-18" }, built).includes("5 statements"));
});

test("schedule 13, the filer's side: one row per company, the filer's newest statement about it", () => {
  const xs = [
    st({ accession: "0000000000-26-000001", issuerCik: "0000000001", filedAt: "2026-02-01", percent: 9 }),
    st({ accession: "0000000000-26-000002", issuerCik: "0000000001", filedAt: "2026-08-01", percent: 3, isAmendment: true }),
    st({ accession: "0000000000-26-000003", issuerCik: "0000000002", filedAt: "2026-05-01", percent: 12.5 }),
    st({ accession: "0000000000-26-000004", issuerCik: "0000000003", filedAt: "2026-05-01", percent: null, shares: 10 }),
    st({ accession: "0000000000-27-000001", issuerCik: "0000000004", filedAt: "2027-01-01" }), // after the build day
  ];
  const hs = holdingsOf(xs, built);
  assert.deepEqual(hs.map((h) => [h.latest.issuerCik, h.latest.accession, h.statements]), [
    ["0000000002", "0000000000-26-000003", 1], ["0000000001", "0000000000-26-000002", 2], ["0000000003", "0000000000-26-000004", 1]]);
  const text = holdingsSentence("Fund One LP", hs);
  assert.equal(text, "Fund One LP is the filer of an ownership statement (Schedule 13D or 13G) about 3 companies this site tracks, filed with the SEC since October 2025. Of the newest statement about each, 1 reports 5% or more of a class of shares, 1 reports less than 5%, 1 states no percentage.");
  assert.equal(holdingsSentence("X", []), "");
  for (const t of [text, HOLDINGS_CAVEAT]) { assert.doesNotMatch(t, /\b(activist|bought|sold|stake grab|bullish|bearish)\b/i); assert.ok(!t.includes("\u2014")); }
  const d = emptySchedule13(); d.shown = true;
  d.byCik.set("0000000001", [xs[0]!, xs[1]!, st({ accession: "0000000000-26-000020", filerCik: "0000000001" })]); // a company about itself: left out
  d.byCik.set("0000000002", [xs[2]!, st({ accession: "0000000000-26-000021", issuerCik: "0000000002", filerCik: "0000000001" })]);
  assert.equal(holdingsLog(d, built, new Set(["0000000101"]), new Set(["0000000001", "0000000002"])), "large holdings by filer: 3 filer and company pairs on 1 insider pages and 1 company pages; most on one page 2");
});
