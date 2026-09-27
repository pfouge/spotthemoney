# spotthemoney.com

See where the money really moves — in the markets and in Washington. Rendered clearly, updated constantly, free.

A single-domain, ad-supported information site that takes free public financial and government data and renders it beautifully, fast, and on a recurring "check-in" basis. Built on one shared ingest-and-render engine so new products are cheap to add.

## Monorepo layout

```
spotthemoney.com/
├── web/        Astro site + page templates (static now; on-demand edge later)
├── mobile/     React Native + Expo app — iOS + Android
├── api/        reserved — apps use supabase-js + RLS directly until app logic outgrows it
├── ingest/     scheduled data-fetch jobs, one module per source
├── ocr/        congressional-PDF OCR pipeline + human-review queue (Phase 2 stub)
├── db/         schema, migrations, migration runner
├── shared/     shared types + utilities
├── docs/       architecture, data model, roadmap, open decisions
└── .github/workflows/   scheduled ingest + CI
```

## Stack (decided)

- **Web:** Astro 7 (zero-JS by default; islands for the few interactive bits), fully prerendered from the DB; long-tail routes go on-demand + edge-cached when they arrive
- **Apps:** React Native + Expo — one codebase → iOS + Android, sharing `/shared` types
- **API:** none to start — `supabase-js` + RLS is the contract for web islands and apps
- **Hosting/CDN:** Cloudflare Workers with static assets (unmetered static requests, no egress fees; same account as the domain), deployed by GitHub Actions
- **Database:** Supabase — one project in the shared Pro org (Postgres + auth + RLS + realtime; powers accounts, watchlists, alerts)
- **Scheduled ingest:** GitHub Actions cron (batch) + Cloudflare Cron Triggers (prices, later)
- **Push + storage:** APNs/FCM (or Expo Push) for alerts; Supabase Storage (private bucket) for raw filings/PDFs (decided 2026-09-27, docs/01 §6)

See `docs/01-architecture.md` and `docs/05-apps-and-api.md` for the full rationale.

## First run (local)

```bash
# 1. Install (Node 22.12+)
npm install

# 2. Configure environment
cp .env.example .env
#   then set DATABASE_URL to the Supabase Session-pooler string (port 5432)

# 3. Create the schema
npm run migrate

# 4. Pull the first live data (I-Bonds — no API key needed)
npm run ingest -- ibonds

# 5. Build / preview the site
npm run dev        # http://localhost:4321
npm run build
```

The site builds even before the database is connected — data-backed pages render a
"data pending" state until `migrate` + `ingest` have run.

## Connecting the pipeline (after local works)

1. Push this repo to GitHub (public site repo + private docs repo, pattern from nsnexplorer — see CLAUDE.md SESSION STATE 2026-09-27).
2. Add GitHub Actions secrets `DATABASE_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   (SETUP.md §5). Nothing to create in the Cloudflare dashboard — the first deploy creates the Worker.
3. Every push to `main` runs `deploy.yml` (migrate → build → `wrangler deploy` → live check);
   the daily `ingest.yml` refreshes data and calls the same deploy.

## Status

Phase 1, flagship-public build done 2026-09-27 (awaiting the first deploy): Rates Hub live
(I-Bonds with the reset outlook, Treasury yield curve, TIPS real yields); Follow-the-Money pages
built for insiders, Congress (House), stocks, companies, donations, lobbying, contracts and the
newest-disclosures feed, each answer-first with JSON-LD; sitemap index + children, `robots.txt`
AI allow-list, `llms.txt`, IndexNow on deploy, post-deploy verifier; daily X thread job
(dry-run until credentials); raw-filing archive on Supabase Storage; measurement jobs
(citation count, Search Console). Twelve ingest jobs + the congress-ptr Python job on the
vendored IIF parser. Current state of record: the dated SESSION STATE log in `CLAUDE.md`
(the 2026-09-27 entry lists the secrets and approvals still needed). See `docs/03-roadmap.md`.

> Not investment advice. Figures are based on public disclosures and official data that
> may lag actual events. No buy/sell recommendations, no trade execution.
