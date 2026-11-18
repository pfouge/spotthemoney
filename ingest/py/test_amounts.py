"""test_amounts.py — amounts the vendored parser gets wrong are put right in the job layer.

Two shapes seen on production: an exact amount with cents ("$2,761.57", parsed as 2761 to 57)
and the form's open-topped spouse / dependent-child box ("Spouse/DC Over $1,000,000", parsed as
1,000,000 to 1,000,000). Covers `fix_amounts` and the mapper both chambers use.

Run with `python3 ingest/py/test_amounts.py` or pytest.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "vendor" / "congress_ptr"))

import congress_ptr_job as job  # noqa: E402
import normalize  # noqa: E402  (the vendored parser's own amount reader)

CONF = {"confidence": 1.0, "review": "auto_approved"}


def _rec(text):
    """A record as the parser would hand it over for this amount cell."""
    amin, amax, norm = normalize.parse_amount_range(text)
    return {"transaction_type": "sale", "transaction_date": "2026-03-03", "asset_type": "stock",
            "amount_min": amin, "amount_max": amax, "amount_range_text": norm}


def test_parser_still_splits_an_exact_amount():
    # The fault this layer exists for. If the vendored parser is ever fixed, this test says so.
    assert normalize.parse_amount_range("$2,761.57")[:2] == (2761, 57)
    assert normalize.parse_amount_range("Spouse/DC Over $1,000,000")[:2] == (1000000, 1000000)


def test_exact_amounts_round_half_up_to_one_figure():
    # Every exact amount on production on 2026-11-18, with the stored (wrong) pair it replaces.
    cases = {"$2,761.57": 2762, "$1,118.07": 1118, "$459.77": 460, "$1,972.55": 1973, "$2,000.00": 2000,
             "$224.00": 224, "$1,140.00": 1140, "$15.00": 15, "$318.74": 319, "$707.21": 707,
             "$584.22": 584, "$2,722.50": 2723, "$344.99": 345, "$710.52": 711, "$0.49": 0, "$7.5": 8}
    for text, want in cases.items():
        assert job.fix_amounts(_rec(text)) == (want, want, "exact"), text


def test_spouse_dc_over_box_has_no_top():
    assert job.fix_amounts(_rec("Spouse/DC Over $1,000,000")) == (1000000, None, "over")
    assert job.fix_amounts(_rec("Spouse/DC  Over  $1,000,000")) == (1000000, None, "over")


def test_ordinary_cells_are_left_alone_and_not_counted():
    for text, want in {"$1,001 - $15,000": (1001, 15000), "$1,000,001 - $5,000,000": (1000001, 5000000),
                       "Over $50,000,000": (50000000, None), "$1,000 or less": (None, 1000)}.items():
        assert job.fix_amounts(_rec(text)) == (*want, None), text
    assert job.fix_amounts({"amount_min": None, "amount_max": None, "amount_range_text": None}) == (None, None, None)
    assert job.fix_amounts({}) == (None, None, None)
    # a whole-dollar single figure is not an exact-with-cents cell: the parser's reading stands
    assert job.fix_amounts(_rec("$2,000")) == (2000, 2000, None)


def test_an_unexplained_upside_down_range_shows_no_amount():
    rec = {"amount_min": 5000, "amount_max": 12, "amount_range_text": "$5,000 $12 see note"}
    assert job.fix_amounts(rec) == (None, None, "unreadable")
    # a range is never "over": the dash keeps "Over" in a comment from opening the top
    assert job.fix_amounts(_rec("$1,001 - $15,000 over $200")) == (1001, 15000, None)


def test_mapper_writes_the_fixed_amounts_and_counts_them():
    ctx = job.RunContext("congress_ptr")
    row = job.map_transaction_record(_rec("$318.74"), 1, 2, 3, CONF, filed_at="2026-03-30", ctx=ctx)
    assert (row["amount_low"], row["amount_high"]) == (319, 319)
    row = job.map_transaction_record(_rec("Spouse/DC Over $1,000,000"), 1, 2, None, CONF, filed_at="2026-03-30", ctx=ctx)
    assert (row["amount_low"], row["amount_high"]) == (1000000, None)
    row = job.map_transaction_record(_rec("$15,001 - $50,000"), 1, 2, 3, CONF, filed_at="2026-03-30", ctx=ctx)
    assert (row["amount_low"], row["amount_high"]) == (15001, 50000)
    stats = ctx.stats()
    assert stats["amounts_exact"] == 1 and stats["amounts_over"] == 1 and "amounts_unreadable" not in stats


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
    print("all amount tests passed")
