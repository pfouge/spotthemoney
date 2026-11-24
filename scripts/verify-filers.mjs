#!/usr/bin/env node
// The filer's side of Form 144 notices and Schedules 13D and 13G: "Planned sales: Form 144
// notices this filer submitted" on insider pages, and "Large holdings this filer reports" on
// insider and company pages.
//
//   node scripts/verify-filers.mjs <base-url> [--sample N]
//
// No browser. The oracles are the two CSV files the company-side sections already use
// (planned-sales-form144.csv, large-holders-13d-13g.csv, written by lib/downloads.ts). This
// script groups their rows by the filer's SEC number with its own copy of the rules (12-month
// window and 25 rows for notices; the newest statement about each company, largest percent
// first, for holdings), finds the filer's page through the link the company page gives, and
// compares the section's counts, row order and cells. With a file absent (that load is not
// current) no page may carry the matching section. Works against the live site too.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const SAMPLE = args.includes("--sample") && Number(args[args.indexOf("--sample") + 1]) > 0 ? Number(args[args.indexOf("--sample") + 1]) : 10;
const ROWS = 25, WINDOW = 365, DAY = 86400000, MAX_PER_SHARE = 1_000_000, THRESHOLD = 5;

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; if (failures <= 60) console.log(`✗ ${msg}`); } };
const cache = new Map();
const get = async (p) => {
  if (cache.has(p)) return cache.get(p);
  for (let i = 0; ; i++) {
    try { const r = await fetch(base + p); const out = { status: r.status, text: await r.text() }; cache.set(p, out); return out; }
    catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); }
  }
};
const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
// An empty data-v can be written with no value at all.
const val = (cell) => (cell ? attr(cell.tag, "data-v") ?? "" : null);
const num = (s) => (s === "" || s == null ? null : Number(s));
const day = (d) => (d ? d.replaceAll("-", "") : "");
const pathOf = (u) => new URL(u).pathname;

function parseCsv(src) {
  const out = []; let row = [], cell = "", q = false;
  const s = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
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
function section(html, mark) {
  const i = html.indexOf(mark);
  if (i < 0) return null;
  const start = html.lastIndexOf("<section", i), end = html.indexOf("</section>", i);
  const body = html.slice(start, end);
  const tb = body.slice(Math.max(0, body.indexOf("<tbody")));
  const rows = [...tb.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => ({ tag: m[1], html: m[2], cells: [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ tag: c[1], html: c[2] })) }));
  return { tag: body.slice(0, body.indexOf(">") + 1), body, rows };
}
const cellBy = (row, name) => row.cells.find((c) => new RegExp(`\\b${name}\\b`).test(c.tag));
/** The address the row of one filing on a company page links its filer to, or null. */
function filerLink(html, rowAttr, accession, cellAttr) {
  const m = html.match(new RegExp(`<tr[^>]*${rowAttr}="${accession}"[^>]*>([\\s\\S]*?)</tr>`));
  if (!m) return null;
  const cell = (m[1].match(new RegExp(`<td[^>]*${cellAttr}[^>]*>([\\s\\S]*?)</td>`)) ?? [])[1] ?? "";
  return (cell.match(/<a href="(\/(?:insiders|companies)\/[^"#]+)"/) ?? [])[1] ?? null;
}

const catalog = JSON.parse((await get("/data/catalog.json")).text);
const built = String(catalog.built).slice(0, 10);
const has = (name) => (catalog.csv?.files ?? []).some((f) => (f.path ?? f.name ?? "").endsWith(name));
const companies = parseCsv((await get("/downloads/companies.csv")).text);
const companyPage = new Map(companies.filter((c) => c.cik && c.page_url).map((c) => [c.cik.padStart(10, "0"), pathOf(c.page_url)]));
const wording = (where, words) => ok(!/\b(dumped|dumping|cashing out|bearish|bullish|activist|insider knowledge|should (buy|sell)|recommend)\b/i.test(words), `${where}: verdict or advice wording`);

// ── planned sales, the filer's side ─────────────────────────────────────────────────────────
let noticePages = 0, noticeRows = 0, heldSeen = 0;
if (!has("planned-sales-form144.csv")) {
  for (const c of companies.slice(0, 3)) ok(!(await get(pathOf(c.page_url))).text.includes("data-filed-notices"), `${c.company}: a filer's notices section with no notices file`);
} else {
  const all = parseCsv((await get("/downloads/planned-sales-form144.csv")).text);
  const end = Date.parse(built + "T00:00:00Z"), start = end - WINDOW * DAY;
  const inWindow = (r) => { const t = Date.parse(r.filed_date + "T00:00:00Z"); return t <= end && t >= start; };
  const byFiler = new Map();
  for (const r of all) { if (!r.seller_sec_number) continue; const xs = byFiler.get(r.seller_sec_number); if (xs) xs.push(r); else byFiler.set(r.seller_sec_number, [r]); }
  const live = [...byFiler.entries()].map(([cik, xs]) => [cik, xs.filter(inWindow).sort((a, b) => b.filed_date.localeCompare(a.filed_date) || b.accession.localeCompare(a.accession))]);
  const withRows = live.filter(([, xs]) => xs.length).sort((a, b) => b[1].length - a[1].length);
  const pick = new Map();
  const add = (e) => { if (e && !pick.has(e[0])) pick.set(e[0], e[1]); };
  add(withRows[0]); add(withRows.at(-1));
  for (const e of withRows) if (e[1].some((r) => r.stated_value_out_of_range === "true")) add(e);
  add(withRows.find(([, xs]) => new Set(xs.map((r) => r.issuer_cik)).size > 1));
  add(withRows.find(([, xs]) => xs.some((r) => r.amendment === "true")));
  for (let i = 0; pick.size < Math.max(SAMPLE, 6) && i < withRows.length; i += Math.max(1, Math.floor(withRows.length / SAMPLE))) add(withRows[i]);
  for (const [cik, rows] of pick) {
    // The filer's page is the one a company page links the seller to.
    let page = null;
    for (const r of rows.slice(0, 3)) { page = filerLink((await get(pathOf(r.page_url))).text, "data-notice", r.accession, "data-ps-seller"); if (page) break; }
    if (!page || !page.startsWith("/insiders/")) continue; // not one person with a page here: no section to check
    const html = (await get(page)).text;
    const sec = section(html, "data-filed-notices");
    ok(!!sec, `${page}: no section, the file has ${rows.length} notices under filer ${cik} in the window`);
    if (!sec) continue;
    noticePages++;
    ok(attr(sec.tag, "data-cik") === cik, `${page}: the section is for ${attr(sec.tag, "data-cik")}, expected ${cik}`);
    ok(Number(attr(sec.tag, "data-notices")) === rows.length, `${page}: ${attr(sec.tag, "data-notices")} notices stated, ${rows.length} in the file`);
    ok(Number(attr(sec.tag, "data-companies")) === new Set(rows.map((r) => r.issuer_cik)).size, `${page}: companies count`);
    ok(Number(attr(sec.tag, "data-amendments")) === rows.filter((r) => r.amendment === "true").length, `${page}: amendments count`);
    const want = rows.slice(0, ROWS);
    ok(sec.rows.map((r) => attr(r.tag, "data-notice")).join() === want.map((r) => r.accession).join(), `${page}: the rows are not the file's ${want.length} newest notices in order`);
    ok(html.includes('href="#filed-notices"'), `${page}: no jump link`);
    ok(/<p[^>]*data-fn-more/.test(sec.body) === rows.length > ROWS, `${page}: the "newest of N" line`);
    let held = 0;
    sec.rows.forEach((row, i) => {
      const r = want[i]; if (!r) return;
      noticeRows++;
      const co = cellBy(row, "data-fn-company");
      ok(co && attr(co.tag, "data-fn-company") === r.issuer_cik && co.html.includes(`href="${pathOf(r.page_url)}"`), `${page} ${r.accession}: company cell`);
      ok(String(val(cellBy(row, "data-fn-shares"))) === (Number(r.shares_to_be_sold) > 0 ? String(Number(r.shares_to_be_sold)) : ""), `${page} ${r.accession}: shares`);
      const v = cellBy(row, "data-fn-value");
      const out = Number(r.stated_market_value) > 0 && Number(r.shares_to_be_sold) > 0 && Number(r.stated_market_value) / Number(r.shares_to_be_sold) > MAX_PER_SHARE;
      ok((r.stated_value_out_of_range === "true") === out, `${page} ${r.accession}: the file's out-of-range mark`);
      if (out) { held++; ok(/data-fn-value-held/.test(v.tag) && text(v.html) === "not shown" && !v.html.includes(String(Math.round(Number(r.stated_market_value)))), `${page} ${r.accession}: an out-of-range value is printed`); }
      else ok(String(val(v)) === (Number(r.stated_market_value) > 0 ? String(Math.round(Number(r.stated_market_value))) : ""), `${page} ${r.accession}: stated value`);
      ok(val(cellBy(row, "data-fn-sale")) === day(r.approximate_sale_date), `${page} ${r.accession}: sale date`);
      ok(val(cellBy(row, "data-fn-plan")) === day(r.plan_adoption_date), `${page} ${r.accession}: plan date`);
      ok(!r.sec_url || row.html.includes(`href="${r.sec_url}"`), `${page} ${r.accession}: link to the notice`);
      ok(/Form 144\/A/.test(text(row.cells.at(-1).html)) === (r.amendment === "true"), `${page} ${r.accession}: amendment label`);
    });
    heldSeen += held;
    const note = sec.body.match(/data-fn-held-note[^>]*data-held="(\d+)"/);
    ok(held === 0 ? !note : note && Number(note[1]) === held, `${page}: ${held} values held back, the note says ${note ? note[1] : "nothing"}`);
    const words = text(sec.body);
    ok(/not a report of a sale/.test(words) && /can be a trust or a family entity/.test(words), `${page}: the section does not say a notice is not a sale, or what a named seller can be`);
    wording(page, words);
  }
  // A filer whose notices are all older than the window has no section.
  const old = live.find(([cik, xs]) => !xs.length && byFiler.get(cik).length);
  if (old) {
    const r = byFiler.get(old[0])[0];
    const co = (await get(pathOf(r.page_url))).text; // an old notice is in no company table, so look the person up by name link elsewhere is not possible: check the company page only
    ok(!filerLink(co, "data-notice", r.accession, "data-ps-seller"), `${pathOf(r.page_url)}: a notice older than the window is in the table`);
  }
  ok(/SEC number in the last 365 days/.test(text((await get("/methodology/")).text)), "methodology does not describe the filer's side of Form 144 notices");
}

// ── large holdings, the filer's side ────────────────────────────────────────────────────────
let holdingPages = 0, holdingRows = 0, onCompanyPages = 0, twoClassFilers = 0;
if (!has("large-holders-13d-13g.csv")) {
  for (const c of companies.slice(0, 3)) ok(!(await get(pathOf(c.page_url))).text.includes("data-reported-holdings"), `${c.company}: a reported-holdings section with no statements file`);
} else {
  const all = parseCsv((await get("/downloads/large-holders-13d-13g.csv")).text);
  const byFiler = new Map();
  for (const r of all) {
    if (!r.holder_sec_number || r.holder_sec_number === r.issuer_cik || r.filed_date > built) continue;
    const xs = byFiler.get(r.holder_sec_number); if (xs) xs.push(r); else byFiler.set(r.holder_sec_number, [r]);
  }
  const pct = (r) => (r.percent_of_class === "" ? -1 : Number(r.percent_of_class));
  const sh = (r) => (r.shares_stated === "" ? -1 : Number(r.shares_stated));
  // The filer's newest statement about each company, and about each class of its shares when the
  // filer's statements name CUSIP numbers that overlap in time (this script's own copy of the rule
  // the company pages use: a number last used before another was first used was replaced by it,
  // and a filer with a statement that gives no number is never split).
  const classKey = (c) => { const k = String(c ?? "").replace(/^'/, "").replace(/\s+/g, "").toUpperCase(); return !k || /^0+$/.test(k) ? "" : k.length === 12 && k.startsWith("US") ? k.slice(2, 11) : k; };
  const cusipOk = (k) => {
    if (k.length !== 9) return false;
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      const ch = k[i]; const at = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ*@#".indexOf(ch);
      if (at < 0) return false;
      const v = i % 2 ? at * 2 : at;
      sum += Math.trunc(v / 10) + (v % 10);
    }
    return k[8] === String((10 - (sum % 10)) % 10);
  };
  const apart = (a, b) => {
    if (a.length === b.length) return [...a].filter((ch, i) => ch !== b[i]).length;
    const [l, s] = a.length > b.length ? [a, b] : [b, a];
    return l.length - s.length === 1 && [...l].some((_, i) => l.slice(0, i) + l.slice(i + 1) === s) ? 1 : Infinity;
  };
  const perClass = (rs) => { // one filer's statements about one company, newest first
    const groups = new Map();
    for (const r of rs) { const k = classKey(r.cusip); const g = groups.get(k); if (g) { if (r.filed_date < g.first) g.first = r.filed_date; } else groups.set(k, { r, first: r.filed_date, last: r.filed_date }); }
    if (groups.size < 2 || groups.has("")) return [rs[0]];
    // A number that cannot be a CUSIP number joins the one nearest valid number, at most two characters away.
    const good = [...groups.keys()].filter(cusipOk);
    for (const k of [...groups.keys()].filter((x) => !cusipOk(x))) {
      const near = good.map((g) => ({ g, d: apart(k, g) })).sort((a, b) => a.d - b.d);
      if (!(near.length && near[0].d <= 2 && (near.length === 1 || near[1].d > near[0].d))) continue;
      const bad = groups.get(k), to = groups.get(near[0].g);
      if (bad.first < to.first) to.first = bad.first;
      if (bad.last > to.last) { to.last = bad.last; }
      if (rs.indexOf(bad.r) < rs.indexOf(to.r)) to.r = bad.r;
      groups.delete(k);
    }
    if (groups.size < 2) return [rs[0]];
    const gs = [...groups.values()].sort((a, b) => rs.indexOf(a.r) - rs.indexOf(b.r));
    return gs.filter((a) => !gs.some((b) => b !== a && b.first > a.last)).map((g) => g.r);
  };
  const holdings = (xs) => {
    const by = new Map();
    for (const r of [...xs].sort((a, b) => b.filed_date.localeCompare(a.filed_date) || b.accession.localeCompare(a.accession))) { const ys = by.get(r.issuer_cik); if (ys) ys.push(r); else by.set(r.issuer_cik, [r]); }
    return [...by.values()].flatMap(perClass).sort((a, b) => pct(b) - pct(a) || sh(b) - sh(a) || a.issuer_cik.localeCompare(b.issuer_cik) || b.accession.localeCompare(a.accession));
  };
  const filers = [...byFiler.entries()].map(([cik, xs]) => [cik, holdings(xs), xs]).sort((a, b) => b[1].length - a[1].length);
  const pick = new Map();
  const add = (e) => { if (e && !pick.has(e[0])) pick.set(e[0], e); };
  for (const e of filers.filter((e) => companyPage.has(e[0])).slice(0, 4)) add(e);       // companies that file about others
  add(filers[0]); add(filers.find((e) => e[2].length > e[1].length));                       // most companies; several statements about one
  add(filers.find((e) => e[1].some((r) => pct(r) >= 0 && pct(r) < THRESHOLD)));
  for (const e of filers.filter((e) => e[1].length > new Set(e[1].map((r) => r.issuer_cik)).size)) { add(e); if (companyPage.has(e[0])) twoClassFilers++; } // a filer with two classes of one company
  for (let i = 0; pick.size < Math.max(SAMPLE, 8) && i < filers.length; i += Math.max(1, Math.floor(filers.length / (SAMPLE * 3)))) add(filers[i]);
  for (const [cik, want0] of pick.values()) {
    let page = companyPage.get(cik) ?? null;
    if (!page) for (const r of want0.slice(0, 4)) { page = filerLink((await get(pathOf(r.page_url))).text, "data-statement", r.accession, "data-lh-holder"); if (page) break; }
    if (!page) continue; // the filer has no page here (most are funds): nothing to check
    const html = (await get(page)).text;
    const sec = section(html, "data-reported-holdings");
    ok(!!sec, `${page}: no section, the file has statements by filer ${cik} about ${want0.length} other companies`);
    if (!sec) continue;
    holdingPages++; if (!page.startsWith("/insiders/")) onCompanyPages++;
    ok(attr(sec.tag, "data-cik") === cik, `${page}: the section is for ${attr(sec.tag, "data-cik")}, expected ${cik}`);
    ok(Number(attr(sec.tag, "data-companies")) === want0.length, `${page}: ${attr(sec.tag, "data-companies")} rows stated, ${want0.length} in the file`);
    const cos = new Set(want0.map((r) => r.issuer_cik)).size;
    const sum = text((sec.body.match(/<p[^>]*data-rh-summary[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
    ok(new RegExp(`about ${cos.toLocaleString("en-US")} compan(y|ies) this site tracks`).test(sum), `${page}: the summary does not state ${cos} companies`);
    ok((want0.length > cos) === /about more than one class of shares/.test(sum), `${page}: ${want0.length} rows about ${cos} companies and the summary ${want0.length > cos ? "does not say so" : "speaks of several classes"}`);
    const want = want0.slice(0, ROWS);
    ok(sec.rows.map((r) => attr(r.tag, "data-statement")).join() === want.map((r) => r.accession).join(), `${page}: the rows are not the filer's newest statement about each company, largest percent first`);
    ok(html.includes('href="#reported-holdings"'), `${page}: no jump link`);
    sec.rows.forEach((row, i) => {
      const r = want[i]; if (!r) return;
      holdingRows++;
      const co = cellBy(row, "data-rh-company");
      ok(co && attr(co.tag, "data-rh-company") === r.issuer_cik && co.html.includes(`href="${pathOf(r.page_url)}"`), `${page} ${r.accession}: company cell`);
      const p = cellBy(row, "data-rh-percent");
      ok(String(val(p)) === (r.percent_of_class === "" ? "" : String(Number(r.percent_of_class))), `${page} ${r.accession}: percent`);
      ok(/data-rh-below/.test(p.html) === (pct(r) >= 0 && pct(r) < THRESHOLD), `${page} ${r.accession}: the below-5% mark`);
      ok(String(val(cellBy(row, "data-rh-shares"))) === (r.shares_stated === "" ? "" : String(Math.round(Number(r.shares_stated)))), `${page} ${r.accession}: shares`);
      ok(val(cellBy(row, "data-rh-event")) === day(r.event_date) && val(cellBy(row, "data-rh-filed")) === day(r.filed_date), `${page} ${r.accession}: dates`);
      ok(!r.sec_url || row.html.includes(`href="${r.sec_url}"`), `${page} ${r.accession}: link to the statement`);
      ok(/data-rh-others/.test(co.html) === Number(r.reporting_persons) > 1, `${page} ${r.accession}: the other-reporting-persons line`);
      ok(r.newest_for_holder === "true", `${page} ${r.accession}: the file does not mark this row as the filer's newest about the company`);
    });
    const words = text(sec.body);
    ok(/not a report of a trade/.test(words) && /not a full list of what the filer owns/.test(words), `${page}: the section does not say what a statement is and is not`);
    wording(page, words);
  }
  // A company that filed nothing about another company has no section.
  let none = 0;
  for (const c of companies.filter((c) => c.cik && !byFiler.has(c.cik.padStart(10, "0"))).slice(0, 3)) { none++; ok(!(await get(pathOf(c.page_url))).text.includes("data-reported-holdings"), `${c.company}: a reported-holdings section with no statement by it in the file`); }
  ok(/Large holdings this filer reports/.test(text((await get("/methodology/")).text)), "methodology does not describe the filer's side of Schedules 13D and 13G");
}

console.log(failures
  ? `verify-filers: ${failures} of ${checks} checks failed`
  : `verify-filers: ${checks} checks pass; planned sales on ${noticePages} insider pages (${noticeRows} rows, ${heldSeen} values held back); reported holdings on ${holdingPages} pages (${onCompanyPages} company pages, ${holdingRows} rows, ${twoClassFilers} company filers with two classes of one company)`);
process.exit(failures ? 1 : 0);
