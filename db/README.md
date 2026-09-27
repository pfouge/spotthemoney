# Database

Serverless Postgres on **Supabase**. Schema lives here as forward-only SQL migrations.

## Files

- `migrations/0001_init.sql` — initial schema (reference, market data, disclosures,
  campaign finance, performance, ingestion/ops). See `../docs/02-data-model.md`.
- `migrate.mjs` — applies pending migrations in order, tracked in `schema_migrations`.

## Run

```bash
# from repo root, with DATABASE_URL set in .env
npm run migrate
```

## Adding a migration

Create the next numbered file (`0002_*.sql`, `0003_*.sql`, …). Migrations are
forward-only and applied exactly once. Keep them idempotent where practical
(`create table if not exists`, etc.) and never edit a migration that has already
been applied in any environment — add a new one instead.

In CI, migrations run on deploy so the schema always matches the code. For risky
changes, test against a Supabase **branch** first (one per PR).
