// Checks /lobbyist-contributions/, the member sections and the company filer sections
// (web/src/lib/lobbygifts.ts) against lobbyist-contributions-<year>.csv, which other code writes:
//   node scripts/verify-lobbycontrib.mjs <base-url> [--sample N]      e.g. http://127.0.0.1:4321
// No browser. Per period figures, kinds of item, filers and recipients are recounted from the CSV
// (counted rows only); the member match is re-derived with this script's own copy of the rule
// (honoree first; else a payee that equals a linked campaign committee's name once normalised, the
// committees read from campaign-committees.csv, which other code writes);
// amended filings count once; future dates and non-numeric amounts are blank; wording.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 8;
let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.log(`✗ ${m}`); } };
const get = async (p) => { for (let i = 0; ; i++) { try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; } catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); } } };
const attr = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
const text = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
function parseCsv(t) {
  const out = []; let row = [], cell = "", q = false; const s = t.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) { const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch; }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const head = out.shift() ?? [];
  return out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const normOrg = (s) => (s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|incorporated|corp|corporation|co|company|llc|ltd|lp|llp|plc)\b/g, " ").replace(/\s+/g, " ").trim();
const nameKey = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const TITLES = "the\\s+honorable|hon|senator|sen|representative|rep|congressman|congresswoman|speaker|leader|chairman|chairwoman|chair|dr|mr|mrs|ms";
const honoree = (raw) => {
  let t = (raw ?? "").replace(/\s+/g, " ").trim(); if (!t || /[;&/+]|\band\b/i.test(t)) return null;
  for (let i = 0; i < 6; i++) { const n = t.replace(/\s*[[(][^\])]*[\])]\s*$/, "").trim(); if (n === t) break; t = n; }
  for (let i = 0; i < 6; i++) { const n = t.replace(new RegExp(`^(?:${TITLES})\\b\\.?\\s*`, "i"), "").trim(); if (n === t) break; t = n; }
  if (!t || new RegExp(`[\\s,](?:${TITLES})\\.?\\s+[A-Za-z]`, "i").test(t) || (t.match(/,/g) ?? []).length > 1) return null; return t;
};

const idx = await get("/downloads/");
// Every lobbyist-contributions file the downloads page lists: one per year, or a year split by period and a big period by part.
const files = [...new Set([...idx.text.matchAll(/lobbyist-contributions-(\d{4}(?:-[a-z0-9-]+?)?)\.csv/g)].map((m) => m[1]))].sort();
const hub = await get("/lobbyist-contributions/");
if (!files.length) {
  ok(!/data-lc-hub/.test(hub.text) || /noindex/.test(hub.text), "no CSV files, so the hub is empty and noindex");
  ok(!/data-lobby-contrib|data-lobby-filer/.test((await get("/congress/")).text), "no section on /congress/");
  console.log(`verify-lobbycontrib: dataset empty in this build; ${checks} checks, ${failures} failures`); process.exit(failures ? 1 : 0);
}
let rows = [];
for (const y of files) { const r = await get(`/downloads/lobbyist-contributions-${y}.csv`); ok(r.status === 200, `CSV ${y} downloads`); ok(Buffer.byteLength(r.text) <= 25 * 1024 * 1024, `CSV ${y} is under 25 MiB`); rows.push(...parseCsv(r.text)); }
const today = new Date().toISOString().slice(0, 10);
ok(rows.every((r) => !r.date || r.date <= today), "no item dated in the future");
ok(rows.every((r) => r.amount === "" || /^-?\d+(\.\d+)?$/.test(r.amount)), "amounts are numbers or blank");
const counted = rows.filter((r) => r.counted === "true");
ok(counted.length + rows.filter((r) => r.counted === "false").length === rows.length, "counted is true or false");
// amended filings: one counted version per registrant, lobbyist, year and period
const perKey = new Map();
for (const r of counted) { const k = [r.registrant, r.lobbyist, r.filing_year, r.filing_period].join("|"); (perKey.get(k) ?? perKey.set(k, new Set()).get(k)).add(r.filing_uuid); }
ok([...perKey.values()].every((s) => s.size === 1), "only one filing counts per registrant, lobbyist, year and period");
const sup = new Set(rows.filter((r) => r.counted === "false").map((r) => r.filing_uuid));
ok(Number(/data-superseded="(\d+)"/.exec(hub.text)?.[1] ?? 0) >= sup.size, `hub counts at least the ${sup.size} replaced filings it holds items for`);

// periods
const periodKey = (r) => `${r.filing_year}-${r.filing_period}`;
const periods = new Map();
for (const r of counted) { const p = periods.get(periodKey(r)) ?? periods.set(periodKey(r), { items: 0, amount: 0, filings: new Set() }).get(periodKey(r)); p.items++; p.amount += Number(r.amount || 0); p.filings.add(r.filing_uuid); }
// The CSV gives the period as a label ("Mid year"); the hub keys rows by the stored code ("mid_year").
const normP = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
const hubKeys = new Map([...hub.text.matchAll(/data-period(?:-row)?="([^"]*)"/g)].map((m) => [normP(m[1]), m[1]]));
for (const [label, p] of periods) {
  const k = hubKeys.get(normP(label)) ?? label;
  const row = new RegExp(`<tr data-period-row="${k.replace(/[()]/g, "\\$&")}"[^>]*>([\\s\\S]*?)</tr>`).exec(hub.text)?.[1];
  const cell = new RegExp(`data-period="${k.replace(/[()]/g, "\\$&")}"[\\s\\S]*?</div></div>`).exec(hub.text)?.[0];
  const tds = row ? [...row.matchAll(/<td[^>]*data-v="([^"]*)"/g)].map((m) => m[1]) : null;
  if (tds) { ok(Number(tds[2]) === p.filings.size, `${k}: reports with contributions ${tds[2]} vs ${p.filings.size}`); ok(Number(tds[3]) === p.items, `${k}: items ${tds[3]} vs ${p.items}`); ok(Number(tds[4]) === Math.round(p.amount), `${k}: amount ${tds[4]} vs ${Math.round(p.amount)}`); }
  else ok(!!cell, `${k} appears on the hub`);
}
// newest year: kinds, filers, recipients
const newest = counted.reduce((a, r) => Math.max(a, Number(r.filing_year) || 0), 0); // no spread: 200,000 rows overflow the stack
const ny = counted.filter((r) => Number(r.filing_year) === newest);
const types = new Map(); for (const r of ny) { const e = types.get(r.contribution_type) ?? types.set(r.contribution_type, { n: 0, a: 0 }).get(r.contribution_type); e.n++; e.a += Number(r.amount || 0); }
const typeRows = [...hub.text.matchAll(/<tr data-type-row[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/data-v="([^"]*)"/g)].map((x) => x[1]));
ok(typeRows.length === types.size, `kinds of item: ${typeRows.length} vs ${types.size}`);
for (const [name, n, a] of typeRows) { const t = [...types].find(([k]) => k.toLowerCase() === name); ok(!!t && t[1].n === Number(n) && Math.round(t[1].a) === Number(a), `kind ${name}: ${n} items, ${a}`); }
const filers = new Map(); for (const r of ny) { const e = filers.get(r.registrant) ?? filers.set(r.registrant, { n: 0, a: 0, f: new Set() }).get(r.registrant); e.n++; e.a += Number(r.amount || 0); e.f.add(r.filing_uuid); }
const filerRows = [...hub.text.matchAll(/<tr data-filer-row[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/data-v="([^"]*)"/g)].map((x) => attr(x[1])));
ok(filerRows.length === Math.min(50, filers.size), `filers shown ${filerRows.length}`);
for (const [name, , n, a] of filerRows) { const f = [...filers].find(([k]) => k.toLowerCase() === name); ok(!!f && f[1].n === Number(n) && Math.round(f[1].a) === Number(a), `filer ${name}: ${n} items, ${a}`); }
const recips = new Map(); for (const r of ny) { const k = (r.honoree || r.payee || "").toLowerCase().replace(/[<>"]/g, ""); if (!k) continue; recips.set(k, (recips.get(k) ?? 0) + 1); }
const recRows = [...hub.text.matchAll(/<tr data-recipient-row data-name="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [attr(m[1]), [...m[2].matchAll(/data-v="([^"]*)"/g)].map((x) => attr(x[1]))]);
for (const [name, cells] of recRows) ok(recips.get(name) === Number(cells[2]), `recipient ${name}: ${cells[2]} items vs ${recips.get(name)}`);
ok(recRows.length === Math.min(100, recips.size), `recipients shown ${recRows.length} vs ${recips.size}`);

// member matching, with this script's own rule
const roster = new Map(); // slug -> full name, from the member pages named in the CSV plus the directory
const dir = parseCsv((await get("/downloads/congress-members.csv")).text);
const members = dir.map((m) => ({ slug: new URL(m.page_url ?? m.member_page_url ?? "http://x/").pathname.split("/").filter(Boolean).pop(), name: m.member ?? m.name ?? m.full_name })).filter((m) => m.slug && m.name);
const byName = new Map(); for (const m of members) { const k = nameKey(m.name); byName.set(k, byName.has(k) ? null : m.slug); }
const ccRes = await get("/downloads/campaign-committees.csv");
const ccRows = ccRes.status === 200 ? parseCsv(ccRes.text) : [];
const lastSeg = (u) => new URL(u).pathname.split("/").filter(Boolean).pop();
const payeeBy = new Map(); // normalised committee name -> slug, or null when two members share it
for (const c of ccRows) { const k = normOrg(c.committee); if (!k || !c.member_page_url) continue; const sl = lastSeg(c.member_page_url); payeeBy.set(k, payeeBy.has(k) && payeeBy.get(k) !== sl ? null : sl); }
let derived = 0, byPayee = 0, mismatched = 0;
for (const r of rows) {
  const h = honoree(r.honoree); const hon = h ? byName.get(nameKey(h)) ?? null : null;
  const pay = !hon && r.payee ? payeeBy.get(normOrg(r.payee)) ?? null : null;
  const want = hon || pay;
  const got = r.member_page_url ? lastSeg(r.member_page_url) : null;
  if (hon) derived++; else if (pay) byPayee++;
  if (got && !want && !(h && got.startsWith(nameKey(h).replace(/ /g, "-")))) { mismatched++; console.log(`  unexpected match: ${r.honoree} / ${r.payee} -> ${got}`); }
  if (want && got !== want) { mismatched++; console.log(`  missed match: ${r.honoree} / ${r.payee} (want ${want}, got ${got})`); }
}
ok(mismatched === 0, `member matches agree with the script's own rules (${derived} by full name, ${byPayee} by committee payee)`);
ok(rows.every((r) => !r.member_page_url || r.honoree || (r.payee && payeeBy.get(normOrg(r.payee)))), "an item with no honoree is tied to a member only through an exact committee payee");
ok(!rows.some((r) => r.member_page_url && !r.honoree && r.payee && /victory fund/i.test(r.payee)), "a near-miss payee name matches nobody");
ok(!rows.some((r) => /^(whitfield|marsh)$/i.test(r.honoree) && r.member_page_url), "a surname alone matches nobody");
ok(!rows.some((r) => / and /i.test(r.honoree) && r.member_page_url), "two people in one field match nobody");
const hubMain = text(/data-lc-hub[\s\S]*?<\/main>/.exec(hub.text)?.[0] ?? "");
ok(/payee/i.test(hubMain) && /campaign committee/i.test(hubMain) && !/is not applied/.test(hubMain), "hub states the payee rule (and no longer says it is not applied)");
ok(/cannot vouch/.test(hubMain), "hub carries the Senate notice");
ok(!/\b(bought|in exchange|influence|after receiving)\b/i.test(hubMain), "no forbidden wording on the hub");

// member pages
const bySlug = new Map(); for (const r of counted) if (r.member_page_url) { const p = new URL(r.member_page_url).pathname; (bySlug.get(p) ?? bySlug.set(p, []).get(p)).push(r); }
for (const [p, rs] of [...bySlug].slice(0, Math.max(sample, 8))) {
  const pg = await get(p); const sec = /<section[^>]*data-lobby-contrib[\s\S]*?<\/section>/.exec(pg.text)?.[0] ?? "";
  ok(!!sec, `${p} has the contributions section`);
  const n = (sec.match(/<tr [^>]*data-lc-item/g) ?? []).length; ok(n === Math.min(25, rs.length), `${p}: ${n} rows vs ${Math.min(25, rs.length)}`);
  ok(!/\b(bought|in exchange|influence|after receiving)\b/i.test(text(sec)), `${p}: no forbidden wording`);
}
const none = dir.find((m) => !bySlug.has(new URL(m.page_url ?? "http://x/").pathname)); if (none?.page_url) { const pg = await get(new URL(none.page_url).pathname); if (pg.status === 200) ok(!/data-lobby-contrib/.test(pg.text), "a member with no item has no section"); }
// company filer pages: registrant equals the company's name once normalised
const co = new Map(); for (const r of counted) { const k = normOrg(r.registrant); co.set(k, (co.get(k) ?? 0) + 1); }
for (const slug of ["lockheed-martin-corp", "palantir-technologies-inc"]) {
  const pg = await get(`/companies/${slug}/`); if (pg.status !== 200) continue;
  const want = co.get(normOrg(slug.replace(/-/g, " "))) ?? 0; const got = /data-lobby-filer data-items="(\d+)"/.exec(pg.text)?.[1];
  ok(want ? Number(got) === Math.min(want, 25) || Number(got) === want : !got, `${slug}: filer section items ${got ?? "none"} vs ${want}`);
}
ok((await get("/sitemaps/pages.xml")).text.includes("/lobbyist-contributions/"), "sitemap lists the hub");
ok((await get("/llms.txt")).text.includes("/lobbyist-contributions/"), "llms.txt lists the hub");
ok((await get("/data/search.json")).text.includes("/lobbyist-contributions/"), "search index lists the hub");
console.log(`verify-lobbycontrib: ${checks} checks pass, ${failures} failures; ${rows.length} items in ${files.length} files, ${bySlug.size} members matched`);
process.exit(failures ? 1 : 0);
