// Quick state-of-the-database report. Usage (repo root):  node scripts/db-check.mjs
// Reads DATABASE_URL from .env (Session pooler). ingest_runs is the diagnostic of record.
import postgres from "postgres";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [m] = await sql`select json_agg(filename order by filename) as v from schema_migrations`;
  console.log("migrations:", (m.v ?? []).join(", "));

  const runs = await sql`
    select r.id, coalesce(s.code, r.source_id::text) as source, r.status,
           r.rows_seen, r.rows_changed, r.finished_at::text as finished_at, left(r.error, 120) as error
      from ingest_runs r left join sources s on s.id = r.source_id
     order by r.id desc limit 12`;
  console.log("\nrecent ingest_runs:");
  for (const r of runs) console.log(" ", JSON.stringify(r));

  const series = await sql`
    select s.code, count(o.*) as obs, min(o.obs_date)::text as first, max(o.obs_date)::text as last
      from rate_series s left join rate_observations o on o.series_id = s.id
     group by s.code order by s.code`;
  console.log("\nrate series:");
  for (const s of series) console.log(`  ${s.code.padEnd(20)} ${String(s.obs).padStart(5)} obs  ${s.first} → ${s.last}`);

  const [ib] = await sql`
    select o.obs_date::text as obs_date, o.value, o.meta from rate_observations o
      join rate_series s on s.id = o.series_id
     where s.code = 'IBOND_COMPOSITE' order by o.obs_date desc limit 1`;
  console.log("\nlatest I-Bond:", ib ? `${ib.obs_date} composite ${ib.value}% ${JSON.stringify(ib.meta)}` : "none");

  // Flagship tables (2026-09-27): what the pages will render from.
  const [c] = await sql`
    select (select count(*) from people) as people,
           (select count(*) from people p where exists (select 1 from person_roles r where r.person_id = p.id and r.role_kind = 'congress')) as members,
           (select count(*) from companies) as companies, (select count(*) from securities where is_active) as securities,
           (select count(*) from filings) as filings, (select count(*) filter (where is_published) from filings) as published,
           (select count(*) from transactions) as txns, (select count(*) from lobbying) as lobbying,
           (select count(*) from contracts) as contracts, (select count(*) from committees) as committees,
           (select count(*) from donations) as donations, (select count(*) from raw_documents) as raw_docs,
           (select count(*) filter (where storage_bucket is not null) from raw_documents) as raw_stored,
           (select count(*) from social_posts) as social_posts`.catch(() => [null]);
  if (c) console.log("\nflagship:", JSON.stringify(c));
  const bySource = await sql`select source::text as source, count(*)::int as filings, count(*) filter (where is_published)::int as published, max(filed_at)::date::text as latest from filings group by 1 order by 1`.catch(() => []);
  for (const r of bySource) console.log(`  ${r.source.padEnd(12)} ${String(r.filings).padStart(6)} filings, ${String(r.published).padStart(6)} published, latest ${r.latest}`);
} finally {
  await sql.end();
}
