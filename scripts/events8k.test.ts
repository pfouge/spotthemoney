import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderItems, itemLabel, itemCounts, topItems, sortEvents, eventsInWindow, eventSummary, summarySentence, isAmendment, safeUrl, cleanText, EVENT_CAVEAT, EVENT_ROWS,
  packHub, unpackHub, hubScreen, hubMatches, hubItemOptions, parseHubHash, toHubHash, isHubViewHash, hubViewCsv, eventUrl, eventsLog, emptyEvents,
  DEFAULT_HUB_VIEW, NO_HUB_FILTER, type CompanyEvent, type HubCompany,
} from "../web/src/lib/events8k";

const built = "2026-11-20";
const ev = (accession: string, filed: string, items: string[], over: Partial<CompanyEvent> = {}): CompanyEvent => ({
  accession, cik: "0000000001", form: "8-K", filed, reportDate: filed, items, sourceUrl: `https://www.sec.gov/Archives/edgar/data/1/${accession.replaceAll("-", "")}/doc.htm`, ...over,
});
const co: HubCompany = { name: "Acme Corp", path: "/companies/acme/", ticker: "ACME", cik: "0000000001", division: { name: "Manufacturing", slug: "manufacturing" } };

test("items: order with 9.01 last, drop repeats and junk, label with the SEC heading", () => {
  assert.deepEqual(orderItems(["9.01", "2.02", "2.02", "x", "10.1", "5.02", "1.01"]), ["1.01", "2.02", "5.02", "9.01"]);
  assert.equal(itemLabel("2.02"), "2.02 Results of Operations and Financial Condition");
  assert.equal(itemLabel("9.99"), "9.99");
});
test("events: newest first, ties by accession; window counts back from the build day and never after it", () => {
  const xs = [ev("0000000001-26-000001", "2025-11-19", ["8.01"]), ev("0000000001-26-000002", "2026-11-20", ["2.02"]), ev("0000000001-26-000003", "2026-11-20", ["5.02"]), ev("0000000001-26-000004", "2026-11-21", ["8.01"]), ev("0000000001-26-000005", "2025-11-20", ["8.01"])];
  assert.deepEqual(sortEvents(xs).map((e) => e.accession.slice(-1)), ["4", "3", "2", "5", "1"]);
  // 2025-11-20 is exactly 365 days back: in. 2025-11-19: out. 2026-11-21 is after the build day: out.
  assert.deepEqual(eventsInWindow(xs, built).map((e) => e.accession.slice(-1)), ["3", "2", "5"]);
});
test("summary: counts, amendments and the top items other than 9.01", () => {
  const xs = [ev("a", "2026-11-01", ["2.02", "9.01"]), ev("b", "2026-10-01", ["2.02", "9.01"]), ev("c", "2026-09-01", ["5.02"], { form: "8-K/A" }), ev("d", "2026-08-01", ["8.01", "9.01"])];
  assert.deepEqual(topItems(xs).map((t) => [t.item, t.reports]), [["2.02", 2], ["5.02", 1], ["8.01", 1]]);
  assert.equal(itemCounts(xs)[0]!.item, "9.01");
  const s = eventSummary(xs);
  assert.equal(s.amendments, 1);
  const text = summarySentence("Acme", s);
  assert.match(text, /4 Form 8-K reports in the last 12 months, one of them an amendment/);
  assert.match(text, /2\.02 Results of Operations and Financial Condition \(2 reports\)/);
  assert.ok(!/9\.01 Financial/.test(text));
  assert.ok(!/[—–]/.test(text) && !/[—–]/.test(EVENT_CAVEAT));
});
test("wording: nothing about timing or news", () => {
  for (const bad of ["ahead of", "before the news", "timed", "good news", "bad news"]) assert.ok(!EVENT_CAVEAT.includes(bad));
  assert.equal(EVENT_ROWS, 15);
});
test("urls and text are cleaned", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("https://evil.example/x"), null);
  assert.ok(safeUrl("https://www.sec.gov/Archives/edgar/data/1/x.htm"));
  assert.equal(cleanText("  a‮b \n c "), "a b c");
  assert.equal(isAmendment({ form: "8-K/A" }), true);
});
test("hub: pack and unpack round-trip, only companies with a report in the window, newest first", () => {
  const events = new Map<string, CompanyEvent[]>([["0000000001", sortEvents([ev("0000000001-26-000010", "2026-11-18", ["2.02", "9.01"]), ev("0000000001-26-000011", "2026-11-19", ["5.02"], { form: "8-K/A", sourceUrl: "https://www.sec.gov/other/page.htm" }), ev("0000000001-24-000001", "2024-01-01", ["8.01"])])]]);
  const other: HubCompany = { ...co, name: "Zed", cik: "0000000002", path: "/companies/zed/", division: null };
  const d = packHub(built, [co, other], events);
  assert.equal(d.rows.length, 2);
  assert.equal(d.companies.length, 1);
  const rows = unpackHub(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(rows.map((r) => r.e.accession), ["0000000001-26-000011", "0000000001-26-000010"]);
  assert.equal(rows[0]!.e.form, "8-K/A");
  assert.equal(rows[0]!.e.sourceUrl, "https://www.sec.gov/other/page.htm");
  assert.equal(rows[1]!.e.sourceUrl, "https://www.sec.gov/Archives/edgar/data/1/000000000126000010/doc.htm");
  assert.equal(rows[1]!.c.division?.slug, "manufacturing");
  assert.equal(eventUrl("0000000001", "0000000001-26-000010", "a/b"), null);
});
test("hub: filters and windows", () => {
  const events = new Map([["0000000001", [ev("0000000001-26-000010", "2026-11-18", ["2.02", "9.01"]), ev("0000000001-26-000011", "2026-10-01", ["5.02"], { form: "8-K/A" })]]]);
  const rows = unpackHub(packHub(built, [co], events));
  const run = (f: Partial<typeof NO_HUB_FILTER>) => hubScreen(rows, { ...DEFAULT_HUB_VIEW, f: { ...NO_HUB_FILTER, ...f } }, built).total;
  assert.equal(run({}), 1);               // 30 days
  assert.equal(run({ w: 90 }), 2);
  assert.equal(run({ w: 90, item: "5.02" }), 1);
  assert.equal(run({ w: 90, form: "amendment" }), 1);
  assert.equal(run({ w: 90, form: "report" }), 1);
  assert.equal(run({ w: 90, division: "finance" }), 0);
  assert.equal(run({ w: 90, q: "acm" }), 2);
  assert.equal(run({ w: 90, q: "zzz" }), 0);
  assert.ok(hubMatches(rows[0]!, NO_HUB_FILTER, built));
  assert.deepEqual(hubItemOptions(rows).map((o) => o.item).sort(), ["2.02", "5.02", "9.01"]);
});
test("hub: address round trip and junk", () => {
  const v = parseHubHash("#item=2.02&division=manufacturing&form=amendment&w=90&q=ac&sort=company&dir=desc&page=2&n=100");
  assert.equal(toHubHash(v), "#item=2.02&division=manufacturing&form=amendment&w=90&q=ac&sort=company&dir=desc&page=2&n=100");
  assert.equal(toHubHash(DEFAULT_HUB_VIEW), "");
  const junk = parseHubHash("#item=abc&w=5&form=x&sort=zzz&page=-1&n=7&division=A B");
  assert.deepEqual(junk, DEFAULT_HUB_VIEW);
  assert.equal(isHubViewHash("#heading"), false);
  assert.equal(isHubViewHash("#w=7"), true);
});
test("hub csv: formula guard and column order", () => {
  const events = new Map([["0000000001", [ev("0000000001-26-000010", "2026-11-18", ["2.02", "9.01"])]]]);
  const rows = unpackHub(packHub(built, [{ ...co, name: "=SUM(A1)" }], events));
  const csv = hubViewCsv(rows, DEFAULT_HUB_VIEW, built);
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines[0], "company,cik,ticker,form,filed,event_date,items,item_headings,accession,source_url,page_url");
  assert.ok(lines[1]!.startsWith("'=SUM(A1),"));
  assert.match(lines[1]!, /2\.02; 9\.01,Results of Operations and Financial Condition \| Financial Statements and Exhibits/);
});
test("log line", () => {
  const d = emptyEvents();
  d.byCik.set("0000000001", [ev("a", "2026-11-18", ["2.02", "9.01"])]);
  assert.match(eventsLog(d, built, new Set(["0000000001"])), /1 reports for 1 companies on the site \(0 amendments\), newest 2026-11-18; 1 filed in the last 365 days for 1 companies/);
});
