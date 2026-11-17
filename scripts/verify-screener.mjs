// Checks the Congress trade screener (/congress-trades/; web/src/lib/screener.ts,
// web/src/scripts/screener.ts) in a real browser:
//   node scripts/verify-screener.mjs <base-url>        e.g. http://127.0.0.1:4321
// Needs: npm i --no-save playwright (with the other --no-save tools, in ONE command).
// Its oracle is not the screener's data file. It recounts every filter from the CSV downloads,
// which other code writes (lib/downloads.ts): /downloads/congress-trades.csv for the rows and
// /downloads/congress-committee-assignments.csv for the seats. For every option of every filter
// it compares the number of trades and members on screen with that recount, and for a set of
// combined filters it pages through the whole result and compares the row ids one by one. It also
// checks sorting, paging, rows per page, the address written for a view and its reload, Reset, a
// jump link, the search box, the empty state, that the rows printed without JavaScript are the
// first page with JavaScript, a sample of the links, the wording, and 390 px.
import { chromium } from "playwright";

const base = (process.argv[2] || "http://127.0.0.1:4321").replace(/\/$/, "");
const PATH = "/congress-trades/";
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } };

function parseCsv(text) {
  const out = []; let row = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const head = out.shift() ?? [];
  return out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i].replace(/^'(?=[=+\-@])/, "")])));
}
const csv = async (name) => { const r = await fetch(`${base}/downloads/${name}`); return r.ok ? parseCsv(await r.text()) : null; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const res = await page.goto(base + PATH, { waitUntil: "load" });
if (!res || !res.ok()) { console.log(`✗ ${PATH} answered ${res?.status()}`); process.exit(1); }
if (!(await page.locator("[data-screener]").count())) {
  // An empty database: the page must say so and stay out of the index.
  ok(await page.locator(".empty-reason").count() > 0, "an empty screener says why");
  ok((await page.locator('meta[name="robots"]').getAttribute("content") ?? "").includes("noindex"), "an empty screener is noindex");
  console.log(failures ? `verify-screener: ${failures} problem(s)` : `verify-screener: no congressional trades on record, ${checks} checks pass`);
  await browser.close();
  process.exit(failures ? 1 : 0);
}
const ready = (p = page) => p.waitForFunction(() => document.querySelector("[data-screener]")?.dataset.ready === "1");
await ready();

// ── the oracle: rows from the CSV downloads ──────────────────────────────────────────────
const tradesCsv = await csv("congress-trades.csv");
ok(!!tradesCsv, "congress-trades.csv is served");
const seatsCsv = (await csv("congress-committee-assignments.csv")) ?? [];
const built = await page.evaluate(async (src) => (await (await fetch(src)).json()).built, await page.locator("[data-screener]").getAttribute("data-src"));
ok(/^\d{4}-\d{2}-\d{2}$/.test(built), `the data file states its build day (${built})`);
const partyKey = (p) => (!p ? "" : /^d(em|$)/i.test(p) ? "D" : /^r(ep|$)/i.test(p) ? "R" : "I");
const memberCommittees = new Map();   // member name → full-committee codes (a subcommittee code starts with its parent's four characters)
for (const s of seatsCsv) { const set = memberCommittees.get(s.member) ?? new Set(); set.add(s.committee_code.slice(0, 4)); memberCommittees.set(s.member, set); }
const age = (iso) => Math.round((Date.parse(`${built}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86400000);
const rows = (tradesCsv ?? []).filter((r) => r.under_review !== "true" && r.disclosed_date && r.filer).map((r) => ({
  id: r.trade_id, member: r.filer, key: `${r.filer}|${r.chamber}|${r.state}|${r.district}`, chamber: r.chamber, party: partyKey(r.party), state: (r.state || "").toUpperCase(),
  committees: memberCommittees.get(r.filer) ?? new Set(), ticker: r.ticker, side: r.side, owner: r.owner,
  low: r.amount_low === "" ? null : Number(r.amount_low), high: r.amount_high === "" ? null : Number(r.amount_high),
  lag: r.lag_days === "" ? null : Number(r.lag_days), late: r.late, disc: r.disclosed_date, txn: r.trade_date,
  slug: (r.page_url || "").replace(/\/+$/, "").split("/").pop() ?? "",
}));
const oracle = {
  chamber: (v) => (r) => !v || r.chamber === v,
  party: (v) => (r) => !v || r.party === v,
  state: (v) => (r) => !v || r.state === v,
  committee: (v) => (r) => !v || r.committees.has(v),
  side: (v) => (r) => !v || r.side === v,
  min: (v) => (r) => !Number(v) || (r.low != null && r.low >= Number(v)),
  max: (v) => (r) => !Number(v) || (r.high != null && r.high <= Number(v)),
  owner: (v) => (r) => !v || r.owner === v,
  asset: (v) => (r) => !v || (v === "ticker" ? !!r.ticker : !r.ticker),
  w: (v) => (r) => !Number(v) || (age(r.disc) >= 0 && age(r.disc) <= Number(v)),
  tw: (v) => (r) => !Number(v) || (!!r.txn && age(r.txn) >= 0 && age(r.txn) <= Number(v)),
  late: (v) => (r) => !v || (v === "late" ? r.late === "true" : r.late === "false"),
};
const FILTERS = Object.keys(oracle);
const want = (state) => rows.filter((r) => FILTERS.every((k) => oracle[k](state[k] ?? "")(r)) && (!state.q || state.q.toLowerCase().split(/\s+/).every((w) => `${r.member} ${r.ticker}`.toLowerCase().includes(w))));

// ── reading the page ─────────────────────────────────────────────────────────────────────
const ds = () => page.evaluate(() => { const d = document.querySelector("[data-screener]").dataset; return { shown: Number(d.shown), members: Number(d.members), page: Number(d.page), pages: Number(d.pages) }; });
const pageRows = (p = page) => p.evaluate(() => [...document.querySelectorAll('[data-scr="rows"] tr')].map((tr) => ({ id: tr.dataset.id, cells: [...tr.cells].map((td) => td.textContent.replace(/\s+/g, " ").trim()), hrefs: [...tr.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href")) })));
const countText = async () => (await page.locator('[data-scr="count"]').textContent()) ?? "";
const setCtl = (name, value) => page.selectOption(`[data-scr="${name}"]`, String(value));
const optionsOf = (name) => page.$$eval(`[data-scr="${name}"] option`, (os) => os.map((o) => o.value));
const reset = async () => { await page.evaluate(() => { history.replaceState(null, "", location.pathname); window.dispatchEvent(new HashChangeEvent("hashchange")); }); await ready(); };
const allIds = async () => {
  // Every row of the current view, page by page.
  const ids = [];
  for (let guard = 0; guard < 2000; guard++) {
    ids.push(...(await pageRows()).map((r) => r.id));
    if (await page.locator('[data-scr="next"]').isDisabled()) break;
    await page.click('[data-scr="next"]');
  }
  return ids;
};
const fmt = (n) => n.toLocaleString("en-US");
const sameSet = (a, b) => a.length === b.size && new Set(a).size === a.length && a.every((x) => b.has(x));

// Everything, before a filter is set.
const start = await ds();
ok(start.shown === rows.length, `the screener holds ${start.shown} rows; congress-trades.csv has ${rows.length} that are not under review`);
ok(start.members === new Set(rows.map((r) => r.key)).size, `members in the screener (${start.members}) equal filers in the CSV (${new Set(rows.map((r) => r.key)).size})`);
ok((await countText()).includes(`All ${fmt(rows.length)} trade`), `the count line says all ${rows.length} trades`);
const buys = rows.filter((r) => r.side === "buy").length, sells = rows.filter((r) => r.side === "sell").length;
ok((await countText()).includes(`${fmt(buys)} purchase`) && (await countText()).includes(`${fmt(sells)} sale`), `the count line gives ${buys} purchases and ${sells} sales`);
ok(!(await page.locator('[data-scr="reset"]').isVisible()), "Reset is hidden when nothing is set");
const firstPage = await pageRows();
ok(firstPage.length === Math.min(50, rows.length), `the first page has ${firstPage.length} rows`);
ok(firstPage.every((r) => r.cells.length === 9 && r.cells[0] && r.cells[5] && /PTR/.test(r.cells[8])), "every row has a member, a disclosure date and a link to the report");

// Without JavaScript the same first rows are in the page, and the controls are hidden.
const plain = await browser.newContext({ javaScriptEnabled: false });
const np = await plain.newPage();
await np.goto(base + PATH, { waitUntil: "load" });
const staticRows = await pageRows(np);
ok(staticRows.length === firstPage.length && staticRows.every((r, i) => r.id === firstPage[i].id && r.cells.join("|") === firstPage[i].cells.join("|") && r.hrefs.join("|") === firstPage[i].hrefs.join("|")), "the rows printed without JavaScript are the first page with JavaScript, cell for cell");
ok(!(await np.locator(".scr-controls").isVisible()) && !(await np.locator(".scr-pager").isVisible()), "without JavaScript the filter controls and the pager are hidden");
await plain.close();

// ── every option of every filter, alone ──────────────────────────────────────────────────
let states = 0;
for (const name of FILTERS) {
  if (!(await page.locator(`[data-scr="${name}"]`).count())) continue;
  for (const v of await optionsOf(name)) {
    await setCtl(name, v);
    const got = await ds(), exp = want({ [name]: v });
    ok(got.shown === exp.length, `${name}=${v || "(any)"}: ${got.shown} trades on screen, ${exp.length} in the CSV`);
    ok(got.members === new Set(exp.map((r) => r.key)).size, `${name}=${v || "(any)"}: ${got.members} members on screen, ${new Set(exp.map((r) => r.key)).size} in the CSV`);
    const text = await countText();
    ok(exp.length === 0 ? text.startsWith("No trade matches") : text.includes(fmt(exp.length)), `${name}=${v || "(any)"}: the count line says ${exp.length}`);
    if (["chamber", "party", "state", "committee", "side", "owner"].includes(name) && v) ok(exp.length > 0, `${name}=${v}: an offered option lists at least one trade`);
    states++;
  }
  await reset();
}

// ── combined filters: page through the whole result and compare ids ──────────────────────
const firstOf = async (name) => (await optionsOf(name)).filter((v) => v && v !== "0");
const parties = await firstOf("party"), sides = await firstOf("side"), owners = await firstOf("owner"), chambers = await firstOf("chamber");
const combos = [];
for (const chamber of chambers) for (const side of sides.slice(0, 2)) combos.push({ chamber, side });
for (const party of parties) combos.push({ party, late: "late" }, { party, min: 15001, asset: "ticker" });
for (const owner of owners.slice(0, 2)) combos.push({ owner, w: 365, side: sides[0] });
combos.push({ min: 100001, w: 90 }, { asset: "other" }, { min: 15001, max: 50000 }, { max: 15000, side: sides[0], tw: 365 }, { tw: 90, w: 30 }, { min: 250001, max: 100000 }, { late: "ontime", side: sides[0], min: 50001 });
await setCtl("per", 25);
for (const c of combos) {
  for (const [k, v] of Object.entries(c)) await setCtl(k, v);
  const exp = want(c), ids = await allIds();
  ok(sameSet(ids, new Set(exp.map((r) => r.id))), `${JSON.stringify(c)}: ${ids.length} rows paged through, ${exp.length} in the CSV, same ids`);
  states++;
  await reset(); await setCtl("per", 25);
}

// ── paging and rows per page ─────────────────────────────────────────────────────────────
const total = rows.length;
ok((await ds()).pages === Math.max(1, Math.ceil(total / 25)), `25 rows a page gives ${Math.ceil(total / 25)} pages`);
ok(await page.locator('[data-scr="prev"]').isDisabled(), "Previous is off on the first page");
if (total > 25) {
  await page.click('[data-scr="next"]');
  ok((await ds()).page === 2 && (await page.evaluate(() => location.hash)).includes("page=2"), "Next opens page 2 and the address says so");
  ok(((await page.locator('[data-scr="pageinfo"]').textContent()) ?? "").startsWith("Page 2 of"), "the pager says page 2");
  const p2 = (await pageRows()).map((r) => r.id);
  await page.reload({ waitUntil: "load" }); await ready();
  ok((await pageRows()).map((r) => r.id).join() === p2.join(), "reloading an address with a page number shows that page");
  await setCtl("side", sides[0]);
  ok((await ds()).page === 1, "changing a filter goes back to page 1");
}
await reset();
ok((await page.inputValue('[data-scr="per"]')) === "50" && (await pageRows()).length === Math.min(50, total), "an address with no rows-per-page value shows 50");

// ── sorting ──────────────────────────────────────────────────────────────────────────────
const byId = new Map(rows.map((r) => [r.id, r]));
const order = async () => (await allIds()).map((id) => byId.get(id));
const mono = (xs, cmp) => xs.every((x, i) => i === 0 || cmp(xs[i - 1], x) <= 0);
const nullsLast = (get, dir) => (a, b) => { const x = get(a), y = get(b); if (x == null || y == null) return x == null && y != null ? 1 : 0; return x === y ? 0 : (x < y ? -1 : 1) * dir; };
await setCtl("per", 100);
ok(mono(await order(), nullsLast((r) => r.disc, -1)), "the table opens newest disclosure first");
const clickSort = (key) => page.click(`th[data-sort="${key}"] button.sort`);
const sortOf = (key) => page.getAttribute(`th[data-sort="${key}"]`, "aria-sort");
await clickSort("amount");
ok(mono(await order(), nullsLast((r) => r.low, -1)) && (await sortOf("amount")) === "descending", "Amount sorts the largest range first, rows with no amount last");
await reset(); await setCtl("per", 100); await clickSort("amount"); await clickSort("amount");
ok(mono(await order(), nullsLast((r) => r.low, 1)) && (await sortOf("amount")) === "ascending", "a second click sorts the smallest first, rows with no amount still last");
ok((await page.evaluate(() => location.hash)).includes("sort=amount") && (await page.evaluate(() => location.hash)).includes("dir=asc"), "the address keeps the sort order");
await clickSort("amount");
ok((await sortOf("amount")) === "none" && (await sortOf("disclosed")) === "descending", "a third click restores newest first");
await reset(); await setCtl("per", 100); await clickSort("lag");
ok(mono(await order(), nullsLast((r) => r.lag, -1)), "Lag sorts the longest first, rows with no lag last");
await reset(); await setCtl("per", 100); await clickSort("ticker");
ok(mono(await order(), nullsLast((r) => r.ticker || null, 1)), "Asset sorts tickers A to Z, rows with no ticker last");
await reset(); await setCtl("per", 100); await clickSort("trade");
ok(mono(await order(), nullsLast((r) => r.txn || null, -1)), "Trade date sorts the newest first");
await setCtl("late", "late");
ok(mono(await order(), nullsLast((r) => r.txn || null, -1)) && (await ds()).shown === want({ late: "late" }).length, "sorting and a filter work together");
await reset();

// ── the address, reload, Reset, a jump link ──────────────────────────────────────────────
const c0 = { chamber: chambers[0], side: sides[0], min: 15001 };
for (const [k, v] of Object.entries(c0)) await setCtl(k, v);
const before = await allIds();
const hash = await page.evaluate(() => location.hash);
ok(hash.includes(`chamber=${c0.chamber}`) && hash.includes(`side=${c0.side}`) && hash.includes("min=15001"), `the address keeps the filters (${hash})`);
ok(await page.locator('[data-scr="reset"]').isVisible(), "Reset is offered once a filter is set");
await page.reload({ waitUntil: "load" }); await ready();
ok((await allIds()).join() === before.join(), "reloading a filtered address shows the same rows");
ok((await page.inputValue('[data-scr="chamber"]')) === c0.chamber && (await page.inputValue('[data-scr="min"]')) === "15001", "reloading a filtered address sets the controls");
await page.click('[data-scr="reset"]');
ok((await ds()).shown === total && (await page.evaluate(() => location.hash)) === "", "Reset shows every trade and clears the address");
await page.goto(base + PATH + "#about", { waitUntil: "load" }); await ready();
ok((await ds()).shown === total, "a jump link (#about) leaves every trade in the table");
// A band (low end and upper limit together) and a trade window: the address, a reload, the controls.
{
  const band = { min: 15001, max: 50000, tw: 365 };
  for (const [k, v] of Object.entries(band)) await setCtl(k, v);
  const exp = want(band), h = await page.evaluate(() => location.hash);
  ok((await ds()).shown === exp.length, `a band of $15,001 to $50,000 traded in 12 months: ${(await ds()).shown} on screen, ${exp.length} in the CSV`);
  ok(h.includes("min=15001") && h.includes("max=50000") && h.includes("tw=365"), `the address keeps the upper limit and the trade window (${h})`);
  ok(exp.every((r) => r.low >= 15001 && r.high <= 50000 && r.txn), "every row the oracle keeps for the band lies inside it and has a trade date");
  await page.reload({ waitUntil: "load" }); await ready();
  ok((await ds()).shown === exp.length && (await page.inputValue('[data-scr="max"]')) === "50000" && (await page.inputValue('[data-scr="tw"]')) === "365", "reloading keeps the upper limit and the trade window and sets their controls");
  ok((await pageRows()).every((r) => r.cells[4] !== ""), "every row shown under a trade window has a trade date");
  await page.click('[data-scr="reset"]');
  ok((await ds()).shown === total && (await page.inputValue('[data-scr="max"]')) === "0" && (await page.inputValue('[data-scr="tw"]')) === "0", "Reset clears the upper limit and the trade window");
  const noTop = rows.filter((r) => r.high == null).length, noDate = rows.filter((r) => !r.txn).length;
  const maxes = (await optionsOf("max")).filter((v) => v !== "0"), tws = (await optionsOf("tw")).filter((v) => v !== "0");
  ok(maxes.every((v, i) => i === 0 || want({ max: maxes[i - 1] }).length <= want({ max: v }).length), "a higher upper limit never keeps fewer rows");
  ok(tws.every((v, i) => i === 0 || want({ tw: tws[i - 1] }).length <= want({ tw: v }).length), "a longer trade window never keeps fewer rows");
  if (maxes.length) ok(want({ max: maxes.at(-1) }).length <= total - noTop, `no upper limit keeps a range with no stated top (${noTop} such rows)`);
  if (tws.length) ok(want({ tw: tws.at(-1) }).length <= total - noDate, `no trade window keeps a row with no trade date (${noDate} such rows)`);
}
await page.goto(base + PATH + "#state=ZZ&min=7&max=7&tw=45&side=short", { waitUntil: "load" }); await ready();
ok((await ds()).shown === total, "an address with values the screener does not offer shows every trade");

// ── search, the empty state ──────────────────────────────────────────────────────────────
await page.goto(base + PATH, { waitUntil: "load" }); await ready();
const someTicker = rows.find((r) => r.ticker)?.ticker;
if (someTicker) {
  await page.fill('[data-scr="q"]', someTicker.toLowerCase());
  const exp = want({ q: someTicker });
  ok((await ds()).shown === exp.length && exp.length > 0, `searching "${someTicker.toLowerCase()}" finds ${exp.length} trades`);
}
const surname = rows[Math.floor(rows.length / 2)].member.split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w)).pop();
if (surname) {
  await page.fill('[data-scr="q"]', surname.toUpperCase());
  const exp = want({ q: surname });
  ok((await ds()).shown === exp.length && exp.length > 0, `searching "${surname}" finds ${exp.length} trades`);
  ok((await pageRows()).every((r) => r.cells.slice(0, 2).join(" ").toLowerCase().includes(surname.toLowerCase())), `every row shown for "${surname}" names it`);
}
await page.fill('[data-scr="q"]', "zzzz-no-such-member");
ok((await ds()).shown === 0 && await page.locator('[data-scr="empty"]').isVisible() && !(await page.locator('[data-scr="pager"]').isVisible()), "a search with no match says so and hides the pager");
await page.click('[data-scr="reset2"]');
ok((await ds()).shown === total, "the empty state's button clears the filters");

// ── one member or one ticker alone (the links from member and stock pages) ───────────────
const open = async (hash) => { await page.goto(base + PATH, { waitUntil: "load" }); await ready(); await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForFunction((h) => location.hash === h || location.hash === "", hash); await ready(); };
const bySlug = new Map(); for (const r of rows) if (r.slug) bySlug.set(r.slug, (bySlug.get(r.slug) ?? 0) + 1);
const byTicker = new Map(); for (const r of rows) if (r.ticker) byTicker.set(r.ticker.toUpperCase(), (byTicker.get(r.ticker.toUpperCase()) ?? 0) + 1);
const someSlugs = [...bySlug.keys()].sort((a, b) => bySlug.get(b) - bySlug.get(a)).filter((_, i, xs) => i === 0 || i === xs.length - 1 || i === Math.floor(xs.length / 2));
for (const slug of someSlugs) {
  await open(`#member=${slug}`);
  const got = await ds();
  ok(got.shown === bySlug.get(slug) && got.members === 1, `#member=${slug}: ${got.shown} trades by ${got.members} member on screen, ${bySlug.get(slug)} in the CSV`);
  const name = rows.find((r) => r.slug === slug).member;
  ok(((await page.locator('[data-scr="pins"]').textContent()) ?? "").includes(`Only trades by ${name}`), `#member=${slug}: the page says it shows only ${name}`);
  ok((await pageRows()).every((r) => r.cells[0].startsWith(name)), `#member=${slug}: every row shown is by ${name}`);
}
// The shortest ticker is the one a search would get wrong ("A" is in every name).
const someTickers = [...byTicker.keys()].sort((a, b) => a.length - b.length || byTicker.get(b) - byTicker.get(a)).filter((_, i, xs) => i === 0 || i === xs.length - 1);
for (const t of someTickers) {
  await open(`#ticker=${encodeURIComponent(t)}`);
  const got = await ds();
  ok(got.shown === byTicker.get(t), `#ticker=${t}: ${got.shown} trades on screen, ${byTicker.get(t)} in the CSV`);
  ok(((await page.locator('[data-scr="pins"]').textContent()) ?? "").includes(`Only ${t}`), `#ticker=${t}: the page says it shows only ${t}`);
  ok((await pageRows()).every((r) => r.cells[1] === t), `#ticker=${t}: every row shown is ${t}`);
}
if (someSlugs.length && someTickers.length) {
  const slug = someSlugs[0];
  await open(`#member=${slug}`);
  await setCtl("side", sides[0]);
  const exp = rows.filter((r) => r.slug === slug && r.side === sides[0]).length;
  ok((await ds()).shown === exp, `one member and a side filter together: ${(await ds()).shown} on screen, ${exp} in the CSV`);
  ok((await page.evaluate(() => location.hash)).includes(`member=${slug}`), "changing a filter keeps the member in the address");
  await page.reload({ waitUntil: "load" }); await ready();
  ok((await ds()).shown === exp, "reloading keeps the member and the filter");
  await page.click('[data-scr="pins"] button');
  ok((await ds()).shown === want({ side: sides[0] }).length && !(await page.evaluate(() => location.hash)).includes("member="), "Remove drops the member and keeps the other filter");
  ok(!(await page.locator('[data-scr="pins"]').isVisible()), "the line is gone once nothing is pinned");
  await open(`#member=${slug}`);
  await page.click('[data-scr="reset"]');
  ok((await ds()).shown === total && (await page.evaluate(() => location.hash)) === "", "Reset drops the member too");
  await open("#member=no-such-member-zz&ticker=ZZZZZZ");
  ok((await ds()).shown === total && !(await page.locator('[data-scr="pins"]').isVisible()), "a member or ticker the table does not hold shows every trade");
}

// ── download these rows ──────────────────────────────────────────────────────────────────
{
  const { readFile } = await import("node:fs/promises");
  const grab = async () => { const [d] = await Promise.all([page.waitForEvent("download"), page.click('[data-scr="download"]')]); return { name: d.suggestedFilename(), rows: parseCsv(await readFile(await d.path(), "utf8")) }; };
  await page.goto(base + PATH, { waitUntil: "load" }); await ready();
  const every = await grab();
  ok(every.rows.length === total && every.name === `congress-trades-all-${built}.csv`, `with no filter the download has every row (${every.rows.length} of ${total}) and is named ${every.name}`);
  const c = { chamber: chambers[0], side: sides[0] };
  for (const [k, v] of Object.entries(c)) await setCtl(k, v);
  await setCtl("per", 25); await clickSort("amount");
  const onScreen = await allIds();
  await page.goto(base + PATH + (await page.evaluate(() => location.hash)), { waitUntil: "load" }); await ready();
  const some = await grab();
  ok(some.rows.map((r) => r.trade_id).join() === onScreen.join(), `the download of a filtered, sorted view has the same ${onScreen.length} rows in the same order as the screen, every page`);
  ok(/filtered/.test(some.name) && some.name.endsWith(".csv"), `a filtered download is named as filtered (${some.name})`);
  ok(some.rows.every((r) => { const o = byId.get(r.trade_id); return o && o.member === r.filer && (o.ticker || "") === r.ticker && o.side === r.side && o.disc === r.disclosed_date && String(o.low ?? "") === r.amount_low && String(o.high ?? "") === r.amount_high && (o.late || "") === r.late; }), "each downloaded row carries the same member, ticker, side, date, range and late flag as congress-trades.csv");
  await page.fill('[data-scr="q"]', "zzzz-no-such-member");
  ok(await page.locator('[data-scr="download"]').isDisabled(), "the download button is off when nothing matches");
  await page.goto(base + PATH, { waitUntil: "load" }); await ready();
}

// ── a sample of the links, late flags, wording ───────────────────────────────────────────
const sample = [...new Set((await pageRows()).flatMap((r) => r.hrefs))].slice(0, 16);
for (const href of sample) { const r = await page.request.get(base + href.split("#")[0]); ok(r.status() === 200, `${href} (linked from a row) answers ${r.status()}`); }
const shownNow = await pageRows();
ok(shownNow.every((r) => (/\blate$/.test(r.cells[6])) === (byId.get(r.id)?.late === "true")), "a row carries the late flag exactly when the CSV marks it late");
ok(shownNow.every((r) => { const c = byId.get(r.id); return !c || (c.ticker ? r.cells[1] === c.ticker : r.cells[1] !== ""); }), "the Asset cell is the CSV's ticker, or a label when there is none");
const html = await (await page.request.get(base + PATH)).text();
const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
ok(html.includes("data-answer"), "the page has an answer block");
ok(/Not investment advice/.test(text), "the page says it is not investment advice");
for (const bad of [/\bconflicts? of interest\b/i, /\binsider trading\b/i, /\bsuspicious\b/i, /\bshould (buy|sell)\b/i, /\bscore\b/i, /—/]) ok(!bad.test(text), `the page does not use ${bad}`);
ok(errors.length === 0, `no page errors (${errors.join("; ")})`);

// ── phone width ──────────────────────────────────────────────────────────────────────────
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(base + PATH, { waitUntil: "load" }); await ready(phone);
const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(over <= 1, `no sideways page scroll at 390 px (${over}px over)`);
await phone.selectOption('[data-scr="side"]', sides[0]);
ok(Number(await phone.evaluate(() => document.querySelector("[data-screener]").dataset.shown)) === want({ side: sides[0] }).length, "filters work at 390 px");

await browser.close();
console.log(failures ? `verify-screener: ${failures} problem(s) in ${checks} checks` : `verify-screener: ${total} trades, ${states} filter states, ${checks} checks pass`);
process.exit(failures ? 1 : 0);
