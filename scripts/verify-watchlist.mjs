// Checks the watchlist cards (web/src/lib/watchcards*.ts, web/src/scripts/watchcards.ts) in a real
// browser, with the account API answered in the browser so no sign-in is needed:
//   node scripts/verify-watchlist.mjs <base-url>        e.g. http://127.0.0.1:4321 or https://spotthemoney.com
// Needs: npm i --no-save playwright axe-core (with the other --no-save tools, in ONE command).
// It reads the served /data/watch/*.json files, picks a stock and a company with trades in the
// window, a member and an insider, then renders /watchlist/ (desktop light, phone dark) and the
// shared-list page and checks: one row per item, a mini-chart slot for each chartable stock or
// company, bars for each person, the figures shown match the card files, no page errors, no
// sideways scrolling, and axe (WCAG 2 A/AA) finds nothing. TradingView is blocked: the frames are
// theirs, and only the slot is ours.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const base = (process.argv[2] || "http://127.0.0.1:4321").replace(/\/$/, "");
const SHARDS = { stock: 16, company: 8, member: 4, insider: 32 };
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

async function cards(kind) {
  const out = {};
  for (let n = 0; n < SHARDS[kind]; n++) {
    const r = await fetch(`${base}/data/watch/${kind}-${n}.json`);
    ok(r.ok, `/data/watch/${kind}-${n}.json is served`);
    if (r.ok) Object.assign(out, (await r.json()).cards);
  }
  return out;
}
const stock = await cards("stock"), company = await cards("company"), member = await cards("member"), insider = await cards("insider");
const pick = (all, f) => Object.entries(all).filter(([, c]) => f(c)).sort((a, b) => a[0].localeCompare(b[0]))[0];
const s = pick(stock, (c) => c.chart && c.insiderCount && c.memberCount) ?? pick(stock, (c) => c.chart && (c.insiderCount || c.memberCount));
const co = pick(company, (c) => c.chart && (c.insiderCount || c.memberCount));
const m = pick(member, (c) => c.rows > 0);
const ins = pick(insider, (c) => c.rows > 0);
ok(!!(s && co && m && ins), "found a stock, a company, a member and an insider with trades in the window");
if (!(s && co && m && ins)) process.exit(1);
const items = [
  { kind: "stock", key: s[0], label: s[1].ticker }, { kind: "company", key: co[0], label: co[1].name },
  { kind: "member", key: m[0], label: m[1].name }, { kind: "insider", key: ins[0], label: ins[1].name },
  { kind: "insider", key: "no-such-page-xyz", label: "A page that no longer exists" },
];
const me = { signedIn: true, available: true, email: "verify@example.com", new_count: 0, lists: [{ id: "11111111-1111-1111-1111-111111111111", name: "Verify list", is_default: true, is_public: false, share_slug: null, items }] };
const axeSrc = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const [label, path, dark, viewport] of [
  ["own list, desktop light", "/watchlist/", false, { width: 1280, height: 900 }],
  ["own list, phone dark", "/watchlist/", true, { width: 390, height: 844 }],
  ["shared list, desktop", "/watchlist/shared/#abcdefabcdef", false, { width: 1280, height: 900 }],
]) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: "stm_signed_in", value: "1", url: base }]);
  if (dark) await ctx.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/(tradingview\.com|tradingview-widget\.com|googletagmanager\.com|google-analytics\.com|cloudflareinsights\.com)/, (r) => r.abort());
  await page.route("**/api/me", (r) => r.fulfill({ json: me }));
  await page.route("**/api/feed", (r) => r.fulfill({ json: { rows: [] } }));
  await page.route("**/api/seen", (r) => r.fulfill({ json: me }));
  await page.route("**/api/public?slug=*", (r) => r.fulfill({ json: { name: "Verify list", updated_at: "2026-10-10", items, recent: [] } }));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForSelector(".wl-row .wl-who", { timeout: 20000 }).catch(() => {});
  const got = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".wl-row")];
    return {
      rows: rows.length,
      plain: rows.filter((r) => r.classList.contains("wl-row-plain")).length,
      minis: [...document.querySelectorAll("[data-tv-mini]")].map((e) => ({ sym: e.getAttribute("data-tv-mini"), href: e.getAttribute("data-tv-href"), range: e.getAttribute("data-tv-range") })),
      bars: document.querySelectorAll("svg.wl-bars[aria-label]").length,
      groups: rows.slice(0, 2).map((r) => [...r.querySelectorAll(".wl-who-group h4")].map((h) => h.textContent)),
      people: rows.slice(2, 4).map((r) => r.querySelector(".wl-who")?.textContent ?? ""),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(got.rows === items.length && got.plain === 1, `${label}: ${items.length} rows, the missing page shown plain`);
  ok(got.minis.length === 2 && got.minis.every((x) => x.range === "3M" && x.href?.startsWith("/")), `${label}: two mini-chart slots, 3M, linking to our pages`);
  ok(got.minis[0]?.sym === s[1].ticker.toUpperCase() && got.minis[1]?.sym === co[1].ticker.toUpperCase(), `${label}: chart symbols ${got.minis.map((x) => x.sym).join(", ")}`);
  ok(got.bars === 2, `${label}: monthly bars for the member and the insider`);
  const want = (c) => [c.insiderCount ? `Corporate insiders (${c.insiderCount})` : null, c.memberCount ? `Members of Congress (${c.memberCount})` : null].filter(Boolean);
  ok(JSON.stringify(got.groups) === JSON.stringify([want(s[1]), want(co[1])]), `${label}: who-traded counts match the card files ${JSON.stringify(got.groups)}`);
  ok(got.people[0].includes(`${m[1].rows} trade`) && got.people[1].includes(`${ins[1].rows} row`), `${label}: person totals match the card files`);
  ok(!got.overflow, `${label}: no sideways scrolling`);
  ok(errors.length === 0, `${label}: no page errors ${errors.join("; ")}`);
  await page.addScriptTag({ content: axeSrc });
  const v = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target.join(" ")}`));
  ok(v.length === 0, `${label}: axe finds nothing ${v.join("; ")}`);
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✓ watchlist cards check passed");
process.exit(failures ? 1 : 0);
