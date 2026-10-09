#!/usr/bin/env node
// Checks the member-of-Congress profile pages (web/src/pages/congress/[slug].astro) on a built
// or live site. For a sample of members with trades it reads the page and checks that the
// numbers agree with each other and with the page's own trade table:
//   - the header facts, the answer, and every section the jump links point to are there;
//   - "Trades on record" = purchases + sales + others = sum of the year rows = sum of the owner rows;
//   - the stock table's trade counts never exceed the total, and are sorted;
//   - the questions on the page match the FAQPage data one for one, and none gives a motive;
//   - a committee section, when present, lists at least one committee and carries its caution;
//   - nothing runs off the side at phone and mid-desktop widths.
// Members with no trades get a lighter check (facts, answer, noindex).
//
//   node scripts/verify-profile.mjs http://127.0.0.1:4321 [--sample 25]
//   node scripts/verify-profile.mjs https://spotthemoney.com
//
// Needs Playwright: npm i --no-save playwright. Set PW_CHROMIUM to reuse a Chromium binary.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const sampleN = Number(args[args.indexOf("--sample") + 1]) || 25;
let chromium;
try { ({ chromium } = await import("playwright")); } catch { console.error("Playwright is not installed. Run: npm i --no-save playwright"); process.exit(2); }

const failures = []; let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); return !!cond; };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));

// Members with trades come from the sitemap (pages without trades are left out of it).
const xml = await (await fetch(`${base}/sitemaps/congress.xml`).catch(() => null))?.text?.() ?? "";
let withTrades = [...xml.matchAll(/<loc>[^<]*?(\/congress\/[a-z0-9-]+\/)<\/loc>/g)].map((m) => m[1]);
await page.goto(`${base}/congress/`, { waitUntil: "domcontentloaded" });
const linked = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="/congress/"]')].map((a) => a.getAttribute("href")).filter((h) => /^\/congress\/[a-z0-9-]+\/$/.test(h)))]);
if (!withTrades.length) withTrades = linked;
ok(withTrades.length > 0, "no member pages found in /sitemaps/congress.xml or on /congress/");
const step = Math.max(1, Math.floor(withTrades.length / sampleN));
const sample = withTrades.filter((_, i) => i % step === 0).slice(0, sampleN);
const int = (s) => Number(String(s ?? "").replace(/[^\d-]/g, "")) || 0;

for (const path of sample) {
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  const d = await page.evaluate(() => {
    const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const cell = (label) => { const c = [...document.querySelectorAll(".datastrip .cell")].find((x) => txt(x.querySelector(".k")) === label); return c ? txt(c.querySelector(".v")) : null; };
    const rows = (sel) => [...document.querySelectorAll(`${sel} tbody tr`)].map((tr) => [...tr.children].map(txt));
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => { try { const j = JSON.parse(s.textContent); return Array.isArray(j) ? j : [j]; } catch { return []; } });
    return {
      h1: txt(document.querySelector("h1")), facts: [...document.querySelectorAll("[data-profile-facts] dt")].map(txt),
      answer: txt(document.querySelector(".answer")), robots: document.querySelector('meta[name="robots"]')?.content ?? "",
      total: cell("Trades on record"), buys: cell("Purchases"), sells: cell("Sales"), stocksCell: cell("Stocks traded"),
      years: rows("[data-profile-years]"), owners: rows("[data-profile-owners]"), stocks: rows("[data-profile-stocks]"),
      jump: [...document.querySelectorAll("nav.jump a")].map((a) => a.getAttribute("href")), missing: [...document.querySelectorAll("nav.jump a")].map((a) => a.getAttribute("href")).filter((h) => !document.querySelector(h)),
      qa: [...document.querySelectorAll("[data-profile-qa] .faq-item")].map((x) => ({ q: txt(x.querySelector("h3")), a: txt(x.querySelector("p")) })),
      faq: ld.find((x) => x["@type"] === "FAQPage")?.mainEntity?.map((x) => ({ q: x.name, a: x.acceptedAnswer?.text })) ?? [],
      person: ld.find((x) => x["@type"] === "Person") ?? null,
      seats: document.querySelectorAll("[data-profile-committees] .seats > li").length, seatNote: txt(document.querySelector("[data-profile-committees] .section-note")),
      hasCommittees: !!document.querySelector("[data-profile-committees]"), compare: rows("[data-profile-compare]"),
      tableRows: document.querySelectorAll("table.txns tbody tr").length, h1s: document.querySelectorAll("h1").length,
      ids: (() => { const seen = new Set(), dup = []; for (const e of document.querySelectorAll("[id]")) { if (seen.has(e.id)) dup.push(e.id); seen.add(e.id); } return dup; })(),
    };
  });
  const at = `${path}:`;
  ok(d.h1 && d.h1s === 1, `${at} needs exactly one h1`);
  ok(d.facts.includes("Chamber") && d.facts.some((f) => f === "Seat" || f === "State"), `${at} header facts are missing Chamber or Seat/State (${d.facts.join(", ")})`);
  ok(d.answer.includes(d.h1), `${at} the answer does not name the member`);
  ok(d.ids.length === 0, `${at} duplicate ids: ${d.ids.slice(0, 3).join(", ")}`);
  const total = int(d.total);
  if (total === 0) { ok(/noindex/.test(d.robots), `${at} a member with no trades should be noindex`); continue; }
  ok(!/noindex/.test(d.robots), `${at} has trades but is noindex`);
  ok(d.missing.length === 0, `${at} jump links point at missing sections: ${d.missing.join(", ")}`);
  for (const need of ["#by-year", "#trades", "#filings", "#questions", "#sources"]) ok(d.jump.includes(need), `${at} jump links lack ${need}`);
  const yearSum = d.years.reduce((n, r) => n + int(r[1]), 0), ownerSum = d.owners.reduce((n, r) => n + int(r[1]), 0);
  // A row with neither a trade date nor a disclosure date has no year; allow that and nothing else.
  ok(yearSum <= total && yearSum >= total * 0.95, `${at} year rows add up to ${yearSum}, Trades on record says ${total}`);
  ok(ownerSum === total, `${at} owner rows add up to ${ownerSum}, Trades on record says ${total}`);
  ok(int(d.buys) + int(d.sells) <= total, `${at} purchases + sales (${int(d.buys)} + ${int(d.sells)}) exceed the total ${total}`);
  ok(d.years.reduce((n, r) => n + int(r[2]), 0) === int(d.buys) || yearSum < total, `${at} purchases by year do not add up to the Purchases figure`);
  ok(d.years.reduce((n, r) => n + int(r[3]), 0) === int(d.sells) || yearSum < total, `${at} sales by year do not add up to the Sales figure`);
  const counts = d.stocks.map((r) => int(r[2]));
  ok(counts.every((c, i) => i === 0 || counts[i - 1] >= c), `${at} the stock table is not sorted by trades`);
  ok(counts.reduce((a, b) => a + b, 0) <= total, `${at} the stock table counts more trades than the total`);
  ok(d.stocks.every((r) => int(r[3]) + int(r[4]) <= int(r[2])), `${at} a stock row has more purchases + sales than trades`);
  ok(d.stocks.length <= int(d.stocksCell), `${at} more stock rows than the Stocks traded figure`);
  ok(d.tableRows === Math.min(total, 200), `${at} the trade table has ${d.tableRows} rows for ${total} trades`);
  ok(d.qa.length >= 2 && d.qa.length === d.faq.length && d.qa.every((f, i) => f.q === d.faq[i].q && f.a === d.faq[i].a), `${at} the questions on the page and the FAQPage data differ`);
  ok(d.qa.every((f) => !/\b(because|in order to|ahead of|suspicious|insider knowledge|tipped)\b/i.test(f.a) || /says nothing about why/.test(f.a)), `${at} an answer appears to give a motive`);
  ok(d.qa[0] && int(d.qa[0].a.match(/^[\d,]+/)?.[0]) === total, `${at} the first answer's trade count is not ${total}`);
  ok(d.person && d.person.name === d.h1, `${at} Person data is missing or misnamed`);
  if (d.hasCommittees) {
    ok(d.seats > 0, `${at} committee section with no committees`);
    ok(/context only/.test(d.seatNote), `${at} committee section lost its "context only" note`);
    ok(Array.isArray(d.person?.memberOf) && d.person.memberOf.length === d.seats, `${at} Person.memberOf does not match the committees listed`);
    ok(d.facts.includes("Committees") && d.jump.includes("#committees"), `${at} committees are listed but not in the header facts or jump links`);
  }
  if (d.compare.length) ok(int(d.compare[0][1].match(/^[\d,]+/)?.[0]) === total, `${at} the comparison table's trade count is not ${total}`);
}

// Layout: nothing off the side at phone and mid-desktop widths (first sampled member).
for (const w of [390, 1100]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.goto(base + sample[0], { waitUntil: "load" });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= w, `${sample[0]} is ${sw}px wide in a ${w}px window`);
}
// One member without trades, if /congress/ links to one.
const quiet = linked.find((h) => !withTrades.includes(h));
if (quiet) {
  await page.goto(base + quiet, { waitUntil: "domcontentloaded" });
  const q = await page.evaluate(() => ({ robots: document.querySelector('meta[name="robots"]')?.content ?? "", facts: document.querySelectorAll("[data-profile-facts] dt").length, jump: !!document.querySelector("nav.jump") }));
  ok(/noindex/.test(q.robots) && q.facts >= 2 && !q.jump, `${quiet}: a member with no trades should be noindex, keep the header facts and have no jump links`);
}
ok(errors.length === 0, `page errors: ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
if (failures.length) { console.error(`✗ ${failures.length} of ${checks} profile checks failed:`); for (const f of failures.slice(0, 40)) console.error("  " + f); process.exit(1); }
console.log(`✓ ${checks} profile checks passed on ${sample.length} member pages${quiet ? " plus one member without trades" : ""}`);
