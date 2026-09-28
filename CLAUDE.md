# CLAUDE.md

Working agreement for this project. Copy this file into the root of each project folder.

**On session start — applies to every new chat in this project.** This file loads automatically. Before doing anything else, also read `WORKING-METHODS.md` and `PERSONAL-PREFERENCES.md` in this same folder and follow all three together as the working agreement for the entire session.

**Style.** Concise and direct — cut words that don't change the meaning. Natural prose, not bullet lists, unless I ask for a list or the content is genuinely multifaceted. No filler ("genuinely," "honestly," "straightforward"), no thanking me for reaching out, no fishing for follow-up. One question per reply at most, and only after a real attempt.

**Before multi-step work.** Ask me 2–4 quick multiple-choice questions on scope, audience, format, and depth — unless I've already said. For research, search first, then ask alongside the results. Use a task list for 3+ steps and always finish with a verification step.

**Searching.** Search before answering anything about current state (prices, who holds a role, what exists now, newest release) even if it feels known. If a request hinges on a named thing you don't recognize, search instead of guessing.

**Files.** Research the substance fully before reading any output-format skill, then read the relevant SKILL.md before building a docx/pptx/xlsx/pdf. Create real files for anything I'd copy, save, or publish; keep strategies, summaries, and explanations inline. Default to markdown/inline and offer a formal doc rather than assuming one. Put finals in this folder, present with a one-line summary, never show internal paths.

**File safety (this folder is OneDrive-synced).** Never create, copy, move, or edit files here with bash — `cp`, `mv`, `sed -i`, `>`/`>>` redirects and the like can silently truncate or corrupt files because of OneDrive sync, and bash calls on this path are also prone to transient errors. Use the Write/Edit tools only for any file change; they sync reliably. Bash here is for read-only inspection and running code, never for mutating project files. Don't keep two copies of a file in sync by copying — write each canonical file directly with the file tools. Standalone HTML prototypes live in `web/public/` (served by the dev server at `/name.html` and double-clickable) as a single canonical copy. After writing/serving a static HTML page, verify it actually parses and runs before calling it done.

**Sources & care.** Paraphrase by default; quotes rare, under 15 words, one per source. Cite linkable web/connector sources. Don't assign motives beyond what I've said. On contested topics, give the strongest case as its proponents' case plus counterpoints, not your own opinion.

**Tools.** When a task implies an external app, search the connector registry and let me pick — don't choose a service I didn't name. Offer to schedule recurring work. Offer a live artifact for data I'd re-open over time.

**Model delegation.** On every new task, automatically consider handing simple, well-scoped subwork to a lighter model to save tokens — use the Agent tool with a cheaper model (Haiku for trivial/mechanical, Sonnet for moderate) for things like searching/reading across files, bulk lookups, fetching and parsing data, routine edits, and format conversions. Keep design, writing/copy, naming, architecture, strategic judgment, and final synthesis on the strongest model — never trade quality there. Only delegate when the subtask is large or parallel enough to actually save tokens; skip it for one-off trivial steps. Do it quietly, as part of normal work.

**Lead role & continuity.** The lead/orchestrator here is a *role*, filled by whichever
strongest model is current (it has changed before and will change again — e.g. to Opus 4.8).
"Sonnet"/"Haiku" in the delegation guidance are Agent-tool *subagent tiers*, not the lead,
and stay as-is across lead changes. No doc in this project may assume chat memory: state
lives in the dated **SESSION STATE** log at the bottom of this file — each session appends
a dated section stating what's done, in-flight, and next, superseding stale status lines
above it. A cold-start successor should need only: this file (+ the two companions above),
`docs/06-ingestion-contract.md` → the canonical contract in the IIF sibling folder, and
`docs/01`–`05`. Delegation notes that survive lead changes: specs must be tight enough to
survive a subagent that can't ask questions (goal, exact deliverable + path, constraints,
success check); parallelize independent subagents; the lead reviews everything; cap Haiku
agents at ~4 large page fetches (a 16-page harvest overflowed one Haiku context, 2026-07-02).

_Fuller rationale in WORKING-METHODS.md; global version in PERSONAL-PREFERENCES.md._

@WORKING-METHODS.md
@PERSONAL-PREFERENCES.md

---

## SESSION STATE 2026-07-06

_Supersedes any stale status lines in older docs. Convention (from gratisglobal): every
session appends a dated section here — done / in-flight / next._

**Done this session (integration contract v1.0 execution + gratisglobal lessons + handoff):**

- **All contract §7 TS ingestion jobs built** in `ingest/src/sources/`: `treasury_yield_curve`
  (§4.6, unknown-tenor slug rule; live CSV verified — header matches the contract's 14 tenors
  verbatim), `senate_lda` (§4.3), `usaspending` (§4.4, requests Action Date/NAICS directly with
  interim-start_date fallback), `fec_schedule_a` (§4.5, captures `sub_id` directly), `sec_form4`
  (§4.2, ticker-scoped, no-XML-lib parser, re-ingest rule, `is_published=false` gate),
  `twelvedata_eod` (§4.7, incomplete-candle drop, stop-early on rate limit). Full ingest
  package typechecks clean (`npx tsc --noEmit`, zero errors).
- **Shared ingest infra** (gratisglobal lessons baked in): `lib/sanitize.ts` (central NUL/control
  scrub choke point), `lib/http.ts` (descriptive UA + contact email, ≥1.5s/host, 429/5xx backoff,
  hard no-spoofing policy on 403), `lib/run.ts` (per-row quarantine + >50-row circuit breaker,
  seen-set dedupe, submit-and-exit external-job ids, rich stats), `lib/csv.ts`. Runner persists
  stats and circuit-breaker partials to `ingest_runs.stats`.
- **Migrations 0004** (`ingest_runs.stats jsonb` — diagnostic of record) and **0005**
  (`people.cik` partial unique index, required by contract §3.1 upserts). 0001–0003 untouched.
  **NOT yet applied anywhere — no Supabase project exists yet.**
- **congress-ptr Python job scaffolded** (`ingest/py/` + `.github/workflows/ingest-congress-ptr.yml`,
  workflow_dispatch only). Runs `--dry-run` cleanly; blocked on open decision #17 (how Actions
  gets IIF's parser code).
- **Docs reconciled with the contract:** `docs/02`/`03` + `ocr/README.md` now say OCR is only for
  `needs_ocr` filings (congress-ptr parser covers text-PDF House + all Senate); congress-ptr is a
  Python job, never a TS port. `docs/01` §10 + `docs/04` #15–18 flag the gratisglobal platform
  items (Workers-vs-Pages, Astro/adapter pinning, SSR security headers, edge cache headers,
  Supabase pause/Pro) — **flagged for Peter, deliberately not acted on**. `docs/06` records job
  status + the WAF caveat. SETUP.md/.env.example/ingest.yml updated for new keys
  (FEC_API_KEY, TWELVEDATA_API_KEY, LDA_API_KEY optional).

**In-flight / known risks:**

- **senate-lda WAF risk:** lda.gov 403s some non-browser clients (IIF passes via Chrome-TLS
  impersonation). Our TS job uses an honest UA; if production 403s, move senate-lda into the
  Python job — never UA-spoof (policy in `lib/http.ts`).
- OneDrive→sandbox mount served stale/truncated snapshots of freshly-written files during this
  session (Read tool always showed truth). If bash sees a truncated file here, trust Read and
  re-verify later — do not "fix" phantom corruption.

**Next session (in order):**

1. **Peter provisions Supabase** (SETUP.md §2) → `npm run migrate` → verify `schema_migrations`
   lists 0001–0005 → set GitHub secrets (DATABASE_URL, CF_DEPLOY_HOOK, FEC_API_KEY,
   TWELVEDATA_API_KEY, LDA_API_KEY) → first live runs: `ibonds`, then `treasury_yield_curve`
   (expect ~14 `UST_PAR_*` series), then remaining jobs; check row counts via SQL —
   `ingest_runs` is the diagnostic of record.
2. **Carry contract edits into the next IIF session** (this project must not modify the IIF
   folder): §3.4 note `ingest_runs.stats` (0004); §5 add 0005; §4.2/§4.4/§4.5 note the TS jobs
   already carry accession / Action Date+NAICS / sub_id, so R1–R3 are IIF-connector-parity only.
3. Peter's open decisions: Workers-vs-Pages (verify current Cloudflare guidance first — blocks
   deploy wiring), IIF-code availability for congress-ptr (#17), FEC committee scope (#18),
   sample-review approvals before any `is_published` flip.
4. IIF-side prerequisites when convenient: R1–R3, Requirement A (market-wide sec-edgar).

---

## SESSION STATE 2026-09-06

_Supersedes the 2026-07-06 "next session" list above. Folder renamed from "Follow the
Money" to `spotthemoney.com`; reconnect the new folder at session start._

**Done this session (platform decisions + wiring, after reading the sibling builds):**

- **Learnings extracted** from nsnexplorer.com (Neon → Supabase migration, Sept 2026) and
  gratisglobal.com (first Supabase project), plus platform facts verified today, into
  `docs/reference/` (three files). Read those before touching Supabase/Cloudflare/CI.
- **Decisions (Peter approved):** Supabase project `spotthemoney` in the existing Pro org,
  us-east-1, Micro (~$10/mo, no pause); **Cloudflare Workers with static assets** instead of
  Pages; **Astro 7.3 + `@astrojs/cloudflare` 14.3** (stable pair now; Node ≥ 22.12); fully
  prerendered at launch, on-demand + edge-cached long tail later; **one deploy path**
  (GitHub Actions, no Workers Builds); **custom Workers API deferred** — apps use supabase-js
  + RLS like gratisglobal. Recorded in `docs/01` §4/§7/§9/§10, `docs/04` #1–3/#15/#16/#19,
  `docs/05`, README, SETUP.md.
- **Code:** `web/` upgraded to Astro 7 + adapter (`astro.config.mjs`: adapter, `session:false`;
  `wrangler.jsonc`; `public/_headers` with s-maxage=120 HTML / immutable assets / security
  headers; `src/middleware.ts` mirrors the headers + 24h/7d edge cache for on-demand routes;
  `AdSlot.astro` comment syntax fixed for the Astro 7 compiler). `db/migrate.mjs` refuses the
  Transaction pooler (6543). `.node-version` → 22; root `engines` → ≥22.12.
- **Workflows:** new `deploy.yml` (migrate → build → `wrangler deploy --config
  dist/client/wrangler.json` → curl live page; push/dispatch/workflow_call; pipefail,
  timeouts, concurrency); `ingest.yml` now migrate → ingest → fresh-runner retry → calls
  deploy; `ci.yml` PR build check only. `CF_DEPLOY_HOOK` is gone; new secrets are
  `CLOUDFLARE_API_TOKEN` (Workers edit + Zone Cache Purge) and `CLOUDFLARE_ACCOUNT_ID`.
- **Verified in the sandbox:** `astro build` on Astro 7.3.1 produces 3 pages + an
  assets-only `dist/client/wrangler.json`; `wrangler deploy --dry-run` reads 13 assets clean;
  the migrate port guard exits 1 on a 6543 URL.

**In-flight / known risks:**

- `package-lock.json` still describes Astro 4 — Peter must run `npm install` locally and
  commit the lockfile, or `npm ci` in Actions fails (SETUP.md troubleshooting).
- The ingest package (`ingest/`) was not rebuilt this session; it uses the same `postgres`
  driver and the Session-pooler string, so no change is expected — confirm on first live run.
- Static `_headers` and `middleware.ts` header lists must be kept identical by hand.
- senate-lda WAF risk and the OneDrive/bash caveat from 2026-07-06 still apply.

**Next (in order):**

1. Peter: SETUP.md §1–5 — `npm install` + commit lockfile; create the Supabase project; local
   `npm run migrate` + `ibonds` + `treasury_yield_curve`; GitHub repo + secrets; run deploy.
2. Confirm `schema_migrations` lists 0001–0005 and `ingest_runs` shows the two runs; confirm
   the live check in `deploy.yml` passes on the custom domain.
3. Design RLS policies for the public tables before any app work (docs/04 #19), then #17, #18, #4.
4. Carry the contract edits into the next IIF session (unchanged from 2026-07-06 item 2).

**Addendum, same day — LIVE.** Supabase project `spotthemoney` (ref `phjjhazaiejrykmbyrpy`,
us-east-1, Micro) created in the Gratis Global Pro org; migrations 0001–0005 applied; `ibonds`
(57 periods; endpoint fixed to `v1/accounting/od/i_bonds_interest_rates`, matrix → announcement
rows) and `treasury_yield_curve` (14 series × 171 days) ingested live. GitHub repo
`pfouge/spotthemoney.com` (private) pushed; secrets `DATABASE_URL`, `CLOUDFLARE_API_TOKEN`
(Workers template + Zone Cache Purge on spotthemoney.com), `CLOUDFLARE_ACCOUNT_ID` set.
**deploy #2 succeeded (51s); https://spotthemoney.com/rates/i-bonds/ serves 4.26% / May 1, 2026
with `s-maxage=120`, HSTS, X-Frame-Options, cf-cache-status HIT.** Fixes along the way (all
committed next): `prerenderEnvironment: "node"` in astro.config (the workerd default cannot read
Postgres or a root .env at build); `web/src/lib/db.ts` walks up from cwd for `.env` and casts
`date::text` / `numeric::float8` (postgres.js otherwise returns a tz-shifted Date and a string);
`format.ts` renders date-only strings in UTC; `ingest/src/lib/db.ts` resolves the repo-root .env;
`scripts/write-env.ps1` (prompted, BOM-free .env writer) and `scripts/db-check.mjs` (state-of-DB
report — run it instead of the Supabase SQL editor, which freezes the tab). Known: OneDrive
prompts on mass `node_modules` deletes — consider excluding `node_modules` from sync.
Remaining next steps are unchanged: RLS design (#19), #17, #18, #4, IIF contract edits.

**Addendum 2 — yield-curve page + analytics live (deploys #3/#4).** `/rates/treasury-yields/`:
datastrip (10Y, 2Y, 10Y−2Y, 10Y−3M with inversion flag), build-time SVG curve chart (today vs one
month ago, log-scale maturity, hover crosshair), per-maturity table with 1d/1m/YTD bp changes,
10Y YTD trend. Code: `web/src/lib/charts.ts` (pure SVG builders; palette green #0E7C4D + amber
#B8862B validated with the dataviz validator), `getYieldCurve`/`getSeriesYearToDate` in
`web/src/lib/db.ts`. Nav + rates index + home datastrip link to it. Cloudflare Web Analytics site
created for spotthemoney.com in manual-snippet mode; token in repo variable
`PUBLIC_CF_ANALYTICS_TOKEN`; beacon confirmed in live HTML. Local dev tip: a throwaway Postgres 16
with 0001 applied + synthetic UST rows lets the page build offline (see session notes in
docs/reference if repeated — worth scripting as `scripts/seed-local.sql` next time).

---

## SESSION STATE 2026-09-26

_Supersedes older "next" lists only where noted; the infra next-steps from 2026-09-06 (RLS #19,
#17, #18, #4, IIF contract edits) still stand._

**Done this session:**

- Project pivot recorded in docs: iOS + Android apps (React Native + Expo) on Supabase Auth/RLS
  (`docs/05`, `docs/06-feature-list.md`); InvestingChannel added as the premium ad partner in the
  ad ladder (`docs/03`, `docs/04` #5, `docs/06`). Partner-outreach flagship list delivered inline
  as plain text (not a file).
- **Competitive analysis** of 11 congress/insider trackers written to
  `docs/07-competitive-analysis.md` (snapshots, have/planned/gap matrix with build cost, data
  sources ranked free → cheap → paid, design takeaways, proposed roadmap revisions, guardrails).
  Four Sonnet subagents produced the per-site catalogs (kept outside the repo). Headline: nobody
  offers free + dense + dark/mobile + congress and insiders on one graph + a transparent
  scoreboard; ~90% of competitor features are derivable from data we already ingest.
- Verified: Form 4 has a Rule 10b5-1 checkbox since EDGAR 23.1 (Apr 2023); FINRA short-interest
  files are free bi-monthly; Kapitol.ai is $35/mo or $299/yr.

**In-flight / awaiting Peter:**

- ~~Fold `docs/07` §8 into roadmap/feature list~~ **Done, Peter approved:** `docs/03` (P1 sprint
  step 5, new Phase 2 additions + Phase 2.5, launch-order rows 6/7/Later/Never) and `docs/06`
  († items, P2.5 tag) now carry the revisions.
- Stale root `congress-heatmap.html` (duplicate of `web/public/`) still not deleted — never
  confirmed.

**Next (in order):**

1. Update `docs/02` for the new
   fields (`days_to_report`, `is_10b5_1`, `owner_type`, `asset_type`, `bioguide_id`,
   `committee_memberships`) and add `SPY` to the Twelve Data tracked set.
2. New cheap ingest jobs, in this order: `congress_legislators` (committees + identity),
   EDGAR Form 144 / Form 3 / 13D-13G, FINRA short interest, 13F-HR.
3. Unchanged infra items: RLS design (#19), #17, #18, #4, IIF contract edits.


---

## SESSION STATE 2026-09-27

_Autonomous flagship-public build (roadmap B.1–B.7). Supersedes the 2026-09-26 "next" list.
Read `docs/04-open-decisions.md` §E for everything that is now Peter's call._

**Environment this session.** The sandbox's egress policy blocked every external host except
package registries, the desktop shell workspace failed to start, and the safety classifier
blocked operating the Supabase dashboard — so **nothing here has touched the live database or
the live site.** Everything was built and verified against a throwaway local Postgres 16 with
0001–0006 applied and `scripts/seed-local.sql`, plus the vendored IIF fixtures for the congress
job. Live verification is delegated to `deploy.yml`, which now ends with
`scripts/verify-live.mjs` and fails the run if sitemaps, robots, llms.txt or JSON-LD regress.
Files were written in the sandbox copy and committed back through the desktop bridge (no bash
on the OneDrive path).

**Blocker found (docs/04 #23).** Via Chrome: every scheduled GitHub Actions run since
2026-09-07 has failed in 7 s — "recent account payments have failed or your spending limit
needs to be increased". The account's $15 Actions budget hit 100% on Sept 6–7 (private-repo
minutes are pooled across nsnexplorer, gratisglobal and this repo) with "stop usage" on. No data
has refreshed and no deploy has run since deploy #5. Resolves Oct 1 (reset), by raising the
budget, or by the public-repo move Peter chose (#22). Peter made nsnexplorer public during
the session.

**Done (all verified locally — 24 node tests, 9 + 28 Python tests, `tsc` clean, 39-page build,
verifier clean on the seeded build and on an empty-database build, `wrangler deploy --dry-run`
reads 95 assets):**

- **W1 discovery:** `/sitemap-index.xml` + `/sitemap.xml` (index) → `/sitemaps/{pages,insiders,
  congress,companies,stocks}.xml` generated at build from the page graph (`web/src/lib/sitemap.ts`);
  `/llms.txt` generated with live counts; `robots.txt` allow lines for GPTBot, OAI-SearchBot,
  ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User,
  Google-Extended, CCBot, Applebot-Extended; JSON-LD on every page (`lib/seo.ts`); IndexNow key
  `web/public/55cb40ddab038d866025273d98018ccb.txt` + `scripts/indexnow-ping.mjs` (URLs with
  lastmod ≤ 2 days) in `deploy.yml`; `scripts/verify-live.mjs` (also runnable locally).
- **W2 flagship:** `web/src/lib/flagship.ts` loads the graph once per build; pages
  `/insiders/`, `/insiders/[slug]/`, `/congress/`, `/congress/[slug]/`, `/stocks/`,
  `/stocks/[ticker]/`, `/companies/`, `/companies/[slug]/`, `/washington/`, `/donations/`,
  `/lobbying/`, `/contracts/`, `/disclosures/`, `/methodology/`, `/corrections/` (draft, marked),
  `/rates/tips/`; components Answer (two-sentence answer + last updated), Crumbs (+BreadcrumbList),
  ReviewNote, TxnTable (source link on every row), Empty (no blank tables). Nav is Rates ·
  I-Bonds · Insiders · Congress · Washington · Newest; the home page has no "Soon" — sections
  show Live or Ingesting from live counts. **Publish gate choice:** unreviewed sources render
  with the visible "under review" note; the API (RLS) and the X thread see only `is_published`.
  Answer-block numbers cross-checked by SQL for Karp/PLTR, Marsh, PLTR ticker (seed data).
- **Migration 0006** (`companies.slug`; `transactions.owner_type/asset_type/is_10b5_1`;
  `raw_documents.source_url/byte_size/storage_bucket/stored_at/filing_id`; `social_posts`;
  `metrics_citations`; `metrics_search`; **RLS read-only policies on all public tables** — #19).
- **Ingest:** new jobs `universe` (seed 60 equities + 10 ETFs incl. SPY → `sec_form4` has a
  universe at last), `treasury_real_yield_curve`, `bls_cpi`, `fec_committees` (#18), `x_daily`,
  `archive_backfill`, `citation_count`, `search_console_weekly`; `sec_form4` now archives the
  XML, writes `is_10b5_1`, `owner_type`, `asset_type`, company slug. Runner: `daily: true` jobs
  only on a bare run; money-spending/public jobs run only when named. `ingest.yml` = migrate →
  4 parallel groups → retry → deploy. `lib/archive.ts` + `py/archive.py` (Supabase Storage,
  bucket `raw-filings`), `lib/oauth1.ts` (passes the X docs vector).
- **W2b congress (#17):** IIF parser vendored to `ingest/py/vendor/congress_ptr/` (VENDORED.md:
  paths, hashes, never-edit rule). `congress_ptr_job.py` complete for the House; scheduled
  13:00 UTC; local run on fixtures: 2 filings → 13 transactions, re-run downloads nothing
  (W5 check ✓). Senate not run — docs/04 #21.
- **W4:** I-Bond page states the 1 Nov 2026 reset and the CPI-implied inflation component
  (`web/src/lib/ibond.ts`, tested); TIPS page; alerts = static explainer (no auth UI yet).
- **W6:** `scripts/citation-questions.json` (200), `docs/reference/citation-count-procedure.md`
  (four API engines + manual Google AI Overviews procedure, `scripts/citation-manual.mjs`,
  ~$4–7/run), `measure.yml`.
- **Docs:** 01 §6 (Supabase Storage decision) + §11; 02 fields; 03 B-status; 04 decisions +
  §E #21–27; 06-feature-list ✓ P1 tags; 06-ingestion-contract status; 07 §10 (16 competitors);
  README, SETUP §5–6, `.env.example`, `ingest/py/README.md`; `scripts/seed-local.sql`;
  `scripts/sample-source.mjs` (writes `docs/reference/samples/`, `--approve` publishes);
  `keepalive.yml` (public-repo 60-day rule).

**Assumptions made (autonomy rules):** publish-partial with the "under review" note rather than
omit; Supabase Storage over R2 (no new billing surface); House-only Congress (no-spoofing policy
beats coverage); donor names withheld, aggregates only; "today" preset feeds folded into "week";
`corrections@spotthemoney.com` as the corrections address (#26); Form 4 "late" = >4 calendar
days; the three agreement files (CLAUDE.md, WORKING-METHODS, PERSONAL-PREFERENCES) stay in the
public site repo — add them to `.gitignore` before the first push if you'd rather not.

**Secrets / variables Peter must add (new repo, SETUP.md §5):** existing `DATABASE_URL`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, var `PUBLIC_CF_ANALYTICS_TOKEN`; new
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (archive uploads), `FEC_API_KEY` (committee universe;
DEMO_KEY is throttled), `X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_SECRET` (thread),
`GSC_SERVICE_ACCOUNT_JSON` (weekly export), `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/
`PERPLEXITY_API_KEY`/`GEMINI_API_KEY` (citation count — gate 1, ~$4–7/run), optional
`BLS_API_KEY`, `TWELVEDATA_API_KEY`, `LDA_API_KEY`; var `PUBLIC_AD_CLIENT` once AdSense approves.
Every job dry-runs or no-ops without its secret.

**Samples awaiting Peter** (generate after the first live ingest — the sandbox could not reach
the sources): `node scripts/sample-source.mjs sec_form4`, then `house_ptr`; review
`docs/reference/samples/*`, publish with `--approve`. Until then the pages carry the note and the
X thread posts nothing.

**Local `scripts/db-check.mjs` (replica, not Supabase):** migrations 0001–0006; flagship
`{"people":10,"members":3,"companies":4,"securities":9,"filings":16,"published":3,"txns":17,
"lobbying":5,"contracts":5,"committees":3,"donations":15}`; house_ptr 5 filings / sec_form4 11;
ingest_runs rows for congress_ptr (2), x_daily (3, dry-run), citation_count (1, dry-run),
search_console_weekly (2, dry-run). The live equivalent is the first item under Next.

**Not done / needs Peter:** the two samples (#27); FEC_API_KEY (#28); Senate route (#21); X account (#24); citation spend (#25); corrections@ mailbox (#26);
archive old repo (#22); `congress-heatmap.html` at the root still not deleted.

**Evening update (same day, connections fixed through Chrome + PowerShell):**
- Repo split done: public `pfouge/spotthemoney` (c9767ab, eea31e1), private
  `pfouge/spotthemoney-docs` (ebc2a34). `.github/workflows/*` cannot be written by the
  sandbox's file bridge (protected path) — fixed workflows land in `_workflows-2026-09-27/` and
  Peter copies them over; delete that folder once the copies are committed.
- Secrets set via `gh secret set`: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  CLOUDFLARE_API_TOKEN (Workers template + Zone Cache Purge), CLOUDFLARE_ACCOUNT_ID; variable
  PUBLIC_CF_ANALYTICS_TOKEN. GitHub secret scanning on the new repo: clean.
- deploy #3 green; migration 0006 applied live; all new pages 200 with JSON-LD.
- Congress PTR #1: 4 filings / 29 rows (unpublished). ingest #1: senate_lda 500, usaspending
  1000, rates/prices ok; sec_form4 no-op'd (universe seeded in parallel — fixed: universe now
  runs in the migrate job); fec_committees 403 (#28).
- The one-shot live check in deploy.yml failed once 15 s after a good deploy → now retries 8×15 s
  and prints HTTP status.
- Google Search Console: Domain property verified via Cloudflare TXT; sitemap-index submitted.
  Bing Webmaster: site added + verified via CNAME (DNS only), sitemap-index submitted. deploy #4
  (99e8319) green with the retrying live check.
- Sandbox lessons: `gh`/api.github.com are not reachable from the sandbox for this repo (session
  repo allow-list) — Actions status is read through Chrome; Google/GitHub tabs freeze the Chrome
  renderer after a few actions — open a fresh tab rather than retrying.

**Review dates (roadmap G):** 2026-10-16 flagship public — achievable the day Actions runs
again; 2026-11-01 reset-day measurement — the I-Bond page, CPI job and Web Analytics are in place.

**Live db-check 2026-09-28 (Peter's machine):** migrations 0001–0006; all rate series loaded
(CPI_U_NSA 31 obs to 2026-08, 15 UST_PAR + 5 UST_REAL tenors 185 obs to 2026-09-25, I-Bond
57 obs, latest 4.26%); flagship people 378 / members 4 / companies 54 / securities 79 /
filings 505 (house_ptr 4, sec_form4 501) / published 0 / txns 1507 / lobbying 500 /
contracts 1446 / committees 0 / donations 0 / raw_docs 505 all stored. FEC empty (#28).

**house_ptr sample review (2026-09-28):** values match the PDFs; two job-layer mapping fixes
made — `disclosed_at` now = filing date (was the notification column; late check undercounted)
and `[OL]` → other (was option). See docs/06-ingestion-contract.md "First live sample".

**Next (in order):**
1. Peter: push the job fix; run "Ingest — Congressional PTR" with extra_args `--reprocess`;
   `node scripts/sample-source.mjs house_ptr` → review → `--approve`. Then
   `node scripts/sample-source.mjs sec_form4` (501 filings ready) → review → `--approve`.
2. FEC_API_KEY (#28), then re-run ingest; run `archive_backfill` once (SUPABASE keys are set).
3. Decide #21 (Senate) and #24 (X account); set the measurement keys when the spend is approved.
4. Archive `pfouge/spotthemoney.com` after the first green scheduled run; bump actions to v5
   (node-20 deprecation warnings) in a quiet moment.
5. Carry the contract edits (docs/06-ingestion-contract.md, 2026-09-27 section) into IIF.

**PowerShell — repo split (HISTORICAL, executed 2026-09-27; kept for the record).** The repos
were created empty on github.com in Chrome and pushed with `git remote add origin` instead of
`gh repo create`.

```powershell
cd "C:\Users\pfoug\OneDrive\Documents\Claude Code Personal\spotthemoney.com"

# 0. sanity: deps unchanged (no new npm packages), migration 0006 applies, local build works
npm install
npm run migrate
node scripts/db-check.mjs

# 1. prompts move into docs/ so the private docs repo holds all strategy material
New-Item -ItemType Directory -Force docs\prompts | Out-Null
Move-Item autonomous-build-session-prompt.md, full-agreement-setup-prompt.md, improvement-session-prompt.md, methods-update-prompt.md docs\prompts\

# 2. private docs repo, nested at docs/ (site repo ignores docs/ — see .gitignore)
Push-Location docs
git init -b main
git add -A
git commit -m "spotthemoney docs — split from the site repo 2026-09-27"
gh repo create pfouge/spotthemoney-docs --private --source . --push
Pop-Location

# 3. fresh public site repo with a clean first commit (old private repo stays as the archive)
Remove-Item -Recurse -Force .git
git init -b main
git add -A
git status --short | Select-String "docs/" | Out-Null   # should print nothing: docs/ is ignored
git commit -m "Flagship public build: pages, discovery plumbing, congress job, archive, X, measurement (2026-09-27)"
gh repo create pfouge/spotthemoney --public --source . --push

# 4. in the new repo's Settings → Secrets and variables → Actions, re-enter every secret and
#    variable from SETUP.md §5, then Actions → deploy → Run workflow.
```

**URLs to click after the first deploy** (each should show real data or a reason line, never a
blank table): https://spotthemoney.com/ · /insiders/ · /congress/ · /stocks/ · /companies/ ·
/washington/ · /donations/ · /lobbying/ · /contracts/ · /disclosures/ · /rates/tips/ ·
/rates/i-bonds/#next-reset · /methodology/ · /corrections/ · /sitemap-index.xml ·
/sitemaps/insiders.xml · /robots.txt · /llms.txt · then any `/insiders/<slug>/`,
`/congress/<slug>/`, `/stocks/<ticker>/`, `/companies/<slug>/` from the sitemaps.
