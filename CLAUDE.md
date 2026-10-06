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
