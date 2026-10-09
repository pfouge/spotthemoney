// Offline tests for the stock / company / insider page figures (web/src/lib/entity.ts) and the
// automatic links (web/src/lib/links.ts). Run:  npx tsx --test scripts/entity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeRows, yearRows, insiderRows, memberRows, relatedTickers, colleagues, relatedCompanies, codeLabel } from "../web/src/lib/entity";
import { autolink, flagHref, orgPath, GLOSSARY } from "../web/src/lib/links";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Flagship, Person, Txn, Security, Company } from "../web/src/lib/flagship";

let nid = 1;
const f4 = (personId: number, securityId: number, code: string, side: string, date: string, shares: number, value: number): Txn => ({ id: nid++, filingId: 1, personId, securityId, side, code, isDerivative: false, txnDate: date, disclosedAt: date, amountLow: null, amountHigh: null, shares, price: value / shares, lagDays: 1, is10b51: false, ownerType: null, assetType: "stock", source: "sec_form4", sourceUrl: null, filedAt: date, isPublished: true, value });
const ptr = (personId: number, securityId: number, side: string, date: string, low: number, high: number): Txn => ({ id: nid++, filingId: 2, personId, securityId, side, code: null, isDerivative: null, txnDate: date, disclosedAt: date, amountLow: low, amountHigh: high, shares: null, price: null, lagDays: 20, is10b51: null, ownerType: "self", assetType: "stock", source: "house_ptr", sourceUrl: null, filedAt: date, isPublished: true, value: high });

function build() {
  const companies = new Map<number, Company>([[1, { id: 1, name: "Alpha Corp", cik: "1", slug: "alpha-corp", primaryTicker: "AAA", sector: null, securityIds: [1], insiders: [], txns: [], contracts: [], lobbying: [], underReview: false }],
    [2, { id: 2, name: "Beta Inc.", cik: "2", slug: "beta-inc", primaryTicker: "BBB", sector: null, securityIds: [2], insiders: [], txns: [], contracts: [], lobbying: [], underReview: false }]]);
  const sec = (id: number, ticker: string, companyId: number): Security => ({ id, ticker, type: "equity", name: null, companyId, txns: [], insiderTxns: [], congressTxns: [], underReview: false });
  const securities = new Map([[1, sec(1, "AAA", 1)], [2, sec(2, "BBB", 2)]]);
  const ins = (id: number, name: string, companyId: number, title: string): Person => ({ id, name, slug: name.toLowerCase().replace(/ /g, "-"), bioguideId: null, cik: null, roles: [{ kind: "insider", chamber: null, state: null, district: null, party: null, companyId, officerTitle: title, isDirector: false }], txns: [], filings: [], isCongress: false, isInsider: true, lastFiledAt: null, firstFiledAt: null, underReview: false });
  const mem = (id: number, name: string): Person => ({ id, name, slug: name.toLowerCase().replace(/ /g, "-"), bioguideId: null, cik: null, roles: [{ kind: "congress", chamber: "house", state: "TX", district: "1", party: "Democrat", companyId: null, officerTitle: null, isDirector: null }], txns: [], filings: [], isCongress: true, isInsider: false, lastFiledAt: null, firstFiledAt: null, underReview: false });
  const people = new Map<number, Person>([[1, ins(1, "Ann Able", 1, "CEO")], [2, ins(2, "Bo Baker", 1, "CFO")], [3, mem(3, "Cy Cole")], [4, mem(4, "Di Dunn")]]);
  const txns: Txn[] = [
    f4(1, 1, "P", "buy", "2026-02-01", 100, 1000), f4(1, 1, "S", "sell", "2026-03-01", 50, 600), f4(1, 1, "A", "buy", "2025-06-01", 500, 0), f4(1, 1, "F", "other", "2025-06-02", 20, 250),
    f4(2, 1, "S", "sell", "2026-01-15", 10, 120),
    ptr(3, 1, "buy", "2026-01-10", 1001, 15000), ptr(3, 2, "sell", "2026-01-11", 15001, 50000), ptr(4, 1, "sell", "2026-02-10", 1001, 15000), ptr(4, 2, "buy", "2026-02-11", 1001, 15000), ptr(3, 1, "sell", "2026-03-10", 1001, 15000),
  ];
  for (const t of txns) { const p = people.get(t.personId!)!; p.txns.push(t); const s = securities.get(t.securityId!)!; s.txns.push(t); companies.get(s.companyId!)!.txns.push(t); }
  companies.get(1)!.insiders.push(people.get(1)!, people.get(2)!);
  return { m: { people, securities, companies, txns } as unknown as Flagship, people, securities, companies, txns };
}

test("codeRows and yearRows: only code P is buying; awards and tax rows are counted apart", () => {
  const { people } = build();
  const ann = people.get(1)!;
  assert.deepEqual(codeRows(ann.txns).map((c) => [c.code, c.label, c.rows, c.shares, c.value]), [["A", "Grant or award", 1, 500, 0], ["F", "Shares withheld for tax", 1, 20, 250], ["P", "Open-market purchase", 1, 100, 1000], ["S", "Open-market sale", 1, 50, 600]]);
  assert.deepEqual(yearRows(ann.txns).map((y) => [y.year, y.rows, y.buys, y.sells, y.other, y.bought, y.sold]), [["2026", 2, 1, 1, 0, 1000, 600], ["2025", 2, 0, 0, 2, 0, 0]]);
  assert.equal(codeRows(ann.txns).reduce((n, c) => n + c.rows, 0), ann.txns.length);
  assert.equal(codeLabel("p"), "Open-market purchase");
  assert.equal(codeLabel("Q"), "Code Q");
});

test("insiderRows and memberRows group one ticker's rows by filer", () => {
  const { m, securities } = build();
  const aaa = securities.get(1)!.txns;
  assert.deepEqual(insiderRows(m, aaa).map((r) => [r.person.name, r.role, r.rows, r.buys, r.sells, r.bought, r.sold, r.last]), [["Ann Able", "CEO", 4, 1, 1, 1000, 600, "2026-03-01"], ["Bo Baker", "CFO", 1, 0, 1, 0, 120, "2026-01-15"]]);
  assert.deepEqual(memberRows(m, aaa).map((r) => [r.person.name, r.trades, r.buys, r.sells, r.low, r.high, r.last]), [["Cy Cole", 2, 1, 1, 2002, 30000, "2026-03-10"], ["Di Dunn", 1, 0, 1, 1001, 15000, "2026-02-10"]]);
  assert.equal(insiderRows(m, aaa).reduce((n, r) => n + r.rows, 0) + memberRows(m, aaa).reduce((n, r) => n + r.trades, 0), aaa.length);
});

test("related tickers, related companies and colleagues", () => {
  const { m, securities, companies, people } = build();
  assert.deepEqual(relatedTickers(m, "AAA", securities.get(1)!.txns).map((r) => [r.ticker, r.shared, r.who, r.path]), [["BBB", 2, ["Cy Cole", "Di Dunn"], "/stocks/bbb/"]]);
  assert.deepEqual(relatedTickers(m, "aaa", []).length, 0);
  assert.deepEqual(relatedCompanies(m, companies.get(1)!).map((r) => [r.company.name, r.ticker, r.shared]), [["Beta Inc.", "BBB", 2]]);
  assert.deepEqual(colleagues(m, people.get(1)!).map((c) => [c.person.name, c.role, c.rows]), [["Bo Baker", "CFO", 1]]);
  assert.deepEqual(colleagues(m, people.get(3)!), []);
});

test("orgPath: exact normalised name only, and no link when two companies share a name", () => {
  const { m, companies } = build();
  assert.equal(orgPath(m, "ALPHA CORP"), "/companies/alpha-corp/");
  assert.equal(orgPath(m, "Beta, Inc"), "/companies/beta-inc/");
  assert.equal(orgPath(m, "Alpha Robotics"), null);
  assert.equal(orgPath(m, null), null);
  const twin = { ...companies.get(1)!, id: 3, slug: "alpha-corp-2", name: "ALPHA CORP." };
  const m2 = { ...m, companies: new Map([...companies, [3, twin]]) } as unknown as Flagship;
  assert.equal(orgPath(m2, "Alpha Corp"), null);
  assert.equal(orgPath(m2, "Beta Inc"), "/companies/beta-inc/");
});

test("flagHref points each flag at its guide", () => {
  assert.equal(flagHref("late", "house_ptr"), "/guides/late-congressional-trade-disclosures/#how-counted");
  assert.equal(flagHref("late", "sec_form4"), "/guides/what-is-form-4/#when");
  assert.equal(flagHref("10b5-1 plan", "sec_form4"), "/guides/rule-10b5-1-trading-plans/");
  assert.equal(flagHref("spouse", "senate_ptr"), "/guides/how-to-read-a-congressional-trade-report/#columns");
  assert.equal(flagHref("under review", "sec_form4"), null);
});

test("autolink: first mention only, never itself, never inside links, headings, code or tables", () => {
  const used = new Set<string>();
  const html = '<p>A Form 4 is due fast. Another Form 4 follows.</p><h3>Form 4 again</h3><p>See <a href="/x/">the STOCK Act page</a> and <code>Form 4</code>.</p><table><tr><td>STOCK Act</td></tr></table><p>The STOCK Act applies.</p>';
  const out = autolink(html, { self: "some-guide", used, max: 5 });
  assert.equal((out.match(/data-auto/g) ?? []).length, 2);
  assert.ok(out.startsWith('<p>A <a href="/guides/what-is-form-4/" data-auto>Form 4</a> is due fast. Another Form 4 follows.</p>'));
  assert.ok(out.includes("<h3>Form 4 again</h3>") && out.includes("<code>Form 4</code>") && out.includes("<td>STOCK Act</td>"));
  assert.ok(out.includes('<a href="/x/">the STOCK Act page</a>'));
  assert.ok(out.endsWith('<p>The <a href="/guides/congress-stock-trading-rules/" data-auto>STOCK Act</a> applies.</p>'));
  // second call on the same page: both terms are used up
  assert.equal(autolink("<p>Form 4 and the STOCK Act.</p>", { self: "some-guide", used }), "<p>Form 4 and the STOCK Act.</p>");
  // never to itself; a hand-made link to the guide counts as the link; the budget holds
  assert.equal(autolink("<p>Form 4 rows.</p>", { self: "what-is-form-4", used: new Set() }), "<p>Form 4 rows.</p>");
  assert.equal(autolink('<p>Form 4 rows. See <a href="/guides/what-is-form-4/">this</a>.</p>', { self: "x", used: new Set() }), '<p>Form 4 rows. See <a href="/guides/what-is-form-4/">this</a>.</p>');
  assert.equal((autolink("<p>Form 4, the STOCK Act, I bonds and the yield curve.</p>", { self: "x", used: new Set(), max: 2 }).match(/data-auto/g) ?? []).length, 2);
  // output stays well-formed: as many opening as closing anchors, and no anchor inside an anchor
  const big = autolink("<p>open-market purchases under a 10b5-1 plan, reported late on Form 4 with transaction codes</p>", { self: "x", used: new Set(), max: 9 });
  assert.equal((big.match(/<a /g) ?? []).length, (big.match(/<\/a>/g) ?? []).length);
  assert.ok(!/<a [^>]*>[^<]*<a /.test(big));
});

test("every glossary term points at a guide that exists", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../web/src/lib/guides");
  const slugs = new Set(readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/slug: "([a-z0-9-]+)"/g)].map((m) => m[1])));
  assert.ok(slugs.size >= 20);
  for (const t of GLOSSARY) assert.ok(slugs.has(t.slug), `no guide called ${t.slug}`);
  for (const [flag, src] of [["late", "house_ptr"], ["late", "sec_form4"], ["10b5-1 plan", "sec_form4"], ["derivative", "sec_form4"], ["also in another filing", "sec_form4"], ["spouse", "house_ptr"]] as const) {
    const slug = flagHref(flag, src)!.split("/")[2]!;
    assert.ok(slugs.has(slug), `flag "${flag}" points at a missing guide ${slug}`);
  }
});
