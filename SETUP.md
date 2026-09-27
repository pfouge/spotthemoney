# SETUP — take spotthemoney.com live

Click-by-click from empty to deployed. ~30 min. Three services: **Supabase** (database, a
project inside your existing Pro org), **GitHub** (`pfouge/spotthemoney.com`), and
**Cloudflare Workers** (hosting; you already own the domain on Cloudflare).

Architecture and the reasons behind each choice: `docs/01-architecture.md`. Sibling-project
lessons this setup encodes: `docs/reference/`.

Prereqs: Node **22.12+** and git installed locally.

---

## 1. Get it running locally first

```bash
# from the repo root
npm install          # also refreshes package-lock.json for Astro 7 — commit that change
cp .env.example .env
npm run dev          # http://localhost:4321/rates/i-bonds → "data pending" + working calculator
```

---

## 2. Supabase (database)

1. supabase.com → your **Pro org** → **New project**: name `spotthemoney`, region
   **East US (us-east-1)** (next to GitHub's runners and the US government sources), compute
   **Micro**. Let Supabase generate the database password; read it once from the screen and
   paste it only where step 3 says. Adds ~$10/mo to the org bill. Pro projects never pause.
2. **Project Settings → Database → Connection string.** You need **two** strings:
   - **Session pooler** — port **5432**. For migrations, ingest, and site builds. Behaves like
     a direct connection (multi-statement SQL, COPY).
   - **Transaction pooler** — port **6543**. Only for short-lived runtime queries inside a
     Cloudflare Worker (none yet while the site is fully static). Never for migrations —
     `db/migrate.mjs` refuses it.
   Both look like `postgresql://postgres.<ref>:PASSWORD@aws-0-us-east-1.pooler.supabase.com:<port>/postgres`.
3. Put the **Session pooler** string in `.env`, with `?sslmode=require` appended:
   ```
   DATABASE_URL=postgresql://postgres.<ref>:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
   ```
4. Create the schema and pull the first live data:
   ```bash
   npm run migrate              # applies migrations 0001–0005 in order
   npm run ingest -- ibonds     # pulls the live I-Bond rate from Treasury
   ```
   Verify in the Supabase SQL editor: `select filename from schema_migrations order by 1;`
   lists all five. Then the first contract slice:
   ```bash
   npm run ingest -- treasury_yield_curve   # keyless; ~14 UST_PAR_* series
   ```
   - ✅ Expect `✓ ibonds: N seen, M written (success)`; `select * from ingest_runs;` shows both runs.
   - ⚠️ On a **404** from ibonds, the endpoint path moved: copy the exact path from the
     dataset's API Quick Guide at <https://fiscaldata.treasury.gov/datasets/i-bonds-interest-rates/>
     into `ENDPOINT` at the top of `ingest/src/sources/ibonds.ts` and re-run.
5. `npm run dev` — `/rates/i-bonds` now shows the live composite rate.

---

## 3. GitHub (`pfouge/spotthemoney.com`)

1. github.com → **New repository** → owner `pfouge`, name `spotthemoney.com`, **Private**,
   no README/license.
2. From the repo root (PowerShell):
   ```powershell
   cd "C:\Users\pfoug\OneDrive\Documents\Claude Code Personal\spotthemoney.com"
   git init
   git add .
   git commit -m "Scaffold: engine, I-Bonds slice, Workers deploy pipeline"
   git branch -M main
   git remote add origin https://github.com/pfouge/spotthemoney.com.git
   git push -u origin main
   ```
   `.gitignore` excludes `.env` and `node_modules`. The first push triggers `deploy.yml`,
   which will fail until step 5's secrets exist — expected.

---

## 4. Cloudflare (hosting)

No dashboard project to create: `wrangler deploy` in the GitHub Action creates the Worker
`spotthemoney` on first run and attaches the custom domains listed in `web/wrangler.jsonc`.
Do **not** connect the repo to Cloudflare's git-triggered Workers Builds — GitHub Actions is
the single deploy path, so nothing races it.

1. **API token:** dash.cloudflare.com → profile → **API Tokens → Create Token → Edit
   Cloudflare Workers** template. Add one more permission before saving: **Zone → Cache
   Purge → Purge** for `spotthemoney.com` (ingest jobs will purge changed pages later; the
   nsnexplorer token lacked this and never got fixed). Copy the token.
2. **Account ID:** Workers & Pages overview, right-hand column.

---

## 5. GitHub secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `DATABASE_URL` | Supabase **Session pooler** string from §2.3, with `?sslmode=require` |
| `CLOUDFLARE_API_TOKEN` | from §4.1 |
| `CLOUDFLARE_ACCOUNT_ID` | from §4.2 |
| `FEC_API_KEY` | free key from api.data.gov (optional; falls back to throttled DEMO_KEY) |
| `TWELVEDATA_API_KEY` | Twelve Data key (optional; job is a no-op without it) |
| `LDA_API_KEY` | Senate LDA token (optional; keyless works at a slower rate) |
| `BLS_API_KEY` | BLS Public Data API key (optional; keyless allows 25 queries/day, enough for the daily CPI pull) |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` — Project Settings → API (raw-filing archive, roadmap B.6) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role (archive uploads; never exposed to the browser) |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X developer app for @spotthemoney, Read+Write, OAuth 1.0a user context (daily thread; job dry-runs without them) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY` | monthly citation count (`measure.yml`); each engine is skipped when its key is absent — ~$4–7 per full run, see `docs/reference/citation-count-procedure.md` |
| `GSC_SERVICE_ACCOUNT_JSON` | Google service-account JSON with Search Console read access to `sc-domain:spotthemoney.com` (weekly export; dry-runs without it) |

Repository **variables** (same page, Variables tab), all optional:
`PUBLIC_CF_ANALYTICS_TOKEN` (§7), `PUBLIC_AD_CLIENT` (AdSense `ca-pub-…` once approved — the slot
renders nothing until set), `GSC_SITE_URL` (defaults to `sc-domain:spotthemoney.com`).

Then **Actions → deploy → Run workflow**. First run: migrations apply (already up to date),
site builds from the database, Worker deploys, and the workflow curls the live page to
confirm. The custom domain attaches automatically; DNS is already on Cloudflare.

---

## 6. Keep data fresh

`ingest.yml` runs daily at 09:00 UTC (and on **Actions → ingest → Run workflow**, optionally
naming sources). It applies migrations once, then runs the sources as four parallel groups
(rates · filings · money · prices), retries failed groups on a fresh runner, then calls
`deploy.yml` so the new data is live in the same run. `ingest-congress-ptr.yml` (13:00 UTC)
parses House PTRs with the vendored IIF parser and redeploys; `x-daily.yml` (15:30 UTC) posts
or dry-runs the daily thread; `measure.yml` runs the weekly Search Console export and the
monthly citation count. `deploy.yml` ends by running `scripts/verify-live.mjs` (sitemaps,
robots, llms.txt, JSON-LD) and `scripts/indexnow-ping.mjs`.

**Sample approval (gate).** New filing sources land with `is_published = false`. From the repo
root: `node scripts/sample-source.mjs sec_form4` writes `docs/reference/samples/…`, review it,
then `node scripts/sample-source.mjs sec_form4 --approve` publishes. Same for `house_ptr`.

**Offline build.** `scripts/seed-local.sql` seeds a throwaway local Postgres so the whole site
builds without Supabase (instructions in the file header).

---

## 7. Analytics (optional, free)

Cloudflare → **Analytics & Logs → Web Analytics → Add a site** → `spotthemoney.com`. Put the
token in the `PUBLIC_CF_ANALYTICS_TOKEN` repository variable and re-run deploy. No cookie
banner needed. Ad network (AdSense/Ezoic) comes after there is traffic.

---

## Done — verify

- `https://spotthemoney.com/rates/i-bonds` loads fast with the live composite rate.
- A push to `main` (touching `web/`, `shared/`, `db/`) redeploys within ~3 minutes.
- **Actions → ingest → Run workflow** refreshes data and redeploys.

## Troubleshooting

- **"data pending" in production** → the build ran without `DATABASE_URL`, or before any
  ingest. Check the deploy log's migrate/build steps; re-run ingest.
- **`migrate` refuses to run** → `DATABASE_URL` is the Transaction pooler (6543). Use Session (5432).
- **Deploy verified-live step fails** → Worker deployed but the custom domain isn't attached
  yet: Workers & Pages → `spotthemoney` → Settings → Domains & Routes.
- **Ingest 404 on ibonds** → fix the `ENDPOINT` path per §2.4.
- **`npm ci` fails in Actions** → `package-lock.json` is out of date; run `npm install`
  locally and commit the lockfile.
