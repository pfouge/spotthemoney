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
// first page with JavaScript, a sample of the links, the wording, and 390 px. Saved screens: what
// is stored (a name and an address under one localStorage key), that saving sends no request,
// opening, replacing, removing, the limit, junk in storage, storage refused, the privacy page.
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

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
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
// Ticker history (web/src/lib/tickerhistory.ts), recomputed here from the CSV rows with this
// script's own copy of the rule: per member and ticker, by trade date; the earliest date is
// "first" when it is 90 days or more after the record starts; a purchase (or sale) on the third or
// a later one-sided date running is in a run; a date with both ends the count; an exchange is neither.
const HIST_FROM = new Date(Date.parse("2025-10-01T00:00:00Z") + 90 * 86400000).toISOString().slice(0, 10), RUN_MIN = 3;
{
  const groups = new Map();
  for (const r of rows) { r.first = false; r.run = 0; if (!r.ticker || !/^\d{4}-\d{2}-\d{2}$/.test(r.txn)) continue; const k = `${r.key}|${r.ticker.toUpperCase()}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const list of groups.values()) {
    let last = "", n = 0;
    [...new Set(list.map((r) => r.txn))].sort().forEach((day, i) => {
      const on = list.filter((r) => r.txn === day), b = on.some((r) => r.side === "buy"), s = on.some((r) => r.side === "sell");
      if (b && s) { last = ""; n = 0; } else if (b || s) { const kind = b ? "buy" : "sell"; n = kind === last ? n + 1 : 1; last = kind; }
      for (const r of on) { r.first = i === 0 && day >= HIST_FROM; r.run = b !== s && r.side === (b ? "buy" : "sell") ? n : 0; }
    });
  }
}
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const runText = (r) => (r.run >= RUN_MIN ? `${ord(r.run)} ${r.side === "buy" ? "buy" : "sale"} in a row` : "");
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
  hist: (v) => (r) => !v || (v === "first" ? r.first : r.run >= RUN_MIN),
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
    if (["chamber", "party", "state", "committee", "side", "owner", "hist"].includes(name) && v) ok(exp.length > 0, `${name}=${v}: an offered option lists at least one trade`);
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
combos.push({ min: 100001, w: 90 }, { asset: "other" }, { min: 15001, max: 50000 }, { max: 15000, side: sides[0], tw: 365 }, { tw: 90, w: 30 }, { min: 250001, max: 100000 }, { late: "ontime", side: sides[0], min: 50001 }, { hist: "first", side: sides[0] }, { hist: "run", w: 365 }, { hist: "first", late: "late" });
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

// ── ticker history: the flags on screen, the address, the member pages ───────────────────
{
  const flagsOf = (cell) => ({ first: /first on record/.test(cell), run: (/\d+(?:st|nd|rd|th) (?:buy|sale) in a row/.exec(cell) ?? [""])[0] });
  for (const v of ["", "first", "run"]) {
    await page.goto(base + PATH, { waitUntil: "load" }); await ready();
    if (v) await setCtl("hist", v);
    await setCtl("per", 100);
    const shown = await pageRows();
    ok(shown.every((r) => { const o = byId.get(r.id), f = flagsOf(r.cells[2]); return o && f.first === o.first && f.run === runText(o); }), `hist=${v || "(any)"}: every row shown carries "first on record" and its run flag exactly when the recount from the CSV says so`);
    if (v) {
      const h = await page.evaluate(() => location.hash);
      ok(h.includes(`hist=${v}`), `the address keeps the ticker history filter (${h})`);
      const n = (await ds()).shown;
      await page.reload({ waitUntil: "load" }); await ready();
      ok((await ds()).shown === n && (await page.inputValue('[data-scr="hist"]')) === v, `reloading keeps hist=${v} and sets its control`);
      ok(shown.length > 0 && shown.every((r) => (v === "first" ? flagsOf(r.cells[2]).first : !!flagsOf(r.cells[2]).run)), `hist=${v}: every row shown has the flag`);
    }
  }
  await page.click('[data-scr="reset"]');
  ok((await ds()).shown === total && (await page.inputValue('[data-scr="hist"]')) === "", "Reset clears the ticker history filter");
  await page.goto(base + PATH + "#hist=streak", { waitUntil: "load" }); await ready();
  ok((await ds()).shown === total, "a ticker history value the screener does not offer shows every trade");
  // What the rule promises, on the oracle itself.
  const firsts = rows.filter((r) => r.first), runs = rows.filter((r) => r.run >= RUN_MIN);
  ok(firsts.every((r) => r.txn >= HIST_FROM && r.ticker), `no row traded before ${HIST_FROM} or without a ticker is first on record`);
  ok(new Set(firsts.map((r) => `${r.key}|${r.ticker.toUpperCase()}|${r.txn}`)).size === new Set(firsts.map((r) => `${r.key}|${r.ticker.toUpperCase()}`)).size, "a member has one first trade date per ticker");
  ok(runs.every((r) => r.side === "buy" || r.side === "sell"), "only purchases and sales are in a run");
  // The same flags on the members' own pages (the trade tables read the same map).
  const pick = [...firsts.slice(0, 3), ...runs.slice(0, 3), ...rows.filter((r) => r.ticker && r.txn && !r.first && r.run < RUN_MIN).slice(0, 3)].filter((r) => r.slug);
  let seenOnPages = 0;
  for (const r of pick) {
    const res = await page.request.get(`${base}/congress/${r.slug}/`);
    if (!res.ok()) continue;
    const m = new RegExp(`<tr[^>]*id="t${r.id}"[\\s\\S]*?</tr>`).exec(await res.text());
    if (!m) continue;                       // an older row than the page's table holds
    seenOnPages++;
    const cell = m[0].replace(/<[^>]+>/g, " ");
    ok(/first on record/.test(cell) === r.first && ((/\d+(?:st|nd|rd|th) (?:buy|sale) in a row/.exec(cell) ?? [""])[0]) === runText(r), `/congress/${r.slug}/ row t${r.id}: the flags match the recount (first ${r.first}, run "${runText(r)}")`);
    if (r.first || runText(r)) ok(/href="\/guides\/how-to-read-a-congressional-trade-report\/#ticker-history"/.test(m[0]), `/congress/${r.slug}/ row t${r.id}: the flag links to the guide section`);
  }
  if (firsts.length + runs.length > 0) ok(seenOnPages > 0, "at least one sampled row was found on its member's page");
  console.log(`  ticker history: ${firsts.length} rows first on record, ${runs.length} rows in a run of ${RUN_MIN} or more (recount from the CSV)`);
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
  ok(every.rows.every((r) => { const o = byId.get(r.trade_id); return o && r.first_in_ticker_on_record === (o.ticker && o.txn ? String(o.first) : "") && r.same_side_run === (o.run > 0 ? String(o.run) : ""); }), "each downloaded row carries the first-on-record mark and the run number the recount from the CSV gives");
  await page.fill('[data-scr="q"]', "zzzz-no-such-member");
  ok(await page.locator('[data-scr="download"]').isDisabled(), "the download button is off when nothing matches");
  await page.goto(base + PATH, { waitUntil: "load" }); await ready();
}

// ── saved screens: names and addresses in this browser's localStorage, nothing sent ──────
{
  const KEY = "stm.screens.congress", MAX = 20;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await ctx.newPage();
  const reqs = [], serr = [];
  sp.on("request", (r) => reqs.push(r.url()));
  sp.on("pageerror", (e) => serr.push(String(e)));
  await sp.goto(base + PATH, { waitUntil: "load" }); await ready(sp);
  const stored = () => sp.evaluate((k) => localStorage.getItem(k), KEY);
  const names = () => sp.locator('[data-scr="saved-items"] li a').allTextContents();
  const msg = async () => (await sp.textContent('[data-scr="save-msg"]')) ?? "";
  const shown = () => sp.evaluate(() => Number(document.querySelector("[data-screener]").dataset.shown));
  const setS = async (k, v) => { await sp.selectOption(`[data-scr="${k}"]`, String(v)); };
  const save = async (name) => { if (!(await sp.locator('[data-scr="save-form"]').isVisible())) await sp.click('[data-scr="save-open"]'); await sp.fill('[data-scr="save-name"]', name); await sp.press('[data-scr="save-name"]', "Enter"); };
  ok(await sp.locator('[data-scr="save-open"]').isVisible(), '"Save this screen" is offered');
  ok((await stored()) === null && !(await sp.locator('[data-scr="saved-list"]').isVisible()), "nothing is stored and no list is shown before a screen is saved");
  await sp.click('[data-scr="save-open"]');
  ok(!(await sp.locator('[data-scr="save-form"]').isVisible()) && /nothing to save/.test(await msg()), "the view the page opens on cannot be saved, and the page says why");
  ok((await stored()) === null, "a refused save stores nothing");

  // Save a filtered view from its second page: the page number is not kept.
  const c1 = { chamber: chambers[0], side: sides[0] };
  for (const [k, v] of Object.entries(c1)) await setS(k, v);
  await setS("per", 25);
  if (!(await sp.locator('[data-scr="next"]').isDisabled())) await sp.click('[data-scr="next"]');
  const h1 = (await sp.evaluate(() => location.hash)).replace(/&page=\d+/, "");
  await sp.click('[data-scr="save-open"]');
  ok(await sp.locator('[data-scr="save-form"]').isVisible() && (await sp.inputValue('[data-scr="save-name"]')).length > 0, "the name box opens with a suggested name");
  ok((await sp.getAttribute('[data-scr="save-open"]', "aria-expanded")) === "true", "the button says the form is open");
  const n1 = '<b>Big</b> & "buys" <img src=x onerror="window.__stmx=1">';
  const before = reqs.length;
  await sp.fill('[data-scr="save-name"]', `  ${n1}  `); await sp.press('[data-scr="save-name"]', "Enter");
  const first = JSON.parse((await stored()) ?? "[]");
  ok(first.length === 1 && first[0].n === n1 && first[0].h === h1, `one screen is stored: its name as typed and the view's address without a page number (${first[0]?.h})`);
  ok(Object.keys(first[0] ?? {}).sort().join() === "h,n", "only a name and an address are stored");
  ok(reqs.length === before, `saving a screen sends no request (${reqs.slice(before).join(", ")})`);
  ok((await names()).join("|") === n1 && (await sp.locator('[data-scr="saved-items"] li :is(b, img)').count()) === 0 && (await sp.evaluate(() => window.__stmx)) === undefined, "the name is shown as text, never as markup");
  ok(/Saved/.test(await msg()) && /this browser only/.test(await msg()), "the page confirms the save and says where it is kept");
  ok(!(await sp.locator('[data-scr="save-form"]').isVisible()), "the name box closes after a save");
  ok((await sp.evaluate(() => Object.keys(localStorage))).every((k) => k === KEY || k === "theme"), "the site's only local storage keys are the saved screens and the theme");

  // A second screen goes first; clicking the older one brings its view back.
  await sp.click('[data-scr="reset"]'); await setS("per", 50);
  await setS("min", 100001);
  await save("Second");
  ok((await names()).join("|") === `Second|${n1}`, "the newest saved screen is listed first");
  ok(await sp.locator('[data-scr="saved-list"]').isVisible() && await sp.locator('[data-scr="saved-items"] li a').first().isVisible(), "the list of saved screens is shown once there is one");
  await sp.locator('[data-scr="saved-items"] li a').nth(1).click();
  await sp.waitForFunction((h) => location.hash === h && document.querySelector('[data-scr="per"]').value === "25" && document.querySelector('[data-scr="min"]').value === "0", h1);
  ok((await shown()) === want(c1).length && (await sp.inputValue('[data-scr="chamber"]')) === c1.chamber && (await sp.inputValue('[data-scr="side"]')) === c1.side && (await sp.inputValue('[data-scr="min"]')) === "0" && (await sp.inputValue('[data-scr="per"]')) === "25",
    `opening a saved screen shows its view: ${await shown()} trades on screen, ${want(c1).length} in the CSV, controls set`);
  ok((await sp.getAttribute('[data-scr="saved-items"] li:nth-child(2) a', "aria-current")) === "true" && (await sp.getAttribute('[data-scr="saved-items"] li:nth-child(1) a', "aria-current")) === null, "the saved screen that is on screen is marked");
  await sp.goto(base + PATH, { waitUntil: "load" }); await ready(sp);
  ok((await names()).join("|") === `Second|${n1}` && (await shown()) === total, "saved screens are still listed after leaving and coming back, and the page opens on every trade");
  await sp.locator('[data-scr="saved-items"] li a').first().click();
  await sp.waitForFunction(() => location.hash.includes("min=100001") && document.querySelector('[data-scr="min"]').value === "100001");
  ok((await shown()) === want({ min: 100001 }).length, "a saved screen opens from a fresh page load too");

  // The same name, whatever its capitals, replaces; Remove removes; the last removal leaves nothing stored.
  await setS("side", sides[0]);
  await save("SECOND");
  const rep = JSON.parse((await stored()) ?? "[]");
  ok(rep.length === 2 && rep[0].n === "SECOND" && rep[0].h.includes("min=100001") && rep[0].h.includes(`side=${sides[0]}`) && /Replaced/.test(await msg()), "saving under a name already in use replaces that screen");
  await sp.click('[data-scr="save-open"]'); await sp.fill('[data-scr="save-name"]', "   "); await sp.press('[data-scr="save-name"]', "Enter");
  ok(/name/.test(await msg()) && JSON.parse(await stored()).length === 2, "a screen cannot be saved without a name");
  await sp.keyboard.press("Escape");
  ok(!(await sp.locator('[data-scr="save-form"]').isVisible()), "Escape closes the name box");
  await sp.getByRole("button", { name: "Remove saved screen: SECOND" }).click();
  ok((await names()).join("|") === n1 && JSON.parse(await stored()).length === 1 && /Removed/.test(await msg()), "Remove takes one screen off the list and out of storage");
  await sp.locator('[data-scr="saved-items"] li button').first().click();
  ok((await stored()) === null && !(await sp.locator('[data-scr="saved-list"]').isVisible()), "removing the last screen leaves nothing stored");

  // What is read back is untrusted: junk is dropped, an address can only be one of the screener's views.
  await sp.evaluate(([k, side]) => localStorage.setItem(k, JSON.stringify([{ n: "kept", h: `#side=${side}&page=9&nonsense=1` }, { n: "script", h: "javascript:alert(1)" }, { n: "elsewhere", h: "https://example.com/#side=buy" }, { n: "jump", h: "#about" }, 5, null, { n: "", h: `#side=${side}` }])), [KEY, sides[0]]);
  await sp.goto(base + PATH, { waitUntil: "load" }); await ready(sp);
  const hrefs = await sp.locator('[data-scr="saved-items"] li a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  ok((await names()).join("|") === "kept" && hrefs.join("|") === `#side=${sides[0]}`, `stored text that is not a saved screen is ignored and an address is rewritten by the screener (${hrefs.join(" ")})`);
  await sp.evaluate((k) => localStorage.setItem(k, "{broken"), KEY);
  await sp.goto(base + PATH, { waitUntil: "load" }); await ready(sp);
  ok((await names()).length === 0 && (await shown()) === total && await sp.locator('[data-scr="save-open"]').isVisible(), "unreadable stored text is treated as no saved screens");

  // The limit: a save past it is refused and nothing is dropped.
  await sp.evaluate(([k, n, side]) => localStorage.setItem(k, JSON.stringify(Array.from({ length: n + 5 }, (_, i) => ({ n: `S${i}`, h: `#side=${side}` })))), [KEY, MAX, sides[0]]);
  await sp.goto(base + PATH, { waitUntil: "load" }); await ready(sp);
  ok((await names()).length === MAX, `at most ${MAX} saved screens are listed`);
  await setS("min", 15001); await save("One too many");
  ok(new RegExp(`\\b${MAX}\\b`).test(await msg()) && !(await names()).includes("One too many"), "a save past the limit is refused with the reason");
  await sp.getByRole("button", { name: "Remove saved screen: S0", exact: true }).click();
  await save("Now it fits");
  ok((await names())[0] === "Now it fits" && (await names()).length === MAX, "after removing one, a new screen can be saved");

  // A long name at phone width does not push the page sideways.
  await sp.evaluate(([k, side]) => localStorage.setItem(k, JSON.stringify([{ n: "W".repeat(60), h: `#side=${side}` }, { n: "Senate purchases of $100,001 or more, newest first, 2026", h: `#side=${side}&min=100001` }])), [KEY, sides[0]]);
  await sp.setViewportSize({ width: 390, height: 844 });
  await sp.goto(base + PATH, { waitUntil: "load" }); await ready(sp);
  await sp.click('[data-scr="save-open"]');
  const overS = await sp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overS <= 1, `saved screens and the name box cause no sideways page scroll at 390 px (${overS}px over)`);
  ok(serr.length === 0, `no page errors while saving screens (${serr.join("; ")})`);
  await ctx.close();

  // A browser that refuses storage: no save button, and the screener works as before.
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx2.addInitScript(() => { Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } }); });
  const bp = await ctx2.newPage();
  await bp.goto(base + PATH, { waitUntil: "load" }); await ready(bp);
  ok(!(await bp.locator('[data-scr="save-open"]').isVisible()), "with storage refused by the browser, saving is not offered");
  await bp.selectOption('[data-scr="side"]', sides[0]);
  ok(Number(await bp.evaluate(() => document.querySelector("[data-screener]").dataset.shown)) === want({ side: sides[0] }).length, "with storage refused, the filters still work");
  await ctx2.close();

  // The privacy page names what is stored, and the page itself says where a screen is kept.
  const priv = (await (await page.request.get(base + "/privacy/")).text()).replace(/<[^>]+>/g, " ");
  ok(priv.includes(KEY) && /Save this screen/.test(priv) && /saved screens are not sent to us/.test(priv), "the privacy page names the saved-screens storage key and says it is not sent to the site");
  ok(!/and one setting:/.test(priv), "the privacy page no longer says the theme is the only thing stored");
  const here = (await (await page.request.get(base + PATH)).text()).replace(/<[^>]+>/g, " ");
  ok(/in this browser only/.test(here) && new RegExp(`Up to ${MAX} screens`).test(here), "the screener says saved screens stay in this browser and how many are kept");
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
