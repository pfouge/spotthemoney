// Checks the "Campaign committee" section on member pages (web/src/lib/campaign.ts), the member links
// on /donations/ and the campaign-committees.csv download, which other code writes:
//   node scripts/verify-campaign.mjs <base-url> [--sample N]      e.g. http://127.0.0.1:4321
// No browser. The oracle is /downloads/campaign-committees.csv (counts only, every linked committee).
// Checks: the section appears exactly for members with a linked committee that holds receipts, with at
// most three committees (most receipts first), each block's counts and FEC link equal the CSV, the
// caveat is present, tables stay within their row limits, no donor names, no "raised" or advice
// wording, no dash punctuation; /donations/ links a committee to its member only as the CSV does.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleAt = args.indexOf("--sample");
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 12;
const MAX_COMMITTEES = 3, EMPLOYER_ROWS = 10, STATE_ROWS = 10;
let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.log(`✗ ${m}`); } };
const get = async (p) => { for (let i = 0; ; i++) { try { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; } catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1500)); } } };
const attr = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
const text = (s) => attr(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function parseCsv(t) {
  const out = []; let row = [], cell = "", q = false; const s = t.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) { const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch; }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const head = out.shift() ?? [];
  return { head, rows: out.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))) };
}
const seg = (u) => new URL(u).pathname.split("/").filter(Boolean).pop();
const FORBIDDEN = /\b(total raised|raised|donors? gave to buy|bought influence|in exchange for|you should|we recommend|buy this|sell this)\b|[–—]/i;

const res = await get("/downloads/campaign-committees.csv");
const dl = await get("/downloads/");
if (res.status !== 200) {
  ok(!/campaign-committees\.csv/.test(dl.text), "no CSV, so the downloads page does not list it");
  ok(!/data-campaign\b/.test((await get("/congress/")).text), "no section on /congress/");
  console.log(`verify-campaign: dataset empty in this build; ${checks} checks, ${failures} failures`); process.exit(failures ? 1 : 0);
}
const { head, rows } = parseCsv(res.text);
ok(JSON.stringify(head) === JSON.stringify(["committee", "fec_id", "fec_url", "member", "member_page_url", "receipts_held", "receipts_90d", "first_receipt", "newest_receipt"]), `CSV columns: ${head.join(",")}`);
ok(rows.length > 0, "CSV has rows");
ok(/campaign-committees\.csv/.test(dl.text), "the downloads page lists the CSV");
ok((await get("/data/catalog.json")).text.includes("campaign-committees.csv"), "the data catalogue lists the CSV");
const today = new Date().toISOString().slice(0, 10);
const ids = new Set();
for (const r of rows) {
  ok(/^C\d{8}$/.test(r.fec_id) || r.fec_id.length > 0, `${r.committee}: fec id present`);
  ok(!ids.has(r.fec_id), `${r.fec_id}: listed once`); ids.add(r.fec_id);
  ok(r.fec_url === `https://www.fec.gov/data/committee/${encodeURIComponent(r.fec_id)}/`, `${r.fec_id}: fec_url`);
  ok(r.member && r.member_page_url, `${r.fec_id}: linked to a member page`);
  ok(/^\d+$/.test(r.receipts_held) && /^\d+$/.test(r.receipts_90d) && Number(r.receipts_90d) <= Number(r.receipts_held), `${r.fec_id}: counts are whole numbers and 90 days <= held`);
  ok(!r.first_receipt || !r.newest_receipt || r.first_receipt <= r.newest_receipt, `${r.fec_id}: first <= newest`);
  ok(!r.newest_receipt || r.newest_receipt <= today, `${r.fec_id}: newest receipt not in the future`);
  ok(Number(r.receipts_held) > 0 || (!r.first_receipt && !r.newest_receipt), `${r.fec_id}: no dates when nothing is held`);
}
ok(!head.some((h) => /sum|amount|total|donor|name_of|employer/i.test(h.replace(/^member$|^committee$/, ""))), "CSV carries no sums, amounts or donor columns");

// members with a section: top committees by receipts held, at most three
const byMember = new Map();
for (const r of rows) (byMember.get(new URL(r.member_page_url).pathname) ?? byMember.set(new URL(r.member_page_url).pathname, []).get(new URL(r.member_page_url).pathname)).push(r);
const wantShown = (rs) => rs.filter((r) => Number(r.receipts_held) > 0).sort((a, b) => Number(b.receipts_held) - Number(a.receipts_held) || (a.fec_id < b.fec_id ? -1 : 1)).slice(0, MAX_COMMITTEES);
const entries = [...byMember];
const withSection = entries.filter(([, rs]) => wantShown(rs).length);
let seen = 0;
for (const [p, rs] of [...withSection, ...entries.filter(([, rs]) => !wantShown(rs).length)].slice(0, Math.max(sample, entries.length ? Math.min(entries.length, sample) : 0))) {
  const pg = await get(p); seen++;
  ok(pg.status === 200, `${p} opens`);
  const want = wantShown(rs);
  const sec = /<section[^>]*data-campaign\b[\s\S]*?<\/section>/.exec(pg.text)?.[0] ?? "";
  if (!want.length) { ok(!sec, `${p}: committee holds no receipts, so no section`); continue; }
  ok(!!sec, `${p}: has the campaign section`);
  ok(Number(/data-committees="(\d+)"/.exec(sec)?.[1]) === want.length, `${p}: ${want.length} committees shown`);
  ok(/data-cc-caveat/.test(sec) && /not totals/.test(text(sec)) && /Nothing here ties a receipt to a trade/.test(text(sec)), `${p}: caveat present`);
  ok(/href="\/methodology\/#campaign-committee"/.test(sec), `${p}: links the methodology`);
  const blocks = [...sec.matchAll(/<div class="cc-block"[^>]*data-committee="([^"]*)"[\s\S]*?(?=<div class="cc-block"|<a [^>]*data-download|<\/section>)/g)];
  ok(blocks.length === want.length, `${p}: ${blocks.length} blocks vs ${want.length}`);
  want.forEach((w, i) => {
    const b = blocks[i]; if (!b) return;
    ok(attr(b[1]) === w.fec_id, `${p}: block ${i} is ${w.fec_id}`);
    ok(Number(/data-cc-held="(\d+)"/.exec(b[0])?.[1]) === Number(w.receipts_held), `${p}: ${w.fec_id} receipts held ${/data-cc-held="(\d+)"/.exec(b[0])?.[1]} vs ${w.receipts_held}`);
    ok(Number(/data-cc-held90="(\d+)"/.exec(b[0])?.[1]) === Number(w.receipts_90d), `${p}: ${w.fec_id} last 90 days vs ${w.receipts_90d}`);
    ok(b[0].includes(`href="${w.fec_url}"`), `${p}: ${w.fec_id} links its FEC page`);
    ok(attr(/<h3[^>]*><a [^>]*>([\s\S]*?)<\/a>/.exec(b[0])?.[1] ?? "") === w.committee, `${p}: ${w.fec_id} name`);
    const emp = (/data-cc-employers[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(b[0])?.[1].match(/<tr[\s>]/g) ?? []).length;
    const sta = (/data-cc-states[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(b[0])?.[1].match(/<tr[\s>]/g) ?? []).length;
    ok(emp <= EMPLOYER_ROWS && sta <= STATE_ROWS, `${p}: ${w.fec_id} tables within limits (${emp} employers, ${sta} states)`);
    ok(sta === 0 || (/data-cc-states[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(b[0])[1].match(/<td[^>]*data-v="[a-z]{2}"[^>]*>[A-Z]{2}<\/td>/g) ?? []).length === sta, `${p}: ${w.fec_id} states are two letters`);
    ok(!/data-cc-omitted/.test(b[0]) || /Left out: [\d,]+ receipts? where the donor/.test(text(b[0])), `${p}: ${w.fec_id} omitted note reads right`);
  });
  const t = text(sec);
  ok(!FORBIDDEN.test(t), `${p}: no forbidden wording${FORBIDDEN.exec(t) ? ` (${FORBIDDEN.exec(t)[0]})` : ""}`);
  ok(!/donor name|contributor name/i.test(t), `${p}: no donor names`);
  // The at-a-glance tiles are capped, so the section's own tile can be left out; the Washington group link always reaches it.
  ok(/id="campaign-committee"/.test(sec) && /href="#(campaign-committee|washington)"/.test(pg.text), `${p}: jump link to the section or its group`);
}
// a member with no linked committee has no section
const dir = parseCsv((await get("/downloads/congress-members.csv")).text).rows;
const none = dir.find((m) => m.page_url && !byMember.has(new URL(m.page_url).pathname));
if (none) { const pg = await get(new URL(none.page_url).pathname); if (pg.status === 200) ok(!/<section[^>]*data-campaign\b/.test(pg.text), `${new URL(none.page_url).pathname}: no linked committee, no section`); }

// /donations/: a committee names its member only when the CSV links them
const don = await get("/donations/");
ok(don.status === 200, "/donations/ opens");
// Two committees can share a name (a member's House and Senate committees): keep every row of a name.
const csvByName = new Map(); for (const r of rows) csvByName.set(r.committee, [...(csvByName.get(r.committee) ?? []), r]);
let linkedRows = 0;
for (const m of don.text.matchAll(/<tr[^>]*><td[^>]*>([^<]*)(?:<span class="cc-member"[^>]*> · <a href="([^"]*)"[^>]*>[^<]*<\/a><\/span>)?<\/td>/g)) {
  const name = attr(m[1]).trim(), href = m[2];
  const r = csvByName.get(name);
  if (href) { linkedRows++; ok(!!r && r.some((x) => new URL(x.member_page_url).pathname === href), `/donations/: ${name} links ${href} as the CSV does`); }
  else if (r) ok(false, `/donations/: ${name} is linked in the CSV but shows no member link`);
}
ok(linkedRows > 0 || rows.every((r) => Number(r.receipts_held) === 0), "/donations/ links at least one committee to its member");
const dtext = text(don.text);
ok(!/\b(total raised|raised \$)/i.test(dtext), "/donations/ never calls a sum raised money");
// methodology
const meth = await get("/methodology/");
ok(/id="campaign-committee"/.test(meth.text), "methodology has #campaign-committee");
ok(!/\b(total raised|raised)\b|[–—]/i.test(text(/<p id="campaign-committee"[\s\S]*?<\/p>/.exec(meth.text)?.[0] ?? "")), "methodology paragraph: no 'raised', no dashes");
console.log(`verify-campaign: ${checks} checks pass, ${failures} failures; ${rows.length} linked committees, ${withSection.length} members with a section (${seen} pages read), ${linkedRows} /donations/ rows with a member link`);
process.exit(failures ? 1 : 0);
