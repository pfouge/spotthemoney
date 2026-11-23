#!/usr/bin/env node
// Institutional holders (SEC Form 13F): the section on stock and company pages and the hub.
//
//   node scripts/verify-inst.mjs <base-url> [--sample N]
//   DATABASE_URL=... node scripts/verify-inst.mjs <base-url>     (also recounts from inst_holdings)
//
// No browser. The state is read from the files the build wrote: when
// /downloads/institutional-holders-by-company.csv exists the section is shown, otherwise the hub
// must say it is being refreshed and no company page may carry a section.
//
// Oracles: the two CSV files (written by lib/downloads.ts, not by the components) and, when a
// database URL is given, set-based SQL over inst_holdings with this script's own copy of the rules
// (newest quarter end with at least 1,000 managers; share rows only; Put and Call rows counted
// separately). Wording: no percentage of a company, no "institutional ownership of".
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const si = args.indexOf("--sample");
const SAMPLE = si >= 0 && Number(args[si + 1]) > 0 ? Number(args[si + 1]) : 12;
const TOP = 25, HUB_MANAGERS = 200;
let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.log(`✗ ${m}`); } };
const get = async (p) => { for (let i = 0; ; i++) { try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; } catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); } } };
const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const nf = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
function parseCsv(src) {
  const out = []; let row = [], cell = "", q = false; const s = src.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) { const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch; }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const head = out.shift() ?? [];
  return { head, rows: out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))) };
}
const section = (html) => { const i = html.indexOf("data-inst-holders"); if (i < 0) return null; const s = html.lastIndexOf("<section", i); const e = html.indexOf("</section>", i); return html.slice(s, e); };
const tag = (html) => html.slice(0, html.indexOf(">") + 1);
const attr = (t, n) => (t.match(new RegExp(`${n}="([^"]*)"`)) ?? [])[1];
const rowsOf = (html) => [...html.slice(Math.max(0, html.indexOf("<tbody"))).matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => ({ tag: m[1], html: m[2], cells: [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ tag: c[1], html: c[2], text: text(c[2]) })) }));
const BAD = [/institutional ownership of/i, /%\s*of\s+(the\s+)?shares/i, /\bpercent of (the )?(company|shares)/i];

const co = await get("/downloads/institutional-holders-by-company.csv");
const rowsCsv = await get("/downloads/institutional-holders.csv");
const shown = co.status === 200;
const hub = await get("/institutional-holders/");
const sitemap = await get("/sitemaps/pages.xml");
const llms = await get("/llms.txt");

if (!shown) {
  ok(hub.status === 200 && /noindex/.test(hub.text) && /being refreshed/i.test(text(hub.text)), "not shown: the hub is a noindex 'being refreshed' page");
  ok(!sitemap.text.includes("/institutional-holders/"), "not shown: hub absent from the sitemap");
  ok(!llms.text.includes("/institutional-holders/"), "not shown: hub absent from llms.txt");
  ok(!/institutional-holders\.csv/.test((await get("/downloads/")).text), "not shown: no CSV in the downloads hub");
  for (const p of ["/stocks/nvda/", "/companies/nvidia-corp/"]) { const r = await get(p); if (r.status === 200) ok(!section(r.text), `not shown: no section on ${p}`); }
  console.log(`verify-inst: 13F not shown; ${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}

const comp = parseCsv(co.text).rows;
const rows = parseCsv(rowsCsv.text).rows;
ok(comp.length > 0, "by-company file has rows");
const period = comp[0]?.quarter_end;
ok(comp.every((r) => r.quarter_end === period), "one quarter in the by-company file");
for (const r of comp) ok(Number(r.managers) >= 1, `${r.company}: managers >= 1`);
ok(rows.length <= comp.length * TOP, "manager file has at most 25 rows per company");
const byCik = new Map();
for (const r of rows) { if (!byCik.has(r.cik)) byCik.set(r.cik, []); byCik.get(r.cik).push(r); }
for (const c of comp) {
  const list = byCik.get(c.cik) ?? [];
  if (list.length) {
    ok(list.length === Math.min(TOP, Number(c.managers)), `${c.company}: ${list.length} manager rows, expected ${Math.min(TOP, Number(c.managers))}`);
    for (let i = 1; i < list.length; i++) ok(Number(list[i - 1].reported_value) >= Number(list[i].reported_value), `${c.company}: manager rows by value, desc`);
  }
  ok(Number(c.shares_summed) >= Math.max(0, ...list.map((r) => Number(r.shares))), `${c.company}: summed shares cover the largest manager`);
}

// Optional independent recount from the database.
if (process.env.DATABASE_URL) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const per = await sql`select period::text p, count(distinct manager_cik)::int n from inst_holdings group by 1 having count(distinct manager_cik) >= 1000 order by 1 desc`;
  ok(per[0]?.p === period, `SQL: newest quarter with 1,000+ managers is ${per[0]?.p}, file says ${period}`);
  const agg = await sql`select issuer_cik, count(distinct manager_cik)::int m, sum(shares)::float8 s, sum(value)::float8 v from inst_holdings where period = ${period} and put_call = '' and amount_type = 'SH' group by 1`;
  const opt = await sql`select issuer_cik, count(distinct manager_cik)::int o from inst_holdings where period = ${period} and put_call <> '' group by 1`;
  const om = new Map(opt.map((r) => [r.issuer_cik, r.o]));
  const am = new Map(agg.map((r) => [r.issuer_cik, r]));
  for (const c of comp) {
    const a = am.get(c.cik);
    ok(a && a.m === Number(c.managers), `SQL: ${c.company} managers ${a?.m} vs file ${c.managers}`);
    ok(a && Math.abs(a.s - Number(c.shares_summed)) < 1, `SQL: ${c.company} summed shares`);
    ok(a && Math.abs(a.v - Number(c.value_summed)) < 1, `SQL: ${c.company} summed value`);
    ok((om.get(c.cik) ?? 0) === Number(c.managers_with_options), `SQL: ${c.company} managers with options`);
  }
  await sql.end();
}

// Company pages: the section against the files.
const pick = [...comp].sort((a, b) => Number(b.managers) - Number(a.managers));
const sample = [...pick.slice(0, 3), ...pick.slice(-2), ...pick.slice(3, SAMPLE)].filter((v, i, a) => a.indexOf(v) === i).slice(0, SAMPLE);
let pages = 0;
for (const c of sample) {
  const slugUrl = rows.find((r) => r.cik === c.cik)?.page_url;
  const paths = [slugUrl ? new URL(slugUrl).pathname : null, c.ticker ? `/stocks/${c.ticker.toLowerCase()}/` : null].filter(Boolean);
  for (const p of paths) {
    const r = await get(p); if (r.status !== 200) continue;
    const sec = section(r.text);
    if (!sec) { if (p.startsWith("/companies/")) ok(false, `${p}: no section though the file lists the company`); continue; }
    const t = tag(sec); if (attr(t, "data-cik") !== c.cik) continue; // a stock page of a different company
    pages++;
    ok(attr(t, "data-managers") === c.managers, `${p}: managers ${attr(t, "data-managers")} vs ${c.managers}`);
    ok(attr(t, "data-options") === c.managers_with_options, `${p}: options ${attr(t, "data-options")} vs ${c.managers_with_options}`);
    ok(attr(t, "data-period") === c.quarter_end, `${p}: period`);
    const tx = text(sec);
    ok(tx.includes(`${nf(c.managers)} institutional manager`), `${p}: sentence states ${nf(c.managers)} managers`);
    if (Number(c.managers_with_options) > 0) ok(/put or call options/.test(tx), `${p}: names the managers with options`);
    for (const re of BAD) ok(!re.test(tx), `${p}: wording ${re}`);
    ok(!/%/.test(tx), `${p}: no percentage anywhere in the section`);
    ok(!/\bnew\b/i.test(rowsOf(sec).map((x) => x.text ?? x.cells.map((c) => c.text).join(" ")).join(" ")), `${p}: no 'new' in the rows`);
    const trs = rowsOf(sec), list = byCik.get(c.cik) ?? [];
    ok(trs.length === list.length, `${p}: ${trs.length} rows vs ${list.length} in the file`);
    const hasPrior = !!c.prior_quarter_end && c.managers_prior_quarter !== "";
    for (const tr of trs) {
      const cik = attr("<x " + tr.tag + ">", "data-manager"); const f = list.find((x) => x.manager_sec_number === cik);
      if (!f) { ok(false, `${p}: row for manager ${cik} not in the file`); continue; }
      ok(tr.cells[1].text === nf(f.shares), `${p}: ${cik} shares ${tr.cells[1].text} vs ${nf(f.shares)}`);
      if (hasPrior) {
        if (f.shares_prior_quarter === "") ok(/not reported for/.test(tr.cells[3].text) && tr.cells[4].text === "—", `${p}: ${cik} no earlier row reads 'not reported for'`);
        else ok(tr.cells[3].text === nf(f.shares_prior_quarter), `${p}: ${cik} prior shares`);
      }
      ok(tr.html.includes(`https://www.sec.gov/Archives/edgar/data/${f.manager_sec_number.replace(/^0+/, "")}/`), `${p}: ${cik} source link is the filing folder`);
    }
  }
}
ok(pages > 0, "at least one company page section was compared");

// The hub.
ok(hub.status === 200 && !/noindex/.test(hub.text), "hub is indexable");
const ht = text(hub.text);
for (const re of BAD) ok(!re.test(ht), `hub wording ${re}`);
ok(!/\d\s?%/.test(ht), "hub states no percentage");
ok(/summed reported value/i.test(ht), "hub labels sums as summed reported value");
const tables = [...hub.text.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
ok(tables.length === 2, "hub has two tables");
if (tables.length === 2) {
  const a = rowsOf(tables[0]), b = rowsOf(tables[1]);
  ok(a.length === comp.length, `hub companies ${a.length} vs file ${comp.length}`);
  ok(b.length === Math.min(HUB_MANAGERS, b.length) && b.length > 0, `hub managers ${b.length}`);
  const ms = a.map((r) => Number(r.cells[3].text.replace(/,/g, "")));
  ok(ms.every((v, i) => i === 0 || ms[i - 1] >= v), "hub companies by managers, desc");
  for (const r of a) { const c = comp.find((x) => text(r.cells[0].html) === x.company) ?? comp.find((x) => x.ticker === r.cells[1].text); ok(!!c && nf(c.managers) === r.cells[3].text, `hub: ${r.cells[0].text} managers`); }
  for (const r of b) ok(/browse-edgar\?action=getcompany&amp;CIK=\d{10}&amp;type=13F-HR|browse-edgar\?action=getcompany&CIK=\d{10}&type=13F-HR/.test(r.html), `hub: ${r.cells[0].text} links to its SEC 13F list`);
}
ok(sitemap.text.includes("/institutional-holders/"), "hub in the sitemap");
ok(llms.text.includes("/institutional-holders/"), "hub in llms.txt");
const search = await get("/data/search.json");
ok(search.text.includes("/institutional-holders/"), "hub in the search index");
const meth = text((await get("/methodology/")).text);
ok(/institutional-holders|Form 13F/.test((await get("/methodology/")).text), "methodology covers Form 13F");
ok(meth.includes("13F"), "methodology text mentions 13F");
const g = await get("/guides/form-13f-institutional-holdings/");
ok(g.status === 200, "guide exists");

console.log(`verify-inst: 13F shown (${period}); ${checks} checks, ${failures} failures, ${pages} company page sections compared`);
process.exit(failures ? 1 : 0);
