import { test } from "node:test";
import assert from "node:assert/strict";
import { citation } from "../web/src/lib/cite.ts";

const page = { title: "Jane Doe Stock Trades — STOCK Act Disclosures", url: "https://spotthemoney.com/congress/jane-doe/", updated: "2026-10-08", accessed: "2026-10-09" };

test("plain", () => {
  assert.equal(citation("plain", page).text, "Jane Doe Stock Trades — STOCK Act Disclosures. Spot the Money, updated October 8, 2026. https://spotthemoney.com/congress/jane-doe/ (accessed October 9, 2026).");
});
test("APA: group author, date, italic title, retrieval date", () => {
  const c = citation("apa", page);
  assert.equal(c.text, "Spot the Money. (2026, October 8). Jane Doe Stock Trades — STOCK Act Disclosures. Retrieved October 9, 2026, from https://spotthemoney.com/congress/jane-doe/");
  assert.ok(c.html.includes("<em>Jane Doe Stock Trades — STOCK Act Disclosures</em>"));
});
test("MLA: quoted title, italic container, day-month-year with abbreviated month", () => {
  const c = citation("mla", { ...page, updated: "2026-09-03", accessed: "2026-05-01" });
  assert.equal(c.text, "“Jane Doe Stock Trades — STOCK Act Disclosures.” Spot the Money, 3 Sept. 2026, https://spotthemoney.com/congress/jane-doe/. Accessed 1 May 2026.");
  assert.ok(c.html.includes("<em>Spot the Money</em>"));
});
test("Chicago", () => {
  assert.equal(citation("chicago", page).text, "Spot the Money. “Jane Doe Stock Trades — STOCK Act Disclosures.” Last modified October 8, 2026. Accessed October 9, 2026. https://spotthemoney.com/congress/jane-doe/.");
});
test("a trade sentence keeps one full stop and names the original filing", () => {
  const t = { title: "Jane Doe sold $1M–$5M of NVDA on Sep 3, 2026; disclosed Sep 20, 2026, 17 days later.", url: "https://spotthemoney.com/congress/jane-doe/#t42", updated: "2026-09-20", accessed: "2026-10-09", original: { label: "House PTR", url: "https://disclosures-clerk.house.gov/x.pdf" } };
  const c = citation("plain", t).text;
  assert.ok(!c.includes(".."), c);
  assert.ok(c.endsWith(" Original filing: House PTR, https://disclosures-clerk.house.gov/x.pdf"), c);
  assert.ok(citation("mla", t).text.startsWith("“Jane Doe sold $1M–$5M of NVDA on Sep 3, 2026; disclosed Sep 20, 2026, 17 days later.” Spot the Money, 20 Sept. 2026,"));
});
test("a question title is not given a second mark", () => {
  const q = { ...page, title: "Can members of Congress trade stocks?" };
  assert.ok(citation("plain", q).text.startsWith("Can members of Congress trade stocks? Spot the Money"));
  assert.ok(citation("chicago", q).text.includes("“Can members of Congress trade stocks?” Last modified"));
});
test("no update date: APA says n.d., the others leave it out", () => {
  const n = { ...page, updated: null };
  assert.ok(citation("apa", n).text.startsWith("Spot the Money. (n.d.). "));
  assert.ok(!citation("chicago", n).text.includes("Last modified"));
  assert.ok(!citation("plain", n).text.includes("updated"));
});
test("HTML output escapes markup in titles", () => {
  assert.ok(citation("apa", { ...page, title: "A <b> & C" }).html.includes("<em>A &lt;b&gt; &amp; C</em>"));
});
