import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV, FOOT_ABOUT, liveItems, groupFor } from "../web/src/lib/nav";

test("live hrefs are unique and well formed", () => {
  const seen = new Set<string>();
  for (const g of NAV) {
    assert.ok(g.href.startsWith("/") && g.href.endsWith("/"));
    for (const i of liveItems(g)) {
      assert.ok(i.href.startsWith("/") && i.href.endsWith("/"), i.href);
      assert.ok(!seen.has(i.href), `duplicate ${i.href}`);
      seen.add(i.href);
    }
  }
});

test("descriptions are short and carry no dash punctuation", () => {
  for (const g of NAV) for (const i of g.items) {
    assert.ok(i.desc.length > 0 && i.desc.length < 60, `${i.href}: ${i.desc.length}`);
    assert.ok(!/[–—]|\s-\s|--/.test(i.desc), i.href);
    assert.ok(!/[–—]/.test(i.label), i.href);
  }
});

test("items that are not live stay out of liveItems", () => {
  for (const g of NAV) for (const i of liveItems(g)) assert.equal(i.live, true);
  assert.ok(NAV.some((g) => g.items.some((i) => !i.live)));
  assert.ok(liveItems(NAV[0]!).some((i) => i.href === "/congress-votes/"));   // live since the roll call page shipped
});

test("group order and footer links", () => {
  assert.deepEqual(NAV.map((g) => g.key), ["congress", "insiders", "companies", "washington", "markets"]);
  assert.equal(FOOT_ABOUT.length, 14);
  assert.equal(FOOT_ABOUT[0]!.label, "About");
  assert.equal(FOOT_ABOUT.at(-1)!.href, "/llms.txt");
});

test("groupFor on real paths", () => {
  const cases: [string, string | null][] = [
    ["/congress/", "congress"], ["/congress/nancy-pelosi/", "congress"], ["/congress-trades/", "congress"], ["/congress-committees/house-financial-services/", "congress"],
    ["/insiders/", "insiders"], ["/insiders/huang-jen-hsun/", "insiders"], ["/disclosures/", "insiders"],
    ["/stocks/", "companies"], ["/stocks/nvda/", "companies"], ["/companies/nvidia-corp/", "companies"], ["/industries/manufacturing/", "companies"], ["/company-financials/", "companies"],
    ["/washington/", "washington"], ["/lobbying/", "washington"], ["/lobbying-issues/tax/", "washington"], ["/donations/", "washington"], ["/contracts/", "washington"],
    ["/rates/i-bonds/", "markets"], ["/markets/largest-stock-exchanges/", "markets"], ["/outside-spending/", "washington"],
    ["/about/", null], ["/", null], ["/guides/", null],
  ];
  assert.ok(cases.length >= 20);
  for (const [p, k] of cases) assert.equal(groupFor(p)?.key ?? null, k, p);
});
