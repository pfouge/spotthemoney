#!/usr/bin/env node
// Writes the sample-review file for a new source (approval gate: nothing flips is_published
// until Peter has reviewed 20 mixed rows). Usage, from the repo root with .env present:
//
//   node scripts/sample-source.mjs sec_form4          → docs/reference/samples/sec_form4-<date>.md
//   node scripts/sample-source.mjs house_ptr
//   node scripts/sample-source.mjs senate_lda | usaspending | fec_schedule_a
//
// 20 rows: the 7 newest, 7 random, 6 with the largest values — each with its source URL so the
// review is "open the link, compare". After review, publish with:
//   node scripts/sample-source.mjs sec_form4 --approve     (sets is_published = true on that
//   source's approved filings and records the approval in the sample file)

import postgres from "postgres";
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env")) && !process.env.DATABASE_URL) process.loadEnvFile(join(root, ".env"));
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const source = process.argv[2];
const approve = process.argv.includes("--approve");
const FILING_SOURCES = new Set(["sec_form4", "house_ptr", "senate_ptr"]);
const FLAT = { senate_lda: "lobbying", usaspending: "contracts", fec_schedule_a: "donations" };
if (!source || (!FILING_SOURCES.has(source) && !FLAT[source])) {
  console.error("usage: node scripts/sample-source.mjs <sec_form4|house_ptr|senate_ptr|senate_lda|usaspending|fec_schedule_a> [--approve]");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const date = new Date().toISOString().slice(0, 10);
const outDir = join(root, "docs", "reference", "samples");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${source}-${date}.md`);

try {
  if (approve) {
    if (!FILING_SOURCES.has(source)) { console.error("--approve applies to filing sources only (flat tables have no publish flag)"); process.exit(1); }
    const r = await sql`update filings set is_published = true where source = ${source} and review in ('auto_approved','approved') and confidence >= 0.9 and not is_published`;
    const line = `\n\n**Approved by Peter ${new Date().toISOString()}** — ${r.count} filing(s) set is_published = true.\n`;
    if (existsSync(out)) appendFileSync(out, line); else writeFileSync(out, `# ${source} sample — ${date}\n${line}`);
    console.log(`✓ published ${r.count} ${source} filing(s); recorded in ${out}`);
  } else if (FILING_SOURCES.has(source)) {
    const rows = await sql`
      with base as (
        select t.id, f.external_id, f.filed_at::date::text as filed, f.source_url, p.full_name as filer, s.ticker::text as ticker,
               t.side::text as side, t.txn_code, t.txn_date::text as txn_date, t.shares::float8 as shares, t.price::float8 as price,
               t.amount_low::float8 as lo, t.amount_high::float8 as hi, t.disclosure_lag_days as lag, t.owner_type, t.asset_type, t.is_10b5_1,
               coalesce(t.shares * t.price, t.amount_high)::float8 as value, f.is_published, f.confidence::float8 as confidence, f.review::text as review
          from transactions t join filings f on f.id = t.filing_id
          left join people p on p.id = t.person_id left join securities s on s.id = t.security_id
         where f.source = ${source}
      )
      (select 'newest' as pick, * from base order by filed desc, id desc limit 7)
      union all (select 'random', * from base order by random() limit 7)
      union all (select 'largest', * from base order by value desc nulls last limit 6)`;
    const [{ n }] = await sql`select count(*)::int as n from filings where source = ${source}`;
    const md = [`# ${source} sample — ${date}`, ``, `${n} filings on record; ${rows.length} rows below (7 newest, 7 random, 6 largest). Open each source link and compare every column. Approve with \`node scripts/sample-source.mjs ${source} --approve\`.`, ``,
      `| pick | filer | ticker | side | code | trade | filed | lag | shares | price | range | value | owner | asset | 10b5-1 | conf | review | source |`, `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
      ...rows.map((r) => `| ${r.pick} | ${r.filer ?? ""} | ${r.ticker ?? ""} | ${r.side} | ${r.txn_code ?? ""} | ${r.txn_date ?? ""} | ${r.filed ?? ""} | ${r.lag ?? ""} | ${r.shares ?? ""} | ${r.price ?? ""} | ${r.lo != null || r.hi != null ? `${r.lo ?? ""}–${r.hi ?? ""}` : ""} | ${r.value == null ? "" : Math.round(r.value).toLocaleString("en-US")} | ${r.owner_type ?? ""} | ${r.asset_type ?? ""} | ${r.is_10b5_1 ?? ""} | ${r.confidence} | ${r.review} | ${r.source_url ? `[open](${r.source_url})` : ""} |`),
      ``, `_Awaiting Peter's review. Nothing is published until \`--approve\` runs._`, ``].join("\n");
    writeFileSync(out, md);
    console.log(`✓ wrote ${out} (${rows.length} rows)`);
  } else {
    const table = FLAT[source];
    const rows = await sql.unsafe(`(select 'newest' as pick, * from ${table} order by created_at desc, id desc limit 7)
      union all (select 'random', * from ${table} order by random() limit 7)
      union all (select 'largest', * from ${table} order by amount desc nulls last limit 6)`);
    const cols = rows.length ? Object.keys(rows[0]).filter((c) => c !== "pick") : [];
    const md = [`# ${source} sample — ${date}`, ``, `${rows.length} rows (7 newest, 7 random, 6 largest) from \`${table}\`. Flat tables have no publish flag; this review confirms the mapping before the pages link to them.`, ``,
      `| pick | ${cols.join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`,
      ...rows.map((r) => `| ${r.pick} | ${cols.map((c) => String(r[c] ?? "").replace(/\|/g, "\\|").slice(0, 60)).join(" | ")} |`),
      ``, `_Awaiting Peter's review._`, ``].join("\n");
    writeFileSync(out, md);
    console.log(`✓ wrote ${out} (${rows.length} rows)`);
  }
} finally {
  await sql.end();
}
