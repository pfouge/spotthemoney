#!/usr/bin/env python3
"""congress_ptr_job.py — congressional PTR ingestion (Python, not TS; see ingest/py/README.md).

Contract: Investing Intelligence Foundation
  shared/architecture/spotthemoney-integration-contract.md §3 (cross-cutting conventions),
  §4.1 (congress-ptr field mapping). Pointer copy: docs/06-ingestion-contract.md.

STATUS (2026-09-27): LIVE for the HOUSE. Open decision #17 resolved under the autonomous-
session rules as "pinned vendored copy": IIF's parser modules live in
ingest/py/vendor/congress_ptr/ (see VENDORED.md there for source paths, hashes, and the
never-edit rule). The Senate eFD path is deliberately not run — its client impersonates a
browser TLS fingerprint (against the project's no-spoofing policy) and eFD rejects
datacenter IPs such as GitHub-hosted runners; that route is docs/04 #21, Peter's call.

What one run does (window = --window-days, default 7):
  1. downloads the House Clerk's annual index (<YEAR>FD.zip → XML) and keeps PTRs ("P")
     filed inside the window (an index fetch is ~1 MB; one per run);
  2. for each PTR not already in `filings` (source='house_ptr', external_id=DocID):
     polite delay → fetch the PDF → archive the bytes (archive.py, Supabase Storage) →
     pdfplumber text → IIF's parse_ptr_text;
  3. resolves the member to `people` + `person_roles` (contract §3.1: normalized name +
     chamber; state/district from the index), tickers to `securities`;
  4. upserts the filing, deletes-and-reinserts its transactions (contract §3.2), with
     confidence/review from §3.3 (needs_ocr → 0.3 / pending / no transactions);
  5. writes `sources` + `ingest_runs` bookkeeping with rich stats (ingest_runs is the
     diagnostic of record).

is_published stays FALSE on every filing this job writes until Peter approves a sample
(docs/reference/samples/). The web build renders unpublished rows with a visible
"under review" note; the API (RLS, migration 0006) hides them until the flip.

Usage:
    python ingest/py/congress_ptr_job.py --window-days 7 [--dry-run] [--limit N] [--reprocess]
    --dry-run   fetch + parse, print what would be written, touch no database
    --limit N   stop after N filings (smoke runs)
    --reprocess re-parse filings already present (re-ingest rule applies)
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent
VENDOR = HERE / "vendor" / "congress_ptr"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(VENDOR))

# Honest, descriptive UA for the House Clerk (house_client._ua reads this variable).
os.environ.setdefault("CONGRESS_PTR_USER_AGENT", "spotthemoney.com ingest (Peter Fougerousse <pfouge@gmail.com>)")

SOURCE_CODE = "congress_ptr"
SOURCE_LABEL = "Congressional PTR filings (House Clerk PDF; Senate pending #21)"
SOURCE_CADENCE = "daily"
QUARANTINE_LIMIT = 50
MIN_HOST_GAP_S = 1.5


# ──────────────────────────────────────────────────────────────────────────
# Dependencies (deferred so --dry-run and the unit tests need nothing extra)
# ──────────────────────────────────────────────────────────────────────────
def import_psycopg():
    try:
        import psycopg  # type: ignore
        from psycopg.types.json import Json  # type: ignore
        return psycopg, Json
    except ImportError as exc:
        raise SystemExit("psycopg is required: pip install \"psycopg[binary]\" (see ingest/py/README.md)") from exc


def load_iif_connector():
    """Return the vendored IIF modules (house_client, normalize). Variant A of the old TODO."""
    import house_client  # type: ignore
    import normalize  # type: ignore
    return house_client, normalize


# ──────────────────────────────────────────────────────────────────────────
# String scrubbing — mirrors ingest/src/lib/sanitize.ts
# ──────────────────────────────────────────────────────────────────────────
_ALLOWED_CONTROL = {9, 10, 13}


def _is_disallowed_control(code: int) -> bool:
    if code in _ALLOWED_CONTROL:
        return False
    return code <= 31 or code == 127


def scrub_string(s: str) -> str:
    if not any(_is_disallowed_control(ord(ch)) for ch in s):
        return s
    return "".join(ch for ch in s if not _is_disallowed_control(ord(ch)))


def scrub_strings(value: Any) -> Any:
    if isinstance(value, str):
        return scrub_string(value)
    if isinstance(value, dict):
        return {scrub_string(k): scrub_strings(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub_strings(v) for v in value]
    return value


# ──────────────────────────────────────────────────────────────────────────
# Run bookkeeping — same shape as ingest/src/lib/run.ts
# ──────────────────────────────────────────────────────────────────────────
class SystemicFailureError(Exception):
    def __init__(self, message: str, stats: dict[str, Any]):
        super().__init__(message)
        self.stats = stats


@dataclass
class RunContext:
    source: str
    quarantine_limit: int = QUARANTINE_LIMIT
    rows_seen: int = 0
    rows_changed: int = 0

    def __post_init__(self) -> None:
        self._quarantined: list[dict[str, str]] = []
        self._quarantine_count = 0
        self._warnings: list[str] = []
        self._extra: dict[str, Any] = {}
        self._seen: set[str] = set()

    def quarantine(self, ref: str, reason: str) -> None:
        self._quarantine_count += 1
        if len(self._quarantined) < 20:
            self._quarantined.append({"ref": ref, "reason": reason})
        print(f"QUARANTINE {ref}: {reason}", file=sys.stderr)
        if self._quarantine_count > self.quarantine_limit:
            raise SystemicFailureError(
                f"{self.source}: {self._quarantine_count} rows quarantined (limit {self.quarantine_limit}) — systemic failure",
                self.stats(),
            )

    def warn(self, message: str) -> None:
        self._warnings.append(message)
        print(f"WARN {self.source}: {message}", file=sys.stderr)

    def mark_seen(self, key: str) -> bool:
        if key in self._seen:
            return False
        self._seen.add(key)
        return True

    def set_extra(self, key: str, value: Any) -> None:
        self._extra[key] = value

    def bump(self, key: str, n: int = 1) -> None:
        self._extra[key] = int(self._extra.get(key, 0)) + n

    def stats(self) -> dict[str, Any]:
        return {
            "rows_seen": self.rows_seen,
            "rows_changed": self.rows_changed,
            "quarantined_count": self._quarantine_count,
            "quarantined_sample": self._quarantined,
            "warnings": self._warnings,
            **self._extra,
        }


# ──────────────────────────────────────────────────────────────────────────
# Pure mapping helpers (unit-testable, no I/O)
# ──────────────────────────────────────────────────────────────────────────
_PTR_SIDE_MAP: dict[str, str] = {"purchase": "buy", "sale": "sell", "sale_partial": "sell", "exchange": "exchange"}
_ASSET_TO_SECURITY_TYPE: dict[str, str] = {
    "stock": "equity", "etf": "etf", "option": "option", "bond": "bond",
    "fund": "fund", "hedge_fund": "fund", "crypto": "crypto",
}


def map_txn_side(transaction_type: Optional[str]) -> tuple[str, Optional[str]]:
    if transaction_type is None:
        return "other", None
    token = transaction_type.strip().lower()
    return _PTR_SIDE_MAP.get(token, "other"), token


def security_type_for(asset_type: Optional[str]) -> str:
    return _ASSET_TO_SECURITY_TYPE.get((asset_type or "").lower(), "other")


def assign_confidence_review(needs_ocr: bool, chamber: str) -> dict[str, Any]:
    if needs_ocr:
        return {"confidence": 0.3, "review": "pending", "is_published": False, "defer_transactions_to_ocr": True}
    return {"confidence": 1.0 if chamber == "senate" else 0.9, "review": "auto_approved",
            "is_published": False, "defer_transactions_to_ocr": False}


def filing_source_enum(chamber: str) -> str:
    if chamber == "house":
        return "house_ptr"
    if chamber == "senate":
        return "senate_ptr"
    raise ValueError(f"unrecognized chamber {chamber!r}")


def display_name(member: str) -> str:
    """'Green, Mark' → 'Mark Green'; 'Pelosi, Nancy Hon.' keeps suffix order as given."""
    if "," in member:
        last, first = [p.strip() for p in member.split(",", 1)]
        return f"{first} {last}".strip()
    return member.strip()


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:80] or "member"


def parse_state_district(sd: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """'CA31' → ('CA', '31'); 'TX' → ('TX', None); None → (None, None)."""
    if not sd:
        return None, None
    m = re.match(r"^([A-Z]{2})(\d{1,2})?$", sd.strip().upper())
    if not m:
        return None, None
    return m.group(1), (m.group(2).lstrip("0") or "0") if m.group(2) else None


def lag_days(disclosed: Optional[str], txn: Optional[str]) -> Optional[int]:
    try:
        if not disclosed or not txn:
            return None
        return (dt.date.fromisoformat(disclosed) - dt.date.fromisoformat(txn)).days
    except ValueError:
        return None


def map_transaction_record(record: dict[str, Any], filing_id: int, person_id: Optional[int],
                           security_id: Optional[int], conf: dict[str, Any]) -> dict[str, Any]:
    """One IIF TransactionRecord (dict) → one `transactions` row (contract §4.1)."""
    side, code = map_txn_side(record.get("transaction_type"))
    return {
        "filing_id": filing_id,
        "person_id": person_id,
        "security_id": security_id,
        "side": side,
        "txn_code": code,
        "is_derivative": (record.get("asset_type") == "option") or None,
        "txn_date": record.get("transaction_date"),
        "disclosed_at": record.get("disclosure_date"),
        "amount_low": record.get("amount_min"),
        "amount_high": record.get("amount_max"),
        "disclosure_lag_days": lag_days(record.get("disclosure_date"), record.get("transaction_date")),
        "confidence": conf["confidence"],
        "review": conf["review"],
        "owner_type": record.get("owner") or "self",
        "asset_type": record.get("asset_type"),
    }


# ──────────────────────────────────────────────────────────────────────────
# DB helpers (psycopg; caller commits)
# ──────────────────────────────────────────────────────────────────────────
def resolve_person(conn, member: str, chamber: str, state_district: Optional[str]) -> int:
    """Contract §3.1: normalized name + an active congress role in the same chamber; create on miss."""
    name = scrub_string(display_name(member))
    slug = slugify(name)
    state, district = parse_state_district(state_district)
    with conn.cursor() as cur:
        cur.execute(
            """
            select p.id from people p
              join person_roles r on r.person_id = p.id and r.role_kind = 'congress' and r.chamber = %s
             where lower(p.full_name) = lower(%s) and (r.valid_to is null or r.valid_to >= current_date)
             order by p.id limit 1
            """,
            (chamber, name),
        )
        row = cur.fetchone()
        if row:
            return row[0]
        # Collision-safe slug: append -2, -3 … (never regenerated later).
        cur.execute("select slug from people where slug = %s or slug ~ %s", (slug, f"^{re.escape(slug)}-\\d+$"))
        taken = {r[0] for r in cur.fetchall()}
        final = slug
        n = 2
        while final in taken:
            final = f"{slug}-{n}"
            n += 1
        cur.execute(
            "insert into people (full_name, first_name, last_name, slug) values (%s, %s, %s, %s) returning id",
            (name, name.split(" ")[0] if " " in name else None, name.split(" ")[-1] if " " in name else name, final),
        )
        person_id = cur.fetchone()[0]
        cur.execute(
            "insert into person_roles (person_id, role_kind, chamber, state, district, valid_from) values (%s, 'congress', %s, %s, %s, current_date)",
            (person_id, chamber, state, district),
        )
        return person_id


def resolve_security(conn, ticker: Optional[str], asset: Optional[str], asset_type: Optional[str]) -> Optional[int]:
    if not ticker:
        return None
    sec_type = security_type_for(asset_type)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into securities (ticker, type, name, is_active)
            values (%s, %s::security_type, %s, true)
            on conflict (ticker, type) do update set name = coalesce(securities.name, excluded.name)
            returning id
            """,
            (scrub_string(ticker.upper()), sec_type, scrub_string(asset) if asset else None),
        )
        return cur.fetchone()[0]


def upsert_filing(conn, Json, filing_row: dict[str, Any]) -> tuple[int, bool]:
    row = scrub_strings(filing_row)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into filings (source, external_id, filer_person_id, filed_at, source_url,
                                 confidence, review, is_published, payload)
            values (%(source)s::filing_source, %(external_id)s, %(filer_person_id)s, %(filed_at)s, %(source_url)s,
                    %(confidence)s, %(review)s::review_status, %(is_published)s, %(payload)s)
            on conflict (source, external_id) do update
                set filer_person_id = excluded.filer_person_id,
                    filed_at        = excluded.filed_at,
                    source_url      = excluded.source_url,
                    confidence      = excluded.confidence,
                    review          = excluded.review,
                    -- never un-publish a filing Peter has already approved
                    is_published    = filings.is_published or excluded.is_published,
                    payload         = excluded.payload
            returning id, (xmax = 0) as inserted
            """,
            {
                "source": row["source"], "external_id": row["external_id"],
                "filer_person_id": row.get("filer_person_id"), "filed_at": row.get("filed_at"),
                "source_url": row["source_url"], "confidence": row["confidence"], "review": row["review"],
                "is_published": row["is_published"], "payload": Json(row.get("payload") or {}),
            },
        )
        filing_id, inserted = cur.fetchone()
    return filing_id, inserted


def reingest_transactions(conn, filing_id: int, transaction_rows: list[dict[str, Any]]) -> int:
    with conn.cursor() as cur:
        cur.execute("delete from transactions where filing_id = %s", (filing_id,))
        written = 0
        for row in transaction_rows:
            clean = scrub_strings(row)
            cur.execute(
                """
                insert into transactions (filing_id, person_id, security_id, side, txn_code, is_derivative,
                                          txn_date, disclosed_at, amount_low, amount_high, disclosure_lag_days,
                                          confidence, review, owner_type, asset_type)
                values (%(filing_id)s, %(person_id)s, %(security_id)s, %(side)s::txn_side, %(txn_code)s, %(is_derivative)s,
                        %(txn_date)s, %(disclosed_at)s, %(amount_low)s, %(amount_high)s, %(disclosure_lag_days)s,
                        %(confidence)s, %(review)s::review_status, %(owner_type)s, %(asset_type)s)
                """,
                clean,
            )
            written += 1
    return written


def ensure_source_row(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "insert into sources (code, label, cadence) values (%s, %s, %s) on conflict (code) do update set label = excluded.label returning id",
            (SOURCE_CODE, SOURCE_LABEL, SOURCE_CADENCE),
        )
        (source_id,) = cur.fetchone()
    conn.commit()
    return source_id


def start_run(conn, source_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute("insert into ingest_runs (source_id, status) values (%s, 'running') returning id", (source_id,))
        (run_id,) = cur.fetchone()
    conn.commit()
    return run_id


def finish_run(conn, Json, run_id: int, status: str, ctx: RunContext, error: Optional[str]) -> None:
    conn.rollback()  # drop any half-done filing transaction before writing the run row
    with conn.cursor() as cur:
        cur.execute(
            "update ingest_runs set finished_at = now(), status = %s::run_status, rows_seen = %s, rows_changed = %s, error = %s, stats = %s where id = %s",
            (status, ctx.rows_seen, ctx.rows_changed, error, Json(ctx.stats()), run_id),
        )
    conn.commit()


# ──────────────────────────────────────────────────────────────────────────
# The House loop
# ──────────────────────────────────────────────────────────────────────────
def house_filings_in_window(house, window_days: int, ctx: RunContext) -> list:
    today = dt.date.today()
    cutoff = today - dt.timedelta(days=window_days)
    years = sorted({today.year, cutoff.year})
    out = []
    for year in years:
        xml = house.download_index(year)
        filings = house.parse_index_xml(xml, filing_type="P")
        ctx.set_extra(f"index_ptrs_{year}", len(filings))
        for f in filings:
            if f.filing_date and dt.date.fromisoformat(f.filing_date) >= cutoff and f.doc_id:
                out.append(f)
    out.sort(key=lambda f: (f.filing_date or "", f.doc_id or ""))
    return out


def process_house_filing(conn, Json, house, f, ctx: RunContext, *, dry_run: bool, archive) -> None:
    year = (f.filing_date or "")[:4] or str(dt.date.today().year)
    pdf_url = house.ptr_pdf_url(year, f.doc_id)
    pdf = house.fetch_ptr_pdf(year, f.doc_id)
    ctx.bump("pdfs_fetched")
    text = house.extract_pdf_text(pdf)
    needs_ocr = not text
    records = [] if needs_ocr else house.parse_ptr_text(
        text, member=f.member, doc_id=f.doc_id, source_url=pdf_url, state_district=f.state_district)
    if not needs_ocr and not records:
        needs_ocr = True  # text layer present but no transactions parsed → treat as OCR/review case
        ctx.bump("parsed_empty")
    conf = assign_confidence_review(needs_ocr, "house")

    if dry_run:
        print(f"[dry-run] {f.filing_date} DocID {f.doc_id} {f.member} ({f.state_district}): "
              f"{'needs_ocr' if needs_ocr else f'{len(records)} transactions'}")
        for r in records[:5]:
            print(f"           {r.transaction_type:<12} {r.transaction_date} {r.ticker or '-':<6} {r.amount_range_text or ''}  {r.asset or ''}")
        return

    person_id = resolve_person(conn, f.member, "house", f.state_district)
    payload = {
        "member": f.member, "state_district": f.state_district, "filing_date": f.filing_date,
        "needs_ocr": needs_ocr, "records": [r.to_dict() for r in records],
    }
    filing_id, inserted = upsert_filing(conn, Json, {
        "source": "house_ptr", "external_id": f.doc_id, "filer_person_id": person_id,
        "filed_at": f.filing_date, "source_url": pdf_url,
        "confidence": conf["confidence"], "review": conf["review"], "is_published": conf["is_published"],
        "payload": payload,
    })
    ctx.bump("filings_inserted" if inserted else "filings_updated")

    # Archive the PDF (best-effort, keyed by URL). archive.py never raises for storage errors.
    try:
        res = archive.archive_bytes(conn, source="house_ptr", source_url=pdf_url, data=pdf,
                                    content_type="application/pdf", filing_id=filing_id)
        if res.get("stored"):
            ctx.bump("documents_archived")
        with conn.cursor() as cur:
            cur.execute("update filings set raw_document_id = %s where id = %s", (res.get("raw_document_id"), filing_id))
    except Exception as exc:  # noqa: BLE001
        ctx.warn(f"archive failed for DocID {f.doc_id}: {exc}")

    rows = []
    if not conf["defer_transactions_to_ocr"]:
        for r in records:
            d = r.to_dict()
            security_id = resolve_security(conn, d.get("ticker"), d.get("asset"), d.get("asset_type"))
            rows.append(map_transaction_record(d, filing_id, person_id, security_id, conf))
    written = reingest_transactions(conn, filing_id, rows)
    ctx.rows_changed += written + 1
    if conf["defer_transactions_to_ocr"]:
        with conn.cursor() as cur:
            cur.execute(
                "insert into review_queue (filing_id, reason, confidence, status) values (%s, 'needs_ocr', %s, 'pending')",
                (filing_id, conf["confidence"]),
            )
        ctx.bump("filings_needs_ocr")
    conn.commit()


# ──────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────
def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest House PTR filings via IIF's vendored parser.")
    parser.add_argument("--window-days", type=int, default=7)
    parser.add_argument("--dry-run", action="store_true", help="fetch + parse, print, write nothing")
    parser.add_argument("--limit", type=int, default=0, help="stop after N filings (0 = all)")
    parser.add_argument("--reprocess", action="store_true", help="re-parse filings already in the DB")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    ctx = RunContext(source=SOURCE_CODE)
    ctx.set_extra("window_days", args.window_days)
    ctx.set_extra("dry_run", args.dry_run)
    ctx.set_extra("chamber", "house")

    house, _normalize = load_iif_connector()
    import archive  # type: ignore  # ingest/py/archive.py

    conn = None
    Json = None
    run_id = None
    if not args.dry_run:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise SystemExit("DATABASE_URL is required (not set). See ingest/py/README.md.")
        psycopg, Json = import_psycopg()
        conn = psycopg.connect(database_url)
        run_id = start_run(conn, ensure_source_row(conn))

    status, error = "failed", None
    try:
        filings = house_filings_in_window(house, args.window_days, ctx)
        ctx.set_extra("ptrs_in_window", len(filings))
        existing: set[str] = set()
        if conn is not None and not args.reprocess:
            with conn.cursor() as cur:
                cur.execute("select external_id from filings where source = 'house_ptr' and external_id = any(%s)",
                            ([f.doc_id for f in filings],))
                existing = {r[0] for r in cur.fetchall()}
            conn.commit()
        ctx.set_extra("filings_skipped_existing", len(existing))

        processed = 0
        last_fetch = 0.0
        for f in filings:
            if f.doc_id in existing or not ctx.mark_seen(f.doc_id):
                continue
            if args.limit and processed >= args.limit:
                break
            ctx.rows_seen += 1
            gap = MIN_HOST_GAP_S - (time.time() - last_fetch)
            if gap > 0:
                time.sleep(gap)
            last_fetch = time.time()
            try:
                process_house_filing(conn, Json, house, f, ctx, dry_run=args.dry_run, archive=archive)
                processed += 1
            except SystemicFailureError:
                raise
            except Exception as exc:  # noqa: BLE001
                if conn is not None:
                    conn.rollback()
                ctx.quarantine(f"house:{f.doc_id}", f"{type(exc).__name__}: {exc}")
        ctx.set_extra("filings_processed", processed)
        status = "success"
    except SystemicFailureError as exc:
        error, status = str(exc), "failed"
        for k, v in exc.stats.items():
            ctx.set_extra(k, v)
    except Exception as exc:  # noqa: BLE001
        error, status = f"{type(exc).__name__}: {exc}", "failed"
    finally:
        if conn is not None:
            finish_run(conn, Json, run_id, status, ctx, error)
            conn.close()

    print(f"{'✓' if not error else '✗'} {SOURCE_CODE}: {ctx.rows_seen} seen, {ctx.rows_changed} written ({status})"
          + (f" — {error}" if error else ""))
    return 1 if error else 0


if __name__ == "__main__":
    raise SystemExit(main())
