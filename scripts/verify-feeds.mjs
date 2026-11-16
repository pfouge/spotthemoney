// Checks the RSS feeds (/feeds/ and /feeds/<id>.xml; web/src/lib/feeds.ts) against the CSV
// downloads, which other code writes from the same rows:
//   node scripts/verify-feeds.mjs <base-url> [--sample N]      e.g. http://127.0.0.1:4321
// No browser. For each feed: the XML is well formed (tags balance, no stray "&"), ids are
// unique, items are newest first and never dated in the future, every link opens a page on
// this site that holds the row's anchor (N pages per feed, default all), and the description
// names the original filing. The items are then recounted from the CSV files: how many there
// should be and on which disclosure days (for insiders: one per filing and direction, open-market
// purchases and sales only, never a row under review or a repeat filing). The /feeds/ page must
// state the same counts, every page must advertise the feeds, and no item may carry advice wording.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : Infinity;
const FEEDS = [
  { id: "congress-trades", limit: 200, page: "/congress/" },
  { id: "insider-purchases", limit: 100, page: "/insiders/" },
  { id: "insider-trades", limit: 200, page: "/insiders/" },
];
const today = new Date().toISOString().slice(0, 10);
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } };
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text(), type: r.headers.get("content-type") ?? "" }; };
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?: [^>]*)?>([\\s\\S]*?)</${name}>`, "g"))].map((m) => unxml(m[1]));

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
  return out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
/** Tags balance and nest; every "&" starts one of the five XML entities or a numeric one. */
function wellFormed(xml) {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) return "no XML declaration";
  const body = xml.replace(/^<\?xml[^>]*\?>/, "");
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(body)) return "a stray & in the text";
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z:]+)([^>]*?)(\/?)>/g)) {
    if (m[4] === "/") continue;
    if (m[1] === "/") { if (stack.pop() !== m[2]) return `</${m[2]}> closes the wrong tag`; } else stack.push(m[2]);
  }
  if (stack.length) return `<${stack.at(-1)}> is never closed`;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(body)) return "a control character XML does not allow";
  return null;
}
const sameCounts = (a, b) => { const k = (m) => JSON.stringify([...m].sort((x, y) => x[0].localeCompare(y[0]))); return k(a) === k(b); };
const countBy = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };

// ── what the feeds should hold, recounted from the CSV files ───────────────────────────────
const csv = async (name) => { const r = await get(`/downloads/${name}`); return r.status === 200 ? parseCsv(r.text) : []; };
const usable = (r) => r.under_review === "false" && /^\d{4}-\d{2}-\d{2}/.test(r.disclosed_date) && r.disclosed_date.slice(0, 10) <= today && r.page_url;
const congressRows = (await csv("congress-trades.csv")).filter(usable);
const insiderRows = (await csv("insider-trades-latest.csv")).filter(usable).filter((r) => r.derivative === "false" && r.also_in_another_filing === "false"
  && ((r.side === "buy" && r.transaction_code === "P") || (r.side === "sell" && r.transaction_code === "S")));
const groupsOf = (rows) => { const m = new Map(); for (const r of rows) { const k = `${r.filing_id}|${r.side}`; const g = m.get(k) ?? { date: r.disclosed_date.slice(0, 10), side: r.side, rows: 0 }; g.rows++; m.set(k, g); } return [...m.values()]; };
const expected = {
  "congress-trades": congressRows.map((r) => ({ date: r.disclosed_date.slice(0, 10), side: r.side, rows: 1 })),
  "insider-purchases": groupsOf(insiderRows.filter((r) => r.side === "buy")),
  "insider-trades": groupsOf(insiderRows),
};

const hub = await get("/feeds/");
ok(hub.status === 200, `/feeds/ answered ${hub.status}`);
ok(hub.text.includes("data-answer"), "/feeds/ has an answer block");
const pageCache = new Map();
const page = async (path) => { if (!pageCache.has(path)) pageCache.set(path, await get(path)); return pageCache.get(path); };
let itemsTotal = 0;

for (const f of FEEDS) {
  const path = `/feeds/${f.id}.xml`;
  const res = await get(path);
  ok(res.status === 200, `${path} answered ${res.status}`);
  if (res.status !== 200) continue;
  const bad = wellFormed(res.text);
  ok(!bad, `${path} is not well-formed XML: ${bad}`);
  ok(/<rss version="2\.0"/.test(res.text) && tag(res.text, "channel").length === 1, `${path} is an RSS 2.0 channel`);
  ok(new RegExp(`<atom:link href="https?://[^"]+${path.replace(/\./g, "\\.")}" rel="self"`).test(res.text), `${path} names its own address`);
  const head = res.text.slice(0, res.text.indexOf("<item>") < 0 ? undefined : res.text.indexOf("<item>"));
  ok(tag(head, "title")[0]?.startsWith("Spot the Money") && tag(head, "description")[0]?.includes("Not investment advice"), `${path} channel has a title and the not-advice line`);
  const items = [...res.text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    title: tag(m[1], "title")[0] ?? "", link: tag(m[1], "link")[0] ?? "", guid: tag(m[1], "guid")[0] ?? "", pub: tag(m[1], "pubDate")[0] ?? "",
    desc: tag(m[1], "description")[0] ?? "", cats: tag(m[1], "category"),
  }));
  itemsTotal += items.length;
  const exp = expected[f.id].sort((a, b) => b.date.localeCompare(a.date));
  const want = exp.slice(0, f.limit);
  ok(items.length === want.length, `${path}: ${items.length} items, the CSV rows give ${want.length} (limit ${f.limit})`);
  ok(items.length <= f.limit, `${path} holds at most ${f.limit} items`);
  ok(new Set(items.map((i) => i.guid)).size === items.length && items.every((i) => i.guid), `${path}: every item has its own id`);
  const dates = items.map((i) => { const d = new Date(i.pub); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); });
  ok(dates.every(Boolean), `${path}: every item has a readable date`);
  ok(dates.every((d, i) => i === 0 || d <= dates[i - 1]), `${path}: items are newest first`);
  ok(dates.every((d) => d <= today), `${path}: no item is dated in the future`);
  ok(sameCounts(countBy(dates), countBy(want.map((w) => w.date))), `${path}: items per disclosure day match the CSV rows`);
  // Sides per day, on the days the feed holds completely (the oldest day can be cut by the limit).
  const whole = (d) => items.length < f.limit || d !== dates.at(-1);
  const sideOf = (i) => (f.id === "congress-trades" ? null : i.cats.includes("Purchase") ? "buy" : i.cats.includes("Sale") ? "sell" : "?");
  if (f.id !== "congress-trades") {
    ok(sameCounts(countBy(items.filter((_, n) => whole(dates[n])).map((i, n) => `${dates[n]} ${sideOf(i)}`)), countBy(want.filter((w) => whole(w.date)).map((w) => `${w.date} ${w.side}`))), `${path}: purchases and sales per day match the CSV rows`);
    ok(items.every((i) => /open-market (purchases|sales)| (bought|sold) /.test(i.title)), `${path}: every item is a purchase or a sale`);
    if (f.id === "insider-purchases") ok(items.every((i) => sideOf(i) === "buy" && / bought /.test(i.title)), `${path}: purchases only`);
    // An item that stands for several rows says how many; the day's rows must add up.
    const rowsIn = (i) => Number((i.title.match(/ in ([\d,]+) open-market /) ?? [, "1"])[1].replace(/,/g, ""));
    const perDay = new Map(); items.forEach((i, n) => { if (whole(dates[n])) perDay.set(dates[n], (perDay.get(dates[n]) ?? 0) + rowsIn(i)); });
    const wantDay = new Map(); for (const w of want) if (whole(w.date)) wantDay.set(w.date, (wantDay.get(w.date) ?? 0) + w.rows);
    ok(sameCounts(perDay, wantDay), `${path}: transactions per day add up to the CSV rows`);
  }
  ok(items.every((i) => i.title.length > 20 && i.title.endsWith(".") && !/under review|undefined|null|NaN/.test(i.title + i.desc)), `${path}: every item has a full sentence`);
  ok(items.every((i) => /Original filing \([^)]+\): https?:\/\/\S+$/.test(i.desc)), `${path}: every description ends with the original filing`);
  ok(!items.some((i) => /\b(should|recommend|signal|bullish|bearish|tip|insider knowledge|suspicious)\b/i.test(i.title + " " + i.desc)), `${path}: no advice or motive wording`);
  ok(items.every((i) => /^https:\/\/[^/]+\/(congress|insiders|stocks)\/[^/]+\/#t\d+$/.test(i.link)), `${path}: every link is a page on this site with a row anchor`);
  ok(items.every((i) => (f.id === "congress-trades" ? i.link.includes("/congress/") : !i.link.includes("/congress/"))), `${path}: links go to the right kind of page`);
  // The linked page exists and holds the row (a filer's table shows the newest 200 rows: only
  // a page with fewer rows than that must hold every anchor).
  const paths = [...new Set(items.map((i) => new URL(i.link).pathname))].slice(0, sample);
  let missing = 0, dead = 0;
  for (const p of paths) {
    const pg = await page(p);
    if (pg.status !== 200) { dead++; continue; }
    const rows = (pg.text.match(/<tr[^>]* id="t\d+"/g) ?? []).length;
    for (const i of items.filter((x) => new URL(x.link).pathname === p)) {
      const id = i.link.split("#")[1];
      if (!pg.text.includes(`id="${id}"`) && rows < 200) missing++;
    }
  }
  ok(dead === 0, `${path}: ${dead} linked page(s) did not open`);
  ok(missing === 0, `${path}: ${missing} item(s) link to a row their page does not hold`);
  // The /feeds/ page states the same count and newest day.
  const row = (hub.text.match(new RegExp(`<li data-feed="${f.id}"[\\s\\S]*?</li>`)) ?? [""])[0];
  ok(row.includes(`data-items="${items.length}"`), `/feeds/ states ${items.length} items for ${f.id}`);
  ok(dates.length === 0 || row.includes(`data-newest="${dates[0]}"`), `/feeds/ states the newest day of ${f.id}`);
  ok(row.includes(`href="${path}"`), `/feeds/ links ${path}`);
}

// Every page advertises the feeds; the section pages link theirs in the text.
for (const p of ["/", "/congress/", "/insiders/", "/feeds/", "/methodology/"]) {
  const pg = await page(p);
  ok(FEEDS.every((f) => pg.text.includes(`<link rel="alternate" type="application/rss+xml" title="`) && pg.text.includes(`href="/feeds/${f.id}.xml"`)), `${p} advertises the feeds in its head`);
}
ok((await page("/congress/")).text.includes("data-feed-link"), "/congress/ links its feed");
ok((await page("/insiders/")).text.includes('data-feed-link'), "/insiders/ links its feeds");
ok((await page("/methodology/")).text.includes('id="feeds"'), "the methodology explains the feeds");
ok((await get("/llms.txt")).text.includes("/feeds/congress-trades.xml"), "llms.txt lists the feeds");
ok((await get("/sitemaps/pages.xml")).text.includes("/feeds/</loc>"), "the sitemap lists /feeds/");

console.log(failures ? `verify-feeds: ${failures} problem(s) in ${checks} checks` : `✓ verify-feeds: ${checks} checks pass (${itemsTotal} items in ${FEEDS.length} feeds)`);
process.exit(failures ? 1 : 0);
