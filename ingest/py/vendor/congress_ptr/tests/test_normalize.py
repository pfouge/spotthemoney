"""Offline unit tests for congress-ptr normalize.py (pure functions, no network)."""
import normalize as n


def test_amount_range_standard():
    assert n.parse_amount_range("$1,001 - $15,000") == (1001, 15000, "$1,001 - $15,000")
    assert n.parse_amount_range("$1,000,001 - $5,000,000") == (1000001, 5000000, "$1,000,001 - $5,000,000")
    assert n.parse_amount_range("$50,001 - $100,000") == (50001, 100000, "$50,001 - $100,000")


def test_amount_range_open_ended():
    assert n.parse_amount_range("Over $50,000,000") == (50000000, None, "Over $50,000,000")
    assert n.parse_amount_range("$1,000 or less") == (None, 1000, "$1,000 or less")


def test_amount_range_messy_whitespace_and_empty():
    assert n.parse_amount_range("  $15,001   -   $50,000 ") == (15001, 50000, "$15,001 - $50,000")
    assert n.parse_amount_range("") == (None, None, None)
    assert n.parse_amount_range(None) == (None, None, None)


def test_transaction_type():
    assert n.parse_transaction_type("P") == "purchase"
    assert n.parse_transaction_type("S") == "sale"
    assert n.parse_transaction_type("S (partial)") == "sale_partial"
    assert n.parse_transaction_type("E") == "exchange"
    assert n.parse_transaction_type(None) is None


def test_owner():
    assert n.parse_owner("SP") == "spouse"
    assert n.parse_owner("DC") == "dependent"
    assert n.parse_owner("JT") == "joint"
    assert n.parse_owner("") == "self"
    assert n.parse_owner(None) == "self"


def test_extract_ticker():
    assert n.extract_ticker("Apple Inc. (AAPL)") == "AAPL"
    assert n.extract_ticker("Alphabet Inc. Class C (GOOG)") == "GOOG"
    assert n.extract_ticker("US Treasury Bill") is None
    assert n.extract_ticker("Some Fund (NASDAQ)") is None  # exchange name, not a ticker
    assert n.extract_ticker(None) is None


def test_parse_date():
    assert n.parse_date("05/14/2026") == "2026-05-14"
    assert n.parse_date("2026-05-14") == "2026-05-14"
    assert n.parse_date("garbage") is None
    assert n.parse_date(None) is None


def test_normalize_member():
    assert n.normalize_member(last="Green", first="Mark") == "Green, Mark"
    assert n.normalize_member(last="Pelosi", first="Nancy", prefix="Hon.") == "Pelosi, Nancy"
    assert n.normalize_member(last="Doe", first="John", suffix="Jr.") == "Doe, John Jr."


def test_record_to_dict_has_source_url_and_needs_ocr():
    r = n.TransactionRecord(
        member="Green, Mark", chamber="house",
        source_url="https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20029138.pdf",
        ticker="AAL", transaction_type="purchase", amount_min=1001, amount_max=15000,
        transaction_date="2026-05-14", disclosure_date="2026-06-02", doc_id="20029138",
    )
    d = r.to_dict()
    assert d["source_url"].endswith("20029138.pdf")
    assert d["needs_ocr"] is False
    assert d["chamber"] == "house"
