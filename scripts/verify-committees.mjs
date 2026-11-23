// Checks the committee pages (/congress-committees/ and one page per committee;
// web/src/lib/committees.ts) in a real browser:
//   node scripts/verify-committees.mjs <base-url> [--sample N]      e.g. http://127.0.0.1:4321
// Needs: npm i --no-save playwright (with the other --no-save tools, in ONE command).
// For every committee (or N of them) it compares the list's row with the committee's own page,
// the page's facts with its member table, the member table with /downloads/congress-members.csv
// and with the member directory's committee filter, and the trade table with the member list.
// It also checks that member pages link back, that a column sorts, the wording rule (a seat is
// context: no page may call a trade a conflict), and that nothing runs off the side at 390 px.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : Infinity;
const HUB = "/congress-committees/";
const TRADE_ROWS = 200, STOCK_ROWS = 15;
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } };
const int = (s) => Number(String(s ?? "").replace(/[^0-9-]/g, "") || 0);

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const res = await page.goto(base + HUB, { waitUntil: "load" });
if (!res || !res.ok()) { console.log(`✗ ${HUB} answered ${res?.status()}`); process.exit(1); }

const readHub = () => page.evaluate(() => [...document.querySelectorAll("[data-committees] tbody tr")].map((tr) => {
  const c = [...tr.cells].map((td) => td.textContent.trim());
  return { code: tr.dataset.code, name: c[0], href: tr.cells[0].querySelector("a")?.getAttribute("href") ?? null, chamber: c[1], members: c[2], withTrades: c[3], trades12: c[4], latest: c[5] };
}));
const hub = await readHub();
if (hub.length === 0) {
  // No committee data (an empty database): the page must say so and stay out of the index.
  ok(await page.locator(".empty-reason").count() > 0, "an empty committee list says why");
  ok((await page.locator('meta[name="robots"]').getAttribute("content") ?? "").includes("noindex"), "an empty committee list is noindex");
  console.log(failures ? `verify-committees: ${failures} problem(s)` : `verify-committees: no committees on record, ${checks} checks pass`);
  await browser.close();
  process.exit(failures ? 1 : 0);
}
ok(await page.locator("[data-answer]").count() === 1, "the list has an answer block");
ok(new Set(hub.map((r) => r.href)).size === hub.length && hub.every((r) => r.href?.startsWith(HUB) && r.href !== HUB), "every committee links to its own page");
ok(hub.every((r) => ["House", "Senate", "Joint"].includes(r.chamber)), "every committee names its chamber");
ok(hub.every((r) => int(r.members) > 0 && int(r.withTrades) <= int(r.members)), "members with trades never exceed members");
ok(hub.every((r) => (int(r.trades12) > 0 ? r.latest !== "" : true)), "a committee with trades in 12 months has a latest disclosure");

// Sorting: the Members column, both ways.
const membersCol = () => page.evaluate(() => [...document.querySelectorAll("[data-committees] tbody tr")].map((tr) => Number(tr.cells[2].textContent.replace(/,/g, ""))));
await page.locator('[data-committees] thead th:nth-child(3) button').click();
const s1 = await membersCol();
await page.locator('[data-committees] thead th:nth-child(3) button').click();
const s2 = await membersCol();
const asc = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] <= x), desc = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] >= x);
ok((asc(s1) && desc(s2)) || (desc(s1) && asc(s2)), "the Members column sorts in both directions");

// The members CSV (built from the same model by other code): member name → trades on record.
const csvTrades = new Map();
{
  const r = await fetch(`${base}/downloads/congress-members.csv`);
  if (r.ok) {
    const lines = (await r.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
    const parse = (line) => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
    const head = parse(lines[0]); const iName = head.indexOf("member"), iN = head.indexOf("trades_on_record"), iPath = head.findIndex((h) => /url|path|page/.test(h));
    ok(iName >= 0 && iN >= 0, "congress-members.csv has member and trades_on_record columns");
    for (const l of lines.slice(1)) { const c = parse(l); csvTrades.set(iPath >= 0 && c[iPath] ? new URL(c[iPath], base).pathname : c[iName], int(c[iN])); csvTrades.set(c[iName], int(c[iN])); }
  } else ok(false, "congress-members.csv is served");
}

// The directory's committee filter reads the same seats through other code.
const dirCounts = await (async () => {
  const p = await browser.newPage();
  const r = await p.goto(base + "/congress-members/", { waitUntil: "domcontentloaded" });
  const out = r && r.ok() ? await p.evaluate(() => { const m = {}; for (const tr of document.querySelectorAll("[data-directory] tbody tr")) for (const c of (tr.dataset.c ?? "").split(" ").filter(Boolean)) m[c] = (m[c] ?? 0) + 1; return m; }) : null;
  await p.close();
  return out;
})();
ok(!!dirCounts, "the member directory is served");

const BAD = /\b(conflicts? of interest|suspicious|insider knowledge|profited from|front[- ]?ran)\b/i;
const picked = hub.filter((_, i) => sample >= hub.length || i % Math.ceil(hub.length / sample) === 0);
let lcPages = 0; const lcAbsentOk = false; const backlinksChecked = new Set();
let pages = 0, tradeRows = 0;
for (const h of picked) {
  const r = await page.goto(base + h.href, { waitUntil: "load" });
  if (!r || !r.ok()) { ok(false, `${h.href} answered ${r?.status()}`); continue; }
  pages++;
  const d = await page.evaluate(() => {
    const txt = (el) => el?.textContent.trim() ?? "";
    const fact = (k) => txt(document.querySelector(`[data-committee-facts] [data-fact="${k}"]`));
    const members = [...document.querySelectorAll("[data-committee-members] tbody tr")].map((tr) => ({ name: txt(tr.cells[0]), href: tr.cells[0].querySelector("a")?.getAttribute("href") ?? null, role: txt(tr.cells[3]), trades: txt(tr.cells[4]), trades12: txt(tr.cells[5]), latest: txt(tr.cells[6]) }));
    const stocks = [...document.querySelectorAll("[data-committee-stocks] tbody tr")].map((tr) => ({ ticker: txt(tr.cells[0]), members: txt(tr.cells[2]), trades: txt(tr.cells[3]), buys: txt(tr.cells[4]), sells: txt(tr.cells[5]) }));
    const lcSec = document.querySelector("[data-committee-lobbycontrib]");
    const lcc = lcSec ? { n: lcSec.getAttribute("data-n"), summary: txt(lcSec.querySelector("[data-lcc-summary]")), caveat: txt(lcSec.querySelector("[data-lcc-caveat]")), text: txt(lcSec),
      rows: [...lcSec.querySelectorAll("tbody tr")].map((tr) => ({ name: txt(tr.cells[0]), href: tr.cells[0].querySelector("a")?.getAttribute("href") ?? null, items: txt(tr.cells[1]), filers: txt(tr.cells[2]), newest: txt(tr.cells[3]) })) } : null;
    const filers = [...document.querySelectorAll("[data-committee-trades] table.txns tbody tr")].map((tr) => tr.cells[0].querySelector("a")?.getAttribute("href") ?? txt(tr.cells[0]));
    return { h1: txt(document.querySelector("h1")), h1s: document.querySelectorAll("h1").length, title: document.title, members, stocks, filers, lcc,
      fMembers: fact("members"), fWith: fact("with-trades"), fTrades: fact("trades"), answer: document.querySelectorAll("[data-answer]").length,
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "", main: txt(document.querySelector("main")),
      jump: [...document.querySelectorAll("nav.jump a")].map((a) => a.getAttribute("href")).filter((x) => x.startsWith("#")).every((x) => document.getElementById(x.slice(1))) };
  });
  const at = h.name;
  ok(d.h1 === h.name && d.h1s === 1, `${at}: the page is headed with the committee's name`);
  ok(d.answer === 1, `${at}: one answer block`);
  ok(!d.robots.includes("noindex"), `${at}: indexable`);
  ok(d.jump, `${at}: every jump link has its target`);
  ok(!BAD.test(d.main), `${at}: no wording that ties a trade to the committee`);
  ok(/context/.test(d.main), `${at}: says a seat is context`);
  ok(d.members.length === int(h.members) && int(d.fMembers) === d.members.length, `${at}: ${d.members.length} member rows, list says ${h.members}, facts say ${d.fMembers}`);
  const withTrades = d.members.filter((m) => int(m.trades) > 0).length;
  ok(withTrades === int(h.withTrades) && withTrades === int(d.fWith), `${at}: ${withTrades} members with trades, list says ${h.withTrades}, facts say ${d.fWith}`);
  const total = d.members.reduce((n, m) => n + int(m.trades), 0), total12 = d.members.reduce((n, m) => n + int(m.trades12), 0);
  ok(total === int(d.fTrades), `${at}: member rows add up to ${total} trades, facts say ${d.fTrades}`);
  ok(total12 === int(h.trades12), `${at}: member rows add up to ${total12} trades in 12 months, list says ${h.trades12}`);
  ok(d.members.every((m) => int(m.trades12) <= int(m.trades) && (int(m.trades) > 0) === (m.latest !== "")), `${at}: each member's counts and latest date agree`);
  ok(new Set(d.members.map((m) => m.href)).size === d.members.length && d.members.every((m) => m.href?.startsWith("/congress/")), `${at}: every member links to a member page, once`);
  const latest = d.members.map((m) => (m.latest ? Date.parse(m.latest + " UTC") : 0)).reduce((a, b) => Math.max(a, b), 0);
  ok((latest ? Date.parse(h.latest + " UTC") : 0) === latest || (!latest && h.latest === ""), `${at}: the list's latest disclosure is the newest among its members`);
  if (dirCounts) ok((dirCounts[h.code] ?? 0) === d.members.length, `${at}: the directory's committee filter has ${dirCounts[h.code] ?? 0} members, the page ${d.members.length}`);
  if (csvTrades.size) for (const m of d.members) ok((csvTrades.get(m.href) ?? csvTrades.get(m.name)) === int(m.trades), `${at}: ${m.name} has ${m.trades} trades here, ${csvTrades.get(m.href) ?? csvTrades.get(m.name)} in congress-members.csv`);
  // Trade table: the newest rows, at most TRADE_ROWS, all by members of this committee.
  ok(d.filers.length === Math.min(total, TRADE_ROWS), `${at}: trade table has ${d.filers.length} rows, expected ${Math.min(total, TRADE_ROWS)}`);
  const hrefs = new Set(d.members.map((m) => m.href));
  ok(d.filers.every((f) => hrefs.has(f)), `${at}: every trade row is by a listed member`);
  tradeRows += d.filers.length;
  ok(d.stocks.length <= STOCK_ROWS && d.stocks.every((s) => int(s.buys) + int(s.sells) <= int(s.trades) && int(s.members) >= 1 && int(s.members) <= withTrades), `${at}: most-traded table is consistent`);
  ok(d.stocks.every((s, i) => i === 0 || int(d.stocks[i - 1].trades) >= int(s.trades)), `${at}: most-traded table is in order`);
  ok((d.stocks.length > 0) === (total12 > 0 && d.stocks.length > 0) && (total12 > 0 || d.stocks.length === 0), `${at}: most-traded table only with trades in 12 months`);
  ok(d.title.replace(/ [|·] Spot the Money$/, "").length <= 60 || d.title.length <= 75, `${at}: title is ${d.title.length} characters`);
  // Lobbyist contributions naming members: counts only, from the member pages' own data.
  if (d.lcc) {
    ok(int(d.lcc.n) === d.lcc.rows.length && d.lcc.rows.length > 0 && d.lcc.rows.length <= d.members.length, `${at}: lobbyist section says ${d.lcc.n}, has ${d.lcc.rows.length} rows, ${d.members.length} members`);
    ok(new RegExp(`^${d.lcc.rows.length} current members? of the ${d.members.length} on record (is|are) named as honoree`).test(d.lcc.summary), `${at}: lobbyist summary reads "${d.lcc.summary}"`);
    ok(d.lcc.caveat.includes("A committee seat is context only") && d.lcc.caveat.includes("nothing here ties a contribution"), `${at}: lobbyist caveat is missing`);
    ok(!/[$\u2013\u2014]/.test(d.lcc.text) && !BAD.test(d.lcc.text), `${at}: a dollar figure, a dash or conflict wording in the lobbyist section`);
    const names = new Set(d.members.map((m) => m.href));
    ok(d.lcc.rows.every((r) => names.has(r.href)), `${at}: a lobbyist row names someone who is not a member`);
    ok(d.lcc.rows.every((r, i) => i === 0 || int(d.lcc.rows[i - 1].items) >= int(r.items)), `${at}: lobbyist rows are not in order of items`);
    for (const r of d.lcc.rows.slice(0, 6)) {
      const html = await (await fetch(base + r.href)).text();
      const sec = html.match(/<section[^>]*data-lobby-contrib[^>]*>/)?.[0] ?? "";
      ok(Number(sec.match(/data-items="(\d+)"/)?.[1] ?? -1) === int(r.items), `${at}: ${r.name} has ${r.items} items here, ${sec.match(/data-items="(\d+)"/)?.[1]} on their own page`);
      const dates = [...html.matchAll(/<tr data-lc-item[^>]*>\s*<td[^>]*>([^<]*)<\/td>/g)].map((m) => Date.parse(m[1].trim() + " UTC")).filter((x) => !Number.isNaN(x));
      const want = dates.length ? Math.max(...dates) : 0;
      ok((r.newest ? Date.parse(r.newest + " UTC") : 0) === want, `${at}: ${r.name} newest item ${r.newest || "none"} here, differs on their own page`);
    }
    lcPages++;
  } else {
    // no section: no member of this committee has a lobbyist section of their own
    for (const m of d.members.slice(0, 3)) { const html = await (await fetch(base + m.href)).text(); ok(!/data-lobby-contrib/.test(html) || lcAbsentOk, `${at}: ${m.name} has a lobbyist section but the committee shows none`); }
  }
  // Two members' own pages link back to this committee.
  for (const m of d.members.filter((x) => !backlinksChecked.has(x.href)).slice(0, 2)) {
    backlinksChecked.add(m.href);
    const html = await (await fetch(base + m.href)).text();
    ok(html.includes(`href="${h.href}"`), `${m.name}'s page links to ${h.href}`);
  }
}

// Phone width: the list and the first committee page.
const phone = await browser.newPage({ viewport: { width: 390, height: 800 } });
for (const p of [HUB, picked[0].href]) {
  await phone.goto(base + p, { waitUntil: "load" });
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, `${p} runs ${over}px off the side at 390px`);
}
await phone.close();
ok(errors.length === 0, `page errors: ${errors.slice(0, 3).join(" | ")}`);

console.log(failures ? `verify-committees: ${failures} problem(s) in ${checks} checks` : `verify-committees: ${hub.length} committees listed, ${pages} pages read, ${tradeRows} trade rows, ${lcPages} with a lobbyist section, ${checks} checks pass`);
await browser.close();
process.exit(failures ? 1 : 0);
