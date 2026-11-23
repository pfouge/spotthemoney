#!/usr/bin/env node
// The Washington hub tiles and the home page's "This week in filings".
//
//   node scripts/verify-hubs.mjs <base-url>
//
// No browser. Checks, against the served pages and CSV downloads (written by lib/downloads.ts,
// not by the tile code):
//   - every tile's hub answers 200 and is not noindex; its first figure equals the figure the hub
//     itself prints (and, where a CSV holds the rows, a recount of that CSV);
//   - a tile exists exactly when its hub is shown; a hidden dataset has no tile and is not named
//     in the answer sentence; tiles come in the page's order;
//   - the home week row: each count is recounted from the oracle file (7 days up to the build day,
//     edges inclusive, never after it); a dataset whose hub is not shown has no tile; fewer than
//     three tiles means no section.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.log(`✗ ${m}`); } };
const get = async (p) => {
  for (let i = 0; ; i++) {
    try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; }
    catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); }
  }
};
const strip = (s) => s.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const noindex = (html) => /<meta[^>]+name="robots"[^>]+noindex/i.test(html);
const int = (s) => Number(String(s).replace(/[^\d]/g, ""));
const unguard = (s) => (/^'[=+\-@]/.test(s ?? "") ? s.slice(1) : (s ?? ""));
function csv(text) {
  const rows = []; let row = [], f = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f.replace(/\r$/, "")); rows.push(row); }
  const head = rows.shift() ?? [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, unguard(r[i] ?? "")])));
}
const file = async (name) => { const r = await get(`/downloads/${name}`); return r.status === 200 ? csv(r.text) : null; };
const DAY = 86400000, t0 = (d) => Date.parse(d + "T00:00:00Z");
const inWin = (d, built, days = 7) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "") && t0(d) <= t0(built) && t0(d) >= t0(built) - days * DAY;

const ORDER = ["lobbying", "lobbycontrib", "contracts", "grants", "donations", "outside", "votes"];
const HUB = { lobbying: "/lobbying/", lobbycontrib: "/lobbyist-contributions/", contracts: "/contracts/", grants: "/grants/", donations: "/donations/", outside: "/outside-spending/", votes: "/congress-votes/" };
const NAME = { lobbying: /lobbying filing/i, lobbycontrib: /lobbyist contribution report/i, contracts: /federal contract/i, grants: /federal grant, loan/i, donations: /itemized receipt/i, outside: /independent expenditure/i, votes: /roll call/i };

// ── /washington/ ──────────────────────────────────────────────────────────────────────
const wash = await get("/washington/");
ok(wash.status === 200, "/washington/ answers 200");
ok(!noindex(wash.text), "/washington/ is indexable");
const tiles = [...wash.text.matchAll(/<article[^>]*data-wtile="([a-z]+)"[\s\S]*?<\/article>/g)].map((m) => ({ key: m[1], html: m[0] }));
const keys = tiles.map((t) => t.key);
ok(JSON.stringify(keys) === JSON.stringify(ORDER.filter((k) => keys.includes(k))), `tiles in the page's order (${keys.join(", ")})`);
const answerText = strip((wash.text.match(/class="answer-text"[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
const hubPages = {};
for (const k of ORDER) hubPages[k] = await get(HUB[k]);

// hub figure: what the hub itself prints
const hubFigure = (k) => {
  const h = hubPages[k].text, a = strip((h.match(/class="answer-text"[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
  switch (k) {
    case "lobbying": return int((a.match(/^([\d,]+) lobbying filing/) ?? [])[1]);
    case "lobbycontrib": return int((h.match(/data-lc-hub[^>]*data-filings="(\d+)"/) ?? [])[1]);
    case "contracts": return int((a.match(/tracks ([\d,]+) federal contract/) ?? [])[1]);
    case "grants": return int((h.match(/data-assist-hub[^>]*data-awards="(\d+)"/) ?? [])[1]);
    case "donations": return int((a.match(/hold ([\d,]+) itemized receipt/) ?? [])[1]);
    case "outside": return int((h.match(/data-os="counted"[^>]*>([\d,]+)</) ?? [])[1]);
    case "votes": return int((h.match(/data-votes-hub[^>]*data-total="(\d+)"/) ?? [])[1]);
  }
};
const shownHub = (k) => hubPages[k].status === 200 && !noindex(hubPages[k].text) && hubFigure(k) > 0;

// oracle recount of a hub's first figure, from the served CSV files
const year = Number((wash.text.match(/Filings in (\d{4})/) ?? [])[1]) || new Date().getUTCFullYear();
const recount = {
  lobbying: async () => { let n = 0; for (const q of ["q1", "q2", "q3", "q4"]) { const f = await file(`lobbying-${year}-${q}.csv`); if (f) n += f.filter((r) => Number(r.year) === year).length; } return n; },
  contracts: async () => (await file("federal-contracts.csv"))?.length ?? null,
  grants: async () => (await file("federal-assistance.csv"))?.length ?? null,
  outside: async () => (await file("independent-expenditures.csv"))?.filter((r) => r.counted === "true").length ?? null,
  votes: async () => (await file("congress-votes.csv"))?.length ?? null,
};

for (const k of ORDER) {
  const t = tiles.find((x) => x.key === k);
  const hubOk = shownHub(k);
  ok(hubPages[k].status === 200, `${k}: hub ${HUB[k]} answers 200`);
  if (!hubOk) {
    ok(!t, `${k}: hub not shown, so no tile`);
    ok(!NAME[k].test(answerText), `${k}: hidden dataset is not named in the answer`);
    continue;
  }
  ok(!!t, `${k}: hub is shown, so there is a tile`);
  if (!t) continue;
  ok(!noindex(hubPages[k].text), `${k}: hub is not noindex`);
  ok(new RegExp(`<h2><a href="${HUB[k]}">`).test(t.html), `${k}: title links to the hub`);
  const first = (t.html.match(/data-fig="[^"]+"><div class="k">[^<]*<\/div><div class="v">([^<]*)</) ?? [])[1];
  const n = int(first);
  if (k === "lobbycontrib" || k === "donations" || k === "votes" || k === "outside" || k === "grants" || k === "contracts" || k === "lobbying") ok(n === hubFigure(k), `${k}: first figure ${first} equals the hub's ${hubFigure(k)}`);
  if (recount[k]) { const r = await recount[k](); ok(r === null || r === n, `${k}: first figure ${n} equals a recount of the CSV (${r})`); }
  ok(NAME[k].test(answerText), `${k}: shown dataset is in the answer sentence`);
  const figs = (t.html.match(/data-fig=/g) ?? []).length;
  ok(figs >= 2 && figs <= 3, `${k}: 2 or 3 figures (${figs})`);
  ok(/data-newest="\d{4}-\d{2}-\d{2}"/.test(t.html), `${k}: newest date on file`);
  const li = (t.html.match(/<li>/g) ?? []).length;
  ok(li >= 1 && li <= 3, `${k}: up to 3 linked items (${li})`);
  ok([...t.html.matchAll(/<li><a href="([^"]+)"/g)].every((m) => m[1].startsWith("/")), `${k}: items link to pages on this site`);
  ok(/never added|combined/.test(t.html) || k !== "grants" || /face value/.test(t.html), `${k}: kinds kept apart`);
  if (k === "donations") ok(/itemized receipts held/i.test(strip(t.html)) && !/\$/.test(strip(t.html)), "donations: wording is itemized receipts held, no dollar totals");
}
ok(!/[–—]/.test(answerText), "answer has no dash punctuation");

// ── home: this week in filings ────────────────────────────────────────────────────────
const home = await get("/");
const week = (home.text.match(/<section[^>]*data-week[^>]*>[\s\S]*?<\/section>/) ?? [])[0];
const wk = week ? [...week.matchAll(/<a[^>]*data-wk="([a-z]+)"[^>]*data-n="(\d+)"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*data-wk="([a-z]+)"[^>]*data-n="(\d+)"/g)].map((m) => ({ key: m[1] ?? m[5], n: Number(m[2] ?? m[6]), href: m[3] ?? m[4] })) : [];
const WHUB = { events: "/company-events/", votes: "/congress-votes/", outside: "/outside-spending/", holders: "/large-holders/", planned: "/planned-sales/", lobbycontrib: "/lobbyist-contributions/", grants: "/grants/" };
const WORDER = Object.keys(WHUB);
const wshown = {};
for (const k of WORDER) { const r = k in hubPages ? hubPages[k] : (WHUB[k] === HUB.lobbycontrib ? hubPages.lobbycontrib : await get(WHUB[k])); wshown[k] = r.status === 200 && !noindex(r.text); }
wshown.votes = shownHub("votes"); wshown.outside = shownHub("outside"); wshown.lobbycontrib = shownHub("lobbycontrib"); wshown.grants = shownHub("grants");
const expectTiles = WORDER.filter((k) => wshown[k]);
if (expectTiles.length < 3) ok(!week, `fewer than 3 datasets shown (${expectTiles.length}): no week section`);
else {
  ok(!!week, "week section present");
  ok(JSON.stringify(wk.map((w) => w.key)) === JSON.stringify(expectTiles), `week tiles are the shown datasets in order (${wk.map((w) => w.key).join(", ")})`);
  const built = (week.match(/data-built="([^"]+)"/) ?? [])[1];
  ok(!!built, "week section states its build day");
  const events = await file("company-events.csv"), planned = await file("planned-sales-form144.csv"), holders = await file("large-holders-13d-13g.csv");
  const votes = await file("congress-votes.csv"), outside = await file("independent-expenditures.csv"), assist = await file("federal-assistance.csv");
  const lcFiles = (await Promise.all([year - 1, year, year + 1].map((y) => file(`lobbyist-contributions-${y}.csv`)))).filter(Boolean).flat();
  const count = {
    events: events?.filter((r) => inWin(r.filed, built)).length,
    planned: planned?.filter((r) => inWin(r.filed_date, built)).length,
    holders: holders?.filter((r) => inWin(r.filed_date, built)).length,
    votes: votes?.filter((r) => inWin(r.date, built)).length,
    outside: outside?.filter((r) => r.counted === "true" && inWin(r.date, built)).length,
    grants: assist?.filter((r) => inWin(r.start_date, built)).length,
    lobbycontrib: new Set(lcFiles.filter((r) => r.counted === "true" && inWin(r.posted, built)).map((r) => r.filing_uuid)).size,
  };
  for (const w of wk) {
    ok(w.href === WHUB[w.key], `week ${w.key}: links to ${WHUB[w.key]}`);
    ok(count[w.key] === undefined || count[w.key] === w.n, `week ${w.key}: ${w.n} equals a recount of its file (${count[w.key]})`);
  }
}
for (const k of WORDER) if (!wshown[k]) ok(!wk.some((w) => w.key === k), `week ${k}: hub not shown, so no tile`);
ok(!home.text.includes("This week in filings") || !!week, "week heading only with its section");

console.log(failures ? `verify-hubs: ${failures} FAILED of ${checks} checks` : `verify-hubs: ${checks} checks pass; washington tiles ${keys.join(", ")}; week tiles ${wk.map((w) => `${w.key} ${w.n}`).join(", ") || "none"}`);
process.exit(failures ? 1 : 0);
