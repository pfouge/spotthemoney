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

**Publish gates (2026-09-28):** house_ptr approved after `--reprocess` (4 filings public;
Congress pages live with 25 trades, late flags correct). sec_form4 sample reviewed against
EDGAR: rows match; multi-class `issuerTradingSymbol` ("LEN, LEN.B") had become a security row →
`primaryTicker` in sec_form4.ts + data migration 0007 (folds existing rows). Weighted-average
price footnotes (price 0) and 10%-owner filings widening the universe noted in docs/06.

**Both gates passed 2026-09-28:** house_ptr (4 filings) and sec_form4 (571 filings) approved
and live; migration 0008 decoded XML entities in names; deploys #5–#8 green.

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

## SESSION STATE 2026-09-28 — heatmap is the product

- **Theme:** light by default for everyone; dark is opt-in via the header toggle
  (`localStorage.theme === "dark"`). `:root` tokens are the light set (global.css).
- **Heatmap:** `web/src/components/Heatmap.astro` + `web/src/scripts/heatmap.ts` (vanilla,
  squarified treemap, ~400 lines) over `web/src/lib/heatmap.ts` → `/data/heatmap-congress.json`
  and `/data/heatmap-insiders.json` (build-time, published rows, last 365 days). Home page = the
  map with an **All insiders / Congress / Corporate insiders** switch (the All map merges both
  files; independent filters Who (everyone/congress/insiders) × Chamber × Party × Role, so
  "House Democrats" is Chamber=House + Party=Democrats; tooltip shows the Congress vs insider
  split); `/congress/` and `/insiders/` open on their own map.
  Nav order Congress · Insiders · Newest · Washington · Rates. Rules: congress tile $ = top of
  range; insiders = shares × price, open-market only + 10b5-1 excluded by default; filter state in
  the URL hash (`#scope=house&w=365&view=buy&side=filers`).
- **`congress_roster` job** (Sonnet-built, reviewed): unitedstates/congress-legislators →
  bioguide/party/state/district on `people`/`person_roles`; matches the PTR job's name+chamber
  key; idempotent (verified 2 runs); first in the ingest.yml rates group. Dem/Rep filter is
  empty until its first live run.
- Verified: tsc clean (web + ingest), 32 ingest + 3 web tests, 51-page build on the seed and on
  the empty DB, verify-live clean on the local build (37 pages), headless Chromium screenshots
  of home/congress/insiders in light + dark + mobile with tiles rendering and no page errors.
- Open after this: market-cap range control (#20), Form 4 weighted-average-price footnotes,
  name→ticker for ticker-less PTR assets, Senate (#21), FEC key (#28), X (#24).

**Next (in order):**
1. Peter: push; check https://spotthemoney.com/ renders the map with live data in both themes;
   run ingest once so `congress_roster` fills party (or wait for 09:00 UTC).
2. FEC_API_KEY (#28); `archive_backfill` once; decide #21 and #24; measurement keys (#25).
3. Archive `pfouge/spotthemoney.com`; bump actions to v5; carry docs/06 contract items into IIF.
4. Delete the stale root `congress-heatmap.html` and `design-preview.html` (the prototype in
   `web/public/` stays as the design reference).

## SESSION STATE 2026-10-04 — autopilot audit

_Question asked: is every source updating on its own, is classification automatic, do the
filters work. Supersedes the 2026-09-28 "Next" list where noted._

**Found (all confirmed against live Actions logs and the live site):**

- **The archived-to-be repo was overwriting production.** `pfouge/spotthemoney.com`'s Actions
  budget reset on Oct 1; its scheduled ingest (runs #25–28) deployed the old 3-page site to the
  same Worker and wrote to the same database with pre-fix code. The live site flipped to the
  old build every day until the Congress run redeployed. **Archived 2026-10-04** (docs/04 #22).
- **`ingest` failed every scheduled run since 09-30.** `fec_committees` 403s without a key →
  "money" group red → retry red → deploy skipped (the condition tested the matrix result, which
  is `failure` if any group fails). Data still landed; the site only rebuilt via the Congress job.
- **Nothing filed after 09-28 was public.** New Form 4s and PTRs landed `is_published=false`;
  the heatmaps read published rows only (newest insider filing on the map: 09-25).
- **`senate_lda` was frozen while green.** The API's default order is oldest-first, so the job
  re-read the same 500 January filings daily.
- **Party missing for members filed under a legal name.** "Richard W. Allen" (PTR) vs
  "Rick W. Allen" (roster) became two `people` rows; 3 of the 4 Congress map rows had no party
  and dropped out of any party filter.
- **Combined-map filter leak.** On the home map, Party/Chamber did not hide corporate insiders
  (and Role did not hide Congress), so "Democrats" showed Democrats plus every insider.
- Schedules at `:00` fired ~5 h late. A job returning `status: "failed"` without throwing
  printed ✓ and exited 0.

**Changed (verified locally: 32 ingest tests, 28 + 9 Python tests, ingest `tsc` clean, migration
0009 on a local Postgres, 41-page build, `verify-filters` 367 filter states / 0 mismatches):**

- `db/migrations/0009_publish_gates.sql` — `publish_gates` (house_ptr + sec_form4 seeded as
  approved 2026-09-28), `publish_approved_filings()`, backlog published on apply,
  `lobbying.posted_at`.
- `ingest/src/index.ts` — calls `publish_approved_filings()` after every run; a `failed` result
  now exits 1. `ingest/py/congress_ptr_job.py` — same publish call; seat-based
  `resolve_person`. `scripts/sample-source.mjs --approve` records the gate.
- `congress_roster.ts` — seat match (rule 2b) and duplicate merge (rule 1b).
- `senate_lda.ts` — `ordering=-dt_posted`, stores `posted_at`, stops when a page is all known,
  default 60 pages. `fec_committees` / `fec_schedule_a` — no key → no-op with
  `stats.skipped` instead of a 403 failure; `twelvedata_eod` sets `stats.skipped` too.
- `web/src/scripts/heatmap.ts` — a class-specific filter narrows the combined map to its class.
- Workflows (hand-copied from `_workflows-2026-10-04/`): `ingest.yml` deploys whenever migrate
  succeeded and ends with a `freshness` job; crons moved to 09:17 / 13:23 / 15:47 UTC.
- New `scripts/freshness-check.mjs` (per-source OK / NOT CONFIGURED / STALE / FAILING + publish
  backlog + party coverage; exit 1 on stale) and `scripts/verify-filters.mjs` (Playwright;
  every control option + seeded combinations vs an independent recomputation).

**Still not on autopilot — needs Peter:** `FEC_API_KEY` (donations, #28) and
`TWELVEDATA_API_KEY` (prices) are unset, so those two sources report NOT CONFIGURED; Senate PTRs
(#21) are not ingested at all; X thread dry-runs (#24); measurement keys (#25). Scanned House
PTRs that need OCR stay held by design. Insider coverage is the 70-ticker universe plus tickers
Congress trades — widening it is a scope decision, not a freshness one.

**Next:** push (PowerShell block in the 2026-10-04 chat / project handoff) → run `ingest` once
by hand → read the `freshness` table in the run summary → `node scripts/verify-filters.mjs`
against live. Then FEC + Twelve Data keys. Unchanged: bump actions to v5 (Node 20 warnings;
`ubuntu-latest` moves to Ubuntu 26 on 2026-10-19), #21, #24, #25, #26.

**Evening addendum (2026-10-04) — keys set, FEC donations rebuilt.** `FEC_API_KEY` and
`TWELVEDATA_API_KEY` are set (ingest #11 green; prices 3,450 bars at the free plan's 8/min
pace, `TWELVEDATA_MIN_INTERVAL_MS`). The first keyed FEC run exposed three faults: the
30-day window was on receipt DATE (receipts exist only after a committee files, so it returned
16 rows, mostly typos dated 2035/2036 — the live page said "Last updated May 29, 2035");
`fec_committees` used `/candidates/`, which has no `principal_committees`, so 0 member
committees loaded; and the page called a capped sample "receipts". Fixed: `fec_schedule_a`
pulls by `min_load_date` (+ `max_date` = today, `sort_hide_null`), visits committees
least-recently-checked first under `FEC_MAX_REQUESTS` (850; key limit 1,000/h) using
`committees.donations_checked_at` (migration 0010, which also deletes future-dated rows);
`fec_committees` uses `/candidates/search/`; web SQL ignores receipts dated after today; the
donations page says "receipts held / recent sample", never totals; freshness probes for FEC and
USAspending ignore future dates. Verified against a local mock API (`FEC_API_BASE` override —
test only); **`min_load_date` and `/candidates/search/` are from memory of the OpenFEC API and
were not callable from the sandbox — the first live run is the proof** (expect
`member_committees` > 0 in `ingest_runs.stats` and several hundred committees after a few
runs). Real committee totals (`/committee/{id}/totals/`) are a separate, unbuilt piece.

**FEC first live run (ingest #12, 2026-10-04 19:55 UTC).** `fec_committees` loaded 805
committees (member committees now present — `/candidates/search/` confirmed). `fec_schedule_a`
stored 15,356 real receipts (dated Jul–Aug 2026) for 36 committees, then the 55-minute job
limit cancelled it: row-at-a-time inserts plus slow API pages. Fixed: one batched insert per
page and a wall-clock budget (`FEC_MAX_MINUTES`, default 25); a committee cut off mid-pull is
left unmarked and restarted next run. The cancelled run left one `ingest_runs` row at
`running` (harmless; the freshness check ignores running rows). Coverage of all ~805
committees fills in over several daily runs.

**SEO / LLM pass (2026-10-04, late).** Crawl of all 1,516 live sitemap URLs found: 529 of 539
member pages and 15 stock pages with no data, 1,429 titles over 60 chars, 1,093 descriptions
over 160, no `og:image` anywhere, `/rates/` at 79 words and four core pages with no answer
block. Changed: `fitTitle` / `fitDescription` in `web/src/lib/seo.ts` (pages pass preferred
wording plus shorter fallbacks; the layout takes the first that fits 60 / 155 chars);
`BaseLayout` gains `noindex`, a robots meta, `og:image` (`web/public/og.png`, 1200×630) and
Twitter card tags; member, insider and stock pages with no published transactions are
`noindex, follow` and left out of the sitemap; all four profile templates and the 16 core
pages have rewritten titles/descriptions; `/rates/` rebuilt with live figures and ~450 words;
answer blocks added to `/rates/`, `/rates/treasury-yields/`, `/methodology/`, `/corrections/`.
`scripts/verify-live.mjs` now also checks title/description length, one h1, indexable,
canonical, og:image, Twitter card, data rows on listed profile pages and duplicate titles
(`--all` crawls every URL; deploy.yml samples 5 per sitemap). Verified on the local seed build
only (36 URLs, all checks pass). Not done: insider names are shown as EDGAR files them
("SAMUELI HENRY") — reordering to "Henry Samueli" would match how people search but risks
mangling multi-word surnames and entity filers; Peter's call. Page speed, mobile rendering and
actual index coverage were not tested.

**Charts (2026-10-04, night).** Peter approved a 25-chart mockup
(`docs/mockups/viz-mockup-2026-10-04.html`); the 23 that need no new data are built. All are
build-time SVG, no chart library: `web/src/lib/viz.ts` (pure string builders, each returns ""
when it has nothing to draw), `web/src/lib/vizdata.ts` (shapes the flagship model for them),
`web/src/components/Viz.astro` (one frame for every chart: title, the question it answers,
legend, SVG, a one-sentence text reading for search and answer engines, optional embed
snippet) and `web/src/scripts/viz.ts` (shared tooltip from `data-tip`, leaderboard tabs,
yield-curve playback, phone scroll-to-newest). Where they are: ticker tape under the header on
every page (`Tape.astro`, needs 4+ signal trades); home (`VizHome`: tiles with sparklines,
buy/sell gauge, activity calendar, weekly flow, Congress-vs-insiders scatter, leaderboards);
`/congress/` (`VizCongress`: calendar, flow, party/chamber, state tile map, reporting-lag
histogram); `/insiders/` (`VizInsiders`: gauge, calendar, flow, cluster buys); member and
insider pages (`VizPerson`: trade timeline, portfolio mix, reporting lag); stock and company
pages (`VizStock`: who is trading, insider holdings, lobbying by quarter, contracts by
agency); `/lobbying/` issue treemap; `/contracts/` agency-to-recipient flow; `/donations/`
state map; `/rates/i-bonds/` rate history; `/rates/treasury-yields/` curve playback.
Rules that hold the set together: chart colours are their own tokens (`--viz-buy`,
`--viz-sell`, `--viz-one`, `--viz-late`, …) because the brand green/red fail a colour-blind
check; buy/sell is never colour alone (position or ▲▼ as well); wide charts ship two SVGs
(`svg` + `svgNarrow`, swapped at 760px); on phones time-series charts (`svg.vz-time`) scroll
sideways inside the card and the rest shrink to fit. `flagship.ts` loads two chart-only
extras (shares held after each Form 4, lobbying issue names) in their own try/catch so a
chart query can never blank a page. Embeds: `/embed/congress/[slug]/`, `/embed/insiders/[slug]/`,
`/embed/stocks/[ticker]/` (`EmbedLayout.astro`, noindex, canonical to the full page, not in
sitemaps); `web/public/_headers` lifts `X-Frame-Options` for `/embed/*` — **untested on
Cloudflare; check a real iframe after deploy.** Verified locally only, on synthetic data
(988 trades): 242 pages build, no page errors, light/dark and 390px screenshots reviewed,
tooltip/tabs/playback exercised, `verify-live --all` passes, and a build against an empty
database renders no chart, no tape and no empty frame. Not built (need a price-history
backfill first): price chart with trade markers, "what happened after" calculator. Known
soft spots: phone text in the shrink-to-fit charts is small (~6px); `/congress/` and
`/insiders/` keep a "Charts" jump link even if the section is empty; no typecheck was run
(`astro check` is not installed) — the build is the only compile check.

**Charts, round 2 (2026-10-04, late night).** Live as `0f15cf6` + `07acd5d`; this round fixes
what real data and a phone exposed.
- **Phones.** Every shrink-to-fit chart now has a third, 360-wide build (`svgPhone` on
  `Viz.astro`, `PHONE_W` in `viz.ts`); CSS shows `.vz-a` (default), `.vz-b` (full-row chart at
  ≤760px) or `.vz-c` (≤560px). Label text is ~10px on a phone instead of ~6px. Time-series
  charts (`svg.vz-time`) still scroll sideways. Builders take a width, not a `wide` flag.
- **Scatter** uses signed log scales with decade gridlines and dollar ticks (one outlier used to
  flatten it); labels are placed in the first free spot beside/above/below a dot or dropped.
- **Buying share replaces buy/sell ratio** in the home tile and the monthly line: a ratio is
  undefined in any period with no sells (it showed 0, or a gap); share of dollars always exists.
- **"Prices insiders traded at"** (stock pages): open-market Form 4 trades plotted at the share
  price each filing reported — ▲ bought, ▼ sold, sized by dollars. It uses filings only.
- **Price feed is a licensing decision, not a backfill.** Twelve Data's individual plans (the
  free key in use) allow internal use only; showing prices on a public site needs a business
  plan (Venture, from $149/mo as of 2026-10-04) plus attribution. So the market-price chart
  with trade markers and the "what happened after" view are NOT built, and `security_prices`
  must stay off every public page until Peter picks a licensed source (docs/04 #33). Nothing
  on the site reads `security_prices` today.
- Wording: donations "N states and DC"; lobbying "the 14 largest are shown"; contracts names the
  largest named flow; insider lag says "Form 4 deadline"; `/congress/` and `/insiders/` only
  show the "Charts" jump link when the section exists.
- `astro check` now run (install with `npm i --no-save @astrojs/check typescript` in `web/`;
  never run it without those installed — it prompts and hangs): 0 errors.

**Price decision (2026-10-04).** Peter chose filings-only charts (docs/04 #33): no market price
feed, no market-price chart, no "what happened after" view. `security_prices` stays off every
public page. Peter then had the price pull switched off: `twelvedata_eod` no-ops (reports a
skip; freshness shows NOT CONFIGURED) unless `TWELVEDATA_ENABLED=1`, and migration 0011 drops
the public read policy on `security_prices` so the stored Twelve Data rows are not readable
through the anon API. The rows are kept. Tested locally only (migration applies, job skips,
freshness check stays green); the `prices` matrix job still starts and exits in about a minute.

## SESSION STATE 2026-10-05 — new identity

**Logo.** Peter asked for a new logo in the manner of Allan Peters (Peters Design Co) and
approved the result for the site, except the ring-text badge ("CONGRESS · INSIDERS"), which is
NOT used anywhere on the site. The mark is one continuous line that is a bullseye and a dollar
sign: two centres one stroke apart, three half-rings from each, stroke = gap = one unit, plus a
short vertical bar at each free end. Rules, all asset files, the geometry generator (`mark.py`)
and research notes: `docs/brand/logo-2026-10-05/` (docs repo).
- `web/src/components/Mark.astro` — inline, `currentColor`; `size` is the HEIGHT; under 48px it
  draws the two-ring cut so the stroke stays solid. `web/src/components/Wordmark.astro` — "SPOT
  THE MONEY" drawn with the mark's stroke (not a font); its viewBox does the flat cut on M/N/Y,
  so never pad it. Header = Mark 28 + Wordmark 11; footer = Mark 24 + Wordmark 10. One colour,
  always ink — the green "Money" in the old text wordmark is gone on purpose.
- `web/public/favicon.svg` (ink tile, two-ring cut), `mark.svg` (full mark, ink; the JSON-LD
  logo), `apple-touch-icon.png` (180, new; linked from `BaseLayout`), `og.png` regenerated with
  the new lockup. `web/public/congress-heatmap.html` (prototype) carries the new mark too.
- Only 14 capitals are drawn (S P O T H E M N Y C G R I D); any other lettering in this style
  needs new glyphs in `mark.py`.
- Verified locally: `astro check` 0 errors, 242-page build, header/footer screenshots in light,
  dark and 390px, favicon at 16/32/64, `verify-live --all` passes. Not checked against existing
  trademarks. The stale root `design-preview.html` still shows the old mark (not served).

**Layout redesign after TradingView (2026-10-05).** Feedback: the phone site was cluttered;
"take after tradingview.com" for navigation, filtering, layout and fonts, keeping our colours.
Studied their markets, list and symbol pages in Chrome (desktop width only — the window would
not resize to phone width, so their phone layout is inferred from the folded-menu state they
show below ~1300px). What was adopted, all in `web/src/styles/global.css` unless noted:
- **Type.** Their body stack verbatim (`-apple-system, BlinkMacSystemFont, "Trebuchet MS",
  Roboto, Ubuntu, sans-serif`). Their headline face is a licensed font (Euclid Circular), so
  headlines use Outfit instead — self-hosted at `web/public/fonts/` (OFL, licence alongside),
  preloaded in `BaseLayout`. Google Fonts is no longer requested at all. `--font-mono` now maps
  to the sans stack with tabular figures; the uppercase mono labels are gone everywhere.
- **Header.** Sticky; logo, search pill, nav links, theme icon. Under 1024px the links fold
  into a drop-down menu with icons (`#menuBtn` / `#siteMenu`) and search becomes an icon.
  Without JS the links stay visible (`html.js` gates the folded state).
- **Search (new).** `/data/search.json` (`web/src/pages/data/search.json.ts`): tickers, members
  and insiders with trades, companies, main pages. `web/src/scripts/ui.ts` runs the dialog
  (opens on the pill, `/` or Ctrl/Cmd+K; arrows + Enter), the menu, the theme switch and the
  "Show more" on answer blocks, which are clamped to three lines on phones.
- **Filters.** Same controls and `data-` hooks (the filter verifier still passes), restyled as
  pill chips: selects are pills, button groups are pill groups with an ink active state, labels
  are screen-reader only. On phones the filter row, section chips (`.feeds`) and figure strips
  are one swipeable row each instead of stacked rows. Wording: "Both chambers", "No 10b5-1
  plans / With plans".
- **Tables.** Quiet sentence-case header, 48px rows, no wrapping; on phones the table scrolls
  sideways with the first column pinned.
- **Cards.** 16px radius, more padding. Eyebrow lines are hidden (they repeated the
  breadcrumb). The ticker tape is hidden under 640px.
- Gotcha found: a visually-hidden label (`position:absolute`) inside a scrolling flex row widened
  the whole page on phones until `.ctl` was made `position: relative`.
- Verified locally only: `astro check` 0 errors; 242-page build; `verify-live --all` passes;
  `verify-filters` 391 states, 0 mismatches; screenshots at 390px and 1280px, light and dark;
  menu, search and "Show more" exercised. Not verified: real phones, Windows rendering of
  Trebuchet MS (the sandbox has no such font), the live site.

### SESSION STATE 2026-10-05 (later) — fixes after the redesign, history backfill

- **`7651613` (pushed, deployed):** search ranking (exact, title-start, word-start; Congress
  first), ticker names in the search index, `! Cache-Control` detach lines in
  `web/public/_headers` (Cloudflare was joining two values and browsers obeyed `max-age=0`),
  and no future-dated contracts (`flagship.ts` query capped at today; Newest feed drops
  later-dated items).
- **Scheduled runs:** by 14:37 UTC on 2026-10-05 neither the 09:17 `ingest` nor the 13:23
  Congress PTR cron had fired (the day before they fired about 5 hours late). The FEC batching
  fix, the price-job skip and the freshness job are therefore still unproven in an unattended
  run. A read-only re-check is scheduled for 20:30 UTC.
- **History backfill (Peter, 2026-10-05): Congress and insiders back to January 1, contracts
  to 180 days, donations left at the current window.**
  - Congress: no code change. `ingest-congress-ptr` dispatched with `window_days=280` and
    `--limit 400` per run (the job has no time budget; 45-minute job limit). Repeat until a run
    reports nothing new. Scanned filings stay held for review as before.
  - Insiders: new on-demand source `sec_form4_history` (`ingest/src/sources/sec_form4.ts`,
    registered in `ingest/src/index.ts`). It pages each ticker's EDGAR listing 100 at a time
    back to `SEC_FORM4_HISTORY_SINCE` (default January 1 of the current year), skips stored
    filings, and stops on a 42-minute budget with `stats.history_complete=false`; re-run until
    true. Start it with `gh workflow run ingest.yml -f source=sec_form4_history`.
  - EDGAR listing gotcha: `count` only honours 10/20/40/80/100 and rounds down (35 returned
    20). The daily pass now asks for 40.
  - Pacing decision: SEC requests use a 250 ms gap (4/s; SEC publishes 10/s) through a new
    `minGapMs` option in `ingest/src/lib/http.ts`. Every other host keeps 1.5 s. This also
    shortens the daily `sec_form4` run.
  - Verified locally only (the sandbox cannot reach sec.gov): listing-walk unit tests, `tsc`,
    and an end-to-end run against a fake EDGAR with a real local database (budget stop,
    resume, daily pass unchanged). `start=`/`count=100` paging was confirmed against the real
    EDGAR in a browser.
  - Congress result: run 1 loaded 400 filings (3,688 rows written, 354 filings published,
    deployed 14:55 UTC); run 2 found nothing new, so the House year-to-date is complete. Five
    filings (doc ids 8221285, 8221287, 8221297, 8221302, 8221310) return 404 from the Clerk's
    PDF path every run and are skipped — not investigated.
  - Insiders: `45b1ba4` pushed; first `sec_form4_history` run started 15:06 UTC.
  - Contracts — CORRECTION to what was first written here: production was not storing the
    newest 1,000 awards by action date. The API rejects the "Action Date" field, so every run
    took the fallback: the 1,000 largest awards with any activity in the last 30 days, dated
    by award START date. Most started years ago, so the 180-day pages showed 96 rows.
  - Contracts rewrite (Peter approved "largest per month plus tracked companies"):
    `ingest/src/sources/usaspending.ts` now stores (1) the largest awards that started in
    each 30-day slice of the last 180 days (3 pages of 100 per slice) and (2) awards to
    companies with a tracked ticker, exact normalised-name match only. Rows outside the
    window by start date are dropped. `normalizeOrgName` moved to `shared/src/orgname.ts` so
    the site and the ingest use one rule. Site wording changed everywhere contracts appear:
    "awards that started in the last 180 days", "award value", and the contracts page says it
    is not every federal contract.
  - Contracts, unverified: the USAspending API returned HTTP 500 from Peter's machine and was
    unreachable from the sandbox on 2026-10-05, so the request shape (`date_type:
    "new_awards_only"`, the "NAICS" field, `recipient_search_text`) has only run against a
    fake API. The job drops a rejected optional piece and carries on; read
    `stats.new_awards_filter`, `stats.naics_field`, `largest_rows_kept` and
    `company_rows_kept` on the first live run to see which path it took.

### SESSION STATE 2026-10-05 (evening) — backfill results, history floor moved to 2025-10-01

- **Peter, 17:05 UTC: take the history back to October 1, 2025.**
  - Congress: `ingest-congress-ptr` dispatched with `window_days=370 --limit 1400`.
  - Insiders: `HISTORY_FLOOR = "2025-10-01"` in `sec_form4.ts` is now the default floor for
    `sec_form4_history` (was January 1, 2026).
  - Contracts: `USASPENDING_WINDOW_DAYS` default is now 400 (14 slices). The site still shows
    180 days; the older rows are stored but not displayed until Peter decides the display
    window. Company searches now page up to 3 × 100. Worst case the job makes ~870 requests
    (~22 minutes); it shares the 55-minute "money" job with FEC's 25-minute budget — watch it.
  - Lobbying and donations: NOT extended. Finding: `senate_lda` stores the newest 60 pages
    of the current filing year per run, so the lobbying totals on the site are a sample, the
    same kind of problem contracts had. A full pull is its own piece of work.
- **Results so far.** Congress Jan 1 → today complete (400 filings; site: 97 members, 3,431
  trades). Contracts rewrite live: 3,333 rows on the first run, NAICS populated, site shows
  3,334 awards / $93.91B. Insiders: run 1 4,527 filings, run 2 4,357, zero quarantines,
  run 3 in progress at 17:10 UTC.
- **The Congress backfill grew the tracked-ticker universe from ~106 to ~762 tickers**, so
  the insider history is several times larger than first sized (dozens of thousands of
  filings; each 42-minute run loads ~4,400). Completion signal: a `sec_form4_history` job
  that ends well under 42 minutes (the log line says "partial" either way; `history_complete`
  is only in `ingest_runs.stats`).
- **Freshness job fails** on "Members with trades but no party: 1" (a member added by the
  backfill). Run `congress_roster` with the next manual ingest; if it stays 1, find the name.

### SESSION STATE 2026-10-05 (night) — lobbying and donations history, self-restarting backfill

Peter, ~17:15 UTC: pull lobbying in full back to October 2025 and extend donations too.

- **Lobbying** — new on-demand source `senate_lda_history` (in `senate_lda.ts`). Walks every
  filing POSTED since 2025-10-01, oldest first; 112,256 filings in that window (live API,
  2026-10-05). Resumes from `ingest_runs.stats.cursor`; 42-minute budget; "partial" until
  done. Issue descriptions are not stored (site uses codes only). With `LDA_API_KEY` it paces
  at 750 ms (lda.gov publishes 120/minute for keyed clients).
  - Site: the lobbying query in `flagship.ts` now keeps ONE row per registrant + client +
    period (latest posted wins) so amended reports are not counted twice, orders "newest" by
    the Senate's posted date instead of our load time, and reads up to 400,000 rows.
    Coverage wording changed to "every filing posted since October 2025" — true only once
    the history pass reports success.
- **Donations** — new on-demand source `fec_schedule_a_history` (own file) + migration 0012
  (`committees.donations_history_floor`, `_note`). Per committee, once: all receipts since
  2025-10-01 when the committee has <= 3,000 of them; otherwise the newest 200 from each
  30-day slice (conduits hold tens of millions — ActBlue 47M). 600 requests / 30 minutes a
  run. Stops if the database exceeds 400 MB (`FEC_HISTORY_MAX_DB_MB`) and logs the size.
  FEC facts found: `sort=-contribution_receipt_amount` times out (504) even for one member
  committee; the first page's `pagination.count` gives the committee's receipt count.
  - The site still shows donations for 90 days and contracts for 180; the older rows are
    stored, not displayed. Peter has not decided the display windows.
- **`backfill.yml`** (delivered in `_workflows-2026-10-05/` for Peter to copy into
  `.github/workflows/`): runs the three history sources in parallel jobs, redeploys, and
  re-dispatches itself with whatever still printed "(partial)", counting `remaining` down
  from 30. A failed job is not retried — a red run stops that source's chain. Replaces the
  manual re-dispatching done earlier today. `sec_form4_history` now reports "partial" only
  when it stopped on its budget.
- Tested locally only (fake APIs + local Postgres): resume, failure mid-run, completion,
  budget stop, database guard, site build, `astro check`. Not yet run live.

### Size (market-cap band) filter — 2026-10-05, Peter: "filter by market cap ranges"

- **No price feed** (docs/04 #33 stands). Size is estimated from SEC filings only:
  shares outstanding (10-Q/10-K cover) × median of the company's latest open-market Form 4
  prices in its primary ticker (400 days); fallback public float from the latest 10-K;
  if the two differ by more than 20×, the float wins. Logic and bands: `web/src/lib/capband.ts`
  (mega ≥ $200B, large ≥ $10B, mid ≥ $2B, small ≥ $300M, micro below).
- **Data:** migration 0013 `company_size` (RLS on, no public policy). New source
  `sec_company_size` (`ingest/src/sources/sec_company_size.ts`): the SEC XBRL frames API
  returns one fact for every filer per quarter in one request (~4,400 rows); 14 requests
  cover shares (6 quarters) and float (8 quarters). It also runs at the end of the daily
  `sec_form4` pass, so no workflow change was needed. Multi-class filers (Alphabet, Meta,
  Berkshire, Visa, NVIDIA in some quarters) have no single shares figure in frames and use
  float. Funds/ETFs have neither and drop out when a band is selected.
- **Site:** `/data/heatmap-*.json` now carry `caps` (ticker → band). `Heatmap.astro` has a
  `data-ctl="cap"` select; `scripts/heatmap.ts` filters on it and keeps it in the URL hash
  (`#cap=large`). `scripts/verify-filters.mjs` drives the new control and has its own oracle
  for it. Methodology page explains the estimate.
- Verified locally only: fake frames API + local DB; build; `astro check` 0 errors;
  `verify-filters` 427 states, 0 mismatches; screenshot of the bar. The frames API shape was
  checked against the real SEC in a browser. First live run still to be read — check that
  obvious names land in the right band before trusting it.

### Deploy race found and fixed — 2026-10-05 ~19:20 UTC

- Peter: "the size dropdown should be called market cap, also it disappeared."
- **Why it disappeared:** `deploy.yml` is also called at the end of `ingest.yml` and
  `backfill.yml`, and it checked out the commit THAT RUN started on. The backfill run that
  began at 18:01 on `e62bf01` finished at 18:44 and redeployed `e62bf01`, undoing the 18:34
  deploy of `b14d770` (the filter). Any long run that straddles a push did this.
- **Fix:** `deploy.yml` now checks out `ref: main`, so every deploy builds the newest code.
  Delivered as `_workflows-2026-10-05/deploy.yml` (workflow files cannot be written by the
  bridge; Peter copies it into `.github/workflows/`).
- The filter is now labelled **Market cap** ("Any market cap" when unset). Bands and logic
  unchanged; the methodology page still says the figure is an estimate from filings.

### Daily insider run was failing — found 2026-10-05 19:40 UTC

- The scheduled `ingest` (fired 18:25 UTC, nine hours late) failed in `sec_form4`:
  "52 rows quarantined (limit 50)". The TS jobs did not print quarantine reasons, so the cause
  is inferred, not read: the Congress backfill grew the tracked set to ~760 tickers, and
  tickers with no SEC company CIK (funds, ETFs, foreign, delisted) were each quarantined.
- Fix: such tickers are counted and sampled in stats (`tickers_unresolved_sample`) and
  named in one log line, not quarantined. `lib/run.ts` now prints the first 60 quarantine
  reasons to the job log for every TS source. If the next daily run still trips the breaker,
  the log will say why.
- Deploy flip-flop on 2026-10-05 evening: runs started before `c9688a4` still carry the old
  `deploy.yml` and redeploy their own commit when they finish. Settles once those runs are
  done; a manual `deploy` run from main fixes it at any time.

### TradingView price + chart on ticker pages — 2026-10-05 (Peter: add the free widgets, hold the paid feed)

- `web/src/components/TradingView.astro` + `web/src/scripts/tradingview.ts`, placed on
  `/stocks/[ticker]/` (equity/etf/adr only) under the figure strip: TradingView's free
  Symbol Info widget (price, change) and Advanced Chart. Loaded lazily, rebuilt on theme
  change, TradingView branding kept, note says US prices are delayed.
- Not a change to docs/04 #33: TradingView shows its own data in its own frames; the site
  stores and publishes no prices. The data cannot be read back out, so market-cap bands stay
  the filings-based estimate. A licensed feed (Twelve Data Venture, $414/month billed yearly,
  external display allowed — priced 2026-10-05) is on hold.
- Symbol is passed without an exchange prefix ("AAPL"); TradingView resolves it. Some
  tickers may show "only available on TradingView" or resolve to a non-US listing — not yet
  checked across the ~760 tickers.
- Verified locally only (the sandbox blocks tradingview.com): both embed scripts are created
  with the right config, re-created on theme change, no layout overflow at 390px, build and
  `astro check` clean, `verify-live --all` passes. Rendering to be confirmed on the live site.

### First live market-cap bands — checked 2026-10-05 22:20 UTC

- Live after GitHub's Actions outage cleared (~21:30 UTC): dropdown labelled "Market cap" on
  the three maps; TradingView block renders on ticker pages (two frames, 181 px and 438 px).
- First band data (build 22:15 UTC): insiders map 459 of 493 tickers banded; Congress map 393
  of 797. The Congress gap is mostly tickers whose insider filings are not loaded yet (no
  company row, e.g. JPM, XOM, GS at that time) — it closes as `sec_form4_history` proceeds
  and the daily pass refreshes `company_size`.
- Two wrong bands found and the rules changed (`capband.ts`, tests in
  `scripts/capband.test.ts`, run `npx tsx --test scripts/capband.test.ts`):
  - NOVT showed mega: its 10-K states a public float of $3.5 trillion (a units mistake). The
    old rule trusted the float when the two estimates disagreed; now shares × price wins.
  - NTES showed mega: Form 20-F filers count ordinary shares but trade as ADSs. Shares ×
    price is now used only for companies that also report a public float; 20-F filers are
    left unbanded. (Foreign-issuer insiders file Form 4s since March 2026, which is why they
    have prices at all.)
  - Anything above $6 trillion is discarded.
- Not verified: SNDK and STX show mega; plausible only if their 2026 share prices are very
  high — no price source here to check against.

### Backfill state at 02:30 UTC, 2026-10-06 — lobbying done, donations pass fixed

- **Lobbying history: complete.** Eight cycles (18:01 → 01:15 UTC); the last one ended early
  and the chain did not re-queue it. Live `/lobbying/`: 55,894 filings for 2026 reporting
  $3.39B (was 2,133 / $37M as a sample). Ran keyless (~600 pages a cycle) — `LDA_API_KEY`
  is not set or not accepted.
- **Donations history: stalled, fixed in code.** The 00:42 UTC job was cancelled by its
  45-minute timeout: 600 requests in the first 15 minutes of each ~47-minute cycle put
  ~1,200 calls in one hour, the FEC answered 429 with a long Retry-After, and `lib/http`
  slept on it. Fixes: `lib/http.ts` no longer waits on a Retry-After above 90 s (and has a
  `noRetryOn429` option); `fec_schedule_a_history` paces at one request per 3.7 s (973/hour
  ceiling), runs 36 minutes, and on a 429 pauses five minutes and retries inside its budget.
  The cancelled job also ended the backfill chain (nothing reported "partial").
- **Insider history: fell out of the chain during GitHub's Actions outage** (its job was
  cancelled while queued at 20:55 UTC, so it never reported "partial"). One manual run at
  21:43 UTC; none since. Restarted 02:30 UTC via `backfill.yml` defaults.
- **Market-cap bands after the rule fix:** NOVT mid, NTES unbanded — confirmed live. Congress
  map 378 of 797 tickers banded; JPM, XOM, GS still unbanded until their insider filings load.
- GitHub's unauthenticated API allows ~60 calls an hour from the browser; the checks were
  hitting that. Job logs sometimes do not render in the hidden browser window.

### Trade values: a row total in the Form 4 price box (2026-10-06)

- **Symptom:** `/stocks/crwv` showed Magnetar Financial LLC selling "$68618B". Cause: on its
  CoreWeave call-option sales (e.g. accession 0001104659-26-097430, 2026-08-12) Magnetar put the
  total premium for the row in "price per share" (627,486 options, "price" $12,502,658.55 =
  $19.925 each). `flagship.ts` multiplied shares × price, squaring the quantity.
- **Rule, in `shared/src/tradevalue.ts` (tests: `npx tsx --test scripts/tradevalue.test.ts`):**
  the price box holds the row total when a derivative's price is over 3× the stock's typical
  price (median of its open-market insider trades; over $25,000 when there is none), or a stock
  row's price is over 50× that median. Then value = the box, displayed price = box ÷ units. Any
  value above $1 trillion is dropped. The database keeps the numbers exactly as filed.
- `flagship.ts` applies it once when building the model, so every chart, table and heatmap gets
  the corrected value and per-unit price. `x_daily.ts` gives derivative rows no dollar value
  and leaves them out of cluster buys. `viz.ts` `usd()` now prints trillions as "T".

### Deploys failed 04:49–11:13 UTC, 2026-10-06: insiders heatmap file over 25 MiB

- **Symptom:** every deploy (backfill runs and the push of `b1706a1`) failed at "Deploy to
  Cloudflare Workers": `Asset too large … data/heatmap-insiders.json with a size of 41.4 MiB`.
  Cloudflare's limit is 25 MiB per static asset. The insider history pass had filled a year of
  Form 4 rows; the site stayed on the 04:05 UTC build until this fix.
- **Fix:** the insiders rows are packed (`web/src/lib/heatmap-pack.ts`: each ticker, filer and
  filing written once, a row is a short array; lossless) and split by age —
  `/data/heatmap-insiders.json` holds the last 90 days, `/data/heatmap-insiders-older.json` the
  rest of the year, fetched by `scripts/heatmap.ts` only when the 1Y window is chosen
  (`root.dataset.older`: none / idle / loading / loaded / failed). Estimate for the live data:
  about 4 MiB and 11 MiB.
- **Guard:** `splitInsiders` cuts the older file's far end a month at a time if it would pass
  20 MiB, and the build log prints both sizes (`heatmap-insiders: N rows in the last 90 days …`).
  A shorter 1Y map, never a failed deploy.
- Tests: `npx tsx --test scripts/heatmap-pack.test.ts`; `scripts/verify-filters.mjs` reads both
  files with its own unpacker. The build was 55,761 files at the time — watch the file count too.
- **Insider history:** the 10:04 UTC backfill run finished its insiders job in 19 minutes and
  the chain stopped re-queuing, which is the completion signal (final count not yet read).

### Second deploy failure, 11:37 UTC 2026-10-06: over 20,000 files (Workers Free)

- With the 25 MiB file fixed, `wrangler deploy` failed on the next limit: "27,889 static asset
  files, which exceeds the Workers Free limit of 20,000 … per Worker version" (code 10304;
  Workers Paid allows 100,000). The 04:05 UTC build had 7,394 insider pages (about 17,600 files);
  the finished insider history brought roughly 12,500 insiders, each with a page **and** an
  `/embed/insiders/<slug>/` page.
- **Fix:** `web/src/pages/embed/insiders/[slug].astro` deleted; `VizPerson.astro` offers
  "Embed this chart" for members of Congress only. Stock and Congress embeds are unchanged.
  Expected count about 15,400 files.
- **Headroom is about 4,600 files.** Every new insider adds one page. If the tracked universe
  grows much, either move to Workers Paid or stop giving a page to insiders with no
  open-market trades. `wrangler` prints the count it read; the API error states the real one.

### Derivative rows are out of every buy/sell total (2026-10-06, after the Magnetar fix went live)

- Deploy of `6146262` succeeded 11:47 UTC: live `/stocks/crwv/` shows Magnetar at $4.3B (was
  "$68618B"); heatmap files are 1.8 MiB (24,168 rows, last 90 days) and 7.1 MiB (103,412 older).
- Peter's follow-up: option rows distort the collective numbers generally. They did — a put
  bought counted as dollars "bought" of the stock, a call sold as dollars "sold".
- **Rule:** in `flagship.ts`, a Form 4 row with `is_derivative` and side buy/sell gets side
  `option`. Every aggregate keys on side buy/sell, so derivative rows drop out of who-is-trading,
  net buying/selling, the tape, biggest trades and ratios; they stay in the tables as
  "Option / conversion · derivative" with their value. `insiderRows` leaves them off the heatmap.
  Methodology says so. The database is unchanged.
- Not changed: codes F (shares withheld for tax) and D (returned to the issuer) on stock rows
  still count as "sell" in who-is-trading (`codeToSide` in `sec_form4.ts`); the heatmap's default
  view and `isSignal` already count only P and S.

### Joint filings counted once; partial month off the trend line (2026-10-06)

- Peter asked whether the insiders "Buy / sell pressure" chart is really that skewed (14.7% buying
  over 30 days; a 97% point for October; busiest day $7.7B). Checked against the live heatmap
  files: selling far above buying is real, but two things were wrong.
- **Joint filers:** funds and trusts that hold a stake together each file a Form 4 for the same
  trade. Carlyle's Medline sale (26,105,840 shares at $41, 2026-03-10, $1.07B) was on file under
  seven owners and summed to $7.6B; same pattern for ROL (three Rollins entities) and FANG.
  `web/src/lib/joint.ts`: Form 4 buy/sell rows from different filers with the same stock, date,
  code, share count and price, worth $250,000 or more, are one transaction; the earliest filing
  keeps it. In `flagship.ts` the others get `jointOf` and, in every list that spans filers
  (`model.txns`, security and company lists), side `other`; the filer's own `p.txns` keeps the row
  as filed. Off the heatmap; flagged "joint filing" in tables. Build log prints the count.
  Tests: `npx tsx --test scripts/joint.test.ts`.
- **Partial month:** `gaugeData` plotted the month in progress (33 trades, mostly Berkshire buying
  Lennar → 97%). The line is now the last twelve complete months.
- `x_daily.ts` "largest" skips a trade already taken (same ticker, date, value).
- Left as is, Peter's call: 10% owners account for about $60B of the $92B of open-market selling
  in the year (pre-dedupe); officers $13.6B, directors $18.8B. Cluster buys in `x_daily` still
  count joint filers as distinct insiders.

### Joint filings, second pass: match on holdings after the trade (2026-10-06, ~12:30 UTC)

- `6f66363` live 12:11 UTC: year of open-market insider selling fell from $92.4B to $75.9B,
  busiest day from $7.7B (Mar 10) to $3.8B (Sep 16).
- That $3.8B was still double: SGF FANG Holdings' 9,079,675 FANG shares at $205.26 sit in two
  consecutive accessions (…037009, …037010) under the **same** filer, which the first rule (different
  filers only) skipped. Eight such groups, about $2.1B over the year. But the same shape can be
  real: W. Nicholas Howley's TDG rows repeat 1,925 shares at one average price across three
  filings, which may be three accounts each selling an equal slice.
- **Rule now** (`lib/joint.ts`): rows are one trade when stock, date, code, shares, price **and
  shares owned after the transaction** match across different filings, value $250,000 or more.
  Different filers with no holding on file still merge; the same filer merges only when a
  holding is on file. `flagship.ts` reads the holding from the stored Form 4 payload
  (`owned_after`: n-th row of a filing = n-th payload entry, share count cross-checked).
  A same-filer repeat is also taken out of that filer's own page totals.
- Table flag is "also in another filing" (covers both cases).

### Data audit, part 1: coverage report and what it is for (2026-10-06, ~12:40 UTC)

Peter, after the 30-day Congress view showed 6 members: "stop and take a holistic view of the
way you ingest data … and the filtering." Measured against the sources (House Clerk index via
his local Congress PTR tool; live `/data/heatmap-congress.json`):

- **Senate: zero rows.** Known and documented (docs/04 #21, methodology), but the home page said
  "every STOCK Act trade" and the map offered a Senate filter. The Senate eFD listing shows at
  least 100 PTRs from 27 senators since March 2026.
- **House: 250 of 409** PTRs filed in 2026 have ticker rows on the map (362 electronic, 47
  paper per the Clerk index). Where the other ~160 are (held as needs_ocr, parsed with no
  ticker, never fetched) could not be told from outside the database — hence this report.
- **Buys vs sells is not skewed for Congress:** 1,787 buys ($98M) vs 1,948 sells ($131M) over
  the year. The 30-day view was 46 trades because the window used the **trade** date and
  members have 45 days to file; by filing date the same 30 days hold 292 trades by 15 members.
- One trade dated 2026-12-26 on a filing from 2026-02-09.

Changes in this push:
- `web/src/lib/coverage.ts` + `/data/coverage.json`: per source and month — filings on file,
  published, pending review, needs_ocr, paper, with rows, with ticker rows; transaction rows by
  side; last six runs per source (numeric stats only, e.g. `index_ptrs_2026`); row counts for
  lobbying / contracts / donations; data-quality counters. **Read this file first in any future
  data question.** Summary at `/methodology/#coverage`.
- Heatmap windows (7D/30D/90D/1Y) now count by **disclosure date** (`r.f ?? r.d`), in the
  client, the verifier oracle and the recent/older file split.
- `flagship.ts`: a trade date after its filing date is dropped (row kept).
- Home lede no longer claims every STOCK Act trade; Senate filter option says "not yet included".

Open, needs the coverage numbers and Peter's decisions: the House gap; a Senate route (his
machine can reach eFD; GitHub runners cannot); `--reprocess` is the only way a filing once
marked needs_ocr gets re-read; the 7-day default window loses filings if runs are skipped
for a week; late/missing scheduled runs.

### Data audit, part 2: what the coverage report showed (2026-10-06, 13:10 UTC)

Read from live `/data/coverage.json` (build 13:09 UTC):

- **House: ingestion is complete for what can be read.** 409 PTRs filed in 2026 on file = the
  Clerk index (409). 362 published (all the electronic ones); 47 paper filings held as
  `needs_ocr` (62 held in all, 12 months; `reviewQueuePending` 62). 113 House filers on file,
  103 with something published — ten members are invisible until their scans are transcribed.
  105 published 2026 filings have no ticker row: checked on the member pages, the no-ticker rows
  are bonds (454), other assets (136), funds (27), crypto (5) and 62 "stock (no ticker)".
- **Senate: 0 filings.** 100 senators are on the roster with no trades.
- **Database is 402 MB.** `fec_schedule_a_history` stopped itself at its 400 MB guard
  (requests 0 on the 12:17 UTC run): 423 of 806 committees have donation history. It was
  262 MB at 02:00 UTC — the insider history and donations added ~140 MB in ten hours.
  Supabase's free plan allows 500 MB. This push adds table sizes to the report to see where.
- **Form 4:** history pass complete (48,730 filings fetched, 896 tickers processed, 0 remaining,
  5 truncated at the page cap, 131 of 1,027 universe tickers have no SEC CIK). 2,600–6,800
  filings per month since 2025-10. **The daily `sec_form4` run's last two runs failed** (Oct 5,
  quarantine limit); the fix (`69b524a`) has not had a daily run since.
- **Donations daily pass covers 50 of 806 committees per run** (756 deferred), so a committee is
  refreshed about every 16 days.
- Quality counters: 10 trades dated after their filing (3 in the future), 20 Form 4 rows whose
  shares × price exceeds $1T (the price-box rule handles them), 759 rows with no ticker.
- No scheduled daily run had started by 13:11 UTC on Oct 6.

### Database plan and size (2026-10-06, 13:20 UTC)

- **The Supabase project is on the Pro plan ($25/month, 8 GB disk included)** — Peter, 2026-10-06.
  The 400 MB guard in `fec_schedule_a_history.ts` was written for the free plan's 500 MB and
  stopped donations history at 423 of 806 committees. Default is now 6,000 MB.
- Sizes at 401 MB total: donations 96 MB (464,131 rows), filings 74 MB (Form 4 payload 48 MB),
  lobbying 59 MB (104,757), raw_documents 37 MB, transactions 28 MB (128,112), contracts 4 MB.
  About 97 MB is outside the public tables (not traced).
- The site still displays donations for the last 90 days only; the stored history has no page yet.

### Senate PTRs: import from saved browser exports (2026-10-06, built, not yet run on real data)

Peter: "we need to fix this now" (Senate missing). Constraints that shaped it:
- eFD (efdsearch.senate.gov) sits behind bot protection; datacenter IPs and non-browser clients
  are refused. The vendored IIF client gets through by impersonating Chrome's TLS fingerprint —
  **not used here and not to be built** (project no-spoofing policy, docs/04 #21).
- The site loads normally in Peter's own Chrome. It requires accepting a statutory agreement
  (5 U.S.C. app. § 105(c): no commercial use except news and communications media disseminating
  to the general public; no credit rating; no solicitation). **Peter accepts that himself**;
  whether the site fits the media exception is his call.

Design:
- Reports are read in his browser session, and saved as
  `ingest/data/senate_ptr/export-YYYY-MM-DD.json` (`filings[]`: id, first, last, filer, title,
  url, date_received, kind ptr|paper, html). Later export files win per report id.
- `ingest/py/senate_import.py` (called from `congress_ptr_job.py` after the House loop, no
  workflow change): one `filings` row per report (source `senate_ptr`, external_id = eFD uuid),
  rows parsed by the vendored `senate_client.parse_ptr_html` (parser only). Paper → `needs_ocr`,
  no rows. An amendment ("… (Amendment N)") supersedes earlier versions of the same filer +
  report date: those keep `payload.superseded_by` and lose their rows. Senators are matched to
  the roster by surname, first name settling shared surnames (`pick_senator`); no match falls
  back to `resolve_person` (stat `senate_people_not_on_roster`). eFD's free-text asset type is
  mapped to the short codes (`job_asset_type`). Already-stored reports are skipped.
- `senate_ptr` has **no publish gate row**: rows stay unpublished until Peter approves the source
  (`node scripts/sample-source.mjs senate_ptr --approve`, or a gate migration).
- Web: `senateShown(model)` flips the House-only wording (home lede, map's Senate option,
  Congress/stock source notes, methodology) once a Senate report is public.
- Tests: `python3 ingest/py/test_senate_import.py` (10). End-to-end against a local database
  with the fixture: original, amendment, paper filing all correct; re-run processes nothing.
- Not yet seen: a real eFD report page (the fixture is synthetic). Updates are batches, not daily.

### Senate PTRs: first real read (2026-10-06, ~14:10 UTC)

- Peter accepted the eFD agreement in his Chrome. Read through that session, 1.5 s apart: the
  site's own report search (PTRs received since 10/01/2025) → **177 reports** (162 electronic,
  15 paper) from **32 senators**, 1,860 transaction rows, 1,106 with a ticker; all 162 pages
  fetched, 0 errors, every table has the nine expected columns. Export is 590 KB.
- Real pages parse with the vendored parser unchanged (checked on Fetterman 08/10/2026). Types
  seen: Purchase, Sale (Full), Sale (Partial), Exchange. Asset types: Stock, Municipal Security,
  Corporate Bond, Other, Stock Option, Non-Public Stock, Cryptocurrency.
- **Amendments are full copies** (Boozman 12/08/2025: 14 rows, Amendment 1: 14 rows, 13
  identical). 17 amendments in the window: 7 replace a report in the window, 10 amend reports
  from before October 2025 (their originals are not on file, so nothing is double-counted).
  A senator can file two reports on one day (13 such days), so `mark_superseded` now picks the
  earlier version by row overlap; on the real set every amendment matched (0 unmatched).
  Amendment rows carry no disclosure lag (it would be measured to the correction date).
- Expected after import: 155 live electronic reports (~1,745 rows), 7 superseded, 15 paper held.
- The export reaches the repo as one browser download that Peter moves into
  `ingest/data/senate_ptr/` — tool output is too small a channel for 590 KB.

### Senate PTRs loaded (2026-10-06, 14:04 UTC run 37475856200) — awaiting approval

- Export file verified after Peter's push (`f8f8d87`): 590,312 bytes, hash equal to the one
  computed in the browser. Local dry run and the live run agree exactly:
  **177 filings** (months match the eFD list), 15 paper held as needs_ocr, 7 superseded by an
  amendment, 155 with rows, **1,791 rows** (1,143 buys, 646 sells, 2 exchanges; 1,044 with a
  ticker; 33 options), 0 quarantined, 0 unmatched amendments. Published: 0 (no gate yet).
- 31 senators matched to the roster; **1 filer not on the roster: Alan Armstrong** — created as
  a new person with no state or party. Check the roster job picks him up.
- `db/migrations/0014_senate_ptr_gate.sql` adds the `senate_ptr` publish gate and publishes.
  **Pushing it is Peter's approval of the source.** After that the site's House-only wording
  switches off by itself (`senateShown`).
- To add newer Senate reports later: repeat the browser read (Peter accepts the eFD agreement,
  reports are fetched in his session, one download), save as a new
  `ingest/data/senate_ptr/export-YYYY-MM-DD.json`, push, run the Congress PTR workflow.

### Senate live — and a wrong-person match found on the live site (2026-10-06, 14:15 UTC)

- `786210b` (gate migration 0014) deployed 14:12 UTC: 818 Senate rows on the Congress map from
  20 senators; home lede and the Senate filter switched over.
- **Wrong attribution, live:** the reports of the late **Lindsey Graham** (filed Oct 2025 – Jan
  2026) were attached to **Darline Graham**, his sister, appointed to his seat and sworn in July
  2026. `pick_senator` matched on surname alone when only one sitting senator had it.
- The filer "not on the roster" was **Markwayne Mullin** (no longer a senator; Alan Armstrong
  holds an Oklahoma seat and matched correctly) — not Armstrong, as the previous note said.
- **Fix:** `pick_senator` now also requires the first names to agree (`first_names_agree`: same
  name, one the start of the other, a nickname table, or a nickname whose formal name starts
  with a filer initial). All 30 distinct filers in the first export map to the right roster
  row in the test; "Lindsey Graham" and "Markwayne Mullin" match nobody and become their own
  people (no state or party — former members are still not on the roster).
- Apply with the Congress PTR workflow, `extra_args: --reprocess` (re-attaches the filings and
  rewrites their rows).
- Lesson: a seat changes hands. Never match a filer to the roster on surname + seat alone when
  the filing may predate the current holder.

### 15:20 UTC check: deploy "failures" since the Senate went live; state of the day

- Every deploy since 14:11 UTC shows **failure**, but the site is updated each time: the failing
  step is the post-deploy link check, on one page — `/stocks/-- amcr/`. A Senate exchange row's
  ticker cell reads "-- AMCR" (one side has no symbol) and went through as a ticker.
  `senate_import.clean_ticker` now takes the cell's single valid symbol or none, and the import
  deletes securities whose ticker contains a space or starts with "--" once no row uses them.
  Needs the Congress PTR workflow with `--reprocess` (same run that applies the Graham fix).
- **Still unpushed at 15:18 UTC: the Lindsey/Darline Graham fix** — the wrong attribution is live.
- Donations history: running, past the old 400 MB stop — 508 of 806 committees, database 422 MB.
- No scheduled run fired on Oct 6: `ingest` (09:17 UTC) and Congress PTR (13:23 UTC) both
  absent by 15:18 UTC; the only Congress run was the manual one at 14:04. `sec_form4` daily has
  therefore not run since its two failures on Oct 5.
- The "cancelled" run conclusions seen all day are deploy jobs replaced by a newer deploy
  (concurrency group `deploy-web`), not errors.

### Former members get their party; why scheduled runs look missing (2026-10-06, ~15:50 UTC)

**Scheduled runs.** Nothing is broken or disabled (all workflows `active`, GitHub status
operational). GitHub starts this repo's scheduled runs hours after the cron time, every day:

| Workflow (cron, UTC) | Oct 2 | Oct 3 | Oct 4 | Oct 5 |
|---|---|---|---|---|
| ingest (09:17) | 15:28 | 14:10 | 14:40 | 18:25 |
| Congress PTR (13:23) | 18:18 | 17:08 | 17:23 | 21:08 |
| x-daily (15:47) | 20:01 | 18:45 | — | 22:12 |

So "no run by 15:18 UTC" on Oct 6 is the usual 5–9 hour delay, not a missed run. GitHub documents
schedule events as best-effort (delayed, sometimes dropped, under load). The only way to run at
a set time is to trigger `workflow_dispatch` from outside GitHub (dispatched runs start within
seconds — every manual run today did). Also: `ingest` has ended in **failure** on each of those
four days.

**Former members** (`congress_roster.ts`, `linkUnlinkedFilers`). The roster file holds sitting
members only. After the normal pass, filers that have reports but no Bioguide ID are looked up
in current + `legislators-historical.json` (fetched only when needed; last term within 4 years):
same chamber, same state if the filer row has one, surname present, first names agree
(`isSameMember` / `findMember`, unique match only). A match gets the Bioguide ID, party, state,
district and term dates; an ended term closes the role (`valid_to`). If the roster already has
that member, the filer row is merged into it. Checked in the dataset: Greene (R-GA-14, left
2026-01-05), Mullin (R-OK, left 2026-03-23), Lindsey Graham (R-SC, died 2026-07-11) are present.
- `findUnlinkedFilerBySeat` now skips a filer whose reports all predate the member's term start
  (a predecessor in the same seat with the same surname is not a duplicate).
- Because roles can now be closed: `resolve_person` (Python) matches an exact name in the
  chamber whether or not the role is active (active first), and `resolve_senator` tries sitting
  senators, then former ones — otherwise `--reprocess` would create a second person.
- Tests: `npx tsx --test ingest/src/sources/congress_roster.test.ts` (14). End to end on a local
  database with fixture rosters: the three former members linked with party and closed roles,
  Lindsey Graham not merged into Darline Graham, an unknown filer left alone.
- Run with: Actions → ingest → source `congress_roster`.

### Legal, privacy and trust basics (2026-10-07) — Peter: "do 2, look at NSNExplorer.com for ideas"

Not reviewed by a lawyer. Peter's answers: operator is "a Wyoming limited liability company"
(same wording as nsnexplorer.com; no company name published), contact address
`contact@spotthemoney.com` (**Peter sets up the forwarding** — until he does, mail to it bounces),
and the pages cover advertising now, before AdSense is switched on.

- **New pages:** `/privacy/`, `/terms/`, `/about/` (`web/src/pages/*.astro`; in the sitemap and
  `llms.txt`). Each has the answer block and a dated constant (`POLICY_UPDATED`, `TERMS_UPDATED`,
  `PAGE_UPDATED`) — change the date whenever the wording changes. Structure follows
  nsnexplorer.com's pages; the text is written for what this site does.
- **One contact address:** `CONTACT_EMAIL` in `web/src/lib/seo.ts` (footer, the three pages,
  corrections, `llms.txt`). `corrections@` is no longer used. The ingest user-agent strings still
  carry Peter's Gmail address (they identify the crawler to SEC and others) — unchanged.
- **Footer:** About · Methodology · Corrections · Terms · Privacy · Contact · llms.txt, plus a
  not-affiliated line. **Corrections page:** the draft "Use of this site" paragraph now points
  to Terms; the "Draft — needs review" note on the corrections policy itself is still there.
- **What the privacy page promises — keep these true:** no accounts, forms or email list; the
  site sets no cookies; one localStorage key (`theme`); Cloudflare Web Analytics only; TradingView
  widgets load from TradingView on stock pages; ads may be shown through Google AdSense with
  consent asked "where the law requires it"; requests answered within 30 days; future email
  alerts or accounts will be opt-in with unsubscribe and deletion.
  **Before setting `PUBLIC_AD_CLIENT`:** turn on Google's consent message (AdSense → Privacy &
  messaging) for EEA/UK/Swiss visitors, or the consent sentence is false. **Before adding any
  third-party script, form or account feature:** update the privacy page and its date first.
- **Third-party services (the audit):** Cloudflare (hosting, Web Analytics), Supabase (database,
  public records only, no visitor data), GitHub (code, scheduled jobs), TradingView (widgets on
  `/stocks/<ticker>/`), Google AdSense (off), self-hosted Outfit font (OFL). Nothing else loads
  from another host.
- **Reuse limits stated in Terms:** 5 U.S.C. § 13107(c) (congressional disclosure reports) and
  52 U.S.C. § 30111(a)(4) (FEC filings). Liability cap US$100; Wyoming law and courts.
- **Unsupported claims removed:** "every disclosed trade" / "every STOCK Act disclosure" /
  "every Form 4" in the default description, home JSON-LD, member, insider and stock page
  descriptions and two link labels — the site holds back scanned filings and tracks a set of
  tickers, so "every" was not true. `VizCongress` no longer says "Senate filings are not yet
  covered" once Senate reports are public. Ad slots now carry a visible "Advertisement" label.
- **Accessibility pass.** New `scripts/verify-a11y.mjs` (axe-core, WCAG 2 A/AA, one page of each
  type × light/dark × desktop/phone, plus the skip link). First run: 202 findings; now 0. Fixed:
  skip link + `<main id="main">`; text colours `--green-ink` / `--red-ink` (the fill green was
  4.29:1 as text; use the `-ink` tokens for any green/red TEXT); heatmap tile text is pure
  black or white (the softer inks fell to 4.2:1 on mid greens) and every tile has an
  `aria-label` (ticker, dollars, direction, trades); the map is a `group`, not an `img`; charts
  with links inside are `role="group"` (`linked()` in `viz.ts`); hover tooltips are
  `aria-hidden` (pointer-only; the facts are in labels and chart summaries); links inside running
  text are underlined; sideways-scrolling strips with nothing focusable become a Tab stop
  (`markScrollers` in `ui.ts`); the home map switch's tablist no longer contains a link; the
  search button's label matches its visible text; under-review rows are no longer dimmed.
  Run: `npm i --no-save playwright axe-core`, then
  `node scripts/verify-a11y.mjs http://127.0.0.1:4321` (or the live URL). **Install every
  `--no-save` tool in ONE npm command** (`playwright axe-core @astrojs/check typescript`): a
  second `npm i --no-save` removes the first set, and `astro check` then hangs on a prompt.
- Not covered by the check: TradingView and ad frames (excluded — not ours), real screen-reader
  use, the trade map's keyboard order (tiles are in size order, there can be hundreds).
  Provenance of the header/menu line icons is not recorded; the About page credits only the
  logo and charts as made for the site.
- Verified on the local build only: `astro check` 0 errors, 233-page build, `verify-live --all`,
  `verify-filters` (427 states, 0 mismatches), `verify-a11y` clean, 30 unit tests, screenshots.

**State carried over from 2026-10-06 (not written down then):** roster run linked 3 former
members and merged 1 duplicate — no member on the Congress map lacks a party; the scheduled
`ingest` at 15:55 UTC was fully green (daily `sec_form4` fix confirmed); donations history is
complete (806 of 806 committees, 924,040 receipts; database about 500 MB of 8 GB).

### Built-in sharing (2026-10-08) — Peter: "Built-in sharing now"

Peter's choices: every channel offered plus TikTok; pages, charts **and single trades** are
shareable; link previews keep the one site-wide image for now (per-member and per-stock preview
cards are on the roadmap, `docs/03` "Additions — 2026-10-08").

- **One dialog, four kinds of button.** `#shareDlg` in `BaseLayout.astro`, run by
  `web/src/scripts/share.ts`. Any element with `data-share` opens it:
  `page` (the button in every answer block — so every page with an answer block is shareable
  with no per-page work), `chart` (in every `Viz.astro` card), `trade` (the last column of
  `TxnTable.astro`), `map` ("Share this view" under the trade map; the link keeps the filter hash).
- **Channels:** Copy link; the phone's own share sheet ("More apps…", only where the browser has
  one); X, WhatsApp, Reddit, LinkedIn, Facebook, email; Copy text; Copy embed code (charts that
  have one); Save image (charts). **All are plain links built in the browser at click time — no
  SDK, pixel or third-party script, and nothing records a share.** The privacy page says so
  (date bumped to 2026-10-08); keep it true. Network names are text chips on purpose: no brand
  logos are drawn.
- **TikTok has no way to receive a link from a website** (no web share URL; checked 2026-10-08).
  Its chip hands over what TikTok does take: on a chart it makes the image (phone: opens the
  share sheet with the image file; desktop: downloads it) and copies the caption; elsewhere it
  copies the caption and says so.
- **Chart image.** `chartPng` copies the visible inline SVG, writes each element's computed
  colours onto the copy, and draws it on a 1200-wide canvas with the chart title, page title,
  legend, "spotthemoney.com" and the date. Follows the current theme. The trade map is HTML,
  not SVG, so it has a link but no image.
- **Anchors.** Every chart card has an id (`chartId(title)` → `#chart-weekly-flow`; pass `id` to
  `Viz` if two cards on one page ever share a title — the verifier fails on repeats). Every
  trade row has `id="t<transaction id>"` on its first appearance in a page (tracked in
  `Astro.locals.txnAnchors`; the preset feeds on `/insiders/` repeat rows). A shared trade link
  goes to the **filer's own page** at that row (`data-share-path`), falling back to the stock
  page, then the current page. Rows and charts highlight on arrival (`:target`).
  Known limit: tables show the newest 200 rows, so a link to an older trade of a very active
  filer opens the page without a highlighted row.
- **Wording.** `web/src/lib/sharetext.ts` `tradeSentence` builds the pre-filled line from the
  labels the row already shows ("Jane Doe sold $1M–$5M of NVDA on Sep 3, 2026; disclosed Sep 20,
  2026, 17 days later."). Option, exchange and other rows are never called buys or sells; no
  motive is stated. Under-review rows have no share button. Page shares use the page title;
  chart shares use the chart title + page title, with the chart's summary sentence as the
  longer text. Tests: `npx tsx --test scripts/sharetext.test.ts` (7).
- **Verifier:** `node scripts/verify-share.mjs <base-url>` (Playwright; axe-core optional) —
  222 checks: each button kind opens the dialog with the canonical link, every network link
  carries it, copy/caption/embed reach the clipboard, Save image yields a 1200-wide PNG, shared
  chart and trade links land on screen, the map link keeps `w=90`, row and chart anchors are
  unique, focus returns to the button, the dialog passes axe, and opening the menu contacts no
  other host. Runs against the live site too.
- Without JavaScript the buttons are hidden (`html:not(.js) [data-share]`).
- Verified on the local build only: `astro check` 0 errors, `verify-share` 222/222,
  `verify-a11y` clean, `verify-live --all`, `verify-filters` 427 states / 0 mismatches, 37 unit
  tests, screenshots (desktop light, phone dark) and one saved chart image looked at.
  Not tested: real phones' share sheets, the networks' own preview rendering.

### Guides and FAQ (2026-10-08) — Peter: "FAQ and beginner guides now"

Peter's choices: all four subject areas; 15 or more guides, "well SEO and GEO optimized with
internal linking and external linking"; FAQ answers also on the section pages; reader is a
retail investor; and **"when we change the site the necessary guide pages are also altered to
fit the changes."**

**STANDING RULE — guides move with the site.** After ANY change under `web/`, `ingest/` or
`shared/`, build, serve and run `node scripts/verify-guides.mjs http://127.0.0.1:4321` with the
other verifiers. If it reports STALE or LABEL: read the named guide against the change, fix
its wording (and set its `updated` date) if what it describes is now different, then
`node scripts/verify-guides.mjs --accept <slug>` and ship `reviewed.json` in the same push.
Never `--accept` without reading. A change that adds a feature, filter, source or rule a reader
would ask about gets a paragraph in the right guide (or a new guide) in the same push.

- **What exists.** 19 guides at `/guides/<slug>/` (Congress 5, insiders 6, Washington money 3,
  rates 3, using the site 2; about 14,400 words), a hub at `/guides/`, `/faq/` (70 questions,
  grouped), and a "Common questions" block at the foot of `/congress/`, `/insiders/`,
  `/stocks/`, `/washington/`, `/rates/` (`SectionFaq.astro`). "Guides" is in the header menu;
  Guides and FAQ are in the footer, the sitemap, the search index and `llms.txt`.
- **Guides are data, not pages.** `web/src/lib/guides/`: `types.ts` (the model, and the
  explanation of the three keep-in-step mechanisms), `congress.ts`, `insiders.ts`,
  `washington.ts`, `rates.ts`, `site.ts` (the text), `ctx.ts` (live values), `facts.ts` (dated
  outside facts), `index.ts`, `html.ts`, `reviewed.json`. One renderer:
  `pages/guides/[slug].astro`. The FAQ page and section blocks reuse the guides' own answers,
  so they cannot disagree with them.
- **Three mechanisms that keep them true:**
  1. *Live values* (`ctx.ts`): the 45-day deadline, the Form 4 late rule, market-cap bands, the
     joint-filing threshold, counts, held paper filings and the current I-Bond rate are read
     from the code and database at build time. Never type one of these into a guide.
  2. *`covers`* on each guide: the files (or `file#symbol`, one declaration) whose behaviour it
     describes. `verify-guides` hashes them (line endings ignored) against `reviewed.json`.
  3. *`ui`* on each guide: on-screen labels it quotes, and the page they must be on (36 today,
     mostly the trade map's filters).
  Plus *`facts.ts`*: nine outside facts, each with `asOf`, `recheckBy` and a source URL.
  `verify-guides` fails when one is past due. **First due: `tradingBan`, 2026-11-20** (status
  of the congressional stock-trading bill); then `fecLimits` 2027-02-15.
- **`scripts/verify-guides.mjs <base-url>`** — STALE, LABEL, LINK (113 internal links and their
  anchors), FACT, SHAPE (≥450 words, ≥4 sections, ≥3 questions, ≥4 internal links, ≥2 outside
  sources, Article + FAQPage markup). `--external` also requests every outside link (not run
  here: the sandbox cannot reach most of those hosts). Reads `/data/guides.json`, so it runs
  against the live site too. Self-tested: changing `JOINT_MIN_VALUE` or
  `CONGRESS_DEADLINE_DAYS` flags the right guides; a CRLF copy of a covered file does not.
- **SEO / answer-engine structure of every guide:** two-sentence answer block first; "In brief"
  facts; question headings whose first sentence answers them; tables for codes and ranges; the
  guide's own Q&A; "See it on this site" links; related guides; primary sources; Article +
  FAQPage JSON-LD (FAQPage also on `/faq/`; the section blocks carry none, on purpose).
  Titles ≤ 60 and descriptions ≤ 155 characters via `fitTitle` / `fitDescription`.
- **Facts were checked on 2026-10-08** by two research sweeps against primary sources, with a
  lead re-check of three (House roll call 280, Senate vote 253, FEC limits). Things worth
  knowing: no trading ban is law — H.R. 7008 passed the House 232–198 on 2026-07-22 and failed
  cloture 53–47 on 2026-09-30; insiders of foreign private issuers file Section 16 reports
  since 2026-03-18; `lda.senate.gov` now redirects to `lda.gov` (the ingest already uses `lda.gov`; the
  site's source link was updated to match). Not confirmed
  against a primary page: TreasuryDirect (blocks automated readers) — the I-Bond formula and
  rules are stated from the regulation and the rate comes from our own database.
- **Editorial rules for guides:** state what a filing shows, never why someone traded; no
  advice; on contested questions (a trading ban, 10b5-1 plans) give each side's case as its
  supporters make it; every outside claim has a primary source in `sources`.
- Verified on the local build only: `astro check` 0 errors, 254 pages / 287 files in the seed
  build (+22 pages), `verify-guides` clean, `verify-live --all`, `verify-a11y` (24 pages ×
  4, now including four guide pages), `verify-share` 222/222, `verify-filters`, 37 unit tests.

### Citation and source features (2026-10-08) — Peter: "Citation and source features now"

Peter's choices: all four features; formats plain + APA, MLA, Chicago; the data licence label
points to the Terms page instead of Creative Commons.

- **Cite.** `web/src/lib/cite.ts` (`citation(style, input)` → text + HTML with italics; tests
  `npx tsx --test scripts/cite.test.ts`, 8). The share dialog has a "Cite" block: style switch,
  the citation, "Copy citation" (copies rich text so italics survive in a word processor).
  Every answer block has a **Cite** button beside Share (`data-share-focus="cite"` opens the
  dialog at the citation, headed "Cite this page"). Charts and trades get the same block
  through their Share buttons. A citation gives the page's last-updated date
  (`data-updated` on the answer block; a trade uses its disclosure date) and today as the
  access date. **A trade's citation also names the original filing** with the row's source link.
- **Sources panel.** `SourcePanel.astro` under "Sources and method" on member, insider, stock
  and company pages: per official source, filings and rows on record, first and newest filing
  date (newest linked), and a link to the originals (EDGAR Form 4 list by CIK or ticker; House
  Clerk and Senate eFD search pages, which have no per-member address). Company pages add
  contracts and lobbying counts. It counts everything on record, not only the rows displayed.
- **Guide.** `/guides/how-to-cite-and-reuse/` (20th guide; footer link "How to cite"; linked
  from Terms). Its example table is produced by `cite.ts`, so it cannot show a format the menu
  does not produce.
- **For search and answer engines.** Every page: `citation_title` / `citation_author` /
  `citation_publication_date` / `citation_public_url`, `dcterms.*`, `article:modified_time`,
  `<link rel="license">`. `BaseLayout` takes an optional `modified` date (guides, privacy, terms
  and about pass theirs; data pages use the build date). Dataset JSON-LD gained `usageInfo`,
  `creditText` and `citation`. `llms.txt` states how to attribute.
- **Licence label changed:** Dataset JSON-LD said CC BY 4.0, which the Terms do not grant.
  It now points to `/terms/#reuse`. Not legal advice; for the lawyer's read with the Terms.
- Stale wording fixed on the way: member and stock pages said Senate reports appear "when
  that feed is live".
- The guide check did its job twice in this change: five guides flagged STALE (TxnTable,
  share.ts, terms.astro), each re-read; the trade-map guide gained a sentence about citing.
- `verify-share` now also checks the Cite button, all four formats, the copied citation, the
  original filing in a trade citation, and the sources panel (250 checks).
- Not done: archived copies of filings are not offered (the `raw-filings` bucket is private,
  and Senate reports carry use limits); no BibTeX/RIS; citations for the trade map view use the
  page title, not the filter state.
- Verified on the local build only: `astro check` 0 errors, `verify-guides` (20 guides),
  `verify-share` 250/250, `verify-live --all`, `verify-a11y`, `verify-filters`, 45 unit tests.

### Better politician profile pages (2026-10-08) — Peter: "Better politician profile pages now"

Peter said to go ahead without the usual questions; the choices below are mine and can be changed.

- **Member page rebuilt** (`web/src/pages/congress/[slug].astro`). Order: header facts (chamber,
  seat with the state spelled out, party, current term or "Left office", committee count, latest
  trade) → answer → jump links → figure strip (now also Purchases, Sales, Stocks traded) →
  Most-traded stocks → charts → Year by year / whose trades → How this record compares →
  Committee assignments → Disclosed trades → Filings → Related members → Questions → Sources.
  Members with no trades keep the header, committees and empty states and stay `noindex`.
- **Figures live in `web/src/lib/profile.ts`** (pure, tested in `scripts/profile.test.ts`, 5 tests):
  `memberProfile`, `peerStats` (members with ≥1 trade; medians; rank by trade count),
  `sameState`, `sameStocks`, `seatGroups`, `memberQa`, `stateName`, `seatName`, `partyName`.
  Every number is a count, a date or a sum of ranges as filed. No prices, no returns.
- **Committee assignments are new data.** Migration `0015_congress_committees.sql`
  (`congress_committees`, `congress_committee_members`; RLS on, no public policy). The
  `congress_roster` job now also reads `committees-current.json` and
  `committee-membership-current.json` from the same congress-legislators project (two more
  requests a day) and replaces the stored set in one transaction. A membership file with fewer
  than 500 seats is treated as broken and ignored; a failure in the committee pass never fails
  the roster (`stats.committees_error`). Env overrides: `CONGRESS_COMMITTEES_URL`,
  `CONGRESS_MEMBERSHIP_URL`. Until the job has run once after the migration, pages simply have
  no committee section. `flagship.ts` gained `Seat`, `model.seats`, and `Role.validFrom/validTo`.
- **Wording rules kept:** committees are "listed for context only"; the "Also on record" column
  (company has lobbying reports or federal contracts on its own page) says it describes the
  company, not the member; the questions never give a reason for a trade (tested). No photos.
- **Per-member questions** carry FAQPage data; Person data gained `identifier` (Bioguide),
  `affiliation` and `memberOf`.
- **Guides:** new section "What does a member's page on this site show?" in
  `how-to-read-a-congressional-trade-report`, which now covers `profile.ts` and the page file.
  Methodology has a "Member pages" paragraph (`#member-pages`); About names committee data.
- **New verifier:** `node scripts/verify-profile.mjs <base-url> [--sample N]` — on a sample of
  member pages checks that totals, year rows, owner rows, stock rows, the trade table, the
  questions and the structured data all agree, and that nothing runs off the side at 390 and
  1100px. Run it with the other verifiers after any change to the member page or `profile.ts`.
- **Header fix found on the way:** between 1024 and 1199px the six header links ran 32px past
  the edge on every page (since "Guides" joined the nav). Tightened in `global.css`.
- Stale sentence fixed: the empty-state answer for senators no longer says Senate filings are
  not ingested.
- Not done: committee pages (members of one committee and their trades); matching trades to
  committee remit (deliberately not attempted); donations to a member's campaign committee
  (committees are not linked to people in the database); former members have no committee
  history (the source lists current seats only); insider profile pages are unchanged.
- Verified on the local build only (real roster and committee files, synthetic trades):
  `astro check` 0 errors, `verify-profile` 755 checks on 25 members, `verify-guides` (20 guides),
  `verify-live --all`, `verify-a11y` 96 checks, `verify-share` 250, `verify-filters`, 66 unit
  tests. The committee job ran locally against the real files: 230 committees, 3,895 seats,
  531 members, none unmatched. Not verified: the job on GitHub Actions, live data.

### Free CSV downloads (2026-10-09) — Peter: "now Free CSV downloads"

No questions were asked (Peter: "just do it"); the choices below are mine and can be changed.

- **Hub at `/downloads/`** (footer link "Downloads", in the sitemap, search and `llms.txt`): every
  site-wide file with rows, size and newest date; how to get one member's or one ticker's file;
  a column dictionary; format notes; reuse limits (5 U.S.C. § 13107(c) for congressional rows).
- **Files** (all static, built with the site, no sign-up, nothing recorded):
  `congress-trades.csv`, `congress-members.csv`, `congress-committee-assignments.csv`,
  `insider-trades-latest.csv` (90 days) and `insider-trades-<period>.csv`,
  `lobbying-<period>.csv`, `federal-contracts.csv`, `treasury-yields.csv`,
  `tips-real-yields.csv`, `i-bond-rates.csv`, `cpi-u.csv`; plus
  `/downloads/congress/<slug>.csv` per member with trades and `/downloads/stocks/<ticker>.csv`
  per ticker with trades (same rows as the stock page, sibling securities included).
- **One catalogue:** `web/src/lib/downloads.ts` (`getDownloads()` → `files`, `member`, `stock`)
  feeds the hub, the endpoints (`pages/downloads/[file].csv.ts`, `congress/[slug].csv.ts`,
  `stocks/[ticker].csv.ts`), the `DownloadCsv.astro` link and Dataset `distribution` markup
  (`datasetLd({ downloads })`). A file with no rows is not built and not linked.
- **Writer:** `web/src/lib/csv.ts` — RFC 4180, CRLF, UTF-8 BOM (Excel), and a leading
  apostrophe on any text cell that starts with `= + - @` so a name from a filing can never run
  as a formula. Numbers plain, dates `YYYY-MM-DD`, `true`/`false`, blank for missing.
- **Size and count limits:** big sets are cut by quarter of disclosure, an over-size quarter by
  month, an over-size month into parts (`MAX_ROWS` 50,000 ≈ 15 MB; Cloudflare's limit is
  25 MiB a file). No file per corporate insider: that would add thousands of files against the
  20,000-file cap. Insider pages link to the file of the ticker they file most for. Expect
  roughly 1,100 new files on live data (about 900 tickers, 135 members, 40 site-wide).
- **Deliberately not offered:** campaign donations (the site holds a recent sample, not totals,
  and FEC sale-and-use limits cover donor details), market prices, anything not on a page.
  Rows flagged "under review" are included with `under_review = true`, as on the pages.
- **Download links** sit above the table on: member pages, stock pages, company pages (ticker
  file), insider pages (ticker file), `/congress/`, `/insiders/`, `/lobbying/`, `/contracts/`,
  and the three rates pages.
- **Words changed elsewhere:** Terms (`#reuse`, date 2026-10-09) and Privacy (new "Downloads"
  sentence, date 2026-10-09); Methodology `#downloads`; guide `how-to-cite-and-reuse` — the
  "bulk data" section is now "Can I download the data?", two new FAQs, new covers and labels.
- **New verifier:** `node scripts/verify-downloads.mjs <base-url> [--sample N]` (no browser):
  every listed file downloads, parses, has the stated row count and stays under 20 MB; trade
  files share one header and are well-formed; member and ticker files match their pages;
  totals agree with `congress-members.csv` and `/llms.txt`; pages that should link do; no
  donor or contact columns; no formula cells. Tests: `scripts/csv.test.ts`,
  `scripts/downloads.test.ts`.
- Also fixed: the comparison table said "41th" (live on Lloyd Doggett's page); `ordinal()` in
  `profile.ts`. `seo.ts` reads `import.meta.env?.` so the libraries load in unit tests.
  `verify-a11y` now includes `/downloads/` (25 pages).
- Live check of the member pages (`020368c`, 2026-10-09): header facts, jump links, stocks,
  by-year, owners, comparison (135 members), related members, 4 questions with matching FAQ
  data all present on `/congress/lloyd-doggett/`. Committees not yet shown: the roster job had
  not run since the migration.
- Not done: no JSON or Excel versions; no per-insider files; no "download this filtered map
  view"; no `X-Robots-Tag` on the files (the `_headers` pattern for `*.csv` is unconfirmed on
  Cloudflare, so it was left out rather than guessed).
- Verified on the local build only: `astro check` 0 errors, `verify-downloads` 1,261 checks,
  `verify-guides` (20 guides, 9 re-read and accepted), `verify-live --all`, `verify-profile`
  755, `verify-a11y` 100, `verify-share` 250, `verify-filters`, 74 unit tests.

### Stock, company and insider page layout; automatic internal linking (2026-10-09) — Peter: "next Stock, company and insider pages layout polish and Automatic internal linking enhancements"

These are items 2 and 3 of the suggestions list (Peter pasted the full list on 2026-10-09; the
numbering is: 1 politician pages, 2 stock/company/insider pages, 3 automatic internal linking,
4 accounts/follow/watchlists, 5 email signup on pages, 6 sharing, 7 FAQ and guides, 8 citation,
9 CSV downloads, then the unnumbered "Legal, Privacy & Website Trust" block). No questions asked.

- **One layout for every entity page**, matching the member page: header facts (`dl.facts`),
  answer, jump links, figures, charts, "who" tables, the transaction tables, related pages,
  "Guides for this page", sources.
  - Stock: facts (company, security type, size band, counts, latest trade); **Insiders trading
    X** and **Members of Congress trading X** tables (linked names, rows, open-market buys and
    sales, values or ranges, latest date); a folded table of rows by Form 4 code; **Related
    stocks**. The old "Who is filing" bullet list is gone.
  - Company: facts incl. EDGAR link and matched contract/lobbying counts; richer Insiders table;
    **Members of Congress who traded <ticker>** (the page computed these rows before and never
    showed them); issue names instead of codes in the lobbying table; **Related companies**.
  - Insider: facts; **What kind of transactions** (by code) beside rows by year; **Other
    insiders at <company>**.
- **Figures in `web/src/lib/entity.ts`** (pure; tests in `scripts/entity.test.ts`): `codeRows`,
  `yearRows`, `insiderRows`, `memberRows`, `relatedTickers`, `relatedCompanies`, `colleagues`,
  `sizeOf` (cached), `tickerPages`, `CODE_LABEL`. "Bought" for Form 4 means code P only.
  "Related" = filers in common, stated on the page as overlap in public filings and nothing else.
  There is no sector data (companies.sector is empty), so nothing is related by industry.
- **Automatic links in `web/src/lib/links.ts`:**
  - `orgPath` links a lobbying client, registrant or contract recipient to a company page on an
    exact normalised-name match, never when two companies share the name. Now used in the
    newest-filings and largest-awards tables and on company pages.
  - `flagHref`: flags in every trade table ("late", "10b5-1 plan", "derivative", "also in
    another filing", spouse/joint/child) are links to the guide that explains them.
  - `autolink` + `GLOSSARY`: in guides, the first mention of a term another guide explains
    becomes a link (max two per section, one per target per page, never to itself, never inside
    an existing link, heading, code or table, never where the guide already links by hand).
    Marked `data-auto`. A test checks every glossary and flag target is a real guide.
  - `LearnMore.astro`: "Guides for this page" on stock, company and insider pages; titles come
    from the guides data.
- **New verifier:** `node scripts/verify-links.mjs <base-url> [--sample N]` (no browser):
  broken internal links and anchors, orphans, click depth from home (full crawl only), entity
  pages missing facts / guide links / jump targets, automatic-link rules, flag links.
  Local full crawl: 5,232 checks, no orphans, deepest page 3 clicks from home. Against the live
  site use `--sample` (a full crawl is ~17,000 requests).
- **Downloads follow-up from the live check of `e305810`:** all 76 files matched their stated
  row counts, the largest was 14.9 MB (insider 2026 Q1, 44,499 rows), but about 60 of them were
  old quarters with a handful of rows. `mergeOldSmall` now folds the run of small old quarters
  into one `insider-trades-before-<period>.csv`.
- Guides: `what-is-form-4` gained the description of the three page types (now covers
  `entity.ts`, `links.ts` and the three page files); methodology `#related-pages`.
- Not done from list items 1–3: profile photos (no licensed source; About says none are used),
  holdings (annual disclosures are not ingested), performance statistics (no price data
  licensed for display). Committees on member pages still wait on the first roster run.
- Verified on the local build only: `astro check` 0 errors, `verify-links` 5,232,
  `verify-guides` (20 guides, 7 re-read and accepted), `verify-downloads` 1,261,
  `verify-live --all`, `verify-profile` 755, `verify-a11y` 100, `verify-share` 250,
  `verify-filters`, 83 unit tests.

### Live check of `6c2f546` and a title repair (2026-10-09)

- `6c2f546` (stock/company/insider layout, automatic linking) is live. Checked on
  `/stocks/nvda/`, `/companies/nvidia-corp/`, `/insiders/huang-jen-hsun/`: header facts, working
  jump links, insider and member tables, related lists, "Guides for this page", flags linked
  (no unlinked "late" flags). Downloads hub now lists 26 files; the old small quarters are one
  `insider-trades-before-2025-q4.csv`. Committees still absent on member pages (roster job has
  not run since migration 0015).
- **Found live:** officer titles showed XML escapes as text ("EVP &amp; Chief Financial
  Officer" on `/insiders/kress-colette/` and wherever a role is printed). Old data: migration
  0008 repaired names, not titles. Fix: migration `0016_decode_xml_entities_in_titles.sql`
  (idempotent) plus `decodeEntities()` in `flagship.ts` applied to every officer title at build
  time, so the pages are right as soon as the deploy finishes whichever runs first.

### Trade map opens on a scatter chart; heatmap behind a switch (2026-10-09) — Peter, with a sketch

Peter's instructions: the main chart on the main pages defaults to the scatter in his sketch;
a switch **under the chart**, with a scatter icon on one side and a tile ("quadrant") icon on
the other, changes it to the heatmap; dots green for mostly buying, red for mostly selling,
red–yellow–green in between; default view Buying showing the right half, Net showing four
quadrants, Selling the left half; dots labelled with tickers; the small scatter stays at the
foot of those pages and a small heatmap joins it.

- **One component, two drawings.** `Heatmap.astro` + `scripts/heatmap.ts` still own the
  filters, summary, side list and URL hash. `state.chart` is `scatter` or `map`; the scatter is
  drawn by `web/src/scripts/scatter.ts` (pure: points in, SVG string out; tests in
  `scripts/scatter.test.ts`). Full-size maps open on `scatter` + view `buy`
  (`data-chart`, `data-view` on the root); `compact` maps open on `map` + `net`.
- **What a dot is.** Across = the page's own group (insiders on `/` and `/insiders/`, Congress
  on `/congress/`; on the combined map, whichever group the filters single out — `xClass()`):
  dollars bought (Buying, right half), dollars sold (Selling, left half), bought minus sold
  (Net, four quadrants). Up and down = the other group's buying minus selling. Size = dollars.
  Colour = share of all those dollars that were purchases, five stops red → orange → yellow →
  lime → green (`shareColor`). Signed log scales with a $10,000 dead zone; decade gridlines.
  The dot set is exactly the heatmap's tile set (`aggregate(filtered())`), so the summary's
  "Tickers" always equals the number of dots.
- **Labels:** biggest dots first, each in the first free spot beside its dot; never over a dot,
  another label or a corner caption; at most 90 (28 on a phone). Every dot links to the stock
  page, has an `aria-label`, and shows a tooltip with both groups' bought / sold / net.
- **The other group's numbers.** Home page: from the loaded rows, each group under its own
  filters. One-group pages: `/data/trade-cross.json` (`web/src/lib/trade-cross.ts`), per ticker
  and window, Congress = all members, insiders = open-market non-plan trades, windows counted
  back from the build date. Fetched the first time the scatter draws (`root.dataset.cross`).
  The line under the chart says which rule applies.
- **Switch.** `.hm-chart-switch` sits inside `.hm-mapcol`, directly under the chart on every
  screen size: icon · `role="switch"` button · icon (the icons are click targets, hidden from
  assistive tech; the switch carries the label). Reset clears filters, not the chart.
- **Links.** New links always carry `chart=`. A hash with filters but no `chart` key was
  shared before this change and opens the heatmap in the Net view, as it did then.
- **Small charts.** `MiniCharts.astro` ("More views") near the foot of `/`, `/congress/`,
  `/insiders/`: the small static Congress-vs-insiders scatter (already on the home page among
  its charts, so not repeated there) and a compact heatmap (window and view controls only).
- View buttons are now ordered Buying · Net · Selling. Section heading and chip on
  `/congress/` and `/insiders/` read "Trade map" (anchor still `#heatmap`). Home title unchanged.
- `verify-filters` runs its whole suite on whichever chart a page opens on, requires one dot per
  ticker and at least one label, then tests the switch, the hash, Reset and an old-style link.
- Guide `how-to-use-the-trade-map` rewritten for the scatter (new section `#heatmap`).
- Peter's sketch shows many dots on the centre line; that is real — most stocks are traded by
  one group only, so the other group's value is zero.
- Not done: no saved image of the scatter from "Share this view" (the map share is a link);
  the cross file ignores a one-group page's filters by design; labels are not user-toggleable.
- Verified on the local build only: `astro check` 0 errors, `verify-filters` 430 states / 0
  mismatches, `verify-a11y` 100, `verify-guides`, `verify-live --all`, `verify-links`,
  `verify-share` 250, 90 unit tests; a 1,200-dot render takes 28 ms and yields a 217 KB SVG.

### Small heatmap moved beside Leaderboards on the home page (2026-10-09)

- Live check of `5a8f97d`: scatter is the default on `/` (107 dots at 30 days, Buying) and
  `/congress/` (74); the switch, Reset, the hash and the small charts all behave as built.
  Read from the page's DOM — screenshots of the live site timed out, so the look with real
  data has not been seen by Claude.
- Peter: "Trade heatmap should not be under More Views, it should be to the right of
  Leaderboards." The small heatmap card is now its own component (`MiniHeatmap.astro`), placed
  after the Leaderboards card in `VizHome.astro`'s grid (right-hand column on desktop, below it
  on a phone). The home page no longer has a "More views" section. `/congress/` and
  `/insiders/` have no leaderboards and keep "More views" (small scatter + small heatmap).

### Trade map default is 90 days, Net view (2026-10-09) — Peter, with a screenshot of the filter bar

- Peter: "now that I look at it, make this the default view" — All insiders, every filter at its
  first option, Open-market, No 10b5-1 plans, **90D**, **Net**. Every map now opens that way
  (the three full-size maps and the small heatmaps); it was 30D, and Buying on the scatter.
  `Heatmap.astro` props `win` (default 90) and `view` (default `net`) → `data-window`,
  `data-view`; `heatmap.ts` reads both into `DEFAULTS`, so Reset returns to 90D / Net.
- **Shared links keep their meaning.** A link written from now on always carries `chart`, `w`
  and `view`. A link without `w` is older and means 30 days; without `view` it means Net (no
  `chart` key, before the scatter) or Buying (with one, shared on 2026-10-09).
- Fixed on the way: any hash at all was read as a saved view, so `/congress/#heatmap` (a jump
  link) opened the heatmap in place of the scatter. Only a hash with one of the map's own keys
  counts now.
- `verify-filters` checks what each page opens on, the jump link, three generations of old
  link, and that a written link states chart, window and view. Guide
  `how-to-use-the-trade-map` reworded (opens on 90 days / Net).
- Not changed: the answer blocks and figure strips above the maps still talk about the last 30
  days (they are separate counts, not the map's window).
- Verified on the local build only: `astro check` 0 errors, `verify-filters` 448 states + link
  checks / 0 mismatches, `verify-guides`, `verify-live --all`, `verify-a11y` 100, 90 unit tests.

### Google Analytics 4 (2026-10-10) — Peter: "set up a GA4 property for this site"

Peter's choices: its own GA account (not under pfouge.com or a client account); consent mode by
region; keep Cloudflare Web Analytics alongside.

- **GA setup (done in Chrome; Peter created the account and accepted Google's terms himself):**
  account `spotthemoney.com` (411497541), property `spotthemoney.com` (558401102), web stream
  `https://spotthemoney.com` (16103187243), **measurement ID `G-Y9940NMJKF`**. Account
  data-sharing boxes all off. Time zone New York (Eastern), USD, industry Finance. Event and
  user data retention 14 months. Google signals off; user-provided data off.
  Enhanced measurement: page views (history-change page views OFF) and scrolls only — outbound
  clicks, site search, forms, video and file downloads OFF.
- **Why those switches are off — keep them off:** outbound clicks would record share links
  (privacy page: "we do not record what you share"); file downloads would log CSV downloads per
  visitor; history-change page views would count every trade-map filter change (it rewrites
  the URL hash) as a page view.
- **Code:** `web/src/components/Analytics.astro` (in `BaseLayout`; not in `EmbedLayout`, so
  embeds carry no analytics). Consent defaults: EEA + UK + CH → `analytics_storage` denied
  (cookieless pings, no banner); elsewhere granted unless the browser sends Global Privacy
  Control; all ad consent types denied everywhere. Config: signals and ad personalisation off,
  `cookie_expires` 13 months. `PUBLIC_GA_MEASUREMENT_ID` overrides the ID; empty turns GA off.
- **Privacy page rewritten** (`POLICY_UPDATED` 2026-10-10): what GA records, the two `_ga`
  cookies and their lifetime, the region rule, GPC honoured, 14-month retention, Google as
  processor, opt-out add-on. About credits list both analytics tools.
  **Before ads go on:** a Google consent message must grant ad consent in the EEA/UK/CH, and
  the privacy page must say so first. Nothing on the site asks for consent today.
- `verify-share` map check now uses a 30-day window (90 is the default since 2026-10-09, so it
  never appears in a link).
- Verified on the local build: `astro check` 0 errors, `verify-guides`, `verify-live --all`,
  `verify-share` 250/250, `verify-a11y` 100, `verify-filters` 0 mismatches; in Chromium the page
  queues the region default, then `granted` (or `denied` with GPC), then config with the ID;
  embeds load no Google script. GA receiving hits is checked on the live site after the push.

### Accounts and watchlists with WorkOS (2026-10-10) — Peter: "start item 4 (watchlists and alerts) on spotthemoney with WorkOS"

Peter's choices: one WorkOS team (`pfouge.com`) for all his sites, one project per site
(`spotthemoney`); sign-in by emailed code plus Google, Microsoft and GitHub (no Apple); alerts
on the site now, email alerts with item 5; lists private until shared with a link.

- **WorkOS (set up in Chrome; Peter created the team and added billing himself):** project
  `spotthemoney`, Production environment `environment_01M4KVTRT7PSY6KV0GBQ3ZQQQ0`, application
  `spotthemoney.com`, **client ID `client_01M4KVTS09DN5NFTRKV5GH7ZCG`** (public). Magic Auth on
  (email code). Redirect URI `https://spotthemoney.com/auth/callback`; initiate-login URI
  `/auth/login`; sign-out URI `https://spotthemoney.com/`. Sessions: 365-day max, 5-minute access
  token, **30-day inactivity** (was 2). JWT template `{"role": "authenticated"}` (Supabase needs
  it). Google, Microsoft and GitHub sign-in are enabled (see "Sign-in providers" below); each is an
  OAuth app at that company whose client ID + secret is pasted into WorkOS → Authentication →
  Providers (Peter pastes secrets).
- **Supabase:** Third-party auth → WorkOS, issuer
  `https://api.workos.com/user_management/client_01M4KVTS09DN5NFTRKV5GH7ZCG` (enabled). The Worker
  uses the publishable key `sb_publishable_…` (public by design; in `web/wrangler.jsonc` vars).
- **Database:** `db/migrations/0017_accounts_watchlists.sql` replaces the unused 0002 account
  tables (refuses if any has rows) with `accounts` (WorkOS user id, text), `watchlists`,
  `watchlist_items` (kind member/insider/stock/company + the page's slug or ticker). RLS keys on
  `app_user_id()` = `auth.jwt()->>'sub'`. All access goes through functions called by PostgREST
  as the visitor: `my_state`, `account_touch`, `follow`, `list_save`, `item_move`, `watch_feed`
  (+`watch_feed_rows`), `mark_feed_seen`, `list_copy`, `account_delete`; `public_watchlist` is
  the only definer-rights function and returns no account id or email. Limits: 20 lists, 500 items.
- **Worker routes (first on-demand routes on the site):** `/auth/login` (state cookie, canonical
  host), `/auth/callback`, `/auth/logout` (POST only), `/api/[action]` (me, feed, follow, list,
  move, copy, seen, delete-account, public). Code: `web/src/lib/account.ts` (pure),
  `web/src/lib/server/session.ts` (WorkOS SDK `@workos-inc/node` 10.14.0, sealed session cookie,
  refresh, `rpc()`). POSTs must carry the request's own Origin. Responses `private, no-store`.
- **Build output moved:** with on-demand routes the adapter writes `web/dist/server/wrangler.json`
  (Worker + assets) instead of `dist/client/wrangler.json`. `deploy.yml` must deploy whichever
  exists — new copy in `_workflows-2026-10-10/deploy.yml` (Peter copies it into
  `.github/workflows/`; the bridge cannot write there). Static pages are still served as assets
  without running the Worker. `postgres` must never be imported by an on-demand route, and an
  on-demand page may not use `BaseLayout` (its ticker tape reads the database) — the watchlist
  pages are static shells filled by `src/scripts/watchlist.ts`.
- **Pages:** `Follow.astro` beside the h1 on member, insider, stock and company pages; header
  bookmark link `#acctBtn` with a new-trades badge; `/watchlist/` and `/watchlist/shared/#<slug>`
  (noindex). Anonymous visitors never call the Worker: `src/scripts/account.ts` asks `/api/me`
  only when the readable `stm_signed_in` cookie exists. Master switch `ACCOUNTS_ENABLED` in
  `web/src/lib/account.ts` — **false in the first push** (secrets cannot be added to an
  assets-only Worker), flipped to true once `WORKOS_API_KEY` and `WORKOS_COOKIE_PASSWORD` are
  set as Worker secrets.
- **Words:** privacy page `#accounts` (what an account keeps, WorkOS, three cookies, session
  storage, shared lists, deletion, 7-day backups, no emails yet); Terms `#accounts` (date
  2026-10-10); About credits WorkOS; new guide `how-to-follow-members-insiders-and-stocks`;
  member and Form 4 guides mention the Follow button.
- **Verifiers:** `node scripts/verify-accounts-db.mjs <local-db>` (35 checks: anon refused,
  isolation between two users, sharing, copy, limits, unpublished rows never in the feed,
  delete); `node scripts/verify-accounts-e2e.mjs <local-db>` (36 checks: the real Worker under
  `wrangler dev --local-upstream` against `scripts/accounts-fakes.mjs` — fake WorkOS with RS256
  tokens and fake PostgREST over local Postgres — sign-in, follow-after-sign-in, cookies,
  badge, feed, share, copy, cross-user refusal, token refresh, sign-out, delete); unit tests
  `scripts/account.test.ts`. The e2e run is flaky in this sandbox (wrangler dev's proxy drops
  connections now and then; a stray workerd on port 8787 also caused false 403s) — it passed
  36/36 on clean runs, with `ACCOUNTS_ENABLED` true.
- **Second push (same day):** `ba374ba` deployed; Peter set `WORKOS_API_KEY` (Production key
  `spotthemoney-worker`) and `WORKOS_COOKIE_PASSWORD` as Worker secrets in the Cloudflare
  dashboard. Live checks before the flip: `/api/me` → `{signedIn:false, available:true}`,
  `/api/public` reaches Supabase with the publishable key, `/auth/login` redirects to WorkOS,
  signed-out POST → 401. `ACCOUNTS_ENABLED` then set to true.
- Verified locally: `astro check` 0 errors, the two account verifiers, `verify-guides` (21),
  `verify-live --all`, `verify-a11y` 104, `verify-share` 250, `verify-filters`, 96 unit tests.
- **Sign-in providers (later the same day):** GitHub (OAuth app "Spot the Money" under
  github.com/pfouge, client `Ov23liwLFLJbqNTZKX9Z`) and Google (Cloud project `spotthemoney-511223`
  in the pfouge.com organisation, owner peter@pfouge.com; consent screen External, **In
  production**, no logo so no Google review; client `881333258431-iseqkn648lf9hfmcnc5734rabfpn0mud`)
  are enabled in WorkOS Production. "Return OAuth tokens" stays OFF for every provider. Google's
  screen says "continue to workos.com" until a WorkOS custom auth domain exists. **Microsoft:** app
  "Spot the Money" in Peter's own free Entra directory "Default Directory" (peterpfouge.onmicrosoft.com,
  signed in as peter@pfouge.com; never register it in a work account's directory), any Entra tenant +
  personal Microsoft accounts, Web redirect = the WorkOS Microsoft callback, client
  `3120d97b-c8e2-4498-a455-62569d2f6f0c`. Its client secret "WorkOS" **expires 2028-10-09**: make a
  new one under Certificates & secrets and paste its *Value* (not the Secret ID) into WorkOS before
  then. A Google project made by mistake under pfouge@gmail.com (`spotthemoney-511222`) was shut down.
- **Sign-out bug fixed (same push):** WorkOS refresh tokens are single-use. The watchlist page
  asked `/api/me` twice at once (header script + page), both refreshed an expired 5-minute token,
  one failed, and the failure cleared the cookies. Now `loadMe()` shares an in-flight request and
  `getSession()` clears cookies only when the cookie itself is unreadable; `verify-accounts-e2e`
  checks both (40 checks). `/auth/callback` with no code and no state now says "Sign-in did not
  complete": in Peter's main Chrome profile AuthKit returns to the callback with nothing (seen
  in Worker logs; a clean browser works) — cause not found, likely that profile's WorkOS state.
- Cloudflare Workers observability (Logs) works on the free plan: dashboard → spotthemoney →
  Observability shows every Worker request with its full URL. Bots probe `/api/.env` etc. daily (404s).

### Watchlist cards (2026-10-10, evening) — Peter: "widgets next to each stock I follow, stacked"

Peter's choices: widgets for every kind of followed page; 3-month price charts; shared lists show
them too; and each stock's line lists the insiders (and members) who traded it in the window.

- **What a row shows** (`/watchlist/` and `/watchlist/shared/`): name | widget | details on one
  line (stacked under 900px). Stock or company: TradingView's free **Mini Chart**
  (`embed-widget-mini-symbol-overview.js`, `dateRange: "3M"`, `largeChartUrl` = our stock or
  company page) beside **Who traded it, last 90 days**: corporate insiders and members of Congress,
  five of each (bought / sold, or buys, sales and range sum; latest date), "N more on the page".
  Member or insider: bars of trades disclosed per month for 12 months (buys up, sales down; counts),
  latest trade, last-90-day totals, tickers traded. Members' seats are short ("Rep. D-AZ-4").
- **No price data passes through the site** (docs/04 #33 unchanged): the chart is TradingView's
  frame; only the slot is ours. Charted only for equity / ETF / ADR, the stock page's rule.
- **Data:** build-time `/data/watch/<kind>-<n>.json` (60 files: stock 16, company 8, member 4,
  insider 32 shards; `shardOf` = FNV-1a, in `web/src/lib/watchcards.ts`, which is pure and loaded
  by the browser). Built by `web/src/lib/watchcards-build.ts` from the same `insiderRows` /
  `memberRows` / labels the pages use, so cards cannot disagree with pages — only cover a shorter
  window (`WATCH_WINDOW_DAYS` = 90, by disclosure date, counted back from the build). One file per
  page was rejected: ~14,000 insider files against the 20,000-file limit.
- **Browser:** `web/src/scripts/watchcards.ts` (fetches only the shards a list needs, renders the
  cards), `scripts/dom.ts` (shared `h()`), `observeMini()` in `scripts/tradingview.ts` (lazy, one
  IntersectionObserver, rebuilt on theme change). No database or API change.
- **Words:** privacy page TradingView paragraph now names watchlists and shared lists (TradingView
  gets IP, browser and the ticker; never the account, email or lists). Guide
  `how-to-follow-members-insiders-and-stocks` describes the cards (window from `ctx.watchWindowDays`)
  and has a FAQ on where the charts come from.
- **Verifier:** `node scripts/verify-watchlist.mjs <base-url>` — reads the served card files, picks
  a stock, company, member and insider with trades, renders own list (desktop light, phone dark) and
  shared list with the account API answered in the browser; checks rows, chart slots, bars, counts
  vs the files, no overflow, no page errors, axe clean. Works against the live site. Unit tests:
  `npx tsx --test scripts/watchcards.test.ts` (4).
- Verified locally (synthetic data in `stm_acct`): `astro check` 0 errors, 84 unit tests,
  `verify-watchlist` all pass, `verify-guides` (21), `verify-live --all` (198 pages),
  `verify-accounts-e2e` 40/40 (one clean run after two flaky ones). TradingView is blocked in the
  sandbox; the mini chart itself was mounted on the live NVDA page in the browser pane before
  building and renders (price, change, 3-month line). Check a real watchlist after deploy.
- Not done: a window switch (30/90/365) on the cards; cards are as fresh as the last deploy, the
  trade list above them is live.
- **Live check of `754cc0f` (deploy #53):** 60 card files served (stock 1,218 / company 968 /
  member 542 / insider 12,771 cards; 8 MB in all, largest file 209 KB). Rendered on the live
  shared-list page in Chrome with a sample list fed in the browser: NVDA and AAPL mini charts load
  with real "who traded" lists, member (Alan Armstrong) and insider (Huang Jen Hsun) rows show bars,
  latest trade and totals; no sideways scroll. Note: the Claude desktop browser pane, when hidden,
  pauses IntersectionObserver, so charts there stay empty — check in Chrome or a visible pane.
  `verify-watchlist` now also requires the first chart to mount once on screen.

### Daily import failures fixed (2026-10-12) — Peter: "fix the setup first, then re-run"

Diagnosed from the Actions logs of runs 38152113545, 38294749376, 38312732656 (deploy check)
and 37957144123, 38063262128 (timeouts) before anything was changed.

- **Deploy check blocked by Cloudflare.** Since about 10:47 UTC on 2026-10-11 every request
  from a GitHub runner to spotthemoney.com gets a managed challenge ("Just a moment...",
  `cf-mitigated: challenge`). Cause: **Bot Fight Mode** on the zone (Free plan), almost certainly
  switched on in the security-settings session that morning; the toggle is not in the audit
  log. Bot Fight Mode cannot be skipped by WAF custom/skip rules or Page Rules (Cloudflare docs),
  so a secret-header skip rule would not work; the workers.dev URL would need workers.dev turned
  on for the Worker, which publishes a copy of the site outside Bot Fight Mode — **keep
  workers.dev off**. Chosen: a challenge is **inconclusive, never a failure**, and the proof of
  the deploy moved off the public website:
  `scripts/check-deployed-version.mjs` (the version `wrangler deploy` printed must serve 100% of
  traffic per `wrangler deployments status --json`), `scripts/verify-live.mjs` run against the
  build itself on the runner before deploying (`--fail-on-challenge`), then `scripts/probe-live.mjs`
  and `verify-live` against the live site, where a challenge is an Actions warning.
  Shared detector: `scripts/lib/cf-challenge.mjs`. Tests: `scripts/deploycheck.test.ts`.
- **Crawlers (read from Cloudflare's firewall events):** crawlers on Cloudflare's
  verified-bot list pass. **PerplexityBot and AzureAI-SearchBot
  are mostly challenged** — Peter's call whether to allow their published IP ranges with IP
  Access rules (the only thing that bypasses Bot Fight Mode on Free).
- **"money" group timeouts.** usaspending re-read 400 days every day (23–26 min) and FEC spent
  ~2.5 min a run retrying the same committees that answer 504, in series in one 55-minute job.
  Now: groups `lobbying-contracts` (senate_lda, usaspending) and `donations` (fec_committees,
  fec_schedule_a) run in parallel; usaspending does the newest 60 days daily and a full 400-day
  sweep when the last complete one is over 7 days old (`stats.mode`, `full_sweep_complete`),
  stopping at 35 minutes as "partial"; FEC's budget is 35 minutes, a request gets one retry, and
  a committee that answers 5xx is set aside for 3 days (`committees.donations_retry_after`,
  migration 0018) without moving its load-date floor. `politeFetch` gained a `retries` option.
- **Retry never ran after a timeout.** GitHub reports a job killed by `timeout-minutes` as
  "cancelled", and the retry only ran on "failure". It now runs on either (still not when a
  person cancels the run), per group, and passes `--skip-done-since=<migrate start>` so sources
  that already finished in this run are skipped. Test knob: dispatch `ingest` with
  `job_timeout_minutes` (default 55).
- **One upstream outage failed the whole run.** Rule in `scripts/lib/freshness-rule.mjs`
  (tests `scripts/freshness.test.ts`): a failed last run is **WARN** (Actions warning, run stays
  green) while a successful run happened within the allowance (`runDays × 24 h`, 48 h for daily
  sources); **FAILING** once that passes. STALE and NOT CONFIGURED unchanged.
- Verified locally: 89 unit tests, ingest `tsc`; migration 0018 twice; freshness check with
  faked runs (one-day failure → WARN and not counted, long failure → FAILING with last error);
  `--skip-done-since` skips and runs as expected; FEC set-aside and usaspending
  budget/full/recent against a fake API (`FEC_API_BASE`, `USASPENDING_API_BASE` — tests only);
  the build check under `python3 -m http.server` exactly as the workflow runs it (198 URLs).
  **The real proof is the Actions runs after the push** — see the next entry.

## Writing section (2026-11-01)

An articles section so an outside contributor can publish by adding one Markdown file and opening
a pull request. Built as a second content type beside the data-driven guides; nothing about the
guides changed.

- **Content.** `web/src/content.config.ts` defines two collections (Astro content layer, glob
  loader; `z` from `astro/zod`, `reference` from `astro:content`). `articles`:
  `web/src/content/articles/<slug>.md`, the file name is the URL slug (must match
  `^[a-z0-9]+(-[a-z0-9]+)*$`, otherwise the build throws a clear error). Fields: title (1–60),
  deck (70–155), published, updated?, author (reference to `authors`), tags (lowercase, default
  `[]`), original? (http/https URL), image? (path starting `/writing/`, file in
  `web/public/writing/<slug>/`), draft (default false). `authors`: `web/src/content/authors/<slug>.json`
  with name, bio (≤300), url, x, linkedin, github (handles or URLs). Both folders hold only a
  `.gitkeep`: **no sample article or author is committed**, and the build passes with none.
- **Data.** `web/src/lib/articles.ts`: `getArticles({ publicOnly? })` (newest first; excludes
  `draft: true` and `published` later than today UTC), `getAuthors`, `articlePath`, `authorPath`,
  `readingMinutes` (220 wpm, minimum 2). A missing author file fails the build with a message
  naming the article. **Scheduling:** a future-dated article goes live on its own at the first
  daily deploy on or after its date (ingest calls deploy every day); no second commit.
  `PUBLIC_SHOW_DRAFTS=1` (local preview only) also builds drafts and future-dated articles with a
  "Draft — not public" banner and noindex; sitemap, `llms.txt` and RSS always use `publicOnly`.
- **Pages.** `web/src/pages/writing/index.astro` (hub; empty state and noindex while nothing is
  published; CollectionPage + ItemList), `writing/[slug].astro` (article: byline, "Originally
  published at", hero image, body in `.prose.article-body`, tags, author box, More writing,
  disclaimer; Article JSON-LD with Person author, `isBasedOn`/`sameAs` when `original` is set),
  `writing/authors/[slug].astro` (Person JSON-LD; noindex when the author has no published
  article), `writing/rss.xml.ts` (hand-written RSS 2.0, newest 50). CSS at the end of
  `web/src/styles/writing.css` ("Writing section"), reusing `.guide-cards`, `.prose`, `.chip`, `.tag`.
- **Layout.** `BaseLayout.astro` gained optional `author`, `canonical`, `ogImage`, `ogType`,
  `published` props and a `head` slot (used for the RSS `<link rel="alternate">`); a page that
  passes none renders as before. An article with `original` set passes it as `canonical`. The
  footer links "Writing" next to "Guides" (the header nav is unchanged); the footer link is always
  present, even before the first article, and leads to the noindex empty hub.
- **Sitemap and llms.txt.** `lib/sitemap.ts` adds `/writing/` (only with ≥1 published article),
  each published article (lastmod = updated ?? published) and each author with ≥1 published
  article, all in the `pages` child sitemap. `llms.txt` gets a `## Writing` section (title link:
  deck) only when there is at least one.
- **Checker.** `scripts/check-articles.mjs`, run as `npm run check:articles` (root `package.json`).
  Plain Node, tiny front-matter parser, no dependencies. Checks every article and author file
  against the schema above plus: author file exists and parses, `updated` ≥ `published`, image
  file exists, links in the body to `/writing/<slug>/`, `/writing/authors/<slug>/` and files under
  `/writing/` resolve. One line per file, WARN for a future `published` date, exit 1 on any error.
  CI (`ci.yml`) does not run it; the build enforces the schema anyway.
- **Contributor guide.** `PUBLISHING-ARTICLES.md` at the repo root (not `docs/`: `/docs/` is
  gitignored here because it is the private nested docs repo). Branch `article/<slug>`, one article
  per pull request, open as draft against `main`; Peter merges and the next deploy publishes.

Live 2026-11-01 as 1de5782 (deploy 41363903954 green; /writing/ empty state, noindex, rss.xml 200, footer link checked in Chrome).

QA copy for article pull requests (2026-11-01): `.github/workflows/qa.yml` ("qa") runs on every pull request to `main` that touches `web/src/content/**` (same-repo branches only; `workflow_dispatch` with `pr_number` re-runs one). It builds the merge of the PR like `deploy.yml` (no migrations) with `PUBLIC_SHOW_DRAFTS=1`, rewrites the generated `wrangler.json` to Worker `spotthemoney-qa` on the custom domain `qa.spotthemoney.com`, adds `X-Robots-Tag: noindex, nofollow` to `_headers` and a disallow-all `robots.txt`, deploys, and keeps one comment (`<!-- stm-qa -->`) on the PR with a QA link per changed article. Concurrency group `qa`, so the last PR built is what QA shows. Production Worker, routes and `deploy.yml` are untouched. Documented for contributors in `PUBLISHING-ARTICLES.md` ("QA").

Pending articles in one QA, one-click publish (2026-11-01): `qa.yml` now builds main plus EVERY open article pull request (same-repo branches, drafts included), not just the latest. `scripts/pending-articles.sh qa|publish` lists the open PRs against main and copies ONLY files under `web/src/content/articles/`, `web/src/content/authors/` and `web/public/writing/` from each PR head over main (never code, workflows or packages; symlinks skipped; oldest PR first, newer wins on the same file). qa.yml triggers: PR opened/synchronize/reopened/ready_for_review/closed, push to main and `workflow_dispatch`, all on the content paths; concurrency group `qa` cancels older runs, so the newest run is the whole picture. `https://qa.spotthemoney.com/writing/` lists every article not live yet, and each included PR keeps its `<!-- stm-qa -->` comment (article links, main + PR head commit, "QA copy only, not indexed.", how to publish). A failed build comments on the PR that triggered the run. New `.github/workflows/publish.yml` ("publish", `workflow_dispatch` only, input `dry_run`): job `merge` qualifies only PRs whose every changed file is an article, author or image file (others are listed as skipped, never merged), builds the combined tree, runs `npm run check:articles` and a full build (any failure: nothing is merged), then marks drafts ready and squash-merges oldest first with `--delete-branch`, and writes a job summary (merged, skipped with reasons, merged articles still `draft: true` or future-dated); job `deploy` calls `deploy.yml` with the three secrets passed explicitly (merges by the workflow token do not trigger the push workflows); job `qa` runs `gh workflow run qa.yml` for the same reason. Contributor view in `PUBLISHING-ARTICLES.md` ("QA", "Publishing").

## SESSION STATE 2026-11-15 — parity project starts shipping

Peter's brief: bring the site to feature parity with every comparable tracker, then past it; Claude
makes the decisions and ships on its own (merges, deploys, tested migrations); the homepage redesign
is decided with Peter by Q&A. **The plan, decisions, queue and change notes live in the claude.ai
Project "spotthemoney.com"**: `claude/parity-state.md` (resume from here), `claude/parity-changelog.md`,
`claude/parity-phase3-gaps.md` (41-row gap list and build order), phase 1 and 2 docs. Spreadsheets are
in Peter's folder under `Claude outputs/parity/`.

Shipped today (details in the changelog):
- PR #4 `3206bb6` — `senate_lda` daily pass pages until it reaches stored filings or `LDA_MAX_MINUTES`
  (15); an unfinished run is `partial` with `gap_possible` and the next run closes the gap. Cause:
  the 1,500-a-run cap dropped ~14,000 filings around the 20 October deadline (69,404 held vs 83,547
  at the source); history pass re-run to backfill. Trade dates later than the filing date are stored
  as NULL at ingest (`stats.future_dates_nulled`).
- PR #5 `37a7131` — sortable trade tables (`lib/tablesort.ts`, `scripts/tablesort.ts`, `TxnTable.astro`).
- PR #6 `1d824a7` — "Held after" and "Change" columns on insider rows (`lib/holdings.ts`), CSV columns
  `shares_owned_after`, `holdings_change_pct`, methodology `#holdings`.
- This PR — guides brought back in step; `verify-downloads` now matches under-review rows
  (`<tr class="review" id="t…">`); `scripts/seed-local.sql` ends with `select publish_approved_filings();`
  so the seeded site has published rows like production. With that, every verifier is green on the
  local seed build.

Working notes for the next lead:
- From a cloud sandbox: `gh run list` and `gh api` (REST) work; GraphQL-backed `gh` commands do not.
  Dispatch with `gh api -X POST repos/pfouge/spotthemoney/actions/workflows/<file>/dispatches`.
- The PR `build` check finishes in ~25 s and is not a data build; the gate is the local build, unit
  tests and verifiers, then `deploy.yml`.
- Local environment: Postgres 16 on a spare port, all migrations, `scripts/seed-local.sql` (needs an
  `auth.jwt()` stub for 0017), build, serve `web/dist/client`, run the verifiers with system Chrome
  through a no-sandbox wrapper when Playwright cannot download its own browser.
- `facts.ts` `tradingBan` is due for re-check by 2026-11-20.
- Next in the queue: market-wide Form 4 from the SEC bulk Insider Transactions Data Sets (free
  Workers plan only — limit which insiders get a page), then the homepage notable-trades feed.

### AdSense readiness and Modern Web Guidance pass (2026-11-15) — Peter's brief

**Superseded the same day, see "PRs #11 to #13" below: the account now exists** (publisher ID
pub-9671575911691889, owner Google account is Peter's Gmail one, not peter@pfouge.com). Publisher
ID pub-7904173988271272 belongs to the goldprice.org network: never put it on this site.

- **One switch:** `web/src/lib/ads.ts` `ADSENSE_CLIENT` (empty today, so no ad code renders
  anywhere). Filled with `ca-pub-` + 16 digits, production builds render the
  `google-adsense-account` meta tag and the AdSense script in the head (BaseLayout) and the
  in-page `AdSlot` units. Add `web/public/ads.txt` in the same commit as the ID, not before.
  `PUBLIC_AD_CLIENT` is no longer read.
- **No tag on pages without content:** BaseLayout `ads={false}` (privacy, terms, contact, 404,
  watchlist pages); any `noindex` page; `AdSlot show={false}` on profiles with no records;
  embeds use EmbedLayout, which has none. Checked by building with a dummy ID: 66 pages with the
  tag, 19 without.
- **Consent:** `Analytics.astro` queues Consent Mode v2 defaults before any Google tag; the
  region default now carries `wait_for_update: 500`. Before the first ad is served, turn on
  Google's consent message for the EEA, UK and Switzerland in AdSense (Privacy & messaging):
  the privacy page (dated 2026-11-15) says those visitors are asked first.
- **No CSP exists** in `_headers` or `middleware.ts`, so nothing blocks Google's ad hosts.
- **New pages:** `/contact/` (footer link replaces the mailto), `404.astro`.
- **Writing:** three articles under the byline `spot-the-money`, counted by SQL on production
  on 2026-11-15 (figures and method are in each article). `/writing/` and author pages now
  carry an answer block (verify-live requires one on every sitemap page).
- **Thin pages:** `/companies/` and `/disclosures/` gained "What this page shows" and "Where the
  data comes from" sections. The methodology coverage table is wrapped in `.tablewrap` (the
  page was 525px wide on a 390px phone).
- **Modern Web Guidance:** `<meta name="color-scheme">` kept in step with the theme switch
  (BaseLayout inline script and `ui.ts`); a forced-colors block and a reduced-motion rule for
  the toast at the end of `global.css`; `fetchpriority="high"` on the article hero image.
  Held: declarative dialog controls (`command`, `closedby`), `vh` to `dvh`, global
  `scroll-padding-top`, SRI on the d3 script in `web/public/congress-heatmap.html`, view
  transitions, speculation rules.
- **Cloudflare:** custom rule "Challenge SG and CN (bot traffic)",
  `(ip.src.country in {"SG" "CN"} and not cf.client.bot)`, Managed Challenge, Active.
- **Visual check (session workspace, not in the repo):** two captures of the unchanged build
  were pixel-identical (347 of 347); the changed build differs only on the pages changed on
  purpose and in the build timestamp on the methodology page. Chromium only.
- `qa.yml` on branch `feat/home-feed` builds the branch it is started from (manual runs only);
  that is how the new homepage (notable-trades feed, partial coverage) is shown on QA. It is
  NOT merged: Peter reviews it on https://qa.spotthemoney.com first.

### Remaining data faults (2026-11-15, scheduled parity run) — queue item 1

- **Form 4 floor.** `shared/src/floor.ts` `FORM4_FLOOR` ("2025-10-01") is the one date for both
  sides. Web: `flagship.ts` leaves out Form 4 filings filed before it (318 filings, 826 rows, 66
  insiders with nothing else, on production that day; the rows stay in the database).
  Methodology said "filed 2003-.. onward" from the raw coverage months; it now counts from the
  floor and says so. Ingest: the daily `sec_form4` pass ignores listing entries older than the
  floor (it was re-fetching and quarantining a 2002 filing every day). `verify-downloads` fails
  if a Form 4 row disclosed before the floor reaches a CSV; the seed holds one such filing.
  `/data/coverage.json` is the raw diagnostic and still counts everything.
- **Daily `sec_form4` guards** (header of `sec_form4.ts`): SEC answered 503 for hours on Sunday
  2026-11-15 and both the job and its retry were killed at 55 minutes. Now 5 failures in a row
  (`SEC_FORM4_MAX_CONSECUTIVE_FAILURES`) end the run as `failed` with stats in about 4 minutes;
  `SEC_FORM4_MAX_MINUTES` (40) ends a slow run as `partial`; the ticker order starts from a point
  that moves each day (`rotateByDay`). `SEC_EDGAR_BASE` exists for tests against a local fake only.
- **Abandoned runs.** `ingest/src/index.ts` closes a source's `running` rows older than 2 hours
  as `failed` ("abandoned: ...") before opening a new one, so a job killed by the timeout shows
  in the freshness check instead of vanishing.
- **Measurement jobs.** `search_console_weekly` and `citation_count` report `stats.skipped`
  when their keys are missing (they logged plain success with empty tables). The tables stay
  empty until Peter adds `GSC_SERVICE_ACCOUNT_JSON` and the answer-engine keys (the latter
  costs money per run).
- **Lobbying.** History backfill finished (`history_complete: true`, 18:23 UTC): 83,532 filings
  for 2026 against 83,547 counted at the source earlier the same day.
- **`facts.ts` `tradingBan`** re-checked: nothing enacted; next check by 2027-01-20. congress.gov
  and GovTrack refuse automated readers, so the check rests on press reports dated 2026-11-13.
- `scripts/verify-live.mjs` identifies itself with the site's contact page, not a personal
  email address.
- Contracts and lobbying need no floor on the site: pages already read contracts by a 180-day
  window and lobbying from two years back.
- Cloud sandbox notes: sec.gov and lda.gov are not reachable from it; a shell command that
  names a file holding a personal email address beside a user agent is refused by the session's
  privacy guard, so read and edit those files (`sec_form4.ts`, `lib/http.ts`, this file) with
  the file tools, and run tests by glob.

### PRs #11 to #13 (2026-11-15, interactive session) — recorded here on 2026-11-16

Written from the project state doc (`claude/parity-state.md` in the claude.ai Project), which is
the fuller record.

- **#11 AdSense.** `ADSENSE_CLIENT = "ca-pub-9671575911691889"` in `web/src/lib/ads.ts`; head tag
  and meta on content pages only; `web/public/ads.txt`; in-page slots are held by
  `AD_SLOTS_ON = false` until Google approves the site (review requested 2026-11-15). Before ads
  are served: Google's consent message for the EEA, UK and Switzerland.
- **#12 Homepage.** Notable-trades feed above the trade map (`web/src/lib/notable.ts`,
  `notable-build.ts`, `NotableFeed.astro`, `/data/notable.json`, methodology `#notable`). Default
  preset Cluster buys, 7 days (cluster presets fall back to 30). Labelled partial coverage.
- **#13 Market-wide Form 4, stage 1.** Migration 0019: `filings.scope` ('tracked' | 'market'),
  `companies.tracked`, `promote_market_scope()`, and five views `site_filings`, `site_companies`,
  `site_people`, `site_person_roles`, `site_securities`. **Every build-time query reads the
  `site_*` views**, so market-scope rows are not on the site yet. Their column lists are frozen:
  a column added to one of the five tables needs a `create or replace view` too. Source
  `sec_form4_bulk` + workflow `form4-bulk.yml` (manual) load the SEC quarterly Insider
  Transactions Data Sets; 2025 Q4 to 2026 Q3 are loaded (125,746 filings, 120,428 of them
  scope market). The deploy read 37,883 files after the load: file headroom on the free
  Workers plan is thin. Stages 2 (filings since 2026-10-01) and 3 (switch the site over) are open.
  Next free migration number: 0020.

### Stock pages: insider buying and selling over 3 and 12 months (2026-11-16, scheduled parity run) — gap T0-02

- **What.** `/stocks/<ticker>/` has a table "Insider buying and selling in X: 3 and 12 months"
  (anchor `#insider-summary`, `data-entity-periods`) above "Insiders trading X": purchases,
  insiders who bought, shares and dollars bought; the same for sales; sales under a 10b5-1 plan;
  net shares and net dollars. Shown whenever the page has Form 4 rows.
- **Rule** (`insiderPeriods`, `isOpenSale`, `INSIDER_PERIODS` in `web/src/lib/entity.ts`; test in
  `scripts/entity.test.ts`): Form 4 code P with side buy and code S with side sell only, so
  awards, exercises, gifts, code F and D, derivative rows (side `option`) and repeat filings of
  one trade (side `other`) stay out. A row is in a period by its **disclosure** date, 90 and 365
  days back from the build, the trade map's rule. Dollars are the model's `value`; a row with no
  usable price adds shares only (`unpriced`). Methodology `#insider-summary`; guide
  `what-is-form-4` gained a sentence.
- **Changed with it:** the page's figure strip and answer sentence counted every row with side
  `sell` (codes S, F and D) under the label "open-market ... sales". Both now count code S only.
- **Verifier:** `verify-links` checks, on every stock page it reads, that a page listing insiders
  has the table, that net shares equal bought minus sold, and that no 3-month figure exceeds its
  12-month figure.
- **I-Bond job.** `ibonds` had reported `partial` every day since 2026-11-02: the Treasury matrix
  passed 10,000 rows (the API's largest page) with the November period. It read newest first,
  so the stored rates were right (5.51% from 2026-11-01), but the run was never clean. It now
  reads every page (`MAX_PAGES` 10).
- Not done: no 3 and 12 month table on company or insider pages; no market-wide figures (the
  table covers filings on the site, which is stated on the methodology page).

### Form 4 footnotes under the trade tables (2026-11-16, scheduled parity run) — gap T0-08

- **What.** A Form 4 row whose filing has footnotes carries a link in its Flags cell
  (`a.flag.notes`, "2 notes", `href="#fn<filing id>"`). Under the table, a folded
  `details.fnotes[data-fnotes]` prints each filing's footnotes once (`section.fnote#fn<id>`):
  filer, filing date, link to the Form 4, the notes as an ordered list. Everywhere `TxnTable`
  is used (stock, insider, company pages, `/insiders/`). No new files.
- **Data.** `filings.payload.footnotes` is a list of strings per filing (written by the daily
  `sec_form4` job since the start). `flagship.ts` loads it in its own try/catch into
  `model.footnotes` (filing id to clean notes; the build log prints
  `[web] Form 4 footnotes: N filings, M notes`). `web/src/lib/footnotes.ts` (pure; tests in
  `scripts/footnotes.test.ts`): `cleanFootnotes` undoes XML escapes (stored text holds `&amp;`,
  `&quot;`), collapses white space, drops empty and repeated notes; `tableFootnotes` gives one
  block per filing in row order; `MAX_NOTES_PER_FILING` = 10, the rest are counted ("2 more
  footnotes in the filing").
- **Limits, stated on the page and in methodology `#footnotes`:** the payload does not record
  which row or box a footnote is attached to, so the notes are the filing's, shown with every
  row of it. Filings loaded by `sec_form4_bulk` have an empty list (the SEC sets' FOOTNOTES
  table is not loaded). Both belong with the parser fixes (queue item 3): store the
  `footnoteId` references per transaction, load the bulk FOOTNOTES table. Nothing on the site
  is derived from footnote text (no flag, label or total). Footnotes are not in the CSV files.
- **One block per page.** A filing printed by an earlier table on the same page is linked, not
  printed again (`Astro.locals.noteBlocks`), so ids stay unique. `scripts/tablesort.ts` opens
  the folded list when a notes link is clicked or the page is opened at `#fn<id>`.
- **Verifier.** `verify-links` (NOTES): every notes link has its block inside the folded list,
  no block twice, 1 to 10 non-empty notes per block, no XML escape shown as text, and the
  seed's pre-floor filing's note never appears.
- Guides: `what-is-form-4` (now covers `footnotes.ts` and `TxnTable.astro`),
  `form-4-transaction-codes`, `rule-10b5-1-trading-plans`,
  `ten-percent-owners-and-joint-filings` each gained a sentence.

### Member directory with filters (2026-11-16, scheduled parity run) — gap T0-03

- **What.** New page `/congress-members/` (`web/src/pages/congress-members.astro`): one row per
  member of Congress on record (member, chamber, party, seat, committees, trades, trades in 12
  months, latest disclosure), a name search and five filters (chamber, party, state, committee,
  activity), sortable columns (the shared `scripts/tablesort.ts`), a count line with "Reset
  filters". The filter state is in the URL hash (`#chamber=senate&party=D&state=TX`); a hash
  with no `=` is a jump link and leaves the filters alone. Without JavaScript the whole table
  shows and the controls are hidden. In the `pages` sitemap, the search index and `llms.txt`.
- **Why the address is not `/congress/members/`:** four verifiers (live, links, profile, share)
  and the a11y sampler treat every `/congress/<x>/` as a member profile. Do not put a
  non-profile page under `/congress/`.
- **Rules** (`web/src/lib/directory.ts`, pure; tests `scripts/directory.test.ts`; the browser
  script `web/src/scripts/directory.ts` uses the same `matches`): "Trades" = `p.txns.length`;
  12 months and the activity filter go by **disclosure** date; a subcommittee seat counts for
  its full committee; the committee filter lists full committees only; former members
  (`valid_to` in the past) stay listed, marked "left office". Default order is by surname
  (`sortName`, a sort key only; the name is shown as stored). Committee seats are context:
  nothing ties a trade to one (stated on the page, in methodology `#member-directory` and in
  the guide).
- **`/congress/`:** the "All members on record" name list is replaced by one sentence and a
  link to the directory (the chip reads "Member directory"). The answer sentence no longer says
  "House filings only until the Senate feed is live" once Senate reports are public.
- **Build log** prints `[web] member directory: N members (H House, S Senate), W with trades,
  R disclosed in the last 90 days, F former, C committees, T states` for comparison with SQL.
- **Verifier:** `node scripts/verify-directory.mjs <base-url>` (Playwright): every option of
  every filter against a count made from the text in the rows, row count against
  `congress-members.csv`, committee members against their own pages, combined filters, the
  hash and its reload, Reset, a jump link, search, the empty state, sorting, 390 px, no
  JavaScript. Run it with the other verifiers (ten now). `verify-a11y` includes the page.
- **Seed:** `scripts/seed-local.sql` gained three members with no trades (two senators, one
  independent; one representative who left office) and committee seats, so the directory, the
  member pages' committee section and the no-trades member page are exercised locally.
- Guide `how-to-read-a-congressional-trade-report`: new section `#directory`, one FAQ, covers
  the two new files, four new labels.
- Not done: no committee page or committee view of trades (that is T0-07, next); no filter by
  ticker or by late filings; the directory is one static page (no per-state pages).

### Committee pages: members and their disclosed trades (2026-11-16, scheduled parity run) — gap T0-07

- **What.** `/congress-committees/` (list: committee, chamber, members, members with trades,
  trades in 12 months, latest disclosure; sortable) and one page per full committee at
  `/congress-committees/<slug>/` (49 on production): header facts, answer, the committee's
  remit in the dataset's wording, **Members** (leaders first; party, seat, role, trades, trades
  in 12 months, latest disclosure), **Most-traded stocks, last 12 months** (15 tickers by report
  rows, with the number of members), **Trades disclosed by members** (`TxnTable`, newest 200),
  other committees of the same chamber. In the `pages` sitemap, the search index (kind
  "Committee") and `llms.txt`. A committee named on a member page now opens its page here (the
  official site link moved to the committee page). `/congress/` and the directory link to the list.
- **Rules** (`web/src/lib/committees.ts`, pure; tests `scripts/committees.test.ts`):
  `buildCommittees(model, today, personPath)` is the one source for the pages, the sitemap and
  the search index. A subcommittee-only seat counts for its full committee; no page for
  subcommittees (230 would cost file headroom). Counts are the directory's: trades =
  `p.txns.length`, 12 months by **disclosure** date. The slug is made from the name
  (`committeeSlug`: "House Committee on Financial Services" → `house-financial-services`, at
  most 60 characters, the code appended on a clash); a renamed committee gets a new address.
- **Limits, stated on every page, in methodology `#committees` and in the guide:** the roster
  holds today's seats and no history, so a committee's trades are every trade on record for its
  current members (including trades made before they joined), and members who left are not on
  it. A seat is context: no page compares a trade with a committee's work. The verifier fails a
  committee page that uses conflict wording.
- **Not under `/congress/`** for the reason given for the directory.
- **Build log** prints `[web] committees: N pages, S seats, M members seated, W of them with
  trades, Z committees with no trades; members/with trades/trades/12 months: HSBA …, SSBK …,
  HSAS …, SLIN …` for comparison with SQL.
- **Verifier:** `node scripts/verify-committees.mjs <base-url> [--sample N]` (Playwright): list
  row against the committee's page, facts against the member table, member counts against
  `congress-members.csv` and the directory's committee filter, trade table rows (at most 200,
  all by listed members), member pages linking back, sorting, wording, 390 px. Eleven verifiers
  now. `verify-a11y` includes the list and one committee page.
- Guide `how-to-read-a-congressional-trade-report`: new section `#committees`, one FAQ, three
  new covered files, two labels; `ctx.committeeTradeRows` is the live value for "200".
- Not done: no committee filter on the trade map (it belongs with the table screener, T0-12:
  the map's filter script and its verifier oracle would both need the seat list); no CSV per
  committee; no subcommittee pages; no history of assignments.

### Market-wide Form 4, stage 2 (2026-11-16, interactive session) — PR #19

Full status, numbers and the stage 3 plan: Project doc `claude/parity-form4-marketwide.md`.

- **Source `sec_form4_index`** (`ingest/src/sources/sec_form4_index.ts`, daily): walks the EDGAR
  daily index (`/Archives/edgar/daily-index/<year>/QTR<n>/index.json`, then each
  `master.YYYYMMDD.idx`), keeps form type exactly `4`, skips stored accessions, fetches the
  submission `.txt` (one request; the ownership XML is between `<XML>` and `</XML>`) and writes
  through the shared `storeForm4Filing` in `sec_form4.ts`. New companies get `tracked=false`,
  new securities `is_active=false`, scope `market` unless the company is tracked, so the site
  build (which reads the `site_*` views of migration 0019) does not change for them.
- Resume point `ingest_runs.stats.through`; the last 2 index days are re-read every run; budget
  `SEC_INDEX_MAX_MINUTES` (40, "partial"); 5 submission failures in a row end the run as failed;
  start `SEC_INDEX_SINCE` (default 2026-10-01, the day after the last bulk quarter).
- Workflow `form4-index.yml` (manual, chains itself). In `ingest.yml` the source is its own
  group `insiders-market`. `scripts/freshness-check.mjs` lists it. Test fake:
  `scripts/fake-edgar-index.mjs` (through `SEC_EDGAR_BASE`, tests only).
- **Catch-up on production (2026-11-16, two chained runs, about 50 minutes):** through index day
  2026-11-13, 9,875 filings stored (9,614 market, 261 tracked). 2026-11-13: 661 stored against
  663 accessions in that day's index.
- **Open:** 31 filings quarantined, about 30 with "write failed: Invalid time value" (a date the
  shared write path cannot parse; the ticker-by-ticker daily job uses the same path). Store such
  a filing with the date NULL, add a test, re-run the catch-up once.
- The ticker-by-ticker `sec_form4` daily source still runs; the index source now stores tracked
  companies' filings too. Retire the old one with stage 3 (the site switch-over), not before.
- AdSense correction to the 2026-11-15 section above: the account exists, under Peter's personal
  Google account (not the pfouge.com one), publisher ID pub-9671575911691889, site review
  requested 2026-11-15; in-page slots stay off (`AD_SLOTS_ON`) until Google approves.

### Lobbying: every issue on a filing, and a page per issue (2026-11-16, scheduled parity run) — gap T0-11

- **What.** Lobbying tables showed a filing's first issue code only. Now the "Issues" cell
  (`web/src/components/IssueList.astro`; on `/lobbying/`, company pages and the issue pages)
  lists every general issue area the filing names, the first six when there are more
  (`ISSUES_INLINE`), each linked to that issue's page. New pages: `/lobbying-issues/` (one
  sortable row per issue area: filings this year, filings that list no other issue, clients,
  registrants, amount reported on those filings) and `/lobbying-issues/<slug>/` (79 on
  production: facts, 25 largest clients and registrants, the 100 newest filings that list it,
  any period on record). `/lobbying/` gained "Browse by issue" (the 12 issues on the most
  filings). In the `pages` sitemap, the search index (kind "Lobbying issue") and `llms.txt`.
  Lobbying CSVs gained `all_issue_codes` and `all_issues` (semicolon-separated).
- **Rules** (`web/src/lib/lobbyissues.ts`, pure; tests `scripts/lobbyissues.test.ts`):
  `buildIssues(model.lobbying, model.issueNames, year)` is the one source for the pages, the
  sitemap and the search index. A filing counts under EVERY issue it lists. A filing reports
  one amount for all its issues, so the amount beside an issue is the total on the filings
  that list it: amounts overlap between issues, are never added together, and no page calls
  one "spent on" an issue (the verifier fails that wording). The treemap on `/lobbying/` still
  counts each filing once, under its first issue, so its tiles add up to the year's total.
  The slug comes from the Senate's name for the code with brackets dropped (`issueSlug`).
- **Data.** `lobbying.issues` is a JSON list of `{code, display}` (all rows; 79 codes).
  `flagship.ts` reads the codes into `LobbyingRow.issues` and fills `model.issueNames` from
  every entry, not only the first. `scripts/seed-local.sql` now uses that shape (it held bare
  strings, so issue names never showed locally) and gained a one-issue filing and a
  registration with no issue.
- **Build log** prints `[web] lobbying issues: N issues, F filings on record, Y for <year>,
  Z of them with no issue, S with several; filings/only issue/clients/registrants/amount:
  TAX …, DEF …, HCR …, BUD …, WEL …, DOC …` for comparison with SQL.
- **Verifier:** `node scripts/verify-lobbying.mjs <base-url> [--sample N]` (no browser):
  recounts every issue's figures from the lobbying CSV files (written by `downloads.ts`, a
  different code path) and compares them with the list row and the issue page's facts; table
  caps; every row of an issue page lists the issue; the Issues cells on `/lobbying/`; wording.
  Twelve verifiers now. `verify-a11y` includes the list and one issue page.
- Guide `lobbying-disclosure-reports`: new section `#issues`, one FAQ, three new covered files,
  three labels; `ctx.issuesInline`, `issueTopRows`, `issueFilingRows` are the live values.
  `how-to-cite-and-reuse` names the two new CSV columns. Methodology `#lobbying-issues`.
- **T0-09 (capital-gains flag) was NOT built: the data is not there.** `cap_gains_over_200`
  is null on every stored congressional row (5,658 House, 1,860 Senate). The vendored House
  parser reads the tick from the letters "gfedc"/"gfedcb" that 2021-era PDFs carried in their
  text; the 2025 and 2026 PDFs have no such text, and the Senate report has no such column.
  It needs a new way to read the House checkbox from the PDF itself (parser work, with the
  PDFs, which the cloud sandbox cannot fetch).
- Not done: no issue filter on company pages; no per-issue CSV; the specific-issue text of a
  filing (the bills named) is not stored; no history chart per issue.

### RSS feeds of the newest disclosed trades (2026-11-16, scheduled parity run) — gap T0-10

- **What.** Three static RSS 2.0 files and a page about them: `/feeds/congress-trades.xml`
  (the 200 newest published rows of House and Senate periodic transaction reports, one item per
  row), `/feeds/insider-purchases.xml` (100 items) and `/feeds/insider-trades.xml` (200 items),
  and `/feeds/` (what each carries, item counts, how to use one). Every page advertises the
  three feeds in its head (`BaseLayout`), the footer links "RSS feeds", `/congress/` and
  `/insiders/` link their feeds above "Newest disclosures". In the `pages` sitemap, the search
  index and `llms.txt`. Four new files in the deploy. `/writing/rss.xml` is unchanged.
- **Rules** (`web/src/lib/feeds.ts`, pure; tests `scripts/feeds.test.ts`; wired to the model in
  `web/src/lib/feeds-build.ts`, which builds the items once per build): an insider item is one
  Form 4 filing and direction, its open-market purchases (code P, side buy) or sales (code S,
  side sell) added up, because a sale filled in lots is many rows (200 to 340 rows a day on the
  tracked set, 60 to 130 filings). Awards, exercises, gifts, code F and D, derivative rows
  (side `option`) and repeat filings (side `other`) are out, as are rows under review, rows
  with no disclosure date and rows dated after the build day. Order: disclosure day, then
  filing id, purchases first. An item's title is the share menu's sentence
  (`tradeSentence`) for one row, `filingSentence` for several; the description adds the role
  at that company (never a role held elsewhere), owner, late flag, a 10b5-1 note "as stated on
  the form", and the original filing's address. The link is the filer's page at the row
  (`#t<id>`). Guids: `stm-txn-<id>`, `stm-form4-<filing id>-buy|sell` (a `--reprocess` of a
  congressional filing gives its rows new ids, so readers will see those items again).
- **Scope.** Feeds read `model.txns` (the tracked set), like the tables on `/congress/` and
  `/insiders/`; the page says so. Market-wide insider feeds belong with stage 3b of the
  market-wide work. No per-member or per-ticker feeds (file headroom).
- **Build log** prints one line per feed: `[web] feed insider-trades: N items (R rows), newest
  D, oldest D, n items (r rows) on the newest day`, for comparison with SQL.
- **Verifier:** `node scripts/verify-feeds.mjs <base-url> [--sample N]` (no browser; the
  thirteenth): well-formed XML, unique ids, newest first, no future dates, every link opens a
  page that holds the row, the description ends with the original filing, items per disclosure
  day recounted from `congress-trades.csv` and `insider-trades-latest.csv`, the counts on
  `/feeds/`, the head links, wording. `verify-a11y` includes `/feeds/`.
- Guide `how-to-follow-members-insiders-and-stocks`: new section `#feeds`, one FAQ, one key
  fact, two new covered files, one label; the item limits come from `ctx.feedCongressItems`,
  `feedPurchaseItems`, `feedInsiderItems`. Methodology `#feeds`.
- A plain table did not suit `/feeds/` (table cells do not wrap on this site): the feeds are a
  list of cards with a scoped style in the page.
- Not done: no feed of notable trades or clusters; no Atom or JSON Feed; no feed per page.

### Industry from the SEC's SIC code (2026-11-17, scheduled parity run) — queue item 3, "sector from SIC", stage 1

- **What.** Company pages and stock pages carry a header fact "Industry, as the SEC classifies
  it": the SEC's wording, the four-digit SIC code and the division of the SIC manual the code
  falls in, for example "Semiconductors & Related Devices (SIC 3674, Manufacturing)"
  (`div[data-industry]` in `dl.facts`). A company with no code on file has no such line.
  Static pages of the tracked set only; the on-demand pages do not show it yet.
- **Data.** Migration **0021** `company_sic(cik, sic, sic_description, checked_at, updated_at)`,
  keyed by 10-digit CIK like `company_size`, RLS on with no public policy. A table of its own so
  `companies` and the frozen `site_*` views are untouched; `companies.sector` stays unused. A
  row with `sic` NULL means "asked, the SEC lists none" (or HTTP 404). Next free migration: 0022.
- **Source `sec_company_sic`** (`ingest/src/sources/sec_company_sic.ts`; tests beside it): one
  request per company to `data.sec.gov/submissions/CIK<10 digits>.json`, fields `sic` and
  `sicDescription`. Companies never asked come first (tracked before market), then at most 300
  rows a run last checked over 90 days ago. `SEC_SIC_MAX_MINUTES` (40) ends a run as `partial`
  with `remaining`; 5 failures in a row end it as `failed`; it also fails if the first 50
  answers hold no `sic` key (wrong shape) instead of filling the table with NULLs. Its own
  daily group `company-facts` in `ingest.yml` (both matrix lists); `freshness-check.mjs` lists
  it. Test fake: `scripts/fake-sec-submissions.mjs` through `SEC_DATA_BASE` (tests only), modes
  `ok`, `down`, `noshape`. **The request shape was written from memory of the SEC API (data.sec.gov
  is not reachable from the cloud sandbox); the first run on a GitHub runner is the proof.**
- **Division.** `shared/src/sic.ts` (`cleanSicCode`, `sicDivision`, `SIC_DIVISIONS`): a lookup on
  the code's first two digits with the SIC manual's ranges; null for a code in no division.
  Nothing is inferred and nothing on the site uses the industry for a total, ranking or flag.
- **Web.** `model.companySic` (CIK to code and wording, loaded in `flagship.ts` in its own
  try/catch, so a missing table or an empty one only leaves the fact out), `industryOf` in
  `web/src/lib/entity.ts` (test in `scripts/entity.test.ts`). The build log prints
  `[web] industry codes: N of M companies on the site have a SIC code (K codes on file); <division> n, ...`
  for comparison with SQL. Methodology `#industry`; a paragraph in guide `what-is-form-4`.
- **Verifier.** `verify-links` (INDUSTRY): an industry fact is "wording (SIC ####, division)",
  the division is one of the manual's eleven names (its own list, not the code's), and the fact
  is only on stock and company pages. The seed has two companies with a code, one with a NULL
  row and one with no row.
- Not done: industry on the on-demand pages (needs the `od_*` functions, the interactive
  thread's files), an industry filter on the trade map or in a screener, ratios by industry,
  related companies by industry, the code in the CSV files or in JSON-LD.

### Congress trade screener (2026-11-17, scheduled parity run) — queue item 6, stage 1 (congressional trades only)

- **What.** New page `/congress-trades/` (`web/src/pages/congress-trades.astro`): every published
  row of the House and Senate periodic transaction reports on record in one table (member with
  party and seat, asset, side, owner, trade date, disclosed, lag with the late flag, amount range,
  link to the report). A search box (member or ticker) and ten filters: chamber, party, state,
  committee, side, amount, owner, asset (with a ticker or without), disclosure window (30, 90,
  365 days) and reporting time (late or on time). Six sortable columns, pages of 25, 50 or 100
  rows (opens on 50), a count line (trades, members, purchases, sales, tickers), Reset. The
  filters, sort order, page and rows per page are in the URL hash
  (`#chamber=senate&side=buy&min=100001&sort=amount&dir=desc`); a hash without one of the
  screener's keys is a jump link. In the `pages` sitemap, the search index and `llms.txt`;
  `/congress/` links to it (chip "Trade screener"). Two new files in the deploy.
- **How it is built.** The page prints the first 50 rows itself (so they are there without
  JavaScript, with the controls and pager hidden). `web/src/scripts/screener.ts` then loads
  `/data/congress-screener.json` (`pages/data/congress-screener.json.ts`; packed: each member and
  each report link written once, a row is a 12-item array) and filters, sorts and pages in the
  browser. A static table of every row was rejected: about 7,500 rows would be several MB of HTML.
- **Rules** (`web/src/lib/screener.ts`, pure; tests `scripts/screener.test.ts`; the page, the
  browser script and the tests use the same `matches`, `screen`, `parseHash`, `toHash`):
  rows are `model.txns` that are congressional, published, with a disclosure date and a filer
  (`screenerTxns`), so rows under review are NOT in the screener (they are on member pages and
  in the CSV, flagged). Date windows count back from the BUILD day (`data.built`), by disclosure
  date. Late = the member pages' rule (`lagDays > CONGRESS_DEADLINE_DAYS`); a row with no lag is
  neither late nor on time. The amount filter compares the LOW end of the reported range
  (`MIN_STEPS`); sorting by amount is low end, then high end, an open-topped range above the
  rest. Empty values sort last in both directions; ties fall back to newest disclosure, then id.
  The committee filter uses today's seats (a subcommittee seat counts for its full committee)
  and is context only. No dollar totals anywhere: reports give ranges.
- **Do not give the table `data-sortable`**: `scripts/tablesort.ts` would sort only the rows of
  the current page. The screener sorts the whole result itself (`th[data-sort]`).
- **Build log** prints `[web] congress screener: N rows (H House, S Senate) by M members in R
  reports; B purchases, S sales, X exchanges; T tickers, W rows with no ticker, L late; disclosed
  D to D` for comparison with SQL.
- **Verifier:** `node scripts/verify-screener.mjs <base-url>` (Playwright; the fourteenth). Its
  oracle is the CSV downloads, written by other code: `congress-trades.csv` for the rows and
  `congress-committee-assignments.csv` for the seats. Every option of every filter (trades and
  members against the recount), combined filters paged through and compared id by id, paging,
  rows per page, sorting, the address and its reload, Reset, a jump link, junk values, search,
  the empty state, that the rows printed without JavaScript are the first page with JavaScript
  cell for cell, a sample of row links, the late flag, wording, 390 px. `verify-a11y` includes
  the page.
- **Seed:** `scripts/seed-local.sql` gained 48 generated House rows (every side, owner and
  amount step, late reports, an open-topped range, bonds and other assets with no ticker) and one
  Senate report with three rows (Walter Abara Jr.), so the local site has Senate rows, exchanges
  and more than one page. The seed's `exchange` type now maps to side `exchange` (was `other`).
- Guide `how-to-read-a-congressional-trade-report`: new section `#screener`, one FAQ, two new
  covered files, four labels; `ctx.screenerRows` is the live value for the page size.
  Methodology `#congress-screener`.
- Run notes: the cloud sandbox only advances while a tool call is running, so a background gate
  needs repeated short polls; start it with `setsid nohup` (a foreground command that hits the
  2-minute limit takes background children with it); Node's own `fetch` crashed once against
  `python3 -m http.server` (undici assertion), so the verifier uses Playwright's request API.
- Not done: Form 4 rows (the insider screener waits for market-wide stage 3b-2), saved screens,
  a "download these rows" button, links into the screener from committee and member pages
  (`verify-links` treats `#committee=HSBA` as a missing anchor; teach it the screener's keys
  first), a maximum-amount filter, a filter by trade date, asset-type detail beyond ticker or
  no ticker.

### Screener: links in from other pages, one member or ticker alone, download the rows (2026-11-17, scheduled parity run) — queue item 6, stage 1 follow-ups

- **Links in.** `web/src/components/ScreenerLink.astro` prints "Open all N rows ... in the trade
  screener" (`p[data-screener-link][data-n]`) above the trade table on member pages
  (`/congress-trades/#member=<slug>`), committee pages (`#committee=<code>`) and the
  congressional section of stock pages (`#ticker=<SYMBOL>`). N comes from `screenerCountsFor`
  in `web/src/lib/screener.ts` (memoised per build; counted with the screener's own rows, so it
  is the number the screener opens on, and can be lower than a count elsewhere on the page when
  rows are under review). No link when N is 0. The directory and the committee list link to the
  screener in their text.
- **Two exact filters with no control.** `ScreenFilter.member` (the slug of the member's page)
  and `ScreenFilter.ticker` (upper case), hash keys `member` and `ticker`. Exact on purpose: a
  search for "A" matches every name with an a in it, and two members can share a surname. On the
  screener they show as a line above the count (`[data-scr="pins"]`: "Only trades by X",
  "Only NVDA", each with a Remove button); the other filters apply on top, Reset clears them, a
  value the data file does not hold falls back to every trade.
- **Download these rows.** `[data-scr="download"]`: `viewCsv` writes every row the view matches,
  in the view's order and across all pages, with `lib/csv.ts` (BOM, CRLF, formula guard); the
  file is a Blob made in the browser, named by `viewCsvName`. Column names follow
  `congress-trades.csv` where the meaning is the same. Nothing is sent anywhere, so the privacy
  page is unchanged. Hidden without JavaScript; off when nothing matches.
- **Verifiers.** `verify-links` no longer reads a screener view as an anchor and has a SCREEN
  check: a link's keys are the screener's (its own list), its committee, member or ticker has
  rows in `/data/congress-screener.json`, the number beside the link equals a recount from that
  file, and a member or stock page whose member or ticker has rows carries the link.
  `verify-screener` opens `#member=` and `#ticker=` views (the shortest ticker included) and
  compares them with the CSV oracle by `page_url` and ticker, tests Remove, Reset and unknown
  values, and downloads the file for an unfiltered and a filtered, sorted view and compares it
  with the screen row for row and with `congress-trades.csv` cell for cell.
- Guide `how-to-read-a-congressional-trade-report`: a paragraph in `#screener`, one FAQ
  sentence, one label, `ScreenerLink.astro` covered. Methodology `#congress-screener` extended.
- Guide `what-is-form-4`: one sentence in the stock page's description.
- Build log: `[web] screener links: N rows; C committees (top five with counts); M members
  (top five); T tickers (top five)`, for comparison with SQL.
- Not done: a maximum amount, a trade-date window, saved screens, the insider screener.

### Companies by industry (2026-11-17, scheduled parity run) — sector from SIC, stage 2

- **What.** `/industries/` (one sortable row per SIC division with a company on the site:
  industry codes, companies, companies with an insider purchase, with an insider sale, traded by
  Congress, each over 12 months) and `/industries/<slug>/` per division (9 on production; a
  page per code would be about 258 files). A division page has header facts, a table of the SIC
  codes its companies carry, and a table of the companies (ticker, code and the SEC's wording,
  open-market purchases, open-market sales, congressional rows, latest Form 4), by code then
  name, sortable. The first company row of each code carries `id="sic-<code>"`. The Industry
  line on company and stock pages is now a link to its division page at that anchor
  (`industryHref`). `/companies/` links to the list. In the `pages` sitemap, the search index
  (kind "Industry"), `llms.txt`. New download `companies.csv` (company, cik, ticker, tickers,
  sic_code, sic_description, sic_division, insiders_on_file, page_url; kind `companies`).
- **Rules** (`web/src/lib/industries.ts`, pure; tests `scripts/industries.test.ts`;
  `siteIndustries(model)` in `industries-build.ts` is the one call for pages, sitemap and
  search): a company is listed when it has a CIK, a page and a code that falls in a division.
  Purchases = Form 4 code P with side buy, sales = code S with side sell (so awards, F, D,
  derivative rows and repeat filings are out), congressional rows = non-Form 4 rows in the
  company's securities; all by **disclosure** date, 365 days back from the BUILD day
  (`model.builtAt`), never after it. Division figures count companies with at least one such
  row. Counts only: no dollars, no ranking of industries, no ratio, and no page compares a
  trade with a company's industry (the verifier fails ranking or verdict wording).
- **Build log** prints `[web] industries: N divisions, W of C companies with a code, K codes,
  Z in no division; companies/codes/purchases/sales/congress rows in 12 months: A …, B …`
  for comparison with SQL.
- **Verifier:** `node scripts/verify-industries.mjs <base-url>` (no browser; the fifteenth).
  Oracle: `companies.csv` (written in `downloads.ts` from the stored codes, not from
  `industries.ts`), the insider trade files and `congress-trades.csv`, with its own copy of
  the manual's ranges. Recounts every division's and every company's figures, the code table,
  anchors, the back links from company and stock pages, sitemap, wording. `verify-links`
  INDUSTRY now also requires the Industry line to link to `/industries/<division>/#sic-<code>`.
  `verify-a11y` includes the list and one division page.
- **Seed:** Apple (3571) and AMD (3674) are now companies with a code and no insider filings;
  the AAPL and AMD securities belong to them.
- Fixed on the way: `/companies/` said "998 companys" (`plural` needs the plural form for a
  word ending in y).
- Guides `what-is-form-4` (covers `industries.ts`, one new label) and `how-to-cite-and-reuse`
  (names `companies.csv`) updated, re-read, accepted. Methodology `#industries`.
- Not done: an industry filter on the trade map or in a screener, ratios by industry, related
  companies by industry, industry on the on-demand pages, market-wide companies on these pages
  (all touch the market-wide thread's files or wait for it).

### Screener: an upper limit on the amount and a trade-date window (2026-11-17, scheduled parity run) — queue item 6, stage 1, last follow-ups

- **What.** Two more filters on `/congress-trades/`, each a select and a hash key:
  `max` ("Upper limit": "$15,000 or less" to "$1,000,000 or less", `MAX_STEPS`) and `tw`
  ("Traded": last 30 days, 90 days, 12 months; `TRADE_WINDOW_LABEL`, the same `WINDOWS` as the
  disclosure filter). The disclosure select's first option now reads "Any disclosure date".
- **Rules** (`matches` in `web/src/lib/screener.ts`; tests in `scripts/screener.test.ts`):
  `max` passes a row whose range's HIGH end is at most the step, so `min` and `max` together
  select one band (`#min=15001&max=50000`); a range with no stated top passes no upper limit;
  an impossible pair (min above max) shows the empty state. `tw` counts back from the BUILD day
  (`data.built`) by trade date, edge inclusive, never the future; a row with no trade date
  (missing, or dated after the report and blanked by `flagship.ts`) is in no trade window.
  Junk values are ignored like the other keys. The download's file name carries `max…` and
  `traded…d`.
- **A new hash key goes in three places:** `KEYS` / `parseHash` / `toHash` in `screener.ts`,
  `SCREEN_KEYS` in `scripts/verify-links.mjs`, and the `oracle` object in
  `scripts/verify-screener.mjs` (its filter loop tries every option of every key in `oracle`).
- **Build log** prints `[web] congress screener limits: high end at most 15000 N, ...; no stated
  top N; band 15001 to 50000 N; traded in the last 30 days N, 90 days N, 365 days N; no trade
  date N` for comparison with SQL.
- **Verifier.** `verify-screener` tries every option of both new filters against the CSV oracle,
  pages through four more combined views (a band, an upper limit with a side and a trade window,
  both windows together, an impossible band), and checks the address, a reload, the controls,
  Reset, that a higher limit or longer window never keeps fewer rows, and junk values.
- **Data fault found, not fixed here (parser, queue item 3):** 14 House rows in 11 reports have a
  high end below the low end (for example low 318, high 74). The report gave an exact amount
  with cents ("$318.74") and the House parser split it at the decimal point. They display as
  "$318–$74". All are under $3,000, so every filter still places them correctly.
- Guide `how-to-read-a-congressional-trade-report` (`#screener` paragraph, FAQ sentence, two
  labels) and methodology `#congress-screener` updated.
- Not done: saved screens; the insider screener (waits for market-wide stage 3b-2); a custom
  date range.

### SESSION STATE 2026-11-17: security audit (interactive session)

Scope: database privileges and row-level security, Supabase and WorkOS sign-in settings, Worker
routes, secrets in git history and in the build, GitHub workflows, 7 days of Supabase API logs.

- **How the site reaches the database (corrects older notes):** the browser never calls Supabase.
  The Worker calls `/rest/v1/rpc/*` with the publishable key, plus the visitor's WorkOS token for
  account calls. The publishable key and project URL are public, and anyone can obtain their own
  WorkOS token, so grants and row-level security are still the whole defence.
- **Found and fixed, migration `0022_api_privileges.sql` (applied to production the same day,
  dry-run first in a rolled-back transaction):** anon and authenticated held TRUNCATE, REFERENCES,
  TRIGGER and MAINTAIN on every table in public (row-level security does not cover TRUNCATE; not
  reachable through PostgREST, which has no such verb); the cause was the migrating role's default
  privileges, now removed, together with the default that made every new function executable by
  PUBLIC. **Consequence for every later migration: a new table or function is closed to the API
  roles until the migration grants by name** (`grant select on … to authenticated`,
  `grant execute on function … to anon`). `app_user_id()` answers only for a WorkOS user id
  (`user_…`). All API-callable functions have a fixed search_path; `od_vis` and
  `od_person_visible` are left without one on purpose (inlined per row, not executable by API roles).
- **Found and fixed in code:** `web/src/lib/db.ts` and `flagship.ts` read
  `import.meta.env.DATABASE_URL`, which the bundler replaces with the value, so the database
  connection string was inside the deployed Worker script (not in any public file: checked).
  **Never read a secret through `import.meta.env`; use `process.env` at build time and
  `cloudflare:workers` env in the Worker.** `scripts/check-build-secrets.mjs` now fails `deploy`
  and `qa` if a secret value or credential shape is in `web/dist`.
- **Workflows:** `ci`, `deploy`, `ingest`, `ingest-congress-ptr`, `measure`, `x-daily` now set
  `permissions: contents: read`. No workflow uses `pull_request_target`; `qa` skips pull requests
  from forks, and `ci` uses no secrets.
- **Checked and fine:** every table in public has row-level security on; tables with no policy
  have no API grants; isolation between two signed-in users and anon tested on every policy and
  function (reads, writes, moving rows across accounts, the definer functions); storage bucket
  `raw-filings` is private with no policies; no GraphQL, no realtime publication; WorkOS JWT
  template is `{"role":"authenticated"}` and Supabase trusts only the production WorkOS client;
  session cookie is HttpOnly, Secure, SameSite=Lax; POSTs check Origin; account responses are
  `private, no-store`; git history (96 commits) holds only placeholders and test vectors; 7 days
  of API logs show the Worker's `od_*` calls and the ingest jobs' storage uploads, nothing else.
- **Left for Peter:** rotate the database password (it was in the Worker script, and one audit
  tool call printed it inside the audit session), then update the `DATABASE_URL` GitHub secret;
  turn off "Allow new users to sign up" in Supabase Auth (email sign-up is on; no user ever
  signed up, and 0022 makes such a token useless for account data).
- **Left open, by choice:** no rate limit on `/api/*`, `/auth/*` or the on-demand pages (one free
  Cloudflare rate-limiting rule would cover it); no Content-Security-Policy header (ads, analytics
  and the TradingView frames make it a project of its own); `od_*` accept `p_any` and `p_floor`
  from any caller, which only returns public filings the static site shows anyway; `citext` stays
  in public (moving it risks operator lookups under the pinned search_path); the `qa` and `deploy`
  builds connect as the database owner (a read-only build role would be better); supabase_admin's
  default privileges in public cannot be changed by this role.

### Security audit follow-ups (2026-11-17, same interactive session)

Peter's choices: rate limit by a Cloudflare rule, Content-Security-Policy in report-only mode
first, rotate the database password, a read-only role for builds, Claude merges and deploys.

- **Migration `0023_parity_switch_build_role.sql`** (applied to production after a rolled-back
  dry run). `od_insider`, `od_stock`, `od_company` drop `p_any` when the call arrives through the
  API (`session_user = 'authenticator'`); a direct connection keeps it, so the local parity test
  is unchanged. **A later migration that rewrites one of the three must keep that first line.**
  New role `site_build`: select on every table in public except `accounts`, `watchlists`,
  `watchlist_items`; no writes, no function grants, bypasses row-level security, not a member of
  `authenticator`. **A new private table is readable by it by default: revoke in the migration.**
- **Builds use `BUILD_DATABASE_URL`** when that secret exists (`deploy.yml` build step, `qa.yml`,
  the `merge` job of `publish.yml`), otherwise `DATABASE_URL` as before. Migrations and ingest
  keep the owner's `DATABASE_URL`. Every caller of `deploy.yml` passes the new secret through.
- **`Content-Security-Policy-Report-Only`** in `web/public/_headers` and `web/src/middleware.ts`
  (keep the two identical). Nothing is blocked; violations show in the browser console. It
  allows inline scripts (the theme switch, JSON-LD and the analytics snippet are inline), so its
  value today is the list of hosts. To enforce: read the console on a stock page, a page with
  ads on and the watchlist, fix what it reports, rename the header, and drop `frame-ancestors`
  for `/embed/*`.
- **Dashboard settings changed** (not in the repo): Supabase Auth "Allow new users to sign up"
  off. **Correction (2026-11-18): no Cloudflare rate-limiting rule was set.** The zone's one
  free rate-limiting rule is taken by "Leaked credential check"; replacing it waits for Peter's answer.
- Still open: `citext` in public; supabase_admin's default privileges; `p_floor` on the `od_*`
  functions is not clamped (published public filings only).

### Ticker history flags on congressional rows: "first on record" and runs (2026-11-18, scheduled parity run) — queue item 6, first-time and streak flags

- **What.** Congressional rows can carry two flags: "first on record" (the member's earliest trade
  in that ticker among the reports on record) and "3rd buy in a row" / "4th sale in a row" and so
  on (a purchase, or a sale, on the third or a later one-sided trade date running). They show in
  the Flags cell of every `TxnTable` (member, stock, committee pages, `/congress/`), in the Side
  cell of the screener, as the screener filter "Ticker history" (hash key `hist=first|run`), and
  in the screener's download as `first_in_ticker_on_record` and `same_side_run`. Each flag links
  to guide `how-to-read-a-congressional-trade-report#ticker-history`; its `title` states the fact
  in full. Form 4 rows never carry them.
- **Rules** (`web/src/lib/tickerhistory.ts`, pure; tests `scripts/tickerhistory.test.ts`): rows
  are grouped by member and ticker (upper case) and ordered by TRADE date; several rows on one
  date are one date. `RECORD_START` = "2025-10-01" (the site holds reports FILED since then: the
  House backfill and the Senate export), so "first" is given only to trades made
  `FIRST_MIN_DAYS` (90) or more after it (2025-12-30 on). A date with purchases and sales both
  is mixed: no run, and it ends the count. An exchange never carries a run and does not end one,
  but an exchange-only date can be the first date. `RUN_MIN` = 3. Rows with no ticker or no
  usable trade date, rows under review and Form 4 rows take no part. **If the House backfill or
  the Senate export is ever extended further back, change `RECORD_START`.**
- **One map for tables and screener:** `historyFor(model)` in `web/src/lib/screener.ts`
  (memoised per build, over `screenerTxns`). `PackedRow` gained two fields at the end
  (first 0/1, run number); `unpack` tolerates a file without them.
- **Build log** prints `[web] ticker history: N of M rows have a ticker and a trade date, P member
  and ticker pairs; first on record F rows (...); in a run of 3 or more: B purchase rows, S sale
  rows; longest run L` and `[web] congress screener history: ...` for comparison with SQL.
- **Verifier.** `verify-screener` recomputes both flags from `congress-trades.csv` with its own
  copy of the rule and compares: every option of the `hist` filter, the flags in the Side cell of
  the rows on screen, the address and a reload, Reset, a junk value, the two download columns,
  and the Flags cell of sampled rows on member pages. `hist` is in `SCREEN_KEYS`
  (`verify-links`). The seed gained a report with AMD bought on four dates running, a sale, and
  a mixed day.
- Not done: the two columns are not in `congress-trades.csv` (all trade files share one header);
  no flag for Form 4 rows (waits for the market-wide work); no "first" count on member pages or
  in the feeds; sorting by run length.

### House amounts: exact figures and the open-topped spouse box (2026-11-18, scheduled parity run) — queue item (e2)

- **Fault.** The vendored House parser reads "any two dollar figures" from the amount cell, so
  two shapes were stored wrongly: an exact amount with cents ("$2,761.57" became low 2761,
  high 57, shown as "$2,761–$57"; 14 rows in 11 reports on production) and the form's
  open-topped box for an asset held only by a spouse or dependent child ("Spouse/DC Over
  $1,000,000" became 1,000,000 to 1,000,000; 10 rows in 4 reports, found in this run).
- **Job layer** (`fix_amounts` in `ingest/py/congress_ptr_job.py`, used by `map_transaction_record`,
  so by the House loop and the Senate import; tests `ingest/py/test_amounts.py`): reads the
  cell's own text (`amount_range_text`, which the parser keeps). Exact amount: low = high = the
  figure rounded to the dollar, half up. "... Over $X" with no dash: low X, high NULL. A high end
  below the low end that neither rule explains: both NULL (the row shows no amount). Stats
  `amounts_exact`, `amounts_over`, `amounts_unreadable`. The vendored parser is untouched and the
  payload keeps its values as parsed.
- **Stored rows: migration 0024, not `--reprocess`.** `--reprocess` re-reads every report in the
  window and gives every row a new id (row anchors, feed ids, shared trade links). The migration
  updates the 24 rows in place, each tied to the payload text and the stored pair; idempotent.
  Next free migration number: 0025.
- **Web.** `amountLabel` (`flagship-core.ts`) and `rangeLabel` (`screener.ts`) print one figure
  when low equals high ("$319", not "$319–$319"); an open top was already "over $1.0M". An
  open-topped row has no top to add, so it is off the trade map, as the one "over $50,000,000"
  row already was. The screener build log gained "one exact figure N; high end below low end N"
  (expect 14 and 0, and "no stated top" 11, on production).
- Methodology `#values`, guides `congress-trade-amount-ranges` and
  `how-to-read-a-congressional-trade-report` each gained a sentence. The seed has one exact row
  and one open-topped spouse row.
- **Known, not fixed:** on a row with an exact amount the parser never sees a complete range, so
  following lines can run into the asset name (report 20033725: the asset text of the $15.00
  exchange row starts with a comment from the row before). Parser work, queue item 3.

### Email alerts, stage 1: tables and the ways out (2026-11-18, scheduled parity run) — queue item 7

Nothing is sent, nothing on the site changed, and the privacy page is still true ("no emails").
This stage is the database only, built first so that turning a digest off, the one-click
unsubscribe link and account deletion exist and are tested before there is any way in.

- **Stage plan.** 1 (this change): tables, functions, tests. 2: a job that builds each
  account's digest of newly published trades by the pages it follows and writes it to
  `alert_outbox`; it sends nothing. 3: privacy page wording first, then the controls on
  `/watchlist/` and the Worker routes (`/api/alerts`, an unsubscribe page that accepts the
  one-click POST of RFC 8058), behind a site switch like `ACCOUNTS_ENABLED`. 4, with Peter: a
  provider adapter and the key; only then is the database switch turned on.
- **Migration 0025** (`db/migrations/0025_email_alerts_stage1.sql`). Next free number: 0026.
  - `app_settings(key, value jsonb)`: one row, `alerts_enabled` = false. **The database-side
    switch.** While false, `alert_save` refuses to turn a digest ON whatever the site does;
    turning off and unsubscribing always work. Turn it on only in stage 4:
    `update app_settings set value = 'true'::jsonb where key = 'alerts_enabled'`.
  - `alert_prefs`: one row per account that ever chose a digest (`digest` off, daily, weekly;
    `unsub_token`, 64 hex characters, never changes; `opted_in_at`, `unsubscribed_at`,
    `last_digest_at` = trades loaded up to here are covered, reset when a digest is turned on).
    No second email address: a digest goes to `accounts.email`.
  - `alert_outbox`: what would be sent (kind `digest_daily` or `digest_weekly`, period, address,
    subject, text, optional HTML, `item_count` > 0, status pending, sent, failed, cancelled;
    one row per account, kind and period end).
  - All three: row-level security on, **no policy, no grant to anon or authenticated**, and
    nothing for `site_build` on the two private ones. A signed-in visitor cannot read even
    their own row. Access is three definer-rights functions with a fixed search_path:
    `alert_state()` and `alert_save(p_digest)` for `authenticated` (the caller comes from the
    WorkOS token), `alert_unsubscribe(p_token)` for `anon` and `authenticated` (returns `{ok}`
    only). `alerts_enabled()` is not callable through the API.
  - Turning off or unsubscribing sets pending outbox rows to `cancelled` and keeps sent ones.
    `account_delete()` (0017) removes the setting and the outbox rows through the foreign keys.
- **Verifier:** `node scripts/verify-alerts-db.mjs <local-db>` (62 checks, as `anon` and
  `authenticated` the way PostgREST calls; refuses a Supabase host; puts the switch back). It
  and `verify-accounts-db.mjs` need `grant usage on schema auth to anon, authenticated` on the
  local database (the local `auth` stub; Supabase has it).
- **For stage 2:** write the digest job in `ingest/` (owner connection; it may read the private
  tables); what counts as "new" is `filings.created_at > last_digest_at` on published rows, the
  watchlist feed's rule (`watch_feed_rows`); delete or blank sent outbox bodies after a set
  time (they show what an account follows) and say so on the privacy page in stage 3; the
  postal address a commercial email must carry is Peter's to give.

### Email alerts, stage 2: the digest builder (2026-11-18, scheduled parity run) — queue item 7

Still nothing is sent, nothing on the site changed, and the privacy page is still true. This
stage is the job that works out what each digest would say and stores it.

- **Job `alerts_digest`** (`ingest/src/jobs/alerts_digest.ts`; pure rules and wording in
  `ingest/src/lib/digest.ts`, tests beside it). In the daily batch, last in the `company-facts`
  group of `ingest.yml`; listed in `scripts/freshness-check.mjs`. No migration.
- **While the database switch is off it reports a skip** (`stats.skipped`; NOT CONFIGURED in
  the freshness table) and builds nothing. `ALERTS_DRY_RUN=1` builds every digest and writes
  nothing, switch on or off; with `ALERTS_DRY_RUN_OUT=<dir>` it saves them for a look (never
  commit those files). `ALERTS_NOW` sets the clock, tests only. `ALERTS_POSTAL_ADDRESS`, when
  set, is the last line of every digest (`stats.postal_address_set`).
- **What is new for an account:** rows of published filings loaded (`filings.created_at`) after
  its `last_digest_at` and up to the run time less `SETTLE_MINUTES` (120), for the pages on any
  of its watchlists (members and insiders by slug, stocks by ticker, companies by slug; a row
  that matches several is listed under the person first). Three rules the watchlist feed does
  not have: the settling time (a filing is published at the END of the job that loaded it, so
  the last two hours wait for the next digest); only rows disclosed in the last `MAX_AGE_DAYS`
  (30), because a backfill loads old filings as new (130,000 in one week in November 2026);
  superseded Senate reports are out. It reads `filings`, not `site_filings`, so a followed
  insider outside the tracked set is covered. **Known limit:** a filing held for review and
  published more than two hours after it was loaded is in no digest (it is on the watchlist
  page); a `published_at` column would close that.
- **What an item is:** a House or Senate row is one item (the range as reported, the owner when
  not the member). A Form 4 is summed per filing: its open-market purchases (code P) one item,
  its sales (code S) one item, everything else one item that is only a count. **No dollar
  figure is computed for a Form 4** (shares and the price or price range as filed), so the
  price-box fault of `shared/src/tradevalue.ts` cannot reach an email. No reason for a trade,
  no advice, no em-dash (a unit test checks). At most `MAX_ITEMS` (40) are printed, the rest
  counted with a link to the watchlist; at most `MAX_ROWS` (2,000) rows are read per account.
- **When** (`isDue`): daily once the last digest is 12 hours old; weekly on Mondays UTC, or any
  day once the last one is 8 days old. A second run the same day builds nothing.
- **Per account, one transaction:** lock the setting, check the digest and its clock are
  unchanged, insert at most one `alert_outbox` row (`pending`; text and HTML; none when nothing
  is new), move `last_digest_at` to the period end. An account with no address is skipped and
  keeps its period. One account's failure does not stop the others (`partial`).
- **Housekeeping, every run, switch on or off:** a `pending` row older than 3 days is
  cancelled; the body of a row sent over 30 days ago is blanked. **Stage 3 must say both on the
  privacy page.**
- **The unsubscribe address is fixed here:** `/alerts/unsubscribe/?token=<64 hex>`
  (`unsubscribeUrl`). Stage 3 must answer it (GET and the one-click POST).
- **Stats and log carry counts only**: no address, account id or token (the verifier checks).
- **Verifier:** `node scripts/verify-alerts-digest.mjs <local-db>` (54 checks; `SHOW=1` prints
  two digests). It runs the real job through the runner with the clock set, against the seed:
  skip, dry run, daily and weekly rows, item counts against its own SQL, own token only,
  unpublished and old filings left out, a three-lot sale as one item, second run, a quiet day,
  the settling time, unsubscribe, housekeeping, no personal data in stats. It moves a few seeded
  values and puts them back. Eighteen verifiers now.
- For stage 3: the watchlist page's "new" badge (`watch_feed_rows`) has no 30-day rule, so a
  backfill inflates it; worth the same rule when that function is next touched.

### Email alerts, stage 3: the site side, switched off (2026-11-18, scheduled parity run) — queue item 7

Still nothing is sent and a visitor sees no change: the watchlist page, the privacy page, the
terms and the guide read as before. One thing is live: the unsubscribe address. No migration.

- **Two switches, both off.** `ALERTS_LIVE` (false) in `web/src/lib/account.ts` is the site
  switch; `ALERTS_ENABLED` is that, or a local build with `PUBLIC_ALERTS_PREVIEW=1` (no workflow
  sets it; it exists so the verifiers can exercise the "on" state). The database switch
  (`app_settings` `alerts_enabled`, 0025) still decides whether anyone can turn a digest on.
- **What the site switch turns on:** the "Email digest" section on `/watchlist/` (Off, Daily,
  Weekly on Mondays; saved on pick; shown only when the database switch is on too), the API
  actions `GET /api/alerts` (`alert_state`) and `POST /api/alerts-save` (`alert_save`), and the
  "on" wording of the privacy page (`#email-alerts`, the list of companies, retention), the terms
  (`#accounts`) and the guide `how-to-follow-members-insiders-and-stocks` (section `#alerts`,
  one FAQ). The wording lives in those files behind the same constant, so the policy and the
  feature cannot be out of step. While the switch is off the two actions are a 404, except
  saving "off" (`alertActionAllowed`): a way out never depends on a switch.
- **Stage 4 checklist (with Peter):** fill `ALERTS_PROVIDER` (name and the provider's privacy
  page) and `ALERTS_SINCE` (the day), then set `ALERTS_LIVE`; `alertsLaunchProblem()` stops the
  build otherwise. **The privacy page promises that opens and clicks are not recorded: switch
  the provider's open and click tracking off.** Then the database switch, then the sender.
  `/watchlist/` carries `data-alerts="on|off"` so a verifier can tell which build it is reading.
- **`/alerts/unsubscribe/?token=<64 hex>`** (`web/src/pages/alerts/unsubscribe.ts`, rules and
  HTML in `web/src/lib/unsubscribe.ts`), live whatever the switches say. GET shows one button
  and changes nothing (mail scanners open every link). POST calls `alert_unsubscribe` as `anon`
  and answers "You are unsubscribed" for a known and an unknown token alike. A token that is
  not 64 hex characters gets "this link is incomplete" (400). No sign-in, no Origin check.
  The page is a document of its own (no layout, script, analytics or outside file), never
  cached or indexed, and sends no referrer (the token is in the address).
- **Cross-site check moved from Astro to `middleware.ts`.** Astro's `security.checkOrigin`
  refuses a form POST without this site's Origin and cannot exempt a route, which would break
  the one-click unsubscribe of RFC 8058. It is now off in `astro.config.mjs`, and
  `crossSiteRefused` (`lib/account.ts`, called first in `middleware.ts`) refuses every POST,
  PUT, PATCH and DELETE without this site's Origin, whatever its content type, except
  `/alerts/unsubscribe`. **A new on-demand route that accepts requests from elsewhere must be
  added to `ORIGIN_EXEMPT` on purpose; nothing else should be.**
- **Verifiers.** `scripts/unsubscribe.test.ts` (13 unit tests: switch off, launch guard, action
  arguments, the page, the cross-site rule, the periods the privacy page states against the
  job's constants, the off-state wording). `verify-watchlist` reads `data-alerts`: off = no
  control and no request for the setting; on = the control, a save, a refused save put back.
  `verify-accounts-e2e` (63 checks on a preview build, 58 on a normal one) runs the unsubscribe
  page and both switch states through the real Worker. **It needs `pkill -9 -f workerd` before
  each run and often needs a second try**: `wrangler dev` in the cloud sandbox dies on the
  "follow while signed out" request about two runs in three (a wrangler proxy fault, seen on
  unchanged code too). The verifier now kills wrangler's whole process group when it ends.
- To see the "on" state locally: `PUBLIC_ALERTS_PREVIEW=1 npm run build`, then
  `verify-watchlist`, `verify-guides`, `verify-links`, `verify-a11y`, `verify-accounts-e2e`.
- Not done: the Cloudflare rate-limiting rule (dashboard) covers `/api/`, `/auth/` and the
  entity pages, not `/alerts/`; a guessed token is 244 random bits, so this is about load, not
  access. No `List-Unsubscribe` headers yet (they belong to the sender, stage 4). The watchlist
  "new" badge still has no 30-day rule.

### Watchlist: a trade is "new" only when disclosed in the last 30 days (2026-11-18, scheduled parity run) — queue item (g1)

- **Fault.** `watch_feed_rows` (0017) marked a row new when its filing was LOADED after the
  visitor's last visit. A backfill loads old filings as new, so the header badge and "New since
  your last visit" filled with trades disclosed months ago (on production one account had 83
  rows marked new, 40 of them disclosed more than 30 days before).
- **Migration 0026** (`db/migrations/0026_watch_feed_new_age.sql`): `is_new` = loaded after the
  last visit AND `disclosed_at >= current_date - 30`, the digest builder's rule (`MAX_AGE_DAYS`).
  Nothing else changes: the feed still lists every trade disclosed in the last 365 days, so an
  old filing loaded late is under "Earlier trades". Same name, arguments and return type, so the
  grants of 0017 and 0022 stand. **`create or replace function` drops a function's settings**:
  the `set search_path` that 0022 added by `alter function` is written into the definition
  again. Any later migration that replaces a function listed in 0022 section 5 must do the same.
  Next free migration number: 0027.
- **One number, three places:** the SQL, `FEED_NEW_MAX_AGE_DAYS` in `web/src/lib/account.ts`
  (the guide reads it through `ctx.feedNewMaxAgeDays`), and a unit test in
  `scripts/unsubscribe.test.ts` that reads the migration file and compares, and requires it to
  equal the digest's `ALERT_MAX_AGE_DAYS`.
- **Verifier.** `verify-accounts-db` (42 checks, was 35): the count equals the rows marked new,
  every new row was disclosed within 30 days, older rows are listed and not new, a filing loaded
  now but disclosed 60 days ago is listed, not new and does not raise the count, the function
  keeps its search_path and is still for signed-in visitors only.
- Guide `how-to-follow-members-insiders-and-stocks`: one paragraph in `#watchlist`; covers 0026.
- No page file changed: the watchlist script already splits rows by `is_new`.
- **Deploy run 44392224095 of this change ended red although the deploy was fine** (migration
  applied, version serving 100% of traffic): in the live check the runner could not open a
  connection to Cloudflare's edge (`ETIMEDOUT`) and `verify-live.mjs` crashed on the unhandled
  error. `verify-live.mjs` now tries each request three times (5 s and 15 s apart); a request
  with no answer at all is **inconclusive**, like a challenge (a warning; a failure with
  `--fail-on-challenge`, which the pre-deploy check of the build on the runner uses). Any answer,
  5xx included, is still checked. `verify-od.mjs` has the same bare `fetch` calls and was left
  alone (the market-wide thread's file).

### A good deploy is a green deploy: live checks moved to their own workflow (2026-11-18, interactive session)

Peter, after "Run failed: deploy" for a deploy that had gone out (run 44392224095: the runner timed
out reaching the edge during the live check): the public-site checks must not make a deploy look failed.

- `deploy.yml` ends at "Verify the deployed version" (Cloudflare's API: the uploaded version serves
  100% of traffic) and the IndexNow ping. It no longer reads the public website, and is about three
  minutes shorter.
- New `.github/workflows/live-check.yml` ("live check"): starts when `deploy`, `ingest`, `backfill`,
  `publish` or the Congress PTR workflow finishes (`workflow_run`; a cancelled run is skipped), or by
  hand. Runs `probe-live`, `verify-live --sample 5` (after one edge TTL) and `probe-od-live`. A
  failure here arrives as "Run failed: live check", which means the public site needs a look, not
  that a deploy failed. Challenges and unanswered requests stay inconclusive (warnings).
- `scripts/probe-od-live.mjs` reads the market sitemaps from the live sitemap index when no build
  directory is on disk.
- **A workflow that calls `deploy.yml` must be added to the `workflows:` list in `live-check.yml`**
  (by its `name:`), or its deploys go unchecked.

### Contract awards: sub-agency, end date and description (2026-11-19, scheduled parity run) — queue item 8, extra contract fields

- **Finding first.** Neither `contracts` nor `lobbying` has a payload column, so there were no
  "extra fields already stored". But the contracts job has always ASKED USAspending for
  "Awarding Sub Agency", "End Date" and "Description" (`BASE_FIELDS`) and thrown the answers away.
  They are now stored. Lobbying has nothing comparable: lobbyist names, government entities and
  the specific-issue text would need a new pull of every filing (lda.gov), which is its own piece.
- **Migration 0027** (`db/migrations/0027_contract_details.sql`): `contracts.awarding_sub_agency`,
  `end_date`, `description`, all nullable. The table keeps its public read policy; no grant
  changes. Next free migration number: 0028.
- **Ingest** (`ingest/src/sources/usaspending.ts`; tests beside it): `cleanText` (white space
  collapsed, description cut at `DESCRIPTION_MAX` 1,000, sub-agency at 200), `dateOnly` (a real
  calendar date or NULL). An update never blanks a stored value (`coalesce`). **A full sweep
  counts for the weekly rule only if it ran with this code (`stats.details_stored`)**, so the
  first run after the change re-reads all 400 days and fills awards already held. New stats:
  `rows_with_description`, `rows_with_sub_agency`, `rows_with_end_date`. Test fake:
  `scripts/fake-usaspending.mjs` through `USASPENDING_API_BASE` (tests only; `FAKE_BLANK=1`
  answers with the details blank).
- **Web** (`web/src/lib/contracts.ts`, pure; tests `scripts/contracts.test.ts`): the largest-awards
  table on `/contracts/` and the contracts table on company pages gained "Description, as
  reported" (first `DESCRIPTION_SHOWN` = 140 characters, cut at a word, then an ellipsis; the
  full text is in the CSV and on USAspending) and "End date"; the sub-agency prints under the
  agency when it differs from it (`subAgencyLabel`). New section on `/contracts/`,
  `#sub-agencies` (`section[data-sub-agencies]`): awards and award value per sub-agency, the 25
  largest (`SUB_AGENCY_ROWS`), sortable, with a sentence saying how many awards carry a
  sub-agency. `federal-contracts.csv` gained `awarding_sub_agency`, `end_date`, `description`.
  Nothing is derived from a description (no label, category, flag or total). The on-demand
  company pages (`server/od.ts`) do not show contracts and were not touched.
- **Build log** prints `[web] contract details: N awards in the window; with a description D, a
  sub-agency S, an end date E; K sub-agencies; longest description L; awards/value: <top five>`
  for comparison with SQL.
- **Verifier:** `node scripts/verify-contracts.mjs <base-url> [--sample N]` (no browser; the
  nineteenth). Oracle: `federal-contracts.csv`. Every row of the awards table and of sampled
  company pages against its CSV row (description whole or a true prefix, sub-agency only when
  different, end date), the sub-agency table recounted with the script's own grouping, the
  sentence above it, column names, wording.
- Guides: `federal-contracts-usaspending` has a new section `#details`, one FAQ, two labels and
  covers `contracts.ts` (`ctx.contractDescriptionShown` is the live value for "140");
  `how-to-cite-and-reuse` names the new CSV columns; `what-is-form-4` re-read, unchanged.
  Methodology `#contract-details`.
- The seed's contracts carry the details: a long description, one with quotes and angle
  brackets, a sub-agency equal to its agency, and one award with none.
- Not done: no filter or search by description, no NAICS names, no place of performance, no
  product or service code, no award type, no extra lobbying fields.
- **First live sweep (ingest run 44431795386, 2026-11-19 00:47 UTC): the request shape is proven,
  and coverage is partial by design of the job.** `success`, mode full, 7,608 rows seen, 7,607 with
  a description, 7,608 with a sub-agency and an end date, longest description 250 characters. But
  the table holds 17,907 awards and the 180-day window 5,921, of which 3,415 carry details: the
  other 2,506 were stored by earlier runs and are no longer among "the 300 largest of each 30-day
  slice" (the slices move by a day every day) or a tracked company's first 300, so no sweep
  reads them again. The page, the guide and the CSV dictionary say so. **Closing the gap needs a
  fetch by award id** (USAspending `/api/v2/awards/<generated_internal_id>/`; shape unverified):
  about 2,500 requests for the window, a job with a time budget of its own. Not built.

### Contract details for awards the searches no longer return, by award id (2026-11-19, scheduled parity run) — queue item (g2a)

- **Source `usaspending_details`** (`ingest/src/sources/usaspending_details.ts`; tests beside it): for
  every award with a blank description, sub-agency or end date that was never asked for by id, one
  `GET /api/v2/awards/<generated_internal_id>/` (the id is `contracts.source_ref`). It reads
  `description`, `awarding_agency.subtier_agency.name` and `period_of_performance.end_date`, cleans
  them with the search job's `cleanText` and `dateOnly`, and **fills blanks only** (a value the search
  stored is kept). Newest start date first, so the site's 180-day window is filled first.
- **Migration 0028** `contracts.details_checked_at` (NULL = never asked by id). Every award answered
  gets it, also on a 404 or when the answer adds nothing, so it is not asked for again. A failed
  request leaves it NULL. Next free migration number: 0029.
- **Guards.** `USASPENDING_DETAILS_MAX_MINUTES` (40) ends a run as `partial` with `remaining`; 5
  failures in a row end it as `failed`; if the first 20 answers carry none of the keys
  `description`, `awarding_agency`, `period_of_performance` it ends as `failed` and marks nothing
  (answers are held, not written, until one has the shape). An odd answer among good ones is counted
  (`odd_answers`) and left for another run. One retry per request, 1.5 s apart (about 1,500 awards a
  run). Stats: `to_check`, `checked`, `filled_description`, `filled_sub_agency`, `filled_end_date`,
  `nothing_to_add`, `not_found`, `remaining`, `window_180_with_description` of `window_180_rows`.
- **Where it runs:** daily, last in the `company-facts` group of `ingest.yml` (both matrix lists);
  listed in `scripts/freshness-check.mjs`. With no backlog it is a success in seconds. Backlog on
  2026-11-19: 10,300 awards (2,506 in the 180-day window), about seven runs.
- **Test fake:** `scripts/fake-usaspending.mjs` also answers `GET /api/v2/awards/<id>/`
  (`FAKE_DETAILS=noshape|down`; an id holding GONE answers 404, ODD `{}`, BARE the keys with nothing
  in them). Through `USASPENDING_API_BASE`, tests only.
- **Wording:** `/contracts/`, guide `federal-contracts-usaspending` (now also covers the new file) and
  the CSV dictionary say a dash means USAspending lists none or the daily job has not reached the
  award yet. The sentence on `/contracts/` disappears by itself once every award carries a description.
- **First live run (ingest run 44458703744, 2026-11-19 04:30 UTC): the request shape is proven.**
  `partial` on its 40-minute budget as designed: 1,581 awards asked, 1,579 filled with all three
  details, 2 answered 404, 0 failures, 0 odd answers, 8,719 left. The 180-day window went from 3,415
  to 4,994 of 5,921 awards with details (build log = SQL). The sub-agency names that come by id are
  the names the search stores. About 1,580 awards a run, so the window completes on the second run
  and the whole table after about six.

### SEC Form 144 notices, stage 1: stored, not shown (2026-11-19, scheduled parity run) — queue item (g2b)

A Form 144 is a notice that a holder PROPOSES to sell restricted or control securities under Rule
144. It is not a report of a sale. Stage 1 stores the notices; no page, file or feed reads them yet,
so nothing on the site, in the guides or on the privacy page changed.

- **Migration 0029 `form144_notices`** (one row per submission, keyed by accession; 144 and 144/A).
  Columns hold the figures as filed: issuer CIK (10 digits, as `companies.cik`) and name, the
  submission's filer CIK, the seller ("person for whose account"), stated relationships, class,
  `shares` and `market_value` (sums over the form's securities lines), units outstanding, earliest
  approximate sale date, exchange, broker name, earliest Rule 10b5-1 plan adoption date, notice
  date, the past-3-months sales (summed), `payload` (the lines as parsed), `source_url`,
  `parser_version`. Addresses, phone numbers and signatures are not stored. A table of its own,
  not `filings` (`filings.source` is an enum under the `site_*` views and the `od_*` functions).
  Row-level security on, no policy, no API grants; `site_build` may read. Next free number: 0030.
- **Source `sec_form144`** (`ingest/src/sources/sec_form144.ts`; tests beside it): the EDGAR daily
  index walk of `sec_form4_index.ts` (it imports that file's helpers and does not change it), form
  type exactly `144` or `144/A`, every issuer, one request per submission. Start
  `SEC_144_SINCE` (default the Form 4 floor, 2025-10-01); resume `ingest_runs.stats.through`;
  the 2 newest processed days are re-read; `SEC_144_MAX_MINUTES` (30) ends a run `partial`; 5
  request failures in a row end it `failed`. A submission with no data file is counted
  (`no_xml`), not stored.
- **The XML element names were written from memory** (sec.gov is not reachable from the cloud
  sandbox). Guards: nothing is written until one parsed notice has an issuer, a seller and a
  number of units; 20 notices without that shape end the run `failed` with nothing stored and
  the resume point unmoved; `stats.sample_tags` lists the first notice's element names (names
  only); `stats.with_*` count the filled fields. **A parser fix = bump `PARSER_VERSION`**: rows
  written by an older version are fetched and rewritten in place, and the walk restarts from
  the start date (the resume point is per parser version).
- **Where it runs:** daily, after `sec_form4_index` in the `insiders-market` group of
  `ingest.yml` (both matrix lists). `scripts/freshness-check.mjs` lists it by run only; add the
  data date (`dataDays: 6`, newest `filed_at`) once the first catch-up has reached today.
- **Test fake:** `scripts/fake-edgar-144.mjs` through `SEC_EDGAR_BASE` (tests only;
  `FAKE_144=noshape`, `FAKE_FAIL_500=1`, `FAKE_SLOW_MS`). Checked end to end on copies of the
  local database: first run, second run (nothing fetched again), rewrite of older-version rows,
  unknown shape (failed, 0 rows), source down, budget stop and resume.
- **For stage 2 (showing them):** a section on stock and company pages (and insider pages where
  the filer CIK or name matches a person) with the notice's own figures; say on the page that a
  notice is a plan, not a sale, and never add its value to any buy or sell total; 144/A rows
  are amendments and the form does not say which notice they replace; a CSV; a guide; the
  methodology. Market-only issuers need the `od_*` functions (the market-wide thread's files).
