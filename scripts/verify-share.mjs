#!/usr/bin/env node
// Checks the share menu (web/src/scripts/share.ts) on a built or live site: every kind of Share
// button opens the dialog with the right link, the network links carry that link, copying works,
// a shared trade link lands on its row, a shared chart link lands on its chart, a chart saves as
// a real PNG, the map link keeps its filters, and opening the menu contacts no other host.
//
//   node scripts/verify-share.mjs http://127.0.0.1:4321
//   node scripts/verify-share.mjs https://spotthemoney.com
//
// Needs Playwright (and axe-core for the dialog's accessibility check; skipped if absent):
//   npm i --no-save playwright axe-core        Set PW_CHROMIUM to reuse a Chromium binary.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "http://127.0.0.1:4321").replace(/\/$/, "");
let chromium;
try { ({ chromium } = await import("playwright")); } catch { console.error("Playwright is not installed. Run: npm i --no-save playwright axe-core"); process.exit(2); }
let axeSource = null;
try { axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8"); } catch { /* optional */ }

const failures = []; let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); return !!cond; };
const NETS = { x: "https://x.com/intent/tweet?", whatsapp: "https://wa.me/?", reddit: "https://www.reddit.com/submit?", linkedin: "https://www.linkedin.com/sharing/share-offsite/?", facebook: "https://www.facebook.com/sharer/sharer.php?", email: "mailto:?" };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

async function dialogState(page) {
  return page.evaluate(() => {
    const d = document.getElementById("shareDlg");
    const vis = (sel) => { const el = d.querySelector(sel); return !!el && !el.hidden; };
    return {
      open: d.open, heading: d.querySelector("#shareTitle").textContent, what: d.querySelector("#shareWhat").textContent,
      url: d.querySelector("#shareUrl").value, status: d.querySelector("#shareStatus").textContent,
      nets: Object.fromEntries([...d.querySelectorAll("[data-share-net]")].map((a) => [a.dataset.shareNet, a.getAttribute("href")])),
      image: vis('[data-share-act="image"]'), embed: vis('[data-share-act="embed"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? "",
    };
  });
}
function checkNets(where, s) {
  for (const [net, prefix] of Object.entries(NETS)) {
    const href = s.nets[net] ?? "";
    ok(href.startsWith(prefix), `${where}: ${net} link does not start with ${prefix}`);
    ok(decodeURIComponent(href).includes(s.url), `${where}: ${net} link does not carry the shared URL`);
  }
  ok(!/[?&](text|title|subject)=(&|$)/.test(s.nets.x + s.nets.reddit + s.nets.email), `${where}: a network link has empty text`);
}
const closeDialog = (page) => page.keyboard.press("Escape").then(() => page.waitForFunction(() => !document.getElementById("shareDlg").open));
const firstHref = (page, index, prefix) => page.goto(base + index, { waitUntil: "load" }).then(() => page.evaluate((p) => [...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href")).find((h) => h && h.startsWith(p) && h !== p) ?? null, prefix));

for (const [w, h, label] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const page = await ctx.newPage();
  const outside = new Set();
  page.on("request", (r) => { const host = new URL(r.url()).host; if (!r.url().startsWith(base) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) outside.add(host); });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));

  // 1. page share (answer block)
  {
    const where = `/about/ page share [${label}]`;
    await page.goto(base + "/about/", { waitUntil: "load" });
    const before = new Set(outside);
    const btn = page.locator('.answer [data-share="page"]');
    if (ok((await btn.count()) === 1, `${where}: no Share button in the answer block`)) {
      await btn.click();
      const s = await dialogState(page);
      ok(s.open, `${where}: dialog did not open`);
      ok(s.url === s.canonical && /\/about\/$/.test(s.url), `${where}: link is "${s.url}", expected the canonical URL`);
      ok(s.what.trim().length > 3 && !/Spot the Money\s*$/.test(s.what), `${where}: title line is "${s.what}"`);
      ok(!s.image && !s.embed, `${where}: image/embed offered on a page share`);
      checkNets(where, s);
      await page.locator('[data-share-act="copy"]').click();
      await page.waitForFunction(() => document.getElementById("shareStatus").textContent !== "");
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      ok(clip === null || clip === s.url, `${where}: clipboard holds "${clip}"`);
      ok((await dialogState(page)).status === "Link copied.", `${where}: status after copy is "${(await dialogState(page)).status}"`);
      await page.locator('[data-share-act="caption"]').click();
      await page.waitForFunction(() => document.getElementById("shareStatus").textContent.startsWith("Text"));
      const cap = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      ok(cap === null || (cap.includes(s.url) && cap.split("\n").length >= 2), `${where}: caption is "${cap}"`);
      if (axeSource) {
        await page.evaluate(axeSource);
        const v = await page.evaluate(async () => (await axe.run("#shareDlg", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes[0]?.target.join(" ")}`));
        ok(v.length === 0, `${where}: dialog accessibility — ${v.join("; ")}`);
      }
      await closeDialog(page);
      ok(await page.evaluate(() => document.activeElement?.matches('[data-share="page"]')), `${where}: focus did not return to the Share button`);
      ok([...outside].every((x) => before.has(x)), `${where}: opening the menu contacted ${[...outside].filter((x) => !before.has(x)).join(", ")}`);
    }
  }

  // 2. chart share + image, on the Congress page and a member page (which has an embed)
  const member = await firstHref(page, "/congress/", "/congress/");
  for (const path of ["/congress/", member].filter(Boolean)) {
    const where = `${path} chart share [${label}]`;
    await page.goto(base + path, { waitUntil: "load" });
    const n = await page.locator('figure.viz [data-share="chart"]').count();
    if (!ok(n > 0, `${where}: no chart Share buttons`)) continue;
    const ids = await page.evaluate(() => [...document.querySelectorAll("figure.viz")].map((f) => f.id));
    ok(ids.every(Boolean) && new Set(ids).size === ids.length, `${where}: chart anchors missing or repeated (${ids.join(", ")})`);
    const idx = await page.evaluate(() => [...document.querySelectorAll("figure.viz")].findIndex((f) => [...f.querySelectorAll(".viz-body svg")].some((s) => s.getBoundingClientRect().width > 0)));
    const fig = page.locator("figure.viz").nth(Math.max(0, idx));
    const figId = await fig.getAttribute("id"); const hasEmbed = (await fig.locator(".viz-embed").count()) > 0;
    await fig.locator('[data-share="chart"]').click();
    const s = await dialogState(page);
    ok(s.open && s.heading === "Share this chart", `${where}: dialog heading "${s.heading}"`);
    ok(s.url === `${s.canonical}#${figId}`, `${where}: link is "${s.url}", expected …#${figId}`);
    ok(s.embed === hasEmbed, `${where}: embed button ${s.embed ? "shown" : "hidden"} but the chart ${hasEmbed ? "has" : "has no"} embed code`);
    checkNets(where, s);
    if (ok(s.image, `${where}: no Save image button for a chart that is drawn`)) {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }).catch(() => null), page.locator('[data-share-act="image"]').click()]);
      if (ok(!!dl, `${where}: Save image produced no download`)) {
        ok(/^spotthemoney-.+\.png$/.test(dl.suggestedFilename()), `${where}: image is named "${dl.suggestedFilename()}"`);
        const buf = readFileSync(await dl.path());
        const png = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", width = png ? buf.readUInt32BE(16) : 0, height = png ? buf.readUInt32BE(20) : 0;
        ok(png && width === 1200 && height > 300, `${where}: image is not a 1200-wide PNG (${width}×${height})`);
        ok(buf.length > 12000, `${where}: image is only ${buf.length} bytes (blank?)`);
      }
    }
    if (hasEmbed) {
      await page.locator('[data-share-act="embed"]').click();
      await page.waitForFunction(() => document.getElementById("shareStatus").textContent.startsWith("Embed"));
      const code = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      ok(code === null || (code.includes("<iframe") && code.includes("/embed/")), `${where}: copied embed code is "${String(code).slice(0, 60)}"`);
    }
    await closeDialog(page);
    // the shared link lands on the chart
    await page.goto(`${base}${path}#${figId}`, { waitUntil: "load" });
    ok(await page.evaluate((id) => { const el = document.getElementById(id); if (!el || !el.matches(":target")) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }, figId), `${where}: #${figId} is not on screen after opening the shared link`);
  }

  // 3. single trade
  {
    const where = `/congress/ trade share [${label}]`;
    await page.goto(base + "/congress/", { waitUntil: "load" });
    const btn = page.locator("table.txns .row-share").first();
    if (ok((await btn.count()) > 0, `${where}: no trade Share buttons`)) {
      const row = await btn.evaluate((b) => ({ text: b.dataset.shareText, path: b.dataset.sharePath ?? null, id: b.dataset.shareId, cells: [...b.closest("tr").cells].map((c) => c.textContent.trim()) }));
      await btn.scrollIntoViewIfNeeded(); await btn.click();
      const s = await dialogState(page);
      ok(s.open && s.heading === "Share this trade", `${where}: dialog heading "${s.heading}"`);
      ok(s.what === row.text && /\b(bought|sold|exchanged|reported)\b/.test(s.what), `${where}: sentence is "${s.what}"`);
      ok(row.cells.some((c) => c && s.what.includes(c.replace(/ ↗$/, ""))), `${where}: sentence shares nothing with its row`);
      const u = new URL(s.url);
      ok(u.hash === `#${row.id}` && (!row.path || u.pathname === row.path), `${where}: link is "${s.url}" (row ${row.id}, page ${row.path})`);
      checkNets(where, s);
      await closeDialog(page);
      await page.goto(`${base}${u.pathname}${u.hash}`, { waitUntil: "load" });
      ok(await page.evaluate((id) => { const el = document.getElementById(id); if (!el || el.tagName !== "TR" || !el.matches(":target")) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, row.id), `${where}: row ${row.id} is not on screen at ${u.pathname}${u.hash}`);
    }
    const dupes = await page.evaluate(() => { const ids = [...document.querySelectorAll("tr[id]")].map((r) => r.id); return ids.length - new Set(ids).size; });
    await page.goto(base + "/insiders/", { waitUntil: "load" });
    const dupes2 = await page.evaluate(() => { const ids = [...document.querySelectorAll("tr[id]")].map((r) => r.id); return ids.length - new Set(ids).size; });
    ok(dupes + dupes2 === 0, `${where}: ${dupes + dupes2} repeated row anchors`);
  }

  // 4. the trade map keeps its filters in the shared link
  {
    const where = `/ map share [${label}]`;
    await page.goto(base + "/", { waitUntil: "load" });
    await page.waitForSelector(".hm-tile, .hm-empty", { timeout: 20000 }).catch(() => {});
    const pane = page.locator(".hm-pane:not([hidden]) section, section.heatmap, .hm").first();
    const w90 = page.locator('[data-seg="window"] button[data-v="90"], [data-ctl="window"] button[data-v="90"]').first();
    if ((await w90.count()) > 0) { await w90.scrollIntoViewIfNeeded(); await w90.click(); await page.waitForTimeout(300); }
    const btn = page.locator('[data-share="map"]').first();
    if (ok((await btn.count()) > 0, `${where}: no "Share this view" button`)) {
      await btn.scrollIntoViewIfNeeded(); await btn.click();
      const s = await dialogState(page); const hash = await page.evaluate(() => location.hash);
      ok(s.open && s.heading === "Share this view", `${where}: dialog heading "${s.heading}"`);
      ok(s.url === s.canonical + hash, `${where}: link is "${s.url}", expected canonical + "${hash}"`);
      ok((await w90.count()) === 0 || /w=90/.test(s.url), `${where}: the 90-day filter is not in the link (${s.url})`);
      checkNets(where, s);
      await closeDialog(page);
    }
    void pane;
  }
  ok(errors.length === 0, `[${label}] page errors: ${errors.slice(0, 3).join(" | ")}`);
  await ctx.close();
}
await browser.close();

if (failures.length) { console.error(`✗ ${failures.length} of ${checks} share checks failed:`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log(`✓ ${checks} share checks passed (page, chart, image, embed, trade row, map; desktop and phone)${axeSource ? "" : " — axe-core not installed, dialog accessibility not checked"}`);
