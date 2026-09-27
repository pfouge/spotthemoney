"""Offline unit tests for house_client pure parsers, grounded in a real PTR fixture.

Fixture sample_house_ptr.txt is the actual extracted text of House PTR DocID 20018586
(Rep. Mark Green, 2021). sample_house_index.xml mirrors the <YEAR>FD.xml schema.
"""
import os

import house_client as hc

HERE = os.path.dirname(__file__)
FIX = os.path.join(HERE, "fixtures")


def _read(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


# --- XML index ---------------------------------------------------------------


def test_index_parses_all_then_filters_ptr():
    xml = _read("sample_house_index.xml")
    allf = hc.parse_index_xml(xml)
    assert len(allf) == 3
    ptrs = hc.parse_index_xml(xml, filing_type="P")
    assert len(ptrs) == 2
    assert {f.member for f in ptrs} == {"Green, Mark", "Pelosi, Nancy"}


def test_index_builds_ptr_url_and_fields():
    ptrs = hc.parse_index_xml(_read("sample_house_index.xml"), filing_type="P")
    green = next(f for f in ptrs if f.member == "Green, Mark")
    assert green.source_url == (
        "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2021/20018586.pdf"
    )
    assert green.chamber == "house"
    assert green.state_district == "TN07"
    assert green.filing_type == "P"
    assert green.filing_date == "2021-04-15"


# --- PTR PDF text ------------------------------------------------------------


def _green_records():
    text = _read("sample_house_ptr.txt").decode("utf-8")
    return hc.parse_ptr_text(
        text,
        member="Green, Mark",
        doc_id="20018586",
        source_url="https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2021/20018586.pdf",
        state_district="TN07",
    )


def test_ptr_extracts_all_seven_transactions():
    recs = _green_records()
    assert len(recs) == 7  # AAL, DOGE x2, EOS, ETH Classic, Stellar, UAL


def test_ptr_first_transaction_fields():
    r = _green_records()[0]
    assert r.owner == "joint"
    assert r.ticker == "AAL"  # repaired from the small-caps "(AAl)"
    assert "American Airlines" in r.asset
    assert r.asset_type == "stock"
    assert r.transaction_type == "purchase"
    assert (r.amount_min, r.amount_max) == (1001, 15000)
    assert r.transaction_date == "2021-03-24"
    assert r.disclosure_date == "2021-03-24"
    assert r.needs_ocr is False
    assert r.source_url.endswith("20018586.pdf")
    assert r.cap_gains_over_200 is False


def test_ptr_crypto_has_no_ticker_and_other_type():
    recs = _green_records()
    doge = next(r for r in recs if r.asset and "DOGE" in r.asset.upper())
    assert doge.ticker is None
    assert doge.asset_type == "other"
    assert doge.transaction_type == "purchase"


def test_ptr_last_transaction_is_united_airlines():
    r = _green_records()[-1]
    assert r.ticker == "UAL"  # repaired from "(uAl)"
    assert "Airlines" in r.asset
    assert r.asset_type == "stock"


def test_ptr_every_record_carries_source_url():
    assert all(r.source_url.endswith("20018586.pdf") for r in _green_records())


# --- 2026 layout (abbreviated headers, wrapped amounts) -----------------------

def _pelosi_records():
    text = _read("sample_house_ptr_2026.txt").decode("utf-8")
    return hc.parse_ptr_text(
        text, member="Pelosi, Nancy", doc_id="20034836",
        source_url="https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20034836.pdf",
        state_district="CA11",
    )


def test_2026_two_purchases():
    recs = _pelosi_records()
    assert len(recs) == 2
    assert all(r.transaction_type == "purchase" for r in recs)


def test_2026_intel_call_option_wrapped_amount():
    r = _pelosi_records()[0]
    assert r.owner == "spouse"
    assert r.ticker == "INTC"
    assert "Intel" in r.asset
    assert r.asset_type == "option"
    assert (r.amount_min, r.amount_max) == (1000001, 5000000)  # amount wrapped across 2 lines
    assert r.transaction_date == "2026-05-29"


def test_2026_uber_call_option():
    r = _pelosi_records()[1]
    assert r.ticker == "UBER"
    assert (r.amount_min, r.amount_max) == (500001, 1000000)
    assert r.asset_type == "option"


def test_2026_strips_pdfplumber_null_bytes():
    # pdfplumber renders the abbreviated single-letter markers with NUL glyphs; ensure they're
    # stripped so "F S:"/"D:" drop and don't leak into the next asset.
    raw = _read("sample_house_ptr_2026.txt").decode("utf-8")
    noisy = (raw.replace("F S: New", "F\x00\x00\x00\x00\x00 S\x00\x00\x00\x00\x00: New")
                .replace("D: Purchased", "D\x00\x00\x00\x00\x00: Purchased"))
    recs = hc.parse_ptr_text(noisy, member="Pelosi, Nancy", doc_id="20034836", source_url="x")
    assert len(recs) == 2
    uber = recs[1]
    assert uber.ticker == "UBER"
    assert uber.asset == "Uber Technologies, Inc. Common Stock"  # no F S:/D: pollution


# --- Cisneros: many transactions incl. S (partial), ticker/tag on next line, wrapped amounts ---

def _cisneros_records():
    text = _read("sample_house_ptr_2026_cisneros.txt").decode("utf-8")
    return hc.parse_ptr_text(text, member="Cisneros, Gilbert", doc_id="20034713", source_url="x")


def test_cisneros_no_runon_no_partial_ticker():
    recs = _cisneros_records()
    assert len(recs) == 6                                  # every transaction split out
    assert all(r.ticker != "PARTIAL" for r in recs)        # "(partial)" never read as a ticker
    # no run-on junk leaked into asset names
    for r in recs:
        assert "S (partial)" not in (r.asset or "")
        assert "F S:" not in (r.asset or "")


def test_cisneros_partial_sales_recognized():
    recs = _cisneros_records()
    by_ticker = {r.ticker: r for r in recs}
    assert by_ticker["ADBE"].transaction_type == "sale_partial"
    assert by_ticker["ADBE"].asset == "Adobe Inc. - Common Stock"
    assert by_ticker["FLEX"].transaction_type == "sale_partial"
    assert (by_ticker["FLEX"].amount_min, by_ticker["FLEX"].amount_max) == (15001, 50000)  # wrapped
    assert by_ticker["ABT"].transaction_type == "sale"


def test_cisneros_purchases_and_bond():
    recs = _cisneros_records()
    bt = {r.ticker: r for r in recs}
    assert bt["AMD"].transaction_type == "purchase"
    assert bt["MSFT"].transaction_type == "purchase"
    assert (bt["MSFT"].amount_min, bt["MSFT"].amount_max) == (50001, 100000)  # wrapped amount
    nyc = next(r for r in recs if r.ticker is None)
    assert nyc.transaction_type == "purchase"
    assert nyc.asset_type == "bond"
    assert (nyc.amount_min, nyc.amount_max) == (250001, 500000)
    # only 3 of the 6 are purchases (AMD, MSFT, NYC bonds)
    assert sum(1 for r in recs if r.transaction_type == "purchase") == 3
