"""Normalized transaction record + parsing helpers for congress-ptr.

One normalized record per disclosed transaction, from either chamber. Pure functions only
(no I/O) so they are fully unit-testable offline. See
shared/context/sources/congress-ptr.md for the schema contract.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict, field
from datetime import date, datetime
from typing import Optional

# --- Amount brackets ---------------------------------------------------------
# PTRs report dollar ranges, never exact amounts. We parse any two dollar figures
# out of the cell; "Over $X" and "$X or less" are handled as open-ended brackets.

_DOLLARS = re.compile(r"\$?\s*([\d,]+)")


def parse_amount_range(text: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """Return (amount_min, amount_max, normalized_text) from a PTR amount cell.

    Examples:
      "$1,001 - $15,000"     -> (1001, 15000, "$1,001 - $15,000")
      "$1,000,001 - $5,000,000" -> (1000001, 5000000, ...)
      "Over $50,000,000"     -> (50000000, None, "Over $50,000,000")
      "$1,000 or less"       -> (None, 1000, "$1,000 or less")
    """
    if not text:
        return None, None, None
    norm = " ".join(text.split())
    nums = [int(n.replace(",", "")) for n in _DOLLARS.findall(norm)]
    low = norm.lower()
    if not nums:
        return None, None, norm or None
    if "or less" in low or low.startswith("under") or low.startswith("less than"):
        return None, nums[0], norm
    if low.startswith("over") or low.startswith("more than") or low.startswith("at least"):
        return nums[0], None, norm
    if len(nums) == 1:
        return nums[0], nums[0], norm
    return nums[0], nums[1], norm


# --- Transaction type --------------------------------------------------------

_TYPE_MAP = {
    "P": "purchase",
    "S": "sale",
    "S (PARTIAL)": "sale_partial",
    "S (PARTIAL SALE)": "sale_partial",
    "E": "exchange",
}


def parse_transaction_type(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    key = " ".join(text.split()).upper()
    if key in _TYPE_MAP:
        return _TYPE_MAP[key]
    if key.startswith("P"):
        return "purchase"
    if "PARTIAL" in key:
        return "sale_partial"
    if key.startswith("S"):
        return "sale"
    if key.startswith("E"):
        return "exchange"
    return key.lower() or None


# --- Owner code --------------------------------------------------------------

_OWNER_MAP = {
    "SP": "spouse",
    "DC": "dependent",
    "JT": "joint",
    "": "self",
    None: "self",
    # Senate eFD uses word forms:
    "SELF": "self",
    "SPOUSE": "spouse",
    "JOINT": "joint",
    "CHILD": "dependent",
    "DEPENDENT CHILD": "dependent",
}


def parse_owner(text: Optional[str]) -> Optional[str]:
    if text is None:
        return "self"
    key = " ".join(text.split()).upper()
    if key in _OWNER_MAP:
        return _OWNER_MAP[key]
    if key in ("SELF", "FILER"):
        return "self"
    return key.lower() or "self"


# --- Ticker ------------------------------------------------------------------

_TICKER_PAREN = re.compile(r"\(([A-Z][A-Z.\-]{0,9})\)")


def extract_ticker(asset: Optional[str]) -> Optional[str]:
    """Pull a ticker out of an asset name like 'Apple Inc. (AAPL)'."""
    if not asset:
        return None
    m = _TICKER_PAREN.search(asset)
    if not m:
        return None
    tok = m.group(1).strip(".-")
    # Reject obvious non-tickers captured in parens.
    if tok in {"NYSE", "NASDAQ", "OTC", "USD", "LLC", "LP", "INC", "ETF", "REIT"}:
        return None
    return tok or None


# --- Dates -------------------------------------------------------------------

_DATE_FORMATS = ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m-%d-%Y")


def parse_date(text: Optional[str]) -> Optional[str]:
    """Parse a disclosure date into ISO 8601 (YYYY-MM-DD), or None."""
    if not text:
        return None
    s = " ".join(text.split())
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


# --- Record ------------------------------------------------------------------


@dataclass
class TransactionRecord:
    member: str
    chamber: str  # "house" | "senate"
    source_url: str
    state_district: Optional[str] = None
    owner: Optional[str] = None
    asset: Optional[str] = None
    ticker: Optional[str] = None
    asset_type: Optional[str] = None
    transaction_type: Optional[str] = None
    amount_min: Optional[int] = None
    amount_max: Optional[int] = None
    amount_range_text: Optional[str] = None
    transaction_date: Optional[str] = None
    disclosure_date: Optional[str] = None
    doc_id: Optional[str] = None
    cap_gains_over_200: Optional[bool] = None
    needs_ocr: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FilingMeta:
    """Filing-level record (used when transactions can't be parsed, e.g. needs_ocr)."""
    member: str
    chamber: str
    source_url: str
    doc_id: Optional[str] = None
    filing_type: Optional[str] = None
    state_district: Optional[str] = None
    filing_date: Optional[str] = None
    needs_ocr: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


def normalize_member(last: str = "", first: str = "", prefix: str = "", suffix: str = "") -> str:
    """Build a normalized 'Last, First' member string from House XML parts."""
    last = (last or "").strip()
    first = (first or "").strip()
    suffix = (suffix or "").strip()
    name = last
    if first:
        name = f"{last}, {first}" if last else first
    if suffix:
        name = f"{name} {suffix}"
    return name.strip(", ").strip()
