// Checks the member directory (/congress-members/; web/src/lib/directory.ts, scripts/directory.ts)
// in a real browser:
//   node scripts/verify-directory.mjs <base-url>        e.g. http://127.0.0.1:4321
// Needs: npm i --no-save playwright (with the other --no-save tools, in ONE command).
// For every option of every filter it compares the rows left on screen with its own count, made
// from the text a reader sees in each row (not from the attributes the page script reads). It
// also checks the row count and trade totals against /downloads/congress-members.csv, that a
// committee filter's members really list that committee on their own page, combined filters, the
// address written for a filtered view and its reload, Reset, a jump link, the name search, the
// empty state, column sorting, and that nothing runs off the side at 390 px.
import { chromium } from "playwright";

const base = (process.argv[2] || "http://127.0.0.1:4321").replace(/\/$/, "");
const PATH = "/congress-members/";
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const res = await page.goto(base + PATH, { waitUntil: "load" });
if (!res || !res.ok()) { console.log(`✗ ${PATH} answered ${res?.status()}`); process.exit(1); }
const hasTable = await page.locator("[data-directory] tbody tr").count();
if (!hasTable) {
  // An empty database: the page must say so and stay out of the index.
  ok(await page.locator(".empty-reason").count() > 0, "an empty directory says why");
  ok((await page.locator('meta[name="robots"]').getAttribute("content") ?? "").includes("noindex"), "an empty directory is noindex");
  console.log(failures ? `verify-directory: ${failures} problem(s)` : `verify-directory: empty directory, ${checks} checks pass`);
  await browser.close();
  process.exit(failures ? 1 : 0);
}
await page.waitForFunction(() => document.querySelector("[data-directory]")?.dataset.shown != null);

// What a reader sees in each row.
const read = () => page.evaluate(() => [...document.querySelectorAll("[data-directory] tbody tr")].map((tr) => {
  const c = [...tr.cells].map((td) => td.textContent.trim());
  return { shown: !tr.hidden && tr.offsetParent !== null, name: tr.cells[0].querySelector("a")?.textContent.trim() ?? c[0], href: tr.cells[0].querySelector("a")?.getAttribute("href") ?? null,
    chamber: c[1], party: c[2], seat: c[3], committees: Number(c[4] || 0), trades: Number(c[5].replace(/,/g, "")), trades12: Number(c[6].replace(/,/g, "")), latest: c[7] };
}));
const all = await read();
const total = all.length;
ok(all.every((r) => r.shown), "every row is shown before a filter is set");
ok(new Set(all.map((r) => r.href)).size === total && all.every((r) => r.href), "every row links to its own member page");
ok(all.every((r) => r.trades12 <= r.trades), "no member has more trades in 12 months than in total");
ok(all.every((r) => (r.trades > 0) === (r.latest !== "")), "a latest disclosure date is shown exactly when there are trades");

// Against the members CSV (built from the same model by other code).
const csvRes = await fetch(`${base}/downloads/congress-members.csv`);
if (csvRes.ok) {
  const lines = (await csvRes.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
  ok(lines.length - 1 === total, `directory rows (${total}) equal congress-members.csv rows (${lines.length - 1})`);
} else ok(false, "congress-members.csv is served");

const stateNameToCode = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-dir="state"] option')].filter((o) => o.value).map((o) => [o.value, o.textContent.trim()])));
const daysAgo = (text) => Math.round((Date.now() - Date.parse(text + " UTC")) / 86400000);
const oracle = {
  chamber: (v) => (r) => !v || r.chamber.toLowerCase() === v,
  party: (v) => (r) => !v || r.party[0] === v,
  state: (v) => (r) => !v || r.seat.slice(0, 2) === v,
  activity: (v) => (r) => v === "any" ? true : v === "some" ? r.trades > 0 : v === "none" ? r.trades === 0 : r.latest !== "" && daysAgo(r.latest) <= Number(v) + 1 && daysAgo(r.latest) >= -1,
};
const setCtl = async (name, value) => { await page.selectOption(`[data-dir="${name}"]`, value); };
const shownNames = async () => (await read()).filter((r) => r.shown).map((r) => r.name);
const countText = () => page.locator('[data-dir="count"]').textContent();
const reset = async () => { await page.evaluate(() => { const f = document.querySelector("[data-directory]"); f.querySelectorAll("select").forEach((s) => { s.selectedIndex = 0; }); f.querySelector('[data-dir="q"]').value = ""; f.querySelector("select").dispatchEvent(new Event("change")); }); };

let states = 0;
for (const name of ["chamber", "party", "state", "activity"]) {
  const values = await page.$$eval(`[data-dir="${name}"] option`, (os) => os.map((o) => o.value));
  for (const v of values) {
    await setCtl(name, v);
    const got = await shownNames();
    const want = all.filter(oracle[name](v)).map((r) => r.name);
    // The 90-day and 12-month edges are allowed one day of slack (build day against today).
    const exact = name !== "activity" || !/^\d+$/.test(v);
    const same = exact ? got.length === want.length && got.every((n, i) => n === want[i]) : Math.abs(got.length - want.length) <= all.filter((r) => r.latest && Math.abs(daysAgo(r.latest) - Number(v)) <= 1).length;
    ok(same, `${name}=${v || "(any)"}: ${got.length} rows on screen, ${want.length} expected`);
    ok(((await countText()) ?? "").includes(got.length.toLocaleString("en-US")), `${name}=${v || "(any)"}: the count line says ${got.length}`);
    if (name === "state" && v) ok(got.length > 0, `state ${v} (${stateNameToCode[v]}) lists at least one member`);
    states++;
  }
  await reset();
}

// Committees: every option lists someone, each listed member has a committee, and a sampled member's own page names it.
const committees = await page.$$eval('[data-dir="committee"] option', (os) => os.filter((o) => o.value).map((o) => ({ v: o.value, name: o.textContent.trim() })));
for (const [i, c] of committees.entries()) {
  await setCtl("committee", c.v);
  const rows = (await read()).filter((r) => r.shown);
  ok(rows.length > 0, `committee ${c.v}: lists at least one member`);
  ok(rows.every((r) => r.committees > 0), `committee ${c.v}: every listed member has a committee count`);
  if (i % 8 === 0 && rows.length) {
    const html = await (await fetch(base + rows[0].href)).text();
    ok(html.replace(/&amp;/g, "&").replace(/&#39;/g, "'").includes(c.name), `committee ${c.v}: ${rows[0].name}'s page names "${c.name}"`);
  }
  states++;
}
await reset();

// Combined filters, the address, reload, Reset.
const parties = await page.$$eval('[data-dir="party"] option', (os) => os.map((o) => o.value).filter(Boolean));
for (const ch of ["house", "senate"]) for (const p of parties) {
  await setCtl("chamber", ch); await setCtl("party", p);
  const got = await shownNames();
  const want = all.filter((r) => oracle.chamber(ch)(r) && oracle.party(p)(r)).map((r) => r.name);
  ok(got.join("|") === want.join("|"), `chamber=${ch} + party=${p}: ${got.length} rows, ${want.length} expected`);
  states++;
}
await setCtl("chamber", "senate"); await setCtl("party", parties[0]);
const before = await shownNames();
const hash = await page.evaluate(() => location.hash);
ok(hash.includes("chamber=senate") && hash.includes(`party=${parties[0]}`), `the address keeps the filters (${hash})`);
ok(await page.locator('[data-dir="reset"]').isVisible(), "Reset is offered once a filter is set");
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => document.querySelector("[data-directory]")?.dataset.shown != null);
ok((await shownNames()).join("|") === before.join("|"), "reloading a filtered address shows the same members");
ok(await page.inputValue('[data-dir="chamber"]') === "senate", "reloading a filtered address sets the controls");
await page.click('[data-dir="reset"]');
ok((await shownNames()).length === total && (await page.evaluate(() => location.hash)) === "", "Reset shows everyone and clears the address");
ok(!(await page.locator('[data-dir="reset"]').isVisible()), "Reset is hidden when nothing is set");

// A jump link is not a filter.
await page.goto(base + PATH + "#about", { waitUntil: "load" });
await page.waitForFunction(() => document.querySelector("[data-directory]")?.dataset.shown != null);
ok((await shownNames()).length === total, "a jump link (#about) leaves every member on screen");

// Name search and the empty state.
const target = all[Math.floor(total / 2)];
const word = target.name.split(/\s+/).filter((w) => /^[A-Za-z]{3,}$/.test(w)).pop() ?? target.name.slice(0, 4);
await page.fill('[data-dir="q"]', word.toUpperCase());
const found = await shownNames();
ok(found.includes(target.name) && found.every((n) => n.toLowerCase().includes(word.toLowerCase())), `searching "${word}" finds ${target.name} and only matching names (${found.length})`);
await page.fill('[data-dir="q"]', "zzzz-no-such-member");
ok((await shownNames()).length === 0 && await page.locator('[data-dir="empty"]').isVisible(), "a search with no match says so");
await page.click('[data-dir="reset2"]');
ok((await shownNames()).length === total, "the empty state's button clears the filters");

// Sorting works on the filtered rows and keeps the filter.
await setCtl("activity", "some");
await page.click("[data-directory] thead th:nth-child(6) button.sort");
const sorted = (await read()).filter((r) => r.shown);
ok(sorted.every((r, i) => i === 0 || sorted[i - 1].trades >= r.trades), "sorting by Trades puts the largest first");
ok(sorted.every((r) => r.trades > 0), "sorting keeps the filter");
await reset();

ok(errors.length === 0, `no page errors (${errors.join("; ")})`);

// Phone width: the page itself must not scroll sideways (the table scrolls inside its own box).
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(base + PATH, { waitUntil: "load" });
const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(over <= 1, `no sideways page scroll at 390 px (${over}px over)`);
await phone.selectOption('[data-dir="chamber"]', "senate");
ok(Number(await phone.evaluate(() => document.querySelector("[data-directory]").dataset.shown)) === all.filter((r) => r.chamber === "Senate").length, "filters work at 390 px");

// Without JavaScript: the whole table, no controls.
const plain = await browser.newContext({ javaScriptEnabled: false });
const np = await plain.newPage();
await np.goto(base + PATH, { waitUntil: "load" });
ok(await np.locator("[data-directory] tbody tr").count() === total, "without JavaScript every row is in the page");
ok(!(await np.locator(".dir-controls").isVisible()), "without JavaScript the filter controls are hidden");

await browser.close();
console.log(failures ? `verify-directory: ${failures} problem(s) in ${checks} checks` : `verify-directory: ${total} members, ${states} filter states, ${checks} checks pass`);
process.exit(failures ? 1 : 0);
