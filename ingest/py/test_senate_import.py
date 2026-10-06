"""test_senate_import.py — the pure parts of senate_import.py (export loading, amendment
handling, roster matching, asset-type mapping) and a dry run through the vendored parser.

Run with `python3 -m pytest ingest/py/test_senate_import.py` or `python3 ingest/py/test_senate_import.py`.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "vendor" / "congress_ptr"))

import senate_import as si  # noqa: E402

FIXTURE = (HERE / "vendor" / "congress_ptr" / "tests" / "fixtures" / "sample_senate_ptr.html").read_text(encoding="utf-8")
U = "https://efdsearch.senate.gov/search/view/ptr/{}/"
A, B, C, D = ("aaaaaaaa-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002",
              "cccccccc-0000-0000-0000-000000000003", "dddddddd-0000-0000-0000-000000000004")


def _filing(rid, first, last, title, date, kind="ptr", html=FIXTURE):
    url = U.format(rid) if kind == "ptr" else U.format(rid).replace("/ptr/", "/paper/")
    return {"first": first, "last": last, "filer": f"{last}, {first} (Senator)", "title": title, "url": url,
            "date_received": date, "kind": kind, "html": html if kind == "ptr" else ""}


def _write(directory: Path, name: str, filings):
    (directory / name).write_text(json.dumps({"exported_at": "x", "source": "efdsearch.senate.gov", "filings": filings}), encoding="utf-8")


def test_kind_and_id_from_url():
    assert si.kind_and_id(U.format(A)) == ("ptr", A)
    assert si.kind_and_id(U.format(B).replace("/ptr/", "/paper/")) == ("paper", B)
    assert si.kind_and_id("https://example.org/x") == (None, None)


def test_report_key_reads_date_and_amendment_number():
    assert si.report_key("Periodic Transaction Report for 09/15/2026") == ("09/15/2026", 0)
    assert si.report_key("Periodic Transaction Report for 09/15/2026 (Amendment 2)") == ("09/15/2026", 2)
    assert si.report_key("Something else") == (None, 0)


def test_load_exports_merges_files_and_later_file_wins():
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        _write(d, "export-2026-10-06.json", [_filing(A, "Thomas H", "Tuberville", "Periodic Transaction Report for 09/15/2026", "09/20/2026")])
        _write(d, "export-2026-10-13.json", [
            _filing(A, "Thomas H", "Tuberville", "Periodic Transaction Report for 09/15/2026", "09/21/2026"),
            _filing(B, "Richard", "Blumenthal", "Periodic Transaction Report for 08/01/2026", "08/10/2026", kind="paper"),
        ])
        got = si.load_exports(d)
        assert sorted(f["id"] for f in got) == [A, B]
        a = next(f for f in got if f["id"] == A)
        assert a["date_received"] == "09/21/2026" and a["export_file"] == "export-2026-10-13.json"
        assert next(f for f in got if f["id"] == B)["kind"] == "paper"


def test_amendment_supersedes_the_original_only():
    fs = [
        {"id": A, "first": "Thomas H", "last": "Tuberville", "title": "Periodic Transaction Report for 09/15/2026", "date_iso": "2026-09-20"},
        {"id": B, "first": "Thomas H", "last": "Tuberville", "title": "Periodic Transaction Report for 09/15/2026 (Amendment 1)", "date_iso": "2026-09-25"},
        {"id": C, "first": "Thomas H", "last": "Tuberville", "title": "Periodic Transaction Report for 09/16/2026", "date_iso": "2026-09-25"},
        {"id": D, "first": "Rick", "last": "Scott", "title": "Periodic Transaction Report for 09/15/2026", "date_iso": "2026-09-25"},
    ]
    si.mark_superseded(fs)
    assert fs[0].get("superseded_by") == B
    assert all("superseded_by" not in f for f in fs[1:])


def test_amendment_replaces_the_report_it_overlaps_when_two_were_filed_that_day():
    rows = {A: {("r1",), ("r2",), ("r3",), ("r4",)}, B: {("x1",), ("x2",), ("x3",), ("x4",), ("x5",), ("x6",)},
            C: {("x1",), ("x2",), ("x3",), ("x4",), ("x5",), ("x6-fixed",)}}
    fs = [
        {"id": A, "first": "John", "last": "Boozman", "title": "Periodic Transaction Report for 08/17/2026", "date_iso": "2026-08-17"},
        {"id": B, "first": "John", "last": "Boozman", "title": "Periodic Transaction Report for 08/17/2026", "date_iso": "2026-08-17"},
        {"id": C, "first": "John", "last": "Boozman", "title": "Periodic Transaction Report for 08/17/2026 (Amendment 1)", "date_iso": "2026-08-17"},
    ]
    assert si.mark_superseded(fs, lambda f: rows[f["id"]]) == 0
    assert fs[1].get("superseded_by") == C and "superseded_by" not in fs[0] and "superseded_by" not in fs[2]


def test_amendment_with_no_clear_original_supersedes_nothing():
    rows = {A: {("r1",)}, B: {("x1",)}, C: {("z1",), ("z2",)}}
    fs = [
        {"id": A, "first": "John", "last": "Boozman", "title": "Periodic Transaction Report for 08/17/2026", "date_iso": "2026-08-17"},
        {"id": B, "first": "John", "last": "Boozman", "title": "Periodic Transaction Report for 08/17/2026", "date_iso": "2026-08-17"},
        {"id": C, "first": "John", "last": "Boozman", "title": "Periodic Transaction Report for 08/17/2026 (Amendment 1)", "date_iso": "2026-08-17"},
    ]
    assert si.mark_superseded(fs, lambda f: rows[f["id"]]) == 1
    assert all("superseded_by" not in f for f in fs)


def test_second_amendment_replaces_the_first():
    fs = [
        {"id": A, "first": "Thomas H", "last": "Tuberville", "title": "Periodic Transaction Report for 11/15/2024 (Amendment 1)", "date_iso": "2026-08-05"},
        {"id": B, "first": "Thomas H", "last": "Tuberville", "title": "Periodic Transaction Report for 11/15/2024 (Amendment 2)", "date_iso": "2026-08-06"},
    ]
    si.mark_superseded(fs)
    assert fs[0].get("superseded_by") == B and "superseded_by" not in fs[1]


def test_two_originals_for_one_date_are_both_kept():
    fs = [
        {"id": A, "first": "Rick", "last": "Scott", "title": "Periodic Transaction Report for 09/15/2026", "date_iso": "2026-09-20"},
        {"id": B, "first": "Rick", "last": "Scott", "title": "Periodic Transaction Report for 09/15/2026", "date_iso": "2026-09-21"},
    ]
    si.mark_superseded(fs)
    assert all("superseded_by" not in f for f in fs)


ROSTER = [(1, "Tommy Tuberville"), (2, "Rick Scott"), (3, "Tim Scott"), (4, "Mitch McConnell"), (5, "Ben Ray Luján"),
          (6, "John Kennedy"), (7, "Shelley Moore Capito"), (8, "Chris Van Hollen")]


def test_pick_senator_by_surname():
    assert si.pick_senator(ROSTER, "Thomas H", "Tuberville") == 1
    assert si.pick_senator(ROSTER, "A. Mitchell", "McConnell, Jr.") == 4
    assert si.pick_senator(ROSTER, "Ben Ray", "Lujan") == 5
    assert si.pick_senator(ROSTER, "Shelley M", "Capito") == 7
    assert si.pick_senator(ROSTER, "Christopher", "Van Hollen") == 8


def test_pick_senator_shared_surname_uses_first_name():
    assert si.pick_senator(ROSTER, "Rick", "Scott") == 2
    assert si.pick_senator(ROSTER, "Timothy E", "Scott") == 3


def test_pick_senator_returns_none_when_unsure():
    assert si.pick_senator(ROSTER, "Pat", "Toomey") is None           # not a sitting senator
    assert si.pick_senator(ROSTER, "Xavier", "Scott") is None          # two Scotts, neither fits
    assert si.pick_senator(ROSTER, "Rick", "") is None


def test_asset_type_mapping():
    assert si.job_asset_type("Stock") == "stock"
    assert si.job_asset_type("Stock Option") == "option"
    assert si.job_asset_type("Corporate Bond") == "bond"
    assert si.job_asset_type("Municipal Security") == "bond"
    assert si.job_asset_type("Exchange Traded Fund/Note") == "etf"
    assert si.job_asset_type("Other Securities") == "other"
    assert si.job_asset_type(None) == "other"


class _Ctx:
    def __init__(self): self.extra, self.rows_seen, self.rows_changed, self.q = {}, 0, 0, []
    def set_extra(self, k, v): self.extra[k] = v
    def bump(self, k, n=1): self.extra[k] = self.extra.get(k, 0) + n
    def quarantine(self, ref, reason): self.q.append((ref, reason))
    def warn(self, m): pass


def test_dry_run_parses_the_fixture_through_the_vendored_parser(capsys=None):
    import congress_ptr_job as job
    import io, contextlib
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        _write(d, "export-2026-10-06.json", [
            _filing(A, "Thomas H", "Tuberville", "Periodic Transaction Report for 09/15/2026", "09/20/2026"),
            _filing(B, "Thomas H", "Tuberville", "Periodic Transaction Report for 09/15/2026 (Amendment 1)", "09/25/2026"),
            _filing(C, "Richard", "Blumenthal", "Periodic Transaction Report for 08/01/2026", "08/10/2026", kind="paper"),
        ])
        ctx, out = _Ctx(), io.StringIO()
        with contextlib.redirect_stdout(out):
            si.process_senate_exports(None, None, job, ctx, dry_run=True, reprocess=False, directory=d)
        text = out.getvalue()
        assert ctx.extra["senate_export_filings"] == 3 and ctx.rows_seen == 3 and not ctx.q, (ctx.extra, ctx.q)
        assert "3 transactions — superseded" in text and "paper (needs_ocr)" in text
        assert text.count("3 transactions") == 2


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print("PASS", name)
            except Exception as exc:  # noqa: BLE001
                failed += 1; print("FAIL", name, repr(exc))
    raise SystemExit(1 if failed else 0)
