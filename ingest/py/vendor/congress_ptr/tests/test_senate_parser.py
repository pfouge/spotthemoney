"""Offline unit tests for senate_client.parse_ptr_html (stdlib only, no network).

Fixture sample_senate_ptr.html mirrors the Senate eFD electronic-PTR detail page:
a filer-info table (to be ignored) followed by the transactions table.
"""
import os

import senate_client as sc

HERE = os.path.dirname(__file__)
FIX = os.path.join(HERE, "fixtures")
URL = "https://efdsearch.senate.gov/search/view/ptr/abcd1234-5678-90ab-cdef-1234567890ab/"


def _records():
    with open(os.path.join(FIX, "sample_senate_ptr.html"), encoding="utf-8") as f:
        html = f.read()
    return sc.parse_ptr_html(
        html, member="Tuberville, Tommy", source_url=URL,
        disclosure_date="2026-06-01", state="AL",
    )


def test_ignores_filer_table_and_finds_three_transactions():
    assert len(_records()) == 3


def test_first_row_purchase():
    r = _records()[0]
    assert r.chamber == "senate"
    assert r.owner == "self"
    assert r.ticker == "AAPL"
    assert r.asset == "Apple Inc."
    assert r.asset_type == "Stock"
    assert r.transaction_type == "purchase"
    assert (r.amount_min, r.amount_max) == (1001, 15000)
    assert r.transaction_date == "2026-05-14"
    assert r.disclosure_date == "2026-06-01"
    assert r.source_url == URL
    assert r.doc_id == "abcd1234-5678-90ab-cdef-1234567890ab"


def test_second_row_sale_no_ticker():
    r = _records()[1]
    assert r.owner == "spouse"
    assert r.ticker is None          # "--" => no ticker
    assert r.transaction_type == "sale"
    assert (r.amount_min, r.amount_max) == (15001, 50000)


def test_third_row_partial_sale_child_owner():
    r = _records()[2]
    assert r.owner == "dependent"    # "Child" => dependent
    assert r.ticker == "TSLA"
    assert r.transaction_type == "sale_partial"
    assert (r.amount_min, r.amount_max) == (50001, 100000)


def test_every_record_has_source_url_and_member():
    for r in _records():
        assert r.source_url == URL
        assert r.member == "Tuberville, Tommy"
        assert r.needs_ocr is False
