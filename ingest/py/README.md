# congress-ptr — Python ingestion job

## Status (2026-09-27): live for the House, on the vendored IIF parser

Open decision #17 was resolved as **pinned vendored copy**: IIF's `house_client.py`,
`senate_client.py` and `normalize.py` (plus their 28 offline tests and fixtures) live in
`vendor/congress_ptr/`. `VENDORED.md` there records the source paths, hashes, copy date and the
rule: **never edit the vendored files here — fix in IIF, then re-vendor.**

`congress_ptr_job.py` runs the **House** path end to end: annual index → PTRs in the window →
PDF → archive (`archive.py`, Supabase Storage) → pdfplumber text → IIF `parse_ptr_text` →
`people`/`person_roles`/`securities`/`filings`/`transactions` per the contract. Scheduled daily
at 13:00 UTC by `.github/workflows/ingest-congress-ptr.yml`, followed by a redeploy.

**Senate is not run.** IIF's Senate client impersonates a Chrome TLS fingerprint to pass eFD's
Akamai check and needs a residential IP; both are outside this project's no-spoofing policy and
GitHub-hosted runners. The Congress pages say "House filings only" until docs/04 #21 is decided.

## Why Python, not TypeScript

Per the IIF↔spotthemoney integration contract (§1): congressional PTRs are **not** ported to
TypeScript. The House-PDF / Senate-eFD parser is hard-won (multi-era registry handling,
partial-sale fixes) and reimplementing it in TS would mean maintaining two parsers in lockstep
for no benefit. Every other source in `ingest/src/sources/` is a simple REST/CSV feed.

## Running locally

Requires Python 3.11+.

```bash
pip install "psycopg[binary]" pdfplumber requests
python ingest/py/congress_ptr_job.py --window-days 7 --dry-run      # fetch + parse, print, no DB
DATABASE_URL=postgres://... python ingest/py/congress_ptr_job.py --window-days 7 --limit 5
python ingest/py/congress_ptr_job.py --window-days 30 --reprocess   # re-parse filings already stored
```

Parser tests (no network): `cd ingest/py/vendor/congress_ptr && python -m pytest -q tests`, or
without pytest:

```bash
cd ingest/py/vendor/congress_ptr && python3 - <<'EOF'
import importlib, os, sys, traceback
sys.path[:0] = [os.getcwd(), os.path.join(os.getcwd(), "tests")]
ok = fail = 0
for mod in ["test_house_parser", "test_senate_parser", "test_normalize"]:
    m = importlib.import_module(mod)
    for name in [n for n in dir(m) if n.startswith("test_")]:
        try: getattr(m, name)(); ok += 1
        except Exception: fail += 1; traceback.print_exc(limit=1)
print("pass", ok, "fail", fail)
EOF
```

The House Clerk is called with the project's descriptive contact UA (`CONGRESS_PTR_USER_AGENT`,
set by the job) and a ≥1.5 s gap per request. The annual index ZIP (~1 MB) is fetched once per
run; only PDFs for filings not already in `filings` are downloaded, so a re-run downloads nothing.

## Field mapping

Owned by the integration contract, not duplicated here:

- **`docs/06-ingestion-contract.md`** (pointer) → canonical mapping in
  `Investing Intelligence Foundation/shared/architecture/spotthemoney-integration-contract.md`
  **§4.1** and **§3.3**. Two deltas to carry into the next IIF session: `owner` and `asset_type`
  are now columns (`transactions.owner_type`, `transactions.asset_type`, migration 0006), and the
  parser is consumed as a vendored copy.

## Confidence / review rules (contract §3.3)

| Origin | `confidence` | `review` | notes |
|---|---|---|---|
| Senate eFD HTML table parse (structured) | 1.0 | `auto_approved` | not run yet (#21) |
| House PTR text-PDF parse (IIF pdfplumber path) | 0.9 | `auto_approved` | |
| `needs_ocr: true` (scanned House PTR, or text layer with zero parsed rows) | 0.3 | `pending` | `is_published=false`; no transactions inserted; a `review_queue` row is created. Deferred to the Phase-2 OCR pipeline (`ocr/README.md`). |

## Operational rules the job follows

- **Ops rows.** One `sources` row (`code='congress_ptr'`) and one `ingest_runs` row per run with
  rich `stats` (ptrs_in_window, filings_inserted/updated, pdfs_fetched, documents_archived,
  filings_needs_ocr, quarantined sample) — the diagnostic of record.
- **Scrub before every write** (`scrub_strings`, mirrors `ingest/src/lib/sanitize.ts`).
- **Per-row quarantine, not fail-fast**; circuit breaker at 50 quarantined filings.
- **Publish gate is per source, once.** A new source stays `is_published=false` until Peter
  approves a sample (`node scripts/sample-source.mjs house_ptr`, then `--approve`). Approval
  writes a `publish_gates` row (migration 0009); from then on every run ends with
  `select publish_approved_filings()`, which publishes that source's new filings at
  review `auto_approved`/`approved` and confidence ≥ 0.9. `house_ptr` was approved 2026-09-28.
  Scanned filings (`needs_ocr`, confidence 0.3) never qualify and wait for review. The upsert
  never un-publishes a filing already approved.
- **One row per member.** `resolve_person` matches the name as filed, then the seat (chamber +
  state + district with the surname present) so "Allen, Richard W." lands on the roster's
  "Rick W. Allen" row and keeps its party; `congress_roster` merges any older duplicates.
- **Archive first.** Every PDF is stored content-addressed via `archive.py` before parsing;
  `filings.raw_document_id` links to it. Without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` the
  row is recorded and `npm run ingest -- archive_backfill` uploads later.
