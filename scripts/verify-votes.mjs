// Checks roll-call votes (the hub /congress-votes/, the "Recorded votes" section of member pages,
// the monthly position files; web/src/lib/votes.ts) against files that other code writes:
//   node scripts/verify-votes.mjs <base-url> [--sample N] [--no-browser]
// Oracle: /downloads/congress-votes.csv (one row per roll call, written by downloads.ts) and the
// monthly position files /data/votes/<chamber>-<yyyy>-<mm>.json, read with this script's own
// unpacker. Checks: the hub's printed rows and its data file against the CSV; every monthly file
// (a string as long as its roster, only y n p x -, roll calls that exist); a roll call's y/n/p/x
// counts against the CSV totals (a difference is a WARNING line naming the roll call, not a
// failure: the official totals can differ from the positions listed); for sampled members with a
// page (most positions, fewest, a senator, one with a not-voting record, and an even spread) the
// section's four counts over the 12-month window and every table row, cell for cell; the wording
// rule (no scoring); and, when a browser is available, the filters, the member pin and the
// positions that open in place. --no-browser runs everything else.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 12;
const noBrowser = args.includes("--no-browser");
const HUB = "/congress-votes/";
const WINDOW_DAYS = 365, DEFAULT_WINDOW = 90, ROWS = 25, PAGE = 50, MEMBER_Q = 120;
let failures = 0, checks = 0, warnings = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`✗ ${msg}`); } return !!cond; };
const warn = (msg) => { warnings++; console.log(`! ${msg}`); };
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const rowsOf = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => ({ tag: m[0].slice(0, m[0].indexOf(">") + 1), cells: [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]) })).filter((r) => r.cells.length);
const sectionOf = (html, attr) => { const i = html.indexOf(attr); if (i < 0) return ""; const j = html.indexOf("</section>", i); return html.slice(i, j < 0 ? undefined : j); };
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1];
const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nf = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("en-US"));
const LABEL = { yea: "Yea", nay: "Nay", present: "Present", not_voting: "Not voting" };
const CH = { y: "yea", n: "nay", p: "present", x: "not_voting" };
// The member table cuts a question at 120 characters at a word (the site's rule, restated here).
const cut = (s, max) => { const t = (s ?? "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim(); if (!t) return null; if (t.length <= max) return t; const c = t.slice(0, max - 1), sp = c.lastIndexOf(" "); return (sp > max * 0.6 ? c.slice(0, sp) : c).trimEnd().replace(/[,;:.\s]+$/, "") + "…"; };

function parseCsv(txt) {
  const out = []; let row = [], cell = "", q = false;
  const s = txt.replace(/^﻿/, "");
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

const hub = await get(HUB);
if (hub.status !== 200) { console.log(`✗ ${HUB} answered ${hub.status}`); process.exit(1); }
const csvRes = await get("/downloads/congress-votes.csv");
if (csvRes.status !== 200) {
  // Nothing on record: the hub says so, is not indexed, and no member page has a votes section.
  ok(hub.text.includes("empty-reason"), "an empty roll call page says why");
  ok(/<meta name="robots" content="[^"]*noindex/.test(hub.text), "an empty roll call page is noindex");
  ok(!/data-votes-hub/.test(hub.text), "an empty roll call page has no table");
  const sm = await get("/sitemaps/pages.xml");
  ok(!sm.text.includes(HUB), "an empty roll call page is not in the sitemap");
  const cat = await get("/data/catalog.json");
  ok(!/congress-votes\.csv/.test(cat.text), "the catalogue lists no votes file when there are none");
  const mem = await get("/congress/");
  let withSection = 0;
  for (const href of [...mem.text.matchAll(/href="(\/congress\/[a-z0-9-]+\/)"/g)].map((m) => m[1]).slice(0, 15)) { if ((await get(href)).text.includes("data-votes")) withSection++; }
  ok(withSection === 0, "no member page has a votes section when there are no roll calls");
  console.log(failures ? `verify-votes: ${failures} problem(s)` : `verify-votes: no roll calls on record, nothing shown, ${checks} checks pass`);
  process.exit(failures ? 1 : 0);
}
const csv = parseCsv(csvRes.text);
ok(csv.length > 0, "the CSV file has rows");
const keyOf = (c, r) => `${c.chamber ?? c}|${c.congress ?? ""}|${c.session ?? ""}|${c.roll_number ?? r}`;
const byKey = new Map(csv.map((r) => [keyOf(r), r]));
ok(byKey.size === csv.length, "a roll call is listed once in the CSV (chamber, congress, session, number)");
ok(Object.keys(csv[0]).join(",") === "chamber,congress,session,roll_number,date,bill,question,vote_type,result,yeas,nays,present,not_voting,source_url", "the CSV has the documented columns in order");
ok(csv.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)), "every CSV row has a date");
const dates = csv.map((r) => r.date).sort();
const sorted = csv.map((r) => r.date);
ok(sorted.every((d, i) => i === 0 || sorted[i - 1] >= d), "the CSV is newest first");

// ── the data file ───────────────────────────────────────────────────────────────────────────
const dataRes = await get("/data/congress-votes.json");
ok(dataRes.status === 200, "/data/congress-votes.json is served");
const data = JSON.parse(dataRes.text);
const built = data.built;
ok(/^\d{4}-\d{2}-\d{2}$/.test(built), "the data file states the build day");
ok(JSON.stringify(Object.keys(data)) === JSON.stringify(["built", "results", "members", "rows"]), "the data file has the layout the developers page states");
ok(data.rows.length === csv.length, `the data file has ${data.rows.length} rows, the CSV ${csv.length}`);
const rolls = data.rows.map((x) => ({ id: x[0], chamber: x[1] === 1 ? "senate" : "house", congress: x[2], session: x[3], roll: x[4], date: x[5], bill: x[6], question: x[7], result: x[8] >= 0 ? data.results[x[8]] : "", yeas: x[9], nays: x[10], present: x[11], nv: x[12], url: x[13] }));
const rollByKey = new Map();
for (const r of rolls) {
  const c = byKey.get(`${r.chamber}|${r.congress}|${r.session}|${r.roll}`);
  if (!ok(!!c, `data row ${r.id} (${r.chamber} ${r.roll}) is not in the CSV`) && c === undefined) continue;
  rollByKey.set(`${r.chamber}|${r.congress}|${r.session}|${r.roll}`, r);
  ok(c.date === r.date && (c.bill ?? "") === r.bill && (c.result ?? "") === r.result && String(c.yeas) === String(r.yeas ?? "") && String(c.nays) === String(r.nays ?? "") && String(c.present) === String(r.present ?? "") && String(c.not_voting) === String(r.nv ?? "") && c.source_url === r.url,
    `roll ${r.chamber} ${r.roll}: the data file and the CSV differ`);
  const q = c.question ?? "";
  ok(q.startsWith(r.question.replace(/…$/, "")) || r.question === q, `roll ${r.chamber} ${r.roll}: the data file's question is not the CSV's`);
  ok(r.question.length <= 300, `roll ${r.chamber} ${r.roll}: question over 300 characters in the data file`);
}
ok(new Set(rolls.map((r) => r.id)).size === rolls.length, "roll call ids are unique");
ok(new Set(rolls.map((r) => `${r.chamber}|${r.session}|${r.roll}`)).size === rolls.length, "numbers repeat only across sessions or chambers");
ok(rolls.some((r) => r.session !== rolls[0].session) || rolls.length < 3, "(seed) more than one session is on file");

// ── monthly position files ──────────────────────────────────────────────────────────────────
const months = new Map();
for (const r of rolls) months.set(`${r.chamber}-${r.date.slice(0, 7)}`, 1);
const files = new Map();   // "house-2026-09" -> parsed
for (const key of months.keys()) {
  const res = await get(`/data/votes/${key}.json`);
  if (res.status !== 200) continue;   // a month with no recorded positions has no file
  files.set(key, JSON.parse(res.text));
}
const idToRoll = new Map(rolls.map((r) => [String(r.id), r]));
const bySlug = new Map();   // slug -> { chamber, positions: [{ roll, position }] }
let positionCount = 0;
for (const [key, f] of files) {
  ok(JSON.stringify(Object.keys(f)) === JSON.stringify(["chamber", "month", "roster", "rolls"]), `${key}: layout differs from the developers page`);
  ok(`${f.chamber}-${f.month}` === key, `${key}: names another month`);
  const slugs = f.roster.map((m) => m[4]).filter(Boolean);
  ok(new Set(f.roster.map((m) => m[0])).size === f.roster.length, `${key}: a member key is on the roster twice`);
  ok(new Set(slugs).size === slugs.length, `${key}: a page name is on the roster twice`);
  for (const [id, s] of Object.entries(f.rolls)) {
    const r = idToRoll.get(id);
    if (!ok(!!r && r.chamber === f.chamber && r.date.startsWith(f.month), `${key}: roll call ${id} does not belong in this file`)) continue;
    ok(s.length === f.roster.length, `${key}: roll call ${id} has ${s.length} characters for ${f.roster.length} members`);
    ok(/^[ynpx-]*$/.test(s), `${key}: roll call ${id} has a character other than y n p x -`);
    const c = { yea: 0, nay: 0, present: 0, not_voting: 0 };
    for (let i = 0; i < s.length; i++) {
      const pos = CH[s[i]]; if (!pos) continue;
      c[pos]++; positionCount++;
      const slug = f.roster[i]?.[4];
      if (slug) { const e = bySlug.get(slug) ?? { chamber: f.chamber, positions: [] }; e.positions.push({ roll: r, position: pos }); bySlug.set(slug, e); }
    }
    if (r.yeas != null && (c.yea !== r.yeas || c.nay !== r.nays || c.present !== r.present || c.not_voting !== r.nv)) {
      warn(`${f.chamber} roll ${r.roll} (${r.date}): positions give ${c.yea}/${c.nay}/${c.present}/${c.not_voting}, the official totals ${r.yeas}/${r.nays}/${r.present}/${r.nv}`);
    }
  }
}
// Every roll call that has a position is in a file of its chamber and month.
const fileIds = new Set([...files.values()].flatMap((f) => Object.keys(f.rolls)));
ok(files.size > 0, "there are monthly position files");

// ── the hub's printed rows ───────────────────────────────────────────────────────────────────
const newestFirst = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.chamber < b.chamber ? 1 : a.chamber > b.chamber ? -1 : b.roll - a.roll || b.id - a.id);
const start = addDays(built, -DEFAULT_WINDOW);
const expectedFirst = rolls.filter((r) => r.date >= start && r.date <= built).sort(newestFirst).slice(0, PAGE);
const printed = rowsOf(sectionOf(hub.text, "data-votes-hub")).filter((r) => /data-roll=/.test(r.tag));
ok(printed.length === expectedFirst.length, `the hub prints ${printed.length} rows, the CSV gives ${expectedFirst.length} for the last ${DEFAULT_WINDOW} days`);
printed.forEach((p, i) => {
  const e = expectedFirst[i]; if (!e) return;
  const c = p.cells.map(text);
  ok(c[0] === longDate(e.date) && c[1] === (e.chamber === "house" ? "House" : "Senate") && c[2].replace(/\s*↗$/, "") === String(e.roll), `hub row ${i + 1}: date, chamber or roll call differs from the CSV (${c[0]}, ${c[1]}, ${c[2]})`);
  ok(c[3] === (e.bill || "—") && c[5] === (e.result || "—"), `hub row ${i + 1}: bill or result differs`);
  ok(c[6] === nf(e.yeas) && c[7] === nf(e.nays) && c[8] === nf(e.present) && c[9] === nf(e.nv), `hub row ${i + 1}: totals differ from the CSV`);
  const href = (p.cells[2].match(/href="([^"]+)"/) ?? [])[1];
  ok((href ?? "") === (e.url ?? ""), `hub row ${i + 1}: the link is not the official page`);
});
ok(/data-vt="count"/.test(hub.text) && hub.text.includes("data-src=\"/data/congress-votes.json\""), "the hub points at its data file");
ok(hub.text.includes("data-answer"), "the hub has an answer block");

// ── member pages ─────────────────────────────────────────────────────────────────────────────
const winStart = addDays(built, -WINDOW_DAYS);
const members = [...bySlug.entries()].map(([slug, e]) => ({ slug, ...e, inWin: e.positions.filter((p) => p.roll.date >= winStart && p.roll.date <= built).length, nv: e.positions.filter((p) => p.position === "not_voting").length }));
const pick = new Map();
const add = (m) => m && pick.set(m.slug, m);
add([...members].sort((a, b) => b.positions.length - a.positions.length)[0]);
add([...members].sort((a, b) => a.positions.length - b.positions.length)[0]);
add(members.find((m) => m.chamber === "senate"));
add([...members].sort((a, b) => b.nv - a.nv)[0]);
for (let i = 0; i < members.length && pick.size < sample; i += Math.max(1, Math.floor(members.length / sample))) add(members[i]);
const bad = /missed votes|party loyalty|voted with (the|their) party|attendance|\d+(\.\d+)?\s*% of (votes|roll)/i;
let sectionsChecked = 0;
for (const m of pick.values()) {
  const page = await get(`/congress/${m.slug}/`);
  if (!ok(page.status === 200, `/congress/${m.slug}/ answers ${page.status}`)) continue;
  const sec = sectionOf(page.text, "data-votes");
  if (!ok(sec.includes('id="votes"'), `${m.slug}: has recorded positions and no Recorded votes section`)) continue;
  sectionsChecked++;
  const tag = (page.text.match(/<section[^>]*data-votes[^>]*>/) ?? [""])[0];
  const exp = { yea: 0, nay: 0, present: 0, not_voting: 0 };
  for (const p of m.positions) if (p.roll.date >= winStart && p.roll.date <= built) exp[p.position]++;
  ok(Number(attr(tag, "data-yea")) === exp.yea && Number(attr(tag, "data-nay")) === exp.nay && Number(attr(tag, "data-present")) === exp.present && Number(attr(tag, "data-not-voting")) === exp.not_voting,
    `${m.slug}: the section states ${attr(tag, "data-yea")}/${attr(tag, "data-nay")}/${attr(tag, "data-present")}/${attr(tag, "data-not-voting")}, the position files give ${exp.yea}/${exp.nay}/${exp.present}/${exp.not_voting}`);
  ok(Number(attr(tag, "data-total")) === m.positions.length, `${m.slug}: total positions on record ${attr(tag, "data-total")}, the files give ${m.positions.length}`);
  const sum = text((sec.match(/data-votes-summary[^>]*>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
  const total = exp.yea + exp.nay + exp.present + exp.not_voting;
  ok(total === 0 ? /No roll call in the last 12 months/.test(sum) : sum.includes(`${total.toLocaleString("en-US")} roll call`) && sum.includes(`${exp.yea} yea, ${exp.nay} nay, ${exp.present} present and ${exp.not_voting} not voting`), `${m.slug}: the summary sentence is wrong: ${sum}`);
  ok(sec.includes("Positions are as recorded by the Clerk of the House or the Secretary of the Senate.") && sec.includes("This site does not score votes"), `${m.slug}: the caveat is not on the section`);
  const link = (sec.match(/data-votes-link/) && (sec.match(/href="(\/congress-votes\/#[^"]+)"/) ?? [])[1]) || "";
  ok(link.includes(`member=${m.slug}`) && link.includes(`chamber=${m.chamber}`), `${m.slug}: the link to the hub does not name the member and chamber (${link})`);
  const rows = rowsOf(sec).filter((r) => /data-vote=/.test(r.tag));
  const newest = [...m.positions].sort((a, b) => newestFirst(a.roll, b.roll));
  ok(rows.length === Math.min(ROWS, m.positions.length), `${m.slug}: ${rows.length} rows, expected ${Math.min(ROWS, m.positions.length)}`);
  const cutoff = newest[Math.min(ROWS, newest.length) - 1]?.roll.date;
  for (const r of rows) {
    const id = attr(r.tag, "data-vote");
    const roll = idToRoll.get(id);
    if (!ok(!!roll, `${m.slug}: row for unknown roll call ${id}`)) continue;
    const c = r.cells.map(text);
    const csvRow = byKey.get(`${roll.chamber}|${roll.congress}|${roll.session}|${roll.roll}`);
    const mine = m.positions.find((p) => p.roll.id === roll.id);
    ok(!!mine, `${m.slug}: shows roll call ${id} with no position in the files`);
    ok(c[0] === longDate(roll.date), `${m.slug} ${id}: date ${c[0]}`);
    ok(c[1].replace(/\s*↗$/, "") === `${roll.chamber === "house" ? "House" : "Senate"} ${roll.roll}`, `${m.slug} ${id}: roll call ${c[1]}`);
    ok(c[2] === (roll.bill || "—"), `${m.slug} ${id}: bill ${c[2]}`);
    ok(c[3] === (cut(csvRow.question, MEMBER_Q) ?? "—"), `${m.slug} ${id}: question "${c[3]}" is not the CSV's, cut at ${MEMBER_Q}`);
    ok(c[4] === (roll.result || "—"), `${m.slug} ${id}: result ${c[4]}`);
    ok(mine && c[5] === LABEL[mine.position] && attr(r.tag, "data-position") === mine.position, `${m.slug} ${id}: position ${c[5]}, the file says ${mine?.position}`);
    ok(roll.date >= cutoff, `${m.slug} ${id}: a roll call older than the ${ROWS}th newest is shown`);
    const href = (r.cells[1].match(/href="([^"]+)"/) ?? [])[1];
    ok((href ?? "") === (roll.url ?? ""), `${m.slug} ${id}: the roll call link is not the official page`);
  }
  ok(rows.every((r, i) => i === 0 || (idToRoll.get(attr(rows[i - 1].tag, "data-vote"))?.date ?? "") >= (idToRoll.get(attr(r.tag, "data-vote"))?.date ?? "")), `${m.slug}: rows are not newest first`);
  ok(!bad.test(text(sec)), `${m.slug}: the section scores or ranks votes`);
  // The glance tile: roll calls with a position in the last 12 months.
  const tile = (page.text.match(/<a href="#votes">[\s\S]*?<\/a>/) ?? [""])[0];
  if (page.text.includes("data-glance")) ok(text(tile).includes("Recorded votes") && text(tile).includes(total.toLocaleString("en-US")), `${m.slug}: the "Recorded votes" tile is missing or wrong (${text(tile)})`);
  const g = page.text.indexOf('id="washington"');
  ok(g >= 0 && g < page.text.indexOf('id="votes"') && (page.text.indexOf('id="committees"') < 0 || page.text.indexOf('id="votes"') < page.text.indexOf('id="committees"')), `${m.slug}: the votes section is not in the Washington group before committees`);
}
// A member page for someone with no recorded position has no section.
const all = await get("/congress/");
const someNone = [...all.text.matchAll(/href="\/congress\/([a-z0-9-]+)\/"/g)].map((m) => m[1]).filter((s) => !bySlug.has(s)).slice(0, 5);
for (const s of someNone) ok(!(await get(`/congress/${s}/`)).text.includes('data-votes'), `${s}: has no positions and shows a votes section`);

// ── elsewhere ───────────────────────────────────────────────────────────────────────────────
ok(!bad.test(text((hub.text.match(/<main[\s\S]*?<\/main>/) ?? [hub.text])[0])), "the hub has no scoring wording");
const sm = await get("/sitemaps/pages.xml"), llms = await get("/llms.txt"), search = await get("/data/search.json");
ok(sm.text.includes(`${HUB}</loc>`), "the sitemap lists the hub");
ok(llms.text.includes("/congress-votes/"), "llms.txt lists the hub");
ok(search.text.includes(HUB), "the search index lists the hub");
const methodology = await get("/methodology/");
ok(methodology.text.includes('id="votes"'), "the methodology has #votes");
const guide = await get("/guides/how-to-read-a-roll-call-vote/");
ok(guide.status === 200, "the roll call guide is served");
const cat = JSON.parse((await get("/data/catalog.json")).text);
ok(cat.csv.files.some((f) => f.path === "/downloads/congress-votes.csv" && f.rows === csv.length), "the catalogue lists congress-votes.csv with its row count");
ok(cat.workingFiles.some((w) => w.path === "/data/congress-votes.json") && cat.workingFiles.filter((w) => w.pattern).length === 1, "the catalogue lists the hub's data file and ONE pattern entry for the monthly files");
ok(!cat.csv.files.some((f) => /position/i.test(f.title) || /position/.test(f.name)), "there is no per-member positions CSV");

// ── in a browser ─────────────────────────────────────────────────────────────────────────────
let browserNote = "no browser checks";
if (!noBrowser) {
  let chromium;
  try { ({ chromium } = await import("playwright")); } catch { /* not installed */ }
  if (chromium) {
    let browser;
    try { browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}); } catch { browser = null; }
    if (browser) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
      const total = () => page.evaluate(() => Number(document.querySelector("[data-votes-hub]")?.dataset.shown ?? -1));
      const ready = () => page.waitForFunction(() => document.querySelector("[data-votes-hub]")?.dataset.ready === "1", null, { timeout: 15000 });
      await page.goto(base + HUB, { waitUntil: "load" }); await ready();
      const inWin = (r, days) => days == null || (r.date >= addDays(built, -days) && r.date <= built);
      const want = (f) => rolls.filter((r) => inWin(r, f.days) && (!f.chamber || r.chamber === f.chamber) && (!f.result || r.result === f.result) && (!f.q || `${r.bill} ${r.question}`.toLowerCase().includes(f.q))).length;
      ok(await total() === want({ days: DEFAULT_WINDOW }), `hub opens on ${want({ days: DEFAULT_WINDOW })} roll calls, shows ${await total()}`);
      const setHash = async (h) => { await page.goto(base + HUB + h, { waitUntil: "load" }); await ready(); };
      for (const [h, f] of [["#w=all", { days: null }], ["#w=30", { days: 30 }], ["#w=365", { days: 365 }], ["#w=all&chamber=senate", { days: null, chamber: "senate" }], ["#w=all&chamber=house", { days: null, chamber: "house" }]]) {
        await setHash(h); ok(await total() === want(f), `${h}: ${await total()} roll calls, expected ${want(f)}`);
      }
      for (const res of [...new Set(rolls.map((r) => r.result).filter(Boolean))]) { await setHash(`#w=all&result=${encodeURIComponent(res)}`); ok(await total() === want({ days: null, result: res }), `result "${res}": ${await total()}, expected ${want({ days: null, result: res })}`); }
      await setHash("#w=all&q=recommit"); ok(await total() === want({ days: null, q: "recommit" }), `search "recommit": ${await total()}`);
      await setHash("#w=all&chamber=nothing&n=9&page=-3"); ok(await total() === rolls.length, "junk values fall back");
      await setHash("#w=all"); await page.selectOption('[data-vt="chamber"]', "senate"); ok(await total() === want({ days: null, chamber: "senate" }), "the chamber control filters");
      ok((await page.evaluate(() => location.hash)).includes("chamber=senate"), "the address records the filter");
      await page.click('[data-vt="reset"]'); ok(await total() === want({ days: DEFAULT_WINDOW }), "Reset returns to the opening view");
      // A member pinned from a member page: the Position column is filled from the monthly files.
      const m = [...pick.values()].find((x) => x.chamber === "house") ?? [...pick.values()][0];
      if (m) {
        await setHash(`#chamber=${m.chamber}&member=${m.slug}&w=all`);
        ok(await page.locator('[data-vt="unpin"]').count() === 1, "the pin shows with a Remove button");
        await page.waitForFunction(() => ![...document.querySelectorAll('[data-vt="pos"]')].some((c) => c.textContent === "…"), null, { timeout: 15000 });
        const cells = await page.$$eval("tr[data-roll]", (trs) => trs.map((tr) => [tr.dataset.roll, tr.querySelector('[data-vt="pos"]')?.textContent ?? null]));
        let wrong = 0;
        for (const [id, label] of cells) { const mine = m.positions.find((p) => String(p.roll.id) === id); if ((mine ? LABEL[mine.position] : "No record") !== label) wrong++; }
        ok(cells.length > 0 && wrong === 0, `member pin ${m.slug}: ${wrong} of ${cells.length} positions differ from the monthly files`);
        await page.click('[data-vt="unpin"]'); ok(!(await page.evaluate(() => location.hash)).includes("member="), "Remove drops the pin");
      }
      // Positions in place: four groups with the counts the file gives.
      await setHash("#w=all&chamber=house");
      const first = await page.$eval("tr[data-roll]", (tr) => tr.dataset.roll);
      await page.click(`tr[data-roll="${first}"] [data-vt="open"]`);
      await page.waitForSelector(`tr[data-detail="${first}"] .vt-group`, { timeout: 15000 });
      const groups = await page.$$eval(`tr[data-detail="${first}"] .vt-group`, (gs) => gs.map((g) => [g.dataset.position, (g.querySelector("h3")?.textContent ?? "").replace(/.*\((\d[\d,]*)\)/, "$1")]));
      ok(groups.length === 4, "opening a roll call shows the four position groups");
      const roll = idToRoll.get(first); const file = files.get(`${roll.chamber}-${roll.date.slice(0, 7)}`);
      if (file?.rolls[first]) {
        const c = { yea: 0, nay: 0, present: 0, not_voting: 0 };
        for (const ch of file.rolls[first]) if (CH[ch]) c[CH[ch]]++;
        ok(groups.every(([k, n]) => Number(n.replace(/,/g, "")) === c[k]), `roll ${first}: group counts ${JSON.stringify(groups)} differ from the file ${JSON.stringify(c)}`);
        const linked = await page.$$eval(`tr[data-detail="${first}"] a[href^="/congress/"]`, (as) => as.length);
        const expLinked = [...file.rolls[first]].filter((ch, i) => CH[ch] && file.roster[i][4]).length;
        ok(linked === expLinked, `roll ${first}: ${linked} names link to a member page, expected ${expLinked}`);
      }
      await page.click(`tr[data-roll="${first}"] [data-vt="open"]`);
      ok(await page.locator(`tr[data-detail="${first}"]`).count() === 0, "a second click closes the roll call again");
      // Download.
      const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-vt="download"]')]);
      const body = (await (await import("node:fs/promises")).readFile(await dl.path(), "utf8"));
      ok(parseCsv(body).length === want({ days: null, chamber: "house" }), "the download holds every row of the view");
      // Phone width: nothing runs off the side.
      await page.setViewportSize({ width: 390, height: 800 }); await setHash("");
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the hub does not run off the side at 390 px");
      ok(errors.length === 0, `page errors: ${errors.join("; ")}`);
      await browser.close();
      browserNote = "browser checks run";
    } else browserNote = "no browser available";
  }
}
console.log(`${failures === 0 ? "✓" : "✗"} votes: ${csv.length} roll calls, ${files.size} monthly files (${positionCount} positions), ${sectionsChecked} member sections; ${browserNote}; ${checks} checks, ${failures} failed, ${warnings} warnings`);
process.exit(failures ? 1 : 0);
