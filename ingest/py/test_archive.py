"""test_archive.py — tests the pure parts of archive.py (object-key derivation,
extension mapping, sha256 hex). archive_bytes/is_archived/backfill_unstored need a live
Postgres + Supabase Storage (and psycopg installed) and are exercised by hand against
the real project, not here.

Runnable with `python3 -m pytest ingest/py/test_archive.py`, or directly with
`python3 ingest/py/test_archive.py` (no pytest required) — both run every test_*
function and print PASS/FAIL, matching this repo's dependency-free-tests constraint.
"""

from __future__ import annotations

import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from archive import (  # noqa: E402 — path insert must come first
    _extension_for,
    _strip_checksum_suffix,
    object_key_for,
    sha256_hex,
)


def test_sha256_hex_matches_hashlib():
    data = b"hello world"
    assert sha256_hex(data) == hashlib.sha256(data).hexdigest()


def test_sha256_hex_is_lowercase_64_char_hex():
    digest = sha256_hex(b"x")
    assert len(digest) == 64
    assert digest == digest.lower()
    int(digest, 16)  # raises ValueError if not valid hex


def test_sha256_hex_of_empty_bytes_is_well_known_value():
    assert sha256_hex(b"") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_object_key_for_basic():
    sha = "abcd1234" + "0" * 56
    date = datetime(2026, 3, 5, tzinfo=timezone.utc)
    key = object_key_for("sec_form4", sha, "application/pdf", date)
    assert key == f"sec_form4/2026/03/ab/{sha}.pdf"


def test_object_key_for_zero_pads_month():
    sha = "ff" * 32
    date = datetime(2026, 1, 9, 23, 59, tzinfo=timezone.utc)
    key = object_key_for("house_ptr", sha, "text/html", date)
    assert key == f"house_ptr/2026/01/ff/{sha}.html"


def test_object_key_for_matches_ts_layout_exactly():
    # Cross-check against ingest/src/lib/archive.ts's objectKeyFor for the same inputs
    # — both languages can write into the same bucket, so the layout must match byte
    # for byte.
    sha = "9e" + "0" * 62
    date = datetime(2026, 9, 27, tzinfo=timezone.utc)
    key = object_key_for("senate_lda", sha, "application/json", date)
    assert key == f"senate_lda/2026/09/9e/{sha}.json"


def test_extension_mapping():
    cases = [
        ("application/xml", "xml"),
        ("text/xml", "xml"),
        ("text/xml; charset=utf-8", "xml"),
        ("application/pdf", "pdf"),
        ("text/html", "html"),
        ("text/html; charset=utf-8", "html"),
        ("application/xhtml+xml", "html"),
        ("application/json", "json"),
        ("application/json; charset=utf-8", "json"),
        ("application/octet-stream", "bin"),
        ("", "bin"),
        ("image/png", "bin"),
    ]
    for content_type, expected_ext in cases:
        assert _extension_for(content_type) == expected_ext, content_type


def test_extension_mapping_case_insensitive():
    assert _extension_for("APPLICATION/PDF") == "pdf"
    assert _extension_for("Text/XML") == "xml"


def test_strip_checksum_suffix():
    sha = "ab" * 32
    assert _strip_checksum_suffix(sha) == sha
    assert _strip_checksum_suffix(f"{sha}:deadbeef") == sha


ALL_TESTS = [obj for name, obj in list(globals().items()) if name.startswith("test_") and callable(obj)]


def _run_standalone() -> int:
    failures = 0
    for fn in ALL_TESTS:
        try:
            fn()
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {fn.__name__}: {exc}")
        else:
            print(f"PASS {fn.__name__}")
    print(f"\n{len(ALL_TESTS) - failures}/{len(ALL_TESTS)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_standalone())
