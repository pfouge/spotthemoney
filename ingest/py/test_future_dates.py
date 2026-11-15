"""test_future_dates.py — a trade date later than the filing date is stored as NULL (row kept),
counted in stats.future_dates_nulled. Covers the House mapper, which the Senate import also uses.

Run with `python3 ingest/py/test_future_dates.py` or pytest.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "vendor" / "congress_ptr"))

import congress_ptr_job as job  # noqa: E402

CONF = {"confidence": 1.0, "review": "auto_approved"}


def _map(txn, filed, ctx=None):
    rec = {"transaction_type": "purchase", "transaction_date": txn, "asset_type": "stock"}
    return job.map_transaction_record(rec, 1, 2, 3, CONF, filed_at=filed, ctx=ctx)


def test_future_trade_date_is_nulled_and_counted():
    ctx = job.RunContext("congress_ptr")
    row = _map("2026-12-26", "2026-02-09", ctx)
    assert row["txn_date"] is None and row["disclosure_lag_days"] is None
    assert row["disclosed_at"] == "2026-02-09" and row["side"] == "buy"  # row kept
    assert ctx.stats()["future_dates_nulled"] == 1


def test_normal_dates_untouched():
    ctx = job.RunContext("congress_ptr")
    row = _map("2026-01-20", "2026-02-09", ctx)
    assert row["txn_date"] == "2026-01-20" and row["disclosure_lag_days"] == 20
    same = _map("2026-02-09", "2026-02-09", ctx)
    assert same["txn_date"] == "2026-02-09" and same["disclosure_lag_days"] == 0
    assert "future_dates_nulled" not in ctx.stats()


def test_missing_or_bad_dates_do_not_trip_the_guard():
    assert _map(None, "2026-02-09")["txn_date"] is None
    assert _map("not-a-date", "2026-02-09")["txn_date"] == "not-a-date"
    assert _map("2026-12-26", None)["txn_date"] == "2026-12-26"  # no disclosure date to compare to


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print("PASS", name)
            except Exception as exc:  # noqa: BLE001
                failed += 1; print("FAIL", name, repr(exc))
    raise SystemExit(1 if failed else 0)
