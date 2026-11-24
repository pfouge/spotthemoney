#!/usr/bin/env node
// Military parts orders panel on company and stock pages (web/src/components/MilitaryOrders.astro).
// Usage: node scripts/verify-dla.mjs <base-url> [--db <nsn database url>] [--sample N] [--require]
// Without --db: structure. Each panel's headline figures agree with its data attributes; the parts
// table is sorted by value and capped; latest orders are newest first, inside the window, and none
// is a base contract (a PIID whose ninth character is D, G or A); links go to nsnexplorer.com with a
// dashed NSN and to DIBBS. One company shows the same figures on every page that carries its panel.
// With --db: the orders and value of each panel are recounted from the database, by the supplier
// codes the panel names and from its window start (data-since), with this script's own copy of the
// order rule. The heading says "last 12 months" only when the window is a full year.
// --require fails when no page has a panel (use when the build is known to have read the database).
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a) && !a.startsWith("postgres")) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const db = args.includes("--db") ? args[args.indexOf("--db") + 1] : null;
const sample = args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1]) : 40;
const require = args.includes("--require");
const WINDOW = 365, TOP = 25, LATEST = 25;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const get = async (p) => { const r = await fetch(base + p); return r.ok ? r.text() : null; };
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const sm = await get("/sitemaps/companies.xml");
const stocks = await get("/sitemaps/stocks.xml");
// Listed companies have one page, the stock page (company pages redirect), so both sitemaps are read.
const locs = (x) => [...(x ?? "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const urls = [...locs(stocks), ...locs(sm)];
ok(urls.length > 0, "stock and company sitemaps have no URLs");
const seen = new Map();

const today = new Date().toISOString().slice(0, 10);
const floor = new Date(Date.now() - WINDOW * 864e5).toISOString().slice(0, 10);
const panels = [];
let i = 0;
for (const p of urls) {
  const html = await get(p); if (!html) { fails.push(`${p}: not served`); continue; }
  const m = html.match(/<section[^>]*data-dla[^>]*>[\s\S]*?<\/section>/);
  if (!m) continue;
  panels.push({ p, html: m[0] });
  if (++i >= sample) break;
}
if (require) ok(panels.length > 0, "no company page has a military parts orders panel (--require)");
const rows = (html, sel) => {
  const t = html.match(new RegExp(`<table[^>]*${sel}[^>]*>([\\s\\S]*?)</table>`))?.[1] ?? "";
  return [...t.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].filter((r) => !/<th/.test(r[2])).map((r) => ({ tag: r[1], cells: [...r[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ tag: c[1], html: c[2] })) }));
};
const money = (s) => Number(s.replace(/[^0-9.]/g, ""));
let pg = null;
if (db) { const { default: postgres } = await import("postgres"); pg = postgres(db, { max: 1 }); }

for (const { p, html } of panels) {
  const sec = html.match(/<section[^>]*>/)[0];
  const orders = Number(attr(sec, "data-orders")), value = Number(attr(sec, "data-value")), parts = Number(attr(sec, "data-parts"));
  const cages = (attr(sec, "data-cages") ?? "").split(",").filter(Boolean);
  const first = attr(sec, "data-first"), last = attr(sec, "data-last"), since = attr(sec, "data-since");
  ok(since && since >= floor && since <= today, `${p}: window start ${since} outside ${floor}..${today}`);
  const h2 = unesc(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "");
  ok(since > floor ? /since [A-Z][a-z]+ \d{4}\)/.test(h2) : /last 12 months\)/.test(h2), `${p}: heading "${h2}" does not match window start ${since}`);
  ok(orders > 0 && value > 0 && parts > 0 && parts <= orders, `${p}: figures orders ${orders} value ${value} parts ${parts}`);
  ok(cages.length > 0, `${p}: no supplier codes on the panel`);
  ok(first && last && first >= (since ?? floor) && last <= today && first <= last, `${p}: dates ${first} to ${last} outside ${since}..${today}`);
  const figs = [...html.matchAll(/<span class="v"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  ok(figs.length === 3, `${p}: ${figs.length} headline figures`);
  if (figs.length) ok(figs[0] === orders.toLocaleString("en-US"), `${p}: headline orders "${figs[0]}" vs ${orders}`);
  const summary = unesc(html.match(/data-dla-summary[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "") ?? "");
  ok(summary.includes(`$${value.toLocaleString("en-US")}`) || Math.abs(money(summary.match(/worth (\$[\d,\.]+)/)?.[1] ?? "0") - value) <= 1, `${p}: summary value "${summary.slice(0, 120)}" vs ${value}`);
  for (const c of cages) ok(new RegExp(`href="https://nsnexplorer\\.com/supplier/${c}/"`).test(html), `${p}: supplier ${c} not linked`);
  const pr = rows(html, "data-dla-parts");
  ok(pr.length > 0 && pr.length <= Math.min(TOP, parts), `${p}: parts table ${pr.length} rows for ${parts} parts`);
  const pv = pr.map((r) => Number(attr(r.cells[3]?.tag ?? "", "data-v")));
  ok(pv.every((v, k) => k === 0 || v <= pv[k - 1]), `${p}: parts table not sorted by value`);
  ok(pv.reduce((a, b) => a + b, 0) <= value + pr.length, `${p}: parts table sums above the total`);
  for (const r of pr) ok(/href="https:\/\/nsnexplorer\.com\/nsn\/\d{4}-\d{2}-\d{3}-\d{4}\/"/.test(r.cells[1]?.html ?? ""), `${p}: parts row NSN link ${r.cells[1]?.html.slice(0, 80)}`);
  const lr = rows(html, "data-dla-latest");
  ok(lr.length > 0 && lr.length <= Math.min(LATEST, orders), `${p}: latest table ${lr.length} rows for ${orders} orders`);
  const ld = lr.map((r) => attr(r.cells[0]?.tag ?? "", "data-v"));
  ok(ld.every((d, k) => k === 0 || d <= ld[k - 1]), `${p}: latest orders not newest first`);
  ok(ld[0] === last?.replaceAll("-", ""), `${p}: newest order ${ld[0]} vs panel last ${last}`);
  for (const r of lr) {
    const piid = attr(r.tag, "data-piid") ?? "";
    ok(!["D", "G", "A"].includes(piid.charAt(8).toUpperCase()), `${p}: a base contract is listed as an order: ${piid}`);
    ok(/href="https:\/\/www\.dibbs\.bsm\.dla\.mil\//.test(r.cells[5]?.html ?? "") || /—/.test(r.cells[5]?.html ?? ""), `${p}: order ${piid} source link`);
  }
  ok(/href="\/methodology\/#parts-orders"/.test(html), `${p}: no link to the methodology`);
  ok(!/\b(bribe|kickback|influence|corrupt|suspicious)/i.test(html), `${p}: judgement wording in the panel`);
  // one company, one set of figures, wherever its panel appears
  const cid = attr(sec, "data-company"), prev = seen.get(cid);
  if (prev) ok(prev.orders === orders && prev.value === value, `${p}: panel differs from ${prev.p} for the same company`);
  else seen.set(cid, { p, orders, value });
  if (pg) {
    const [r] = await pg.unsafe(`
      select count(*)::int as n, coalesce(round(sum(obligation)), 0)::float8 as v, min(action_date)::text as f, max(action_date)::text as l, count(distinct raw->>'nsn')::int as parts
        from pub.contract_actions
       where raw->>'cage' = any($1) and action_date >= $2::date and action_date <= current_date and obligation > 0
         and raw->>'nsn' is not null
         and (coalesce(raw->>'deliveryOrder', '') <> '' or upper(substr(coalesce(raw->>'awardNumber', ''), 9, 1)) not in ('D', 'G', 'A'))`, [cages, since]);
    ok(r.n === orders, `${p}: ${orders} orders on the page, ${r.n} in the database`);
    ok(Math.abs(r.v - value) <= 1, `${p}: value ${value} on the page, ${r.v} in the database`);
    ok(r.parts === parts && r.f === first && r.l === last, `${p}: parts/first/last ${parts}/${first}/${last} vs ${r.parts}/${r.f}/${r.l}`);
  }
}
if (pg) await pg.end();
const ms = await get("/methodology/");
if (panels.length) ok(/id="parts-orders"/.test(ms ?? ""), "methodology has no #parts-orders while panels are shown");
else ok(!/id="parts-orders"/.test(ms ?? ""), "methodology describes parts orders but no page shows them");
console.log(`verify-dla: ${panels.length} panels read${db ? " and recounted from the database" : ""}; ${pass} checks pass, ${fails.length} fail`);
for (const f of fails.slice(0, 40)) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
