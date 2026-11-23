#!/usr/bin/env node
// One page per company, outside the tracked set (db/migrations/0041_od_one_page_per_company.sql).
// Loads a small made-up set of untracked companies into a LOCAL database, calls od_stock and
// od_company the way PostgREST does (as role anon), and checks which ticker's page shows what.
//
//   node scripts/verify-od-fold.mjs postgres://postgres@127.0.0.1:5433/stm          (rolls everything back)
//   node scripts/verify-od-fold.mjs postgres://postgres@127.0.0.1:5433/stm --keep   (leaves the fixture, for scripts/od-dev.mjs)
//
// Never point it at production.
import postgres from "postgres";

const url = process.argv[2];
const keep = process.argv.includes("--keep");
if (!url || !/^postgres(ql)?:\/\//.test(url) || /supabase\.(co|com)/.test(url) || !/(127\.0\.0\.1|localhost)/.test(url)) { console.error("usage: node scripts/verify-od-fold.mjs <local-database-url> [--keep]"); process.exit(2); }
const sql = postgres(url, { max: 1, onnotice: () => {} });
let failed = 0, ran = 0;
const ok = (cond, label, extra = "") => { ran++; if (!cond) { failed++; console.log("  ✗", label, extra); } };
class Rollback extends Error {}

const COMPANIES = [
  // slug, name, cik, main ticker, [ticker, type][]   (securities are created in this order)
  ["odf-fold-holdings", "ODF FOLD HOLDINGS", "0009990001", "ODFU", [["ODFU", "equity"], ["ODFA", "equity"], ["ODF.B", "equity"]]],
  ["odf-one-ticker", "ODF ONE TICKER INC", "0009990002", "ODONE", [["ODONE", "equity"]]],
  ["odf-renamed", "ODF RENAMED CORP", "0009990003", "ODCX", [["ODCY", "equity"], ["ODCX", "equity"]]],
  ["odf-shares-nvda", "ODF SPONSORED FUND", "0009990004", "ODD", [["ODD", "equity"], ["NVDA", "other"]]],
  ["odf-no-security", "ODF NO SECURITY LLC", "0009990005", null, []],
  ["odf-adr-holder", "ODF ADR HOLDER", "0009990006", "ODFX", [["ODFX", "adr"], ["ODFY", "equity"]]],
  ["odf-equity-owner", "ODF EQUITY OWNER", "0009990007", "ODFX", [["ODFX", "equity"]]],
];
// the SEC's list names ODFA first, then ODF-B, for the first company (so ODFA is its page, not its main ticker ODFU)
const SEC = [["ODFA", "0009990001", 5], ["ODF-B", "0009990001", 6]];

try {
  await sql.begin(async (tx) => {
    const [had] = await tx`select count(*)::int n from companies where slug like 'odf-%'`;
    if (had.n > 0) { if (keep) { console.log("fixture already present"); return; } throw new Error("a fixture from an earlier --keep run is in this database; use a fresh one"); }
    const [p] = await tx`insert into people (full_name, slug, cik) values ('ODF FILER', 'odf-filer', '0009980001') returning id`;
    let n = 0;
    for (const [slug, name, cik, pt, secs] of COMPANIES) {
      const [c] = await tx`insert into companies (name, cik, primary_ticker, slug, tracked) values (${name}, ${cik}, ${pt}, ${slug}, false) returning id`;
      await tx`insert into person_roles (person_id, role_kind, company_id, officer_title, is_director, valid_from) values (${p.id}, 'insider', ${c.id}, 'CEO', false, date '2025-01-01')`;
      for (const [ticker, type] of secs) {
        const [s] = await tx`insert into securities (ticker, name, type, company_id, is_active) values (${ticker}, ${name}, ${type}::security_type, ${c.id}, false) returning id`;
        n++;
        const [f] = await tx`insert into filings (source, external_id, filer_person_id, filer_company_id, filed_at, source_url, confidence, review, is_published, scope, payload)
          values ('sec_form4', ${"ODF-" + n}, ${p.id}, ${c.id}, now() - interval '3 days', ${"https://www.sec.gov/Archives/edgar/data/999/ODF" + n + "-index.htm"}, 1, 'auto_approved', true, 'market', '{"footnotes":[],"transactions":[]}'::jsonb) returning id`;
        await tx`insert into transactions (filing_id, person_id, security_id, side, txn_date, disclosed_at, shares, price, disclosure_lag_days, confidence, review, txn_code, is_derivative, owner_type, is_10b5_1)
          values (${f.id}, ${p.id}, ${s.id}, 'buy', current_date - 5, current_date - 3, ${100 * n}, 10, 2, 1, 'auto_approved', 'P', false, 'officer', false)`;
      }
    }
    for (const [ticker, cik, rank] of SEC) await tx`insert into sec_tickers (ticker, cik, title, rank, origin) values (${ticker}, ${cik}, 'ODF', ${rank}, 'seed') on conflict (ticker) do nothing`;

    const stock = async (t, any = false) => (await tx.unsafe(`select od_stock($1, $2) d`, [t, any]))[0].d;
    const company = async (s) => (await tx.unsafe(`select od_company($1) d`, [s]))[0].d;
    const tickers = (d) => (d?.siblings ?? []).map((s) => s.ticker);

    // the helpers, as the owner
    const home = async (slug) => (await tx`select od_home_ticker(c.id) h from companies c where c.slug = ${slug}`)[0].h;
    const page = async (t) => (await tx`select od_stock_page(${t}) p`)[0].p;
    ok(await home("odf-fold-holdings") === "ODFA", "home ticker: the first of the company's tickers in the SEC's list", await home("odf-fold-holdings"));
    ok(await home("odf-one-ticker") === "ODONE", "home ticker: a company's only ticker");
    ok(await home("odf-renamed") === "ODCX", "home ticker: the main ticker when the SEC's list names none", await home("odf-renamed"));
    ok(await home("odf-shares-nvda") === "ODD", "home ticker: never a ticker that has a static page", await home("odf-shares-nvda"));
    ok(await home("odf-no-security") === null, "home ticker: none for a company with no security");
    ok((await tx`select od_home_ticker(c.id) h from companies c where c.tracked and exists (select 1 from securities s where s.company_id = c.id) limit 1`)[0]?.h == null, "home ticker: none for a tracked company");
    ok(await page("ODFU") === "odfa" && await page("odf.b") === "odfa" && await page("ODFA") === "odfa", "the three tickers of one company share the home ticker's page");
    ok(await page("ODCY") === "odcx", "an older symbol opens the main ticker's page");
    ok(await page("NVDA") === "nvda", "a ticker with a static page is its own page");
    ok(await page("NOSUCHTICKER") === "nosuchticker", "an unknown ticker is its own page");
    ok(await page("ODFY") === "odfy", "a ticker stays put when its company's home ticker shows another company", await page("ODFY"));

    // the entry points, as the API calls them
    await tx.unsafe("set local role anon");
    const a = await stock("ODFA"), u = await stock("ODFU"), b = await stock("odf.b");
    ok(a && a.movedTo == null && a.home === true, "ODFA is its company's page", JSON.stringify([a?.movedTo, a?.home]));
    ok(JSON.stringify(tickers(a)) === JSON.stringify(["ODFA", "ODFU", "ODF.B"]), "ODFA lists its own security first, then the company's others", JSON.stringify(tickers(a)));
    ok(a.stats.rowCount === 3 && a.rows.length === 3 && a.stats.filingCount === 3, "ODFA shows the rows of all three securities", JSON.stringify(a?.stats));
    ok(a.entity.ticker === "ODFA", "the page names the home ticker");
    ok(u?.movedTo === "odfa" && b?.movedTo === "odfa", "ODFU and ODF.B answer with movedTo odfa", JSON.stringify([u?.movedTo, b?.movedTo]));
    ok(u.stats.rowCount === 1 && u.home === false, "a moved ticker's own answer is otherwise as before");
    ok((await company("odf-fold-holdings"))?.homeTicker === "odfa", "the company answers with homeTicker odfa");
    const one = await stock("ODONE");
    ok(one.movedTo == null && one.home === true && tickers(one).length === 1 && one.stats.rowCount === 1, "a one-ticker company: its ticker is its page");
    ok((await company("odf-one-ticker"))?.homeTicker === "odone", "a one-ticker company answers with its ticker");
    const cx = await stock("ODCX");
    ok(cx.home === true && JSON.stringify(tickers(cx)) === JSON.stringify(["ODCX", "ODCY"]) && cx.stats.rowCount === 2, "ODCX shows ODCY's rows too", JSON.stringify(tickers(cx)));
    ok((await stock("ODCY")).movedTo === "odcx", "ODCY answers with movedTo odcx");
    const d = await stock("ODD");
    ok(d.home === true && JSON.stringify(tickers(d)) === JSON.stringify(["ODD"]) && d.stats.rowCount === 1, "a security under a ticker with a static page is not folded in", JSON.stringify(tickers(d)));
    ok((await company("odf-shares-nvda"))?.homeTicker === "odd", "that company's page is ODD");
    ok((await company("odf-no-security"))?.homeTicker == null, "a company with no security has no home ticker");
    ok(await stock("NVDA") === null, "a tracked ticker is still not served to the API");
    const x = await stock("ODFX"), y = await stock("ODFY");
    ok(x.movedTo == null && x.company?.slug === "odf-equity-owner" && x.home === true, "ODFX is the page of the company that owns its equity", JSON.stringify([x?.movedTo, x?.company?.slug, x?.home]));
    ok(y.movedTo == null && y.home === false, "ODFY keeps its own page (no loop)", JSON.stringify([y?.movedTo, y?.home]));
    ok((await company("odf-adr-holder"))?.homeTicker == null, "a company whose home ticker shows another company has no home ticker");
    ok((await company("odf-equity-owner"))?.homeTicker === "odfx", "the equity's owner answers with odfx");
    for (const fn of ["od_home_ticker(1)", "od_stock_page('ODFA')"]) {
      let refused = false;
      await tx.savepoint(async (sp) => { await sp.unsafe(`select ${fn}`); }).catch(() => { refused = true; });
      ok(refused, `${fn} is closed to the API role`);
    }
    await tx.unsafe("reset role");
    // the parity switch, on a direct connection: a tracked ticker is untouched by the new rule
    const nv = await stock("NVDA", true);
    ok(nv && nv.movedTo == null && nv.home === false && !tickers(nv).includes("ODD"), "the parity answer for a tracked ticker is unchanged", JSON.stringify([nv?.movedTo, nv?.home]));
    for (const [fn, want] of [["od_stock", 4], ["od_company", 4]]) {
      const [r] = await tx`select coalesce(array_length(proconfig, 1), 0) n, prosecdef d from pg_proc where proname = ${fn}`;
      ok(r.n === want && r.d, `${fn} keeps its settings and definer rights`, JSON.stringify(r));
    }
    if (!keep) throw new Rollback();
  });
} catch (e) { if (!(e instanceof Rollback)) { console.error(e); failed++; } }
await sql.end();
console.log(failed ? `✗ verify-od-fold: ${failed} of ${ran} checks failed` : `✓ verify-od-fold: ${ran} checks pass${keep ? " (fixture kept)" : " (nothing left behind)"}`);
process.exit(failed ? 1 : 0);
