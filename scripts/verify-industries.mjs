// Checks the industry pages (/industries/ and one page per SIC division; web/src/lib/industries.ts)
// against the CSV downloads, which other code writes:
//   node scripts/verify-industries.mjs <base-url>      e.g. http://127.0.0.1:4321
// No browser. From companies.csv it recounts each division's companies and industry codes (with
// its own copy of the SIC manual's ranges); from the insider trade files and congress-trades.csv
// it recounts every company's open-market purchases, open-market sales and congressional rows
// disclosed in the 12 months to the build day, and its newest Form 4 date. It compares those with
// the list row, the division page's facts, its code table and every company row; checks anchors,
// that each company's own page links back to its division, and the wording rule: an industry is
// a label, so no page ranks industries or reads meaning into a trade from one.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const HUB = "/industries/";
const WINDOW_DAYS = 365;
// The SIC manual's divisions by two-digit major group. A separate list on purpose.
const DIVS = [["A", "Agriculture, forestry and fishing", 1, 9], ["B", "Mining", 10, 14], ["C", "Construction", 15, 17], ["D", "Manufacturing", 20, 39],
  ["E", "Transportation, communications and utilities", 40, 49], ["F", "Wholesale trade", 50, 51], ["G", "Retail trade", 52, 59],
  ["H", "Finance, insurance and real estate", 60, 67], ["I", "Services", 70, 89], ["J", "Public administration", 91, 97], ["X", "Nonclassifiable", 99, 99]];
const divOf = (sic) => { const g = Number(sic.slice(0, 2)); return DIVS.find((d) => g >= d[2] && g <= d[3]) ?? null; };
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; if (failures <= 60) console.log(`✗ ${msg}`); } return !!cond; };
const int = (s) => Number(String(s ?? "").replace(/[^0-9-]/g, "") || 0);
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
const unescape = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const rowsOf = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => ({ tag: m[0].slice(0, m[0].indexOf(">") + 1), cells: [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]) })).filter((r) => r.cells.length);
const section = (html, attr) => { const i = html.indexOf(attr); if (i < 0) return ""; const j = html.indexOf("</section>", i); return html.slice(i, j < 0 ? undefined : j); };
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
const fact = (html, k) => { const m = new RegExp(`data-fact="${k}"[^>]*>([^<]*)<`).exec(html); return m ? int(m[1]) : NaN; };
const mainOf = (html) => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? html;

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
const text0 = (s) => s.replace(/^'/, ""); // the CSV writer guards a leading = + - @ with an apostrophe

const hubRes = await get(HUB);
if (hubRes.status !== 200) { console.log(`✗ ${HUB} answered ${hubRes.status}`); process.exit(1); }
const hubRows = rowsOf(section(hubRes.text, "data-industries-list")).map((r) => ({
  code: attr(r.tag, "data-division"), name: unescape(r.cells[0]), href: (r.cells[0].match(/href="([^"]+)"/) ?? [])[1],
  codes: int(unescape(r.cells[1])), companies: int(unescape(r.cells[2])), withBuys: int(unescape(r.cells[3])), withSells: int(unescape(r.cells[4])), withCongress: int(unescape(r.cells[5])),
}));
const dl = await get("/downloads/");
const listed = [...dl.text.matchAll(/data-file="([^"]+)"/g)].map((m) => m[1]);
const coFile = listed.find((p) => p.endsWith("/companies.csv"));
if (hubRows.length === 0) {
  ok(hubRes.text.includes("empty-reason"), "an empty industry list says why");
  ok(/<meta name="robots" content="[^"]*noindex/.test(hubRes.text), "an empty industry list is noindex");
  if (coFile) ok(parseCsv((await get(coFile)).text).every((r) => !r.sic_code || !divOf(r.sic_code)), "companies.csv holds a company with a code in a division, but the industry list is empty");
  console.log(failures ? `verify-industries: ${failures} problem(s)` : `✓ verify-industries: no industry codes on record, ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}
const built = (hubRes.text.match(/data-industries-list[^>]*data-built="(\d{4}-\d\d-\d\d)"/) ?? [])[1];
if (!ok(!!built, "the list states its build day") || !ok(!!coFile, "/downloads/ lists companies.csv")) process.exit(1);
const from = new Date(Date.parse(`${built}T00:00:00Z`) - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
const inWindow = (d) => !!d && d >= from && d <= built;

// ── the oracle ──
const coRows = parseCsv((await get(coFile)).text);
ok(coRows.length > 0, "companies.csv has rows");
ok(coRows.every((r) => /^\d{10}$/.test(r.cik) || r.cik === ""), "companies.csv: a cik is not ten digits");
ok(coRows.every((r) => r.sic_code === "" || /^\d{4}$/.test(r.sic_code)), "companies.csv: a sic_code is not four digits");
ok(coRows.every((r) => (r.sic_code === "") === (r.sic_division === "") || (r.sic_code !== "" && !divOf(r.sic_code))), "companies.csv: sic_division does not go with sic_code");
ok(coRows.every((r) => r.sic_code === "" || (divOf(r.sic_code)?.[1] ?? "") === r.sic_division), "companies.csv: a sic_division is not the manual's division for its code");
const f4 = [], ptr = [];
for (const p of listed) {
  if (/\/insider-trades-/.test(p) && !/insider-trades-latest/.test(p)) f4.push(...parseCsv((await get(p)).text));
  else if (p.endsWith("/congress-trades.csv")) ptr.push(...parseCsv((await get(p)).text));
}
const byTicker = (rows) => { const m = new Map(); for (const r of rows) { if (!r.ticker) continue; const a = m.get(r.ticker); if (a) a.push(r); else m.set(r.ticker, [r]); } return m; };
const f4By = byTicker(f4), ptrBy = byTicker(ptr);
const expect = new Map(); // page_url path → figures
const perDiv = new Map();
for (const r of coRows) {
  if (!r.sic_code || !r.cik) continue;
  const d = divOf(r.sic_code); if (!d) continue;
  const tickers = r.tickers ? r.tickers.split(";") : [];
  const mine = tickers.flatMap((t) => f4By.get(t) ?? []), cong = tickers.flatMap((t) => ptrBy.get(t) ?? []);
  const e = {
    path: new URL(r.page_url).pathname, name: text0(r.company), sic: r.sic_code, description: text0(r.sic_description), ticker: r.ticker,
    buys: mine.filter((t) => t.transaction_code === "P" && t.side === "buy" && inWindow(t.disclosed_date)).length,
    sells: mine.filter((t) => t.transaction_code === "S" && t.side === "sell" && inWindow(t.disclosed_date)).length,
    congress: cong.filter((t) => inWindow(t.disclosed_date)).length,
    latest: mine.map((t) => t.disclosed_date).filter((x) => x && x <= built).sort().at(-1) ?? "",
  };
  expect.set(e.path, e);
  const list = perDiv.get(d[0]); if (list) list.push(e); else perDiv.set(d[0], [e]);
}

// ── the list ──
ok(hubRes.text.includes("data-answer"), "the list has an answer block");
ok(hubRows.map((r) => r.code).join(",") === DIVS.map((d) => d[0]).filter((c) => perDiv.has(c)).join(","), `the list's divisions (${hubRows.map((r) => r.code).join(",")}) are not the divisions with a company in companies.csv (${[...perDiv.keys()].sort().join(",")}), in the manual's order`);
ok(new Set(hubRows.map((r) => r.href)).size === hubRows.length && hubRows.every((r) => r.href?.startsWith(HUB) && r.href !== HUB), "every division links to its own page");
ok(fact(hubRes.text, "with-code") === coRows.filter((r) => r.cik && r.sic_code).length, `the list says ${fact(hubRes.text, "with-code")} companies have a code; companies.csv has ${coRows.filter((r) => r.cik && r.sic_code).length}`);
ok(fact(hubRes.text, "no-code") === coRows.filter((r) => r.cik && !r.sic_code).length, `the list says ${fact(hubRes.text, "no-code")} companies have no code; companies.csv has ${coRows.filter((r) => r.cik && !r.sic_code).length}`);

// ── each division ──
let companies = 0, codesSeen = 0, backLinks = 0;
const WORDING = /\b(outperform|underperform|bullish|bearish|hot sector|top sector|best sector|worst sector|ranked|conflict of interest|suspicious|signal)\b/i;
ok(!WORDING.test(unescape(mainOf(hubRes.text))), "the list uses ranking or verdict wording");
for (const h of hubRows) {
  const d = DIVS.find((x) => x[0] === h.code);
  const want = perDiv.get(h.code) ?? [];
  ok(d && h.name === d[1], `division ${h.code} is named "${h.name}"`);
  const wantCodes = new Map(); for (const e of want) wantCodes.set(e.sic, (wantCodes.get(e.sic) ?? 0) + 1);
  const figures = { companies: want.length, codes: wantCodes.size, withBuys: want.filter((e) => e.buys > 0).length, withSells: want.filter((e) => e.sells > 0).length, withCongress: want.filter((e) => e.congress > 0).length };
  for (const k of Object.keys(figures)) ok(h[k] === figures[k], `${h.name}: the list says ${k} ${h[k]}, the CSV files give ${figures[k]}`);
  const res = await get(h.href);
  if (!ok(res.status === 200, `${h.href} answered ${res.status}`)) continue;
  const html = res.text, main = mainOf(html);
  ok(html.includes("data-answer"), `${h.href}: no answer block`);
  ok(!WORDING.test(unescape(main)), `${h.href}: ranking or verdict wording`);
  ok(/Not investment advice/.test(main), `${h.href}: no disclaimer`);
  for (const [k, f] of [["companies", "companies"], ["codes", "codes"], ["withBuys", "with-buys"], ["withSells", "with-sells"], ["withCongress", "with-congress"]]) ok(fact(html, f) === figures[k], `${h.href}: fact ${f} is ${fact(html, f)}, the CSV files give ${figures[k]}`);
  // code table
  const codeRows = rowsOf(section(html, "data-industry-codes")).map((r) => ({ sic: attr(r.tag, "data-sic"), href: (r.cells[0].match(/href="([^"]+)"/) ?? [])[1], description: unescape(r.cells[1]), n: int(unescape(r.cells[2])) }));
  codesSeen += codeRows.length;
  ok(codeRows.map((r) => `${r.sic}:${r.n}`).join(",") === [...wantCodes].sort((a, b) => a[0].localeCompare(b[0])).map(([s, n]) => `${s}:${n}`).join(","), `${h.href}: the code table does not match companies.csv`);
  ok(codeRows.every((r) => divOf(r.sic)?.[0] === h.code), `${h.href}: a code outside the division`);
  ok(codeRows.every((r) => r.href === `#sic-${r.sic}` && new RegExp(`<tr id="sic-${r.sic}"[^>]*data-sic="${r.sic}"`).test(html)), `${h.href}: a code does not open a company row with that code`);
  ok(codeRows.every((r) => want.some((e) => e.sic === r.sic && e.description === r.description) || r.description === ""), `${h.href}: a code's wording is not the wording in companies.csv`);
  ok((html.match(/ id="sic-\d{4}"/g) ?? []).length === codeRows.length, `${h.href}: anchors and codes differ in number`);
  // company rows
  const rows = rowsOf(section(html, "data-industry-companies")).map((r) => ({
    sic: attr(r.tag, "data-sic"), name: unescape(r.cells[0]), href: (r.cells[0].match(/href="([^"]+)"/) ?? [])[1], ticker: unescape(r.cells[1]), tickerHref: (r.cells[1].match(/href="([^"]+)"/) ?? [])[1],
    industry: unescape(r.cells[2]), buys: int(unescape(r.cells[3])), sells: int(unescape(r.cells[4])), congress: int(unescape(r.cells[5])), latest: unescape(r.cells[6]),
  }));
  companies += rows.length;
  ok(rows.length === want.length, `${h.href}: ${rows.length} company rows, companies.csv has ${want.length}`);
  ok(new Set(rows.map((r) => r.href)).size === rows.length, `${h.href}: a company is listed twice`);
  const sorted = [...rows].sort((a, b) => a.sic.localeCompare(b.sic));
  ok(rows.every((r, i) => r.sic === sorted[i].sic), `${h.href}: companies are not in code order`);
  for (const r of rows) {
    const e = expect.get(r.href);
    if (!ok(!!e, `${h.href}: ${r.name} (${r.href}) is not a company with a code in companies.csv`)) continue;
    ok(r.name === e.name && r.sic === e.sic && r.ticker === e.ticker, `${h.href}: ${r.name}: name, code or ticker differs from companies.csv`);
    ok(r.industry === `${e.sic} ${e.description}`.trim(), `${h.href}: ${r.name}: industry cell "${r.industry}" is not "${e.sic} ${e.description}"`);
    ok(r.buys === e.buys && r.sells === e.sells, `${h.href}: ${r.name}: purchases/sales ${r.buys}/${r.sells}, the insider trade files give ${e.buys}/${e.sells}`);
    ok(r.congress === e.congress, `${h.href}: ${r.name}: congress rows ${r.congress}, congress-trades.csv gives ${e.congress}`);
    ok(r.latest === e.latest, `${h.href}: ${r.name}: latest Form 4 ${r.latest || "none"}, the insider trade files give ${e.latest || "none"}`);
  }
  // A sample of the companies' own pages and stock pages link back to this division at the code.
  const pick = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 6)) === 0).slice(0, 6);
  for (const r of pick) {
    for (const p of [r.href, r.tickerHref].filter(Boolean)) {
      const page = await get(p);
      if (!ok(page.status === 200, `${p} answered ${page.status}`)) continue;
      backLinks++;
      ok(page.text.includes(`href="${h.href}#sic-${r.sic}"`), `${p}: the Industry line does not link to ${h.href}#sic-${r.sic}`);
    }
  }
}
ok(companies === [...perDiv.values()].reduce((n, l) => n + l.length, 0), "companies on the division pages do not add up to the companies with a code in a division");

// ── around the site ──
const sm = (await get("/sitemaps/pages.xml")).text;
ok(sm.includes(`${HUB}</loc>`), "the pages sitemap lacks /industries/");
ok(hubRows.every((h) => sm.includes(`${h.href}</loc>`)), "the pages sitemap lacks a division page");
ok((await get("/llms.txt")).text.includes("/industries/"), "llms.txt does not mention /industries/");
ok((await get("/companies/")).text.includes('href="/industries/"'), "/companies/ does not link to /industries/");
// phone width cannot be tested without a browser; the tables sit in the site's scrolling wrapper.
ok((hubRes.text.match(/<div class="tablewrap">/g) ?? []).length >= 1, "the list's table is not in the scrolling wrapper");

console.log(failures ? `verify-industries: ${failures} problem(s) in ${checks} checks` : `✓ verify-industries: ${checks} checks pass: ${hubRows.length} divisions, ${codesSeen} industry codes, ${companies} companies recounted from ${f4.length} Form 4 rows and ${ptr.length} congressional rows, ${backLinks} pages link back`);
process.exit(failures ? 1 : 0);
