import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isQuarterEnd, quarterBefore, pickPeriods, instShown, changeShares, signed, priorCell, filingFolderUrl,
  managerBrowseUrl, cleanName, valueLabel, instSentence, quarterDate, quarterName, emptyInst, instLog,
  INST_MIN_MANAGERS, INST_SHOWN_DAYS, INST_TOP, INST_CAVEAT,
} from "../web/src/lib/inst13f";

test("quarter ends", () => {
  assert.equal(isQuarterEnd("2026-09-30"), true);
  assert.equal(isQuarterEnd("2026-12-31"), true);
  assert.equal(isQuarterEnd("2026-10-31"), false);
  assert.equal(isQuarterEnd("2026-09-29"), false);
  assert.equal(isQuarterEnd("nonsense"), false);
  assert.equal(quarterBefore("2026-03-31"), "2025-12-31");
  assert.equal(quarterBefore("2026-09-30"), "2026-06-30");
  assert.equal(quarterBefore("2026-06-30"), "2026-03-31");
});

test("pickPeriods: newest quarter with enough managers, not in the future", () => {
  const rows = [
    { period: "2026-12-31", managers: 5000, lastFiled: "2027-01-10" }, // after the build day
    { period: "2026-09-30", managers: 1151, lastFiled: "2026-11-14" },
    { period: "2026-06-30", managers: 1010, lastFiled: "2026-08-16" },
  ];
  const r = pickPeriods(rows, "2026-11-22T10:00:00Z");
  assert.equal(r.p1?.period, "2026-09-30");
  assert.equal(r.p0?.period, "2026-06-30");
});

test("pickPeriods: a thin quarter is skipped, a thin prior quarter is none", () => {
  const thin = [
    { period: "2026-09-30", managers: INST_MIN_MANAGERS - 1, lastFiled: "2026-10-05" },
    { period: "2026-06-30", managers: 4000, lastFiled: "2026-08-10" },
  ];
  assert.equal(pickPeriods(thin, "2026-11-22").p1?.period, "2026-06-30");
  assert.equal(pickPeriods(thin, "2026-11-22").p0, null);
  const thinPrior = [
    { period: "2026-09-30", managers: 2000, lastFiled: "2026-11-01" },
    { period: "2026-06-30", managers: 12, lastFiled: "2026-08-10" },
  ];
  assert.equal(pickPeriods(thinPrior, "2026-11-22").p0, null);
  assert.deepEqual(pickPeriods([], "2026-11-22"), { p1: null, p0: null });
  // not a quarter end: ignored
  assert.equal(pickPeriods([{ period: "2026-10-31", managers: 5000, lastFiled: "2026-11-01" }], "2026-11-22").p1, null);
});

test("instShown: within 150 days of the build", () => {
  assert.equal(instShown("2026-09-30", "2026-11-14", "2026-11-22"), true);
  assert.equal(instShown("2026-09-30", "2026-06-25", "2026-11-22"), true); // 150 days exactly
  assert.equal(instShown("2026-09-30", "2026-06-24", "2026-11-22"), false);
  assert.equal(instShown(null, "2026-11-14", "2026-11-22"), false);
  assert.equal(instShown("2026-09-30", null, "2026-11-22"), false);
  assert.equal(INST_SHOWN_DAYS, 150);
});

test("change only when both quarters are on file; no 'new' wording", () => {
  const m = { cik: "1", name: "A", shares: 100, value: 1, prevShares: 80, accession: "a", filed: null };
  assert.equal(changeShares(m, true), 20);
  assert.equal(changeShares(m, false), null);
  assert.equal(changeShares({ ...m, prevShares: null }, true), null);
  assert.equal(priorCell({ ...m, prevShares: null }, "2026-06-30"), "not reported for June 30, 2026");
  assert.equal(priorCell(m, "2026-06-30"), "80");
  assert.equal(priorCell(m, null), "not on file");
  assert.equal(signed(1500), "+1,500");
  assert.equal(signed(-1500), "−1,500");
  assert.equal(signed(0), "0");
  assert.ok(!/\bnew\b/i.test(priorCell({ ...m, prevShares: null }, "2026-06-30")));
});

test("links and labels", () => {
  assert.equal(filingFolderUrl("0000102909", "0000102909-26-001234"), "https://www.sec.gov/Archives/edgar/data/102909/000010290926001234/");
  assert.equal(managerBrowseUrl("0000102909"), "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000102909&type=13F-HR");
  assert.equal(cleanName("  A \u0000 B‮  C "), "A B C");
  assert.equal(cleanName(null), "");
  assert.equal(valueLabel(1.5e12), "$1.5T");
  assert.equal(valueLabel(2.5e9), "$2.5B");
  assert.equal(valueLabel(4.1e6), "$4.1M");
  assert.equal(valueLabel(12345), "$12,345");
  assert.equal(valueLabel(null), "not stated");
  assert.equal(quarterDate("2026-09-30"), "September 30, 2026");
  assert.equal(quarterName("2026-09-30"), "Q3 2026");
  assert.equal(INST_TOP, 25);
});

test("the sentence and the caveat state no percentage and no verdict", () => {
  const t = instSentence("NVIDIA", "2026-09-30", "2026-06-30", { managers: 1150, shares: 1, value: 2e11, options: 2, prevManagers: 1000, listed: 25 });
  assert.match(t, /1,150 institutional managers/);
  assert.match(t, /1,000 reported for June 30, 2026/);
  assert.match(t, /2 managers also report put or call options/);
  for (const s of [t, INST_CAVEAT]) {
    assert.ok(!/%/.test(s), s);
    assert.ok(!/[–—]/.test(s), s);
    assert.ok(!/institutional ownership of|% of shares/i.test(s));
  }
});

test("log lines", () => {
  const e = emptyInst();
  assert.match(instLog(e, "2026-11-22", 10), /not shown/);
});
