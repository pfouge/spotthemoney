// One page per company: which page a company is shown on (web/src/lib/onepage.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignCompanyPages, companyRedirects, companyHasRecords, homeSecurity, pageSecurities, onePageLog } from "../web/src/lib/onepage";
import { companyPath } from "../web/src/lib/flagship-core";

const sec = (id: number, ticker: string, companyId: number | null, type = "equity", rows = 0): any => ({ id, ticker, type, name: null, companyId, txns: Array(rows).fill({}), insiderTxns: [], congressTxns: [] });
const co = (id: number, name: string, slug: string | null, primaryTicker: string | null, securityIds: number[], x: any = {}): any => ({ id, name, cik: String(id), slug, primaryTicker, sector: null, securityIds, insiders: [], txns: [], contracts: [], lobbying: [], underReview: false, ...x });
function model() {
  const securities = new Map<number, any>([
    [1, sec(1, "WMT", 10)], [2, sec(2, "GOOGL", 11, "equity", 5)], [3, sec(3, "GOOG", 11, "equity", 9)], [4, sec(4, "SPY", null, "etf")],
    [5, sec(5, "KKR", 12)], [6, sec(6, "ECHO", 14, "equity", 2)], [7, sec(7, "ECHOW", 14, "option", 50)], [8, sec(8, "WMT", 10, "option")],
  ]);
  const companies = new Map<number, any>([
    [10, co(10, "Walmart Inc.", "walmart-inc", "WMT", [1, 8])],
    [11, co(11, "Alphabet Inc.", "alphabet-inc", "GOOGL", [2, 3])],
    [12, co(12, "KKR & Co. Inc.", "kkr-co-inc", "KKR", [5])],
    [13, co(13, "KKR Real Estate Select Trust Inc.", "kkr-real-estate-select-trust-inc", "KKR", [])],   // borrowed ticker: not its security
    [14, co(14, "EchoStar CORP", "echostar-corp", null, [6, 7])],                                          // no main ticker, owns one
    [15, co(15, "Some Fund", "some-fund", null, [])],
    [16, co(16, "No Page Co", null, "WMT", [])],
  ]);
  return { securities, companies } as any;
}

test("a company with a ticker page of its own is shown there; the rest keep a company page", () => {
  const m = model();
  const stats = assignCompanyPages(m);
  const at = (id: number) => companyPath(m.companies.get(id));
  assert.equal(at(10), "/stocks/wmt/");
  assert.equal(at(11), "/stocks/googl/", "the main ticker, not the class with more rows");
  assert.equal(at(12), "/stocks/kkr/");
  assert.equal(at(13), "/companies/kkr-real-estate-select-trust-inc/", "a ticker another company owns is not its page");
  assert.equal(at(14), "/stocks/echo/", "no main ticker: its own share, not its warrant");
  assert.equal(at(15), "/companies/some-fund/");
  assert.equal(at(16), null, "a company with no page gets none");
  assert.deepEqual(stats, { companies: 6, onTicker: 4, companyOnly: 2, tickers: 7, tickerOnly: 3 });
  assert.match(onePageLog(stats), /^one page per company: 6 companies with a page, 4 shown on their ticker page/);
});

test("no two companies are shown on one ticker page, and running it twice changes nothing", () => {
  const m = model();
  assignCompanyPages(m);
  const first = [...m.companies.values()].map((c: any) => c.stockPath);
  assignCompanyPages(m);
  assert.deepEqual([...m.companies.values()].map((c: any) => c.stockPath), first);
  const used = first.filter(Boolean);
  assert.equal(new Set(used).size, used.length);
});

test("the redirect list: old company address to ticker page, lower case, nothing else", () => {
  const m = model();
  assignCompanyPages(m);
  assert.deepEqual(companyRedirects(m), { "alphabet-inc": "/stocks/googl/", "echostar-corp": "/stocks/echo/", "kkr-co-inc": "/stocks/kkr/", "walmart-inc": "/stocks/wmt/" });
  for (const to of Object.values(companyRedirects(m))) assert.match(to, /^\/stocks\/[a-z0-9._-]+\/$/);
});

test("the page security of a ticker is its equity row; records test", () => {
  const m = model();
  assert.equal(pageSecurities(m).get("wmt")!.id, 1);
  assert.equal(homeSecurity(m.companies.get(15), pageSecurities(m), m.securities), null);
  assert.equal(companyHasRecords(m.companies.get(15)), false);
  assert.equal(companyHasRecords({ ...m.companies.get(15), contracts: [{}] }), true);
});
