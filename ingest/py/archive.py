"""archive.py — raw-filing archive helpers (Supabase Storage), Python counterpart of
ingest/src/lib/archive.ts, for the congress-ptr job (congress_ptr_job.py).

WHY: origin pages (House Clerk PDFs, Senate eFD HTML) can vanish or get rate-limited on
re-fetch; archiving the original bytes once, content-addressed by sha256, means
re-processing / OCR reruns / audits never need to hit the origin again.

BINDING RULES (mirror archive.ts exactly — keep both in sync):
  - Storage is best-effort and NEVER raises for an HTTP failure: a failed upload just
    leaves storage_bucket NULL and logs a warning, so a later backfill pass can retry.
    A DB error (other than the documented checksum-collision case below) still
    propagates — row bookkeeping is not optional the way storage is.
  - `checksum` is UNIQUE on raw_documents in addition to the (source_url) upsert key,
    so two different source_urls that happen to hold byte-identical content collide
    there. We do not fail the write for that: we retry the insert with checksum
    suffixed `<sha256>:<sha256(source_url) first 8 hex chars>` — there is no spare
    column to record the collision out of band, so the suffix on the stored checksum
    *is* the record of it. The failed insert aborts the current (sub)transaction, so
    the retry runs inside a SAVEPOINT (conn.transaction()) that rolls back only that
    attempt, never the caller's outer transaction.
  - If credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) are missing, the
    raw_documents row is still written (r2_key = the object key it *would* use,
    storage_bucket left NULL). Exactly one warning per process for this, not one per
    document.
  - autocommit is OFF and this module never calls conn.commit() — committing is the
    caller's job, exactly like congress_ptr_job.py's other DB helpers (upsert_filing,
    reingest_transactions, etc).
  - Polite-client rule (matches congress_ptr_job.py / the TS lib/http.ts policy): at
    most one upload in flight per process (this module is called sequentially, so a
    plain module-level flag is enough — no thread lock needed), and at most one retry,
    only on a 5xx.

Storage REST API: base `${SUPABASE_URL}/storage/v1`; auth via both
`Authorization: Bearer <service role key>` and `apikey: <service role key>`. Bucket
creation (`POST /bucket`) is idempotent (409 / "already exists" -> success). Upload
(`POST /object/raw-filings/<key>`) takes the raw bytes with `x-upsert: true`, which also
makes a second upload of an identical key (e.g. the checksum-collision case) a safe
no-op rather than an error.
"""

from __future__ import annotations

import hashlib
import os
import sys
from datetime import datetime, timezone
from typing import Any, Callable, Optional

BUCKET = "raw-filings"
_ARCHIVE_UA = "spotthemoney.com ingest (Peter Fougerousse <pfouge@gmail.com>)"

_bucket_ensured = False
_warned_missing_credentials = False


def archive_configured() -> bool:
    """True when both Supabase Storage env vars are present."""
    return bool(os.environ.get("SUPABASE_URL")) and bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


def sha256_hex(data: bytes) -> str:
    """Lowercase hex sha256 of `data` — the `raw_documents.checksum` format."""
    return hashlib.sha256(data).hexdigest()


_EXTENSION_BY_CONTENT_TYPE = {
    "application/xml": "xml",
    "text/xml": "xml",
    "application/pdf": "pdf",
    "text/html": "html",
    "application/xhtml+xml": "html",
    "application/json": "json",
}


def _extension_for(content_type: str) -> str:
    base = (content_type or "").split(";", 1)[0].strip().lower()
    return _EXTENSION_BY_CONTENT_TYPE.get(base, "bin")


def object_key_for(source: str, sha256_hexdigest: str, content_type: str, date: datetime) -> str:
    """`<source>/<yyyy>/<mm>/<sha256 first 2 chars>/<sha256>.<ext>`, yyyy/mm taken from
    `date` (caller passes a UTC datetime) — must match archive.ts's objectKeyFor byte
    for byte, since either language's job can write into the same bucket."""
    yyyy = f"{date.year:04d}"
    mm = f"{date.month:02d}"
    ext = _extension_for(content_type)
    return f"{source}/{yyyy}/{mm}/{sha256_hexdigest[:2]}/{sha256_hexdigest}.{ext}"


def _strip_checksum_suffix(checksum: str) -> str:
    return checksum.split(":", 1)[0]


def _storage_base_url() -> str:
    return os.environ["SUPABASE_URL"].rstrip("/") + "/storage/v1"


def _storage_headers(extra: Optional[dict[str, str]] = None) -> dict[str, str]:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    if extra:
        headers.update(extra)
    return headers


def _ensure_bucket() -> None:
    global _bucket_ensured
    if _bucket_ensured:
        return
    import requests

    res = requests.post(
        f"{_storage_base_url()}/bucket",
        headers={**_storage_headers(), "Content-Type": "application/json"},
        json={"id": BUCKET, "name": BUCKET, "public": False},
        timeout=30,
    )
    if res.ok or res.status_code == 409 or "already exists" in res.text.lower():
        _bucket_ensured = True
        return
    raise RuntimeError(f"ensure_bucket failed: HTTP {res.status_code} {res.text}")


def _upload_object(object_key: str, data: bytes, content_type: str) -> None:
    import requests

    url = f"{_storage_base_url()}/object/{BUCKET}/{object_key}"
    headers = {**_storage_headers(), "Content-Type": content_type, "x-upsert": "true"}
    res = requests.post(url, headers=headers, data=data, timeout=60)
    if not res.ok and res.status_code >= 500:
        res = requests.post(url, headers=headers, data=data, timeout=60)  # one retry, 5xx only
    if not res.ok:
        raise RuntimeError(f"upload failed: HTTP {res.status_code} {res.text}")


def _is_checksum_unique_violation(exc: Exception) -> bool:
    """True for a psycopg UniqueViolation on a constraint whose name contains
    'checksum' (SQLSTATE 23505 — callers only reach this after catching
    psycopg.errors.UniqueViolation, so the sqlstate itself is already implied)."""
    diag = getattr(exc, "diag", None)
    constraint = (getattr(diag, "constraint_name", None) or "").lower()
    return "checksum" in constraint


def _warn(message: str) -> None:
    print(f"WARN archive: {message}", file=sys.stderr)


def _warn_missing_credentials_once() -> None:
    global _warned_missing_credentials
    if _warned_missing_credentials:
        return
    _warned_missing_credentials = True
    _warn(
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — raw_documents rows are "
        "recorded without uploading; re-run the backfill once credentials exist."
    )


def is_archived(conn, source_url: str) -> Optional[dict[str, Any]]:
    """Look up an already-archived row by source_url. Returns None if none exists."""
    with conn.cursor() as cur:
        cur.execute(
            "select id, storage_bucket from raw_documents where source_url = %s limit 1",
            (source_url,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    doc_id, storage_bucket = row
    return {"id": doc_id, "stored": storage_bucket is not None}


def _insert_row(
    conn,
    *,
    source: str,
    object_key: str,
    content_type: str,
    checksum: str,
    source_url: str,
    filing_id: Optional[int],
) -> tuple[int, Optional[str], bool]:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into raw_documents (source, r2_key, content_type, checksum, source_url, filing_id)
            values (%(source)s, %(r2_key)s, %(content_type)s, %(checksum)s, %(source_url)s, %(filing_id)s)
            on conflict (source_url) where source_url is not null do update
                set filing_id = coalesce(excluded.filing_id, raw_documents.filing_id)
            returning id, storage_bucket, (xmax = 0) as inserted
            """,
            {
                "source": source,
                "r2_key": object_key,
                "content_type": content_type,
                "checksum": checksum,
                "source_url": source_url,
                "filing_id": filing_id,
            },
        )
        row = cur.fetchone()
    doc_id, storage_bucket, inserted = row
    return doc_id, storage_bucket, inserted


def archive_bytes(
    conn,
    *,
    source: str,
    source_url: str,
    data: bytes,
    content_type: str,
    filing_id: Optional[int] = None,
) -> dict[str, Any]:
    """Archives one document's bytes: hashes them, upserts the raw_documents row, and
    (if credentials are configured and the row isn't already stored) uploads to
    Supabase Storage. Never raises for a storage failure — see the module docstring."""
    from psycopg.errors import UniqueViolation  # lazy: keeps pure functions importable without psycopg

    checksum = sha256_hex(data)
    fetched_at = datetime.now(timezone.utc)
    object_key = object_key_for(source, checksum, content_type, fetched_at)
    effective_checksum = checksum

    try:
        with conn.transaction():  # SAVEPOINT if already inside a transaction
            doc_id, storage_bucket, inserted = _insert_row(
                conn, source=source, object_key=object_key, content_type=content_type,
                checksum=checksum, source_url=source_url, filing_id=filing_id,
            )
    except UniqueViolation as exc:
        if not _is_checksum_unique_violation(exc):
            raise
        # Byte-identical content already archived under a different source_url. Keep
        # this row (the source_url dedupe key still matters) by suffixing the checksum
        # so the UNIQUE constraint doesn't collide; see the module docstring.
        suffix = sha256_hex(source_url.encode("utf-8"))[:8]
        effective_checksum = f"{checksum}:{suffix}"
        _warn(
            f"raw_documents.checksum collision for {source_url} (sha256 {checksum} already "
            f"stored under a different source_url); storing with suffixed checksum {effective_checksum}"
        )
        with conn.transaction():
            doc_id, storage_bucket, inserted = _insert_row(
                conn, source=source, object_key=object_key, content_type=content_type,
                checksum=effective_checksum, source_url=source_url, filing_id=filing_id,
            )

    deduped = not inserted

    if storage_bucket is not None:
        return {
            "raw_document_id": doc_id,
            "checksum": effective_checksum,
            "object_key": object_key,
            "stored": True,
            "deduped": deduped,
        }

    if not archive_configured():
        _warn_missing_credentials_once()
        return {
            "raw_document_id": doc_id,
            "checksum": effective_checksum,
            "object_key": object_key,
            "stored": False,
            "deduped": deduped,
        }

    stored = False
    try:
        _ensure_bucket()
        _upload_object(object_key, data, content_type)
        with conn.cursor() as cur:
            cur.execute(
                """
                update raw_documents
                set storage_bucket = %s, stored_at = now(), byte_size = %s, content_type = %s, r2_key = %s
                where id = %s
                """,
                (BUCKET, len(data), content_type, object_key, doc_id),
            )
        stored = True
    except Exception as exc:  # noqa: BLE001 — storage failures are never fatal
        _warn(f"upload failed for raw_documents.id={doc_id} ({object_key}): {exc}")

    return {
        "raw_document_id": doc_id,
        "checksum": effective_checksum,
        "object_key": object_key,
        "stored": stored,
        "deduped": deduped,
    }


def _default_fetch_bytes(url: str) -> tuple[bytes, str]:
    import requests

    res = requests.get(url, headers={"user-agent": _ARCHIVE_UA}, timeout=60)
    res.raise_for_status()
    content_type = res.headers.get("content-type") or "application/octet-stream"
    return res.content, content_type


def backfill_unstored(
    conn,
    *,
    limit: int = 200,
    fetch_bytes: Optional[Callable[[str], tuple[bytes, str]]] = None,
) -> dict[str, Any]:
    """Uploads any rows recorded (via archive_bytes) with storage_bucket still NULL —
    e.g. because credentials weren't configured at archive time. Verifies the
    re-fetched bytes still hash to the stored checksum before uploading."""
    fetch = fetch_bytes or _default_fetch_bytes

    with conn.cursor() as cur:
        cur.execute(
            """
            select id, source_url, checksum, r2_key
            from raw_documents
            where storage_bucket is null
            order by id
            limit %s
            """,
            (limit,),
        )
        rows = cur.fetchall()

    stored = 0
    failed: list[dict[str, Any]] = []

    for doc_id, source_url, checksum, object_key in rows:
        if not source_url:
            failed.append({"id": doc_id, "error": "no source_url to re-fetch"})
            continue
        if not archive_configured():
            _warn_missing_credentials_once()
            failed.append({"id": doc_id, "error": "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set"})
            continue

        try:
            data, content_type = fetch(source_url)
            actual = sha256_hex(data)
            expected = _strip_checksum_suffix(checksum) if checksum else None
            if expected and actual != expected:
                failed.append({"id": doc_id, "error": f"sha256 mismatch: expected {expected}, got {actual}"})
                continue

            try:
                _ensure_bucket()
                _upload_object(object_key, data, content_type)
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update raw_documents
                        set storage_bucket = %s, stored_at = now(), byte_size = %s, content_type = %s
                        where id = %s
                        """,
                        (BUCKET, len(data), content_type, doc_id),
                    )
                stored += 1
            except Exception as exc:  # noqa: BLE001 — storage failures are never fatal
                _warn(f"backfill upload failed for raw_documents.id={doc_id}: {exc}")
                failed.append({"id": doc_id, "error": "upload failed (see warning log)"})
        except Exception as exc:  # noqa: BLE001 — one bad row must not kill the backfill
            failed.append({"id": doc_id, "error": str(exc)})

    return {"attempted": len(rows), "stored": stored, "failed": failed}
