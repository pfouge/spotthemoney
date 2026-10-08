#!/usr/bin/env node
// Accessibility check for the built site: runs axe-core (WCAG 2 A + AA rules: colour contrast,
// text alternatives, labels, landmarks, keyboard traps) on one page of each type, in the light
// and the dark theme, at desktop and phone width, and checks that the first Tab stop on every
// page is the "Skip to main content" link and that it moves focus into <main>.
//
//   node scripts/verify-a11y.mjs http://127.0.0.1:4321            (a local build being served)
//   node scripts/verify-a11y.mjs https://spotthemoney.com
//
// Needs Playwright and axe-core (not repo dependencies):  npm i --no-save playwright axe-core
// Set PW_CHROMIUM to a Chromium binary to skip Playwright's own download.
// Third-party frames (TradingView, ads) are not ours to fix and are excluded.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const require = createRequire(import.meta.url);
let chromium, axeSource;
try { ({ chromium } = await import("playwright")); axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"); }
catch { console.error("Missing tools. Run: npm i --no-save playwright axe-core"); process.exit(2); }

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

// One page of each type. Entity pages are taken from the index pages so the list never goes stale.
async function firstLink(page, index, prefix) {
  await page.goto(base + index, { waitUntil: "domcontentloaded" });
  return page.evaluate((p) => {
    const a = [...document.querySelectorAll("main a[href]")].map((x) => x.getAttribute("href")).find((h) => h && h.startsWith(p) && h !== p);
    return a ?? null;
  }, prefix);
}
const probe = await browser.newPage();
const pages = ["/", "/congress/", "/insiders/", "/disclosures/", "/stocks/", "/companies/", "/washington/", "/donations/", "/lobbying/", "/contracts/", "/rates/", "/methodology/", "/corrections/", "/about/", "/terms/", "/privacy/"];
for (const [index, prefix] of [["/congress/", "/congress/"], ["/insiders/", "/insiders/"], ["/stocks/", "/stocks/"], ["/companies/", "/companies/"]]) {
  const p = await firstLink(probe, index, prefix);
  if (p) pages.push(p);
}
await probe.close();

const failures = [];
let checked = 0;
for (const theme of ["light", "dark"]) {
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const path of pages) {
      const where = `${path} [${theme}, ${w}px]`;
      try {
        await page.goto(base + path, { waitUntil: "load" });
        await page.waitForTimeout(300);
        await page.evaluate(axeSource);
        const res = await page.evaluate(async () => {
          // eslint-disable-next-line no-undef
          const r = await axe.run({ exclude: [["iframe"], [".tv"], [".ad-slot"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
          return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => `${x.target.join(" ")} — ${(x.any[0]?.message ?? x.failureSummary ?? "").slice(0, 140)}`) }));
        });
        for (const v of res) failures.push(`${where}: ${v.id} (${v.impact}, ${v.n} element${v.n === 1 ? "" : "s"})\n      ${v.sample.join("\n      ")}`);
        // Keyboard: first Tab lands on the skip link; Enter moves focus into <main>.
        await page.goto(base + path, { waitUntil: "load" });
        await page.keyboard.press("Tab");
        const first = await page.evaluate(() => ({ cls: document.activeElement?.className ?? "", top: document.activeElement?.getBoundingClientRect().top ?? -1 }));
        if (!String(first.cls).includes("skip-link")) failures.push(`${where}: first Tab stop is not the skip link`);
        else if (first.top < 0) failures.push(`${where}: skip link is off-screen while focused`);
        else {
          await page.keyboard.press("Enter");
          const inMain = await page.waitForFunction(() => document.activeElement?.id === "main", null, { timeout: 2000 }).then(() => true, () => false);
          if (!inMain) failures.push(`${where}: skip link does not move focus to <main>`);
        }
        checked++;
      } catch (e) { failures.push(`${where}: could not be checked (${String(e).slice(0, 120)})`); }
    }
    await ctx.close();
  }
}
await browser.close();

if (failures.length) {
  console.error(`✗ ${failures.length} accessibility failure(s) across ${checked} page checks:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`✓ ${pages.length} pages × light/dark × desktop/phone (${checked} checks): no WCAG 2 A/AA violations found by axe; skip link works on every page`);
