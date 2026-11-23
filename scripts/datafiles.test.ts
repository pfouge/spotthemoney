import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, catalogTotals, topLabel, WORKING_FILES, OTHER_FILES, CATALOG_VERSION, CATALOG_PATH } from "../web/src/lib/datafiles";

const input = {
  site: "https://example.test", built: "2026-11-19T12:00:00.000Z",
  files: [
    { path: "/downloads/congress-trades.csv", name: "congress-trades.csv", group: "congress", kind: "trades", title: "T", about: "A", rows: 10, bytes: 2000, updated: "2026-11-18", columns: [{ key: "trade_id", about: "id" }] },
    { path: "/downloads/cpi-u.csv", name: "cpi-u.csv", group: "rates", kind: "rates", title: "C", about: "B", rows: 3, bytes: 100, updated: null, columns: [{ key: "month", about: "m" }, { key: "cpi_u", about: "v" }] },
  ],
  member: [{ key: "zed-a", path: "/downloads/congress/zed-a.csv", rows: 4, updated: "2026-11-01" }, { key: "amy-b", path: "/downloads/congress/amy-b.csv", rows: 6, updated: null }],
  stock: [{ key: "nvda", path: "/downloads/stocks/nvda.csv", rows: 9, updated: "2026-11-02" }],
  feeds: [{ id: "congress-trades", path: "/feeds/congress-trades.xml", title: "F", description: "D", limit: 200, items: 7, newest: "2026-11-18" }],
};

test("catalogue: every address is absolute, lists are sorted, totals add up", () => {
  const c = buildCatalog(input);
  assert.equal(c.version, CATALOG_VERSION);
  assert.equal(c.built, input.built);
  assert.equal(c.docs, "https://example.test/developers/");
  assert.equal(c.terms, "https://example.test/terms/#reuse");
  assert.deepEqual(c.csv.files.map((f) => f.url), ["https://example.test/downloads/congress-trades.csv", "https://example.test/downloads/cpi-u.csv"]);
  assert.deepEqual(c.csv.perMember.files.map((f) => f.key), ["amy-b", "zed-a"]);
  assert.equal(c.csv.perMember.count, 2);
  assert.equal(c.csv.perTicker.count, 1);
  assert.match(c.csv.perMember.pattern, /^https:\/\/example\.test\/downloads\/congress\/\{member-page-name\}\.csv$/);
  assert.match(c.csv.perTicker.pattern, /\/downloads\/stocks\/\{ticker\}\.csv$/);
  assert.equal(c.feeds[0]!.url, "https://example.test/feeds/congress-trades.xml");
  assert.deepEqual(catalogTotals(c), { csvFiles: 2, csvRows: 13, csvBytes: 2100, memberFiles: 2, tickerFiles: 1, feeds: 1, feedItems: 7, workingFiles: WORKING_FILES.length });
  assert.equal(c.other.length, OTHER_FILES.length);
  // the input is not reordered in place
  assert.deepEqual(input.member.map((f) => f.key), ["zed-a", "amy-b"]);
});

test("catalogue: working files are never marked stable, and the catalogue does not list itself as one", () => {
  const c = buildCatalog(input);
  assert.ok(c.workingFiles.length >= 5);
  for (const w of c.workingFiles) {
    assert.equal(w.stable, false);
    assert.match(w.path, /^\/data\/[a-z-]+(\/\{[a-z-]+\}-\{[a-z]+\}-\{[a-z]+\})?\.json$/);
    assert.notEqual(w.path, CATALOG_PATH);
    assert.ok(w.about.length > 40);
  }
  assert.equal(new Set(WORKING_FILES.map((w) => w.path)).size, WORKING_FILES.length);
  for (const w of WORKING_FILES) {
    if (w.instead) assert.match(w.instead, /^\/downloads\/[a-z0-9-]+\.csv$/);
    assert.match(w.usedBy, /^\//);
    if (w.top !== "array") { assert.ok(w.top.length > 0, `${w.path} has no layout`); assert.equal(new Set(w.top).size, w.top.length); }
  }
});

test("catalogue: no account, address or price field anywhere, and no advice wording", () => {
  const text = JSON.stringify(buildCatalog(input)) + JSON.stringify(WORKING_FILES);
  assert.doesNotMatch(text, /api[_ -]?key|token|password|email|donor/i);
  assert.doesNotMatch(text, /should (buy|sell)|recommend|bullish|bearish|smart money|score/i);
  assert.doesNotMatch(text, /—/);
});

test("topLabel", () => {
  assert.equal(topLabel("array"), "a list");
  assert.equal(topLabel(["a", "b"]), "an object with the keys a, b");
  assert.equal(topLabel([]), "an object");
});
