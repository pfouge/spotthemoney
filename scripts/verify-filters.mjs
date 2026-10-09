// Mechanical check that every heatmap filter returns exactly the rows it should.
//
//   node scripts/verify-filters.mjs [baseUrl]        default https://spotthemoney.com
//   node scripts/verify-filters.mjs http://127.0.0.1:4321 --legacy-cross
//
// For each map (home = combined, /congress/, /insiders/) it drives the real controls in a
// headless browser — every option of every control on its own, then seeded random
// combinations — and compares the page's summary strip (Disclosures, Tickers, Members/Filers,
// Total traded, Net flow) with an independent recomputation from the same JSON the page
// loaded. It also checks that the URL hash restores the same result after a reload and that
// Reset returns to the default counts. Exit 1 on any mismatch.
//
// Since 2026-10-09 a main map opens on the scatter chart in the Buying view. The suite runs in
// whichever chart the page opens on and expects exactly one dot (scatter) per ticker in the
// summary; it then flips the switch under the chart and checks the heatmap draws tiles, the
// link remembers the choice, a link without a "chart" key (shared before the change) still
// opens the heatmap in the Net view, and Reset keeps the chosen chart.
//
// Needs Playwright (not a repo dependency):  npx -y playwright@latest install chromium  once,
// then  npm i --no-save playwright  — or run `browserSuite` by pasting it into DevTools.
//
// --legacy-cross: expect the pre-2026-10-04 behaviour on the combined map (a Congress-only
// filter did not hide corporate insiders). Only for checking a deploy older than that fix.

const base = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "https://spotthemoney.com").replace(/\/$/, "");
const legacyCross = process.argv.includes("--legacy-cross");
const PAGES = ["/", "/congress/", "/insiders/"];

/** Runs inside the page. Self-contained: no closures over Node scope. */
export async function browserSuite(opts) {
  const { legacyCross = false, randomCombos = 60, seed = 20261004 } = opts ?? {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const root = document.querySelector("[data-heatmap][data-primary='true']") ?? document.querySelector("[data-heatmap]");
  if (!root) return { page: location.pathname, error: "no heatmap on page" };
  const kind = root.dataset.kind;
  const files = await Promise.all(root.dataset.src.split(",").map((u) => fetch(u.trim(), { cache: "no-store" }).then((r) => r.json())));
  // The insiders file is packed (web/src/lib/heatmap-pack.ts); this is a second, independent reader.
  const unpack = (f) => {
    if (f.v !== 2) return f.rows;
    const DAY = 86400000, b = Math.round(Date.parse(f.base + "T00:00:00Z") / DAY), iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);
    return f.rows.map((x) => {
      const tk = f.tk[x[0]], pp = f.pp[x[1]], fl = f.fl[x[2]];
      return { t: tk[0], n: tk[1], p: pp[0], ps: pp[1], r: pp[2], ti: pp[3], c: x[3], s: ["buy", "sell", "other"][x[4]], v: x[5] ?? x[6] * x[7], sh: x[6], pr: x[7], pl: x[8] === 1,
        o: f.ow[x[9]] ?? null, d: iso(b + x[10]), f: fl[1] != null ? iso(b + fl[1]) : null, u: fl[0] == null ? null : /^https?:/.test(fl[0]) ? fl[0] : "https://www.sec.gov/Archives/edgar/data/" + fl[0] };
    });
  };
  // Rows older than 90 days live in a second file the page fetches on demand; the oracle takes both up front.
  const olderFiles = await Promise.all(files.filter((f) => f.older).map((f) => fetch(f.older, { cache: "no-store" }).then((r) => r.json())));
  files.push(...olderFiles);
  const rows = files.flatMap((f) => unpack(f).map((r) => ({ ...r, k: f.kind })));
  const caps = Object.assign({}, ...files.map((f) => f.caps ?? {})); // ticker → size band
  for (let i = 0; i < 50 && root.querySelector(".hm-summary .cell") == null; i++) await sleep(100);

  // ── independent oracle (the rules as documented in CLAUDE.md / methodology) ──
  const partyOf = (pa) => { const p = (pa ?? "").toLowerCase(); return !p ? null : p.startsWith("dem") ? "dem" : p.startsWith("rep") ? "rep" : "ind"; };
  const expected = (s) => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - s.window); const cut = d.toISOString().slice(0, 10);
    const tick = s.tickers.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const cF = s.chamber !== "all" || s.party !== "all", iF = s.role !== "all";
    const sel = rows.filter((r) => {
      if ((r.f ?? r.d) < cut) return false; // the window is by disclosure date
      if (s.who && r.ps !== s.who) return false;
      if (tick.length && !tick.includes(r.t)) return false;
      if (s.cap !== "all" && caps[r.t] !== s.cap) return false;
      if (r.k === "congress") {
        if (s.cls === "insiders") return false;
        if (!legacyCross && s.cls === "all" && iF && !cF) return false;
        if (s.chamber !== "all" && r.ch !== s.chamber) return false;
        if (s.party !== "all" && partyOf(r.pa) !== s.party) return false;
        return true;
      }
      if (s.cls === "congress") return false;
      if (!legacyCross && s.cls === "all" && cF && !iF) return false;
      if (s.codes === "open" && r.c !== "P" && r.c !== "S") return false;
      if (s.plan === "exclude" && r.pl) return false;
      if (s.role !== "all" && r.r !== s.role) return false;
      return true;
    });
    const by = new Map();
    for (const r of sel) { const o = by.get(r.t) ?? { buy: 0, sell: 0 }; if (r.s === "buy") o.buy += r.v; else if (r.s === "sell") o.sell += r.v; by.set(r.t, o); }
    const nodes = [...by.values()].filter((o) => (s.view === "buy" ? o.buy : s.view === "sell" ? o.sell : o.buy + o.sell) > 0);
    const buy = nodes.reduce((a, o) => a + o.buy, 0), sell = nodes.reduce((a, o) => a + o.sell, 0);
    return { disclosures: sel.length, tickers: nodes.length, filers: new Set(sel.map((r) => r.k + ":" + (r.ps ?? r.p))).size, total: buy + sell, net: buy - sell };
  };

  // ── drive the real controls ──
  const DEFAULTS = { cls: "all", chamber: "all", party: "all", role: "all", who: "", codes: "open", plan: "exclude", window: 30, view: root.dataset.view || "net", tickers: "", cap: "all" };
  const sel = (k) => root.querySelector(`[data-ctl="${k}"]`);
  const seg = (k) => [...root.querySelectorAll(`[data-seg="${k}"] button`)];
  const has = { cls: !!sel("cls"), chamber: !!sel("chamber"), party: !!sel("party"), role: !!sel("role"), who: !!sel("who"), cap: !!sel("cap"), codes: seg("codes").length > 0, plan: seg("plan").length > 0 };
  const apply = async (s) => {
    root.querySelector('[data-ctl="reset"]').click();
    for (const k of ["cls", "chamber", "party", "role", "who", "cap"]) {
      if (!has[k] || s[k] === DEFAULTS[k]) continue;
      const el = sel(k); el.value = s[k];
      if (el.value !== s[k]) throw new Error(`control ${k} has no option "${s[k]}"`);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (const k of ["codes", "plan", "window", "view"]) {
      if (String(s[k]) === String(DEFAULTS[k])) continue;
      const b = seg(k).find((x) => x.dataset.v === String(s[k])); if (!b) { if (k === "codes" || k === "plan") continue; throw new Error(`no ${k} button ${s[k]}`); }
      b.click();
    }
    if (s.tickers) { const t = sel("tickers"); t.value = s.tickers; t.dispatchEvent(new Event("input", { bubbles: true })); await sleep(260); }
    await sleep(0);
    for (let i = 0; i < 200 && root.dataset.older === "loading"; i++) await sleep(50); // 1Y pulls the older file
    for (let i = 0; i < 200 && root.dataset.cross === "loading"; i++) await sleep(50); // the scatter's second axis on a one-group page
  };
  // same rounding as fmtUSD in web/src/scripts/heatmap.ts
  const usd = (v) => { const a = Math.abs(v); return a >= 1e9 ? "$" + (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B" : a >= 1e6 ? "$" + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e3 ? "$" + Math.round(v / 1e3) + "K" : "$" + Math.round(v); };
  const shown = () => {
    const v = [...root.querySelectorAll(".hm-summary .cell .v")].map((e) => e.textContent.trim());
    return { totalText: v[0], disclosures: Number(v[1].replace(/,/g, "")), tickers: Number(v[2]), filers: Number(v[3]), netText: v[4], tiles: root.querySelectorAll(".hm-map .hm-tile, .hm-map a.hm-dot").length, labels: root.querySelectorAll(".hm-map svg.hm-scatter .lb").length, chart: root.dataset.chartNow, empty: !!root.querySelector(".hm-map .hm-empty") };
  };
  // state the page actually uses: controls a map does not have stay at their defaults
  const effective = (s) => {
    const e = { ...s };
    if (!has.cls) e.cls = "all"; if (!has.chamber) e.chamber = "all"; if (!has.party) e.party = "all"; if (!has.role) e.role = "all"; if (!has.cap) e.cap = "all";
    if (kind === "congress") { e.codes = "open"; e.plan = "exclude"; }
    return e;
  };

  const fails = []; let ran = 0;
  const check = async (label, s) => {
    const st = { ...DEFAULTS, ...s };
    try { await apply(st); } catch (err) { fails.push({ label, error: String(err.message ?? err) }); return; }
    const want = expected(effective(st)), got = shown(); ran++;
    const bad = [];
    for (const k of ["disclosures", "tickers", "filers"]) if (want[k] !== got[k]) bad.push(`${k}: page ${got[k]} ≠ expected ${want[k]}`);
    if ((want.tickers === 0) !== got.empty) bad.push(`empty-state: page ${got.empty}, expected ${want.tickers === 0}`);
    if (want.tickers > 0 && got.tiles === 0) bad.push("no tiles drawn");
    if (got.tiles > want.tickers) bad.push(`tiles ${got.tiles} > tickers ${want.tickers}`);
    if (got.chart === "scatter" && got.tiles !== want.tickers) bad.push(`scatter draws ${got.tiles} dots for ${want.tickers} tickers`);
    if (got.chart === "scatter" && want.tickers > 0 && got.labels === 0) bad.push("scatter has no ticker labels");
    if (bad.length) fails.push({ label, state: st, bad });
    return { want, got, st };
  };

  // 1. every option of every control, alone (at the widest window so rows exist)
  const optionsOf = (k) => (has[k] ? [...sel(k).querySelectorAll("option")].map((o) => o.value) : []);
  const whoAll = optionsOf("who").filter(Boolean);
  const whoSample = whoAll.filter((_, i) => i % Math.max(1, Math.floor(whoAll.length / 12)) === 0).slice(0, 12);
  const topTickers = [...new Set(rows.map((r) => r.t))].slice(0, 6);
  const space = {
    cls: optionsOf("cls"), chamber: optionsOf("chamber"), party: optionsOf("party"), role: optionsOf("role"), who: ["", ...whoSample], cap: has.cap ? optionsOf("cap") : ["all"],
    codes: has.codes ? ["open", "all"] : ["open"], plan: has.plan ? ["exclude", "include"] : ["exclude"],
    window: [7, 30, 90, 365], view: ["net", "buy", "sell"], tickers: ["", topTickers[0] ?? "", topTickers.slice(0, 3).join(", ").toLowerCase(), "ZZZZ"],
  };
  await check("defaults", {});
  for (const [k, vals] of Object.entries(space)) for (const v of vals) for (const w of k === "window" ? [undefined] : [365, 30])
    await check(`${k}=${v || "∅"}${w ? ` @${w}d` : ""}`, w ? { [k]: v, window: w } : { [k]: v });

  // 2. seeded random combinations
  let x = seed >>> 0; const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => (a.length ? a[Math.floor(rnd() * a.length)] : undefined);
  for (let i = 0; i < randomCombos; i++) {
    const s = {}; for (const [k, vals] of Object.entries(space)) { const v = pick(vals); if (v !== undefined && rnd() < 0.55) s[k] = v; }
    if (rnd() < 0.7) s.window = 365;
    await check(`combo#${i + 1} ${JSON.stringify(s)}`, s);
  }

  // 3. totals formatting on one busy state, reset, and hash content
  const busy = await check("totals @365d all codes", { window: 365, codes: "all", plan: "include" });
  if (busy && busy.want.tickers > 0 && busy.got.totalText !== usd(busy.want.total)) fails.push({ label: "total traded text", bad: [`page ${busy.got.totalText} ≠ expected ${usd(busy.want.total)}`] });
  root.querySelector('[data-ctl="reset"]').click(); await sleep(0);
  const afterReset = shown(), def = expected(effective(DEFAULTS)); ran++;
  if (afterReset.disclosures !== def.disclosures || afterReset.tickers !== def.tickers) fails.push({ label: "reset", bad: [`page ${afterReset.disclosures}/${afterReset.tickers} ≠ ${def.disclosures}/${def.tickers}`] });
  // every size band must be reachable: a band no ticker maps to is fine, an unknown code is not
  const badBands = [...new Set(Object.values(caps))].filter((b) => has.cap && !optionsOf("cap").includes(b));
  if (badBands.length) fails.push({ label: "size bands", bad: [`data has band(s) with no option: ${badBands.join(", ")}`] });
  // the chart switch: heatmap draws tiles, the link says so, Reset keeps it, and switching back restores the dots
  const sw = root.querySelector('[data-ctl="chart"]');
  if (sw) {
    const startChart = root.dataset.chartNow, other = startChart === "scatter" ? "map" : "scatter";
    await apply({ ...DEFAULTS, window: 365 }); const wantSw = expected(effective({ ...DEFAULTS, window: 365 }));
    sw.click(); await sleep(0); for (let i = 0; i < 200 && root.dataset.cross === "loading"; i++) await sleep(50);
    const a = shown(); ran++;
    const bad = [];
    if (a.chart !== other) bad.push(`chart is ${a.chart}, expected ${other}`);
    if (sw.getAttribute("aria-checked") !== String(other === "map")) bad.push(`switch aria-checked is ${sw.getAttribute("aria-checked")}`);
    if (a.disclosures !== wantSw.disclosures || a.tickers !== wantSw.tickers) bad.push(`counts changed with the chart: ${a.disclosures}/${a.tickers} ≠ ${wantSw.disclosures}/${wantSw.tickers}`);
    if (wantSw.tickers > 0 && a.tiles === 0) bad.push("nothing drawn after switching");
    if (other === "map" && root.querySelector(".hm-map svg.hm-scatter")) bad.push("scatter still drawn in heatmap mode");
    if (root.dataset.primary === "true" && !location.hash.includes(`chart=${other}`)) bad.push(`hash is "${location.hash}", expected chart=${other}`);
    root.querySelector('[data-ctl="reset"]').click(); await sleep(0);
    if (root.dataset.chartNow !== other) bad.push("Reset changed the chart");
    sw.click(); await sleep(0);
    if (root.dataset.chartNow !== startChart) bad.push("switching back did not restore the first chart");
    if (bad.length) fails.push({ label: "chart switch", bad });
  }
  await apply({ ...DEFAULTS, window: 365, view: "sell" });
  const hash = location.hash; const hashWant = expected(effective({ ...DEFAULTS, window: 365, view: "sell" }));
  if (root.dataset.primary === "true" && !(hash.includes("w=365") && hash.includes("view=sell"))) fails.push({ label: "hash write", bad: [`hash is "${hash}"`] });

  return { page: location.pathname, kind, rows: rows.length, builtAt: files.map((f) => f.builtAt), controls: has, sized: Object.keys(caps).length, tickersInRows: new Set(rows.map((r) => r.t)).size, checks: ran, failed: fails.length, fails: fails.slice(0, 15), hash, hashWant };
}

// ── Node driver ──
if (import.meta.url === `file://${process.argv[1]}`) {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { console.error("Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium"); process.exit(2); }
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  let failed = 0;
  try {
    for (const path of PAGES) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(base + path, { waitUntil: "networkidle" });
      const res = await page.evaluate(`(${browserSuite.toString()})(${JSON.stringify({ legacyCross })})`);
      // hash round-trip: reload on the hash the page wrote and expect the same counts
      if (res.hash) {
        await page.goto(base + path + res.hash, { waitUntil: "networkidle" }); await page.reload({ waitUntil: "networkidle" });
        const v = await page.$$eval("[data-heatmap] .hm-summary .cell .v", (els) => els.map((e) => e.textContent.trim()));
        if (Number((v[1] ?? "").replace(/,/g, "")) !== res.hashWant.disclosures || Number(v[2]) !== res.hashWant.tickers) { res.failed++; res.fails.push({ label: "hash restore after reload", bad: [`page ${v[1]}/${v[2]} ≠ ${res.hashWant.disclosures}/${res.hashWant.tickers}`] }); }
      }
      // a link shared before 2026-10-09 has no "chart" key: it must still open the heatmap, in the Net view
      await page.goto(base + path + "#w=90", { waitUntil: "networkidle" }); await page.reload({ waitUntil: "networkidle" });
      const legacy = await page.evaluate(() => { const r = document.querySelector("[data-heatmap][data-primary='true']"); return { chart: r?.dataset.chartNow, view: r?.querySelector('[data-seg="view"] button.on')?.dataset.v }; });
      if (legacy.chart !== "map" || legacy.view !== "net") { res.failed++; res.fails.push({ label: "old shared link", bad: [`opens ${legacy.chart}/${legacy.view}, expected map/net`] }); }
      if (errors.length) { res.failed += errors.length; res.fails.push({ label: "page errors", bad: errors.slice(0, 3) }); }
      failed += res.failed ?? 1;
      console.log(`${res.failed ? "✗" : "✓"} ${path}  ${res.kind} map · ${res.rows} rows · ${res.sized}/${res.tickersInRows} tickers sized · ${res.checks} filter states checked · ${res.failed} mismatch(es)`);
      for (const f of res.fails ?? []) console.log("   ", f.label, "→", (f.bad ?? [f.error]).join("; "));
      if (res.error) console.log("   ", res.error);
      await page.close();
    }
  } finally { await browser.close(); }
  process.exit(failed ? 1 : 0);
}
