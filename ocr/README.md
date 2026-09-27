# ocr/ — Congressional-trade OCR pipeline (Phase 2 stub, narrowed scope)

**Scope narrowed 2026-07-06 (integration contract §3.3):** congressional PTRs are NOT a
wholesale OCR problem. IIF's proven congress-ptr parser handles text-based House PDF
filings and **all** Senate eFD reports; those flow in through the Python ingest job
(`ingest/py/`) at confidence 0.9–1.0, auto-approved. This pipeline now covers **only the
scanned/handwritten minority the parser flags `needs_ocr`** — those filings land with
confidence 0.3, review `pending`, `is_published=false`, and their transactions are
deferred here.

## Planned pipeline (for `needs_ocr` filings only)

1. **Receive** filings flagged `needs_ocr` by the congress-ptr job (already in `filings`,
   unpublished, transactions deferred).
2. **Download** the PDF → store raw in Cloudflare R2 (`raw_documents`).
3. **OCR / vision-LLM extract** structured fields: filer, ticker, transaction type,
   amount range, transaction date, disclosure date.
4. **Validate + normalize + dedupe** against the `securities` / `people` reference tables.
5. **Confidence-gate:** high-confidence rows publish to `transactions` automatically;
   low-confidence rows go to `review_queue` for human sign-off **before** publishing.
   Financial-data errors are reputationally expensive — QA is mandatory.

## Why it still matters

The `needs_ocr` remainder is exactly the slice competitors skip or charge for. A clean,
fast, *complete* free dataset — parser + OCR remainder — plus the performance scoreboard
is the flagship's edge. See `../docs/03-roadmap.md` (Phase 2), `../docs/02-data-model.md`,
and `../docs/06-ingestion-contract.md`.
