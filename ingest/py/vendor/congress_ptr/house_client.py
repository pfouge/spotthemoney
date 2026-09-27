"""House Clerk financial-disclosure client for congress-ptr.

Two layers:
  * Pure parsers (no I/O) — unit-tested offline against real fixtures:
      parse_index_xml(xml_bytes)         -> list[FilingMeta]
      parse_ptr_text(text, ...)          -> list[TransactionRecord]
  * I/O (runs on the user's machine where the MCP lives; needs network + pdfplumber):
      download_index(year) / fetch_ptr_pdf / extract_pdf_text / get_ptr_transactions

Source: https://disclosures-clerk.house.gov  (keyless, plain HTTPS).
"""
from __future__ import annotations

import io
import re
import zipfile
from typing import Optional
from xml.etree import ElementTree as ET

from normalize import (
    FilingMeta,
    TransactionRecord,
    normalize_member,
    parse_amount_range,
    parse_date,
    parse_owner,
    parse_transaction_type,
)

HOUSE_BASE = "https://disclosures-clerk.house.gov"


def ptr_pdf_url(year: str | int, doc_id: str) -> str:
    return f"{HOUSE_BASE}/public_disc/ptr-pdfs/{year}/{doc_id}.pdf"


def index_zip_url(year: str | int) -> str:
    return f"{HOUSE_BASE}/public_disc/financial-pdfs/{year}FD.zip"


# --- XML index (pure) --------------------------------------------------------


def parse_index_xml(xml_bytes: bytes, filing_type: Optional[str] = None) -> list[FilingMeta]:
    """Parse a <YEAR>FD.xml index into filing-level records.

    filing_type: optional one-letter filter (e.g. "P" for Periodic Transaction Reports).
    """
    root = ET.fromstring(xml_bytes)
    out: list[FilingMeta] = []
    for m in root.findall(".//Member"):
        ft = (m.findtext("FilingType") or "").strip()
        if filing_type and ft.upper() != filing_type.upper():
            continue
        year = (m.findtext("Year") or "").strip()
        doc_id = (m.findtext("DocID") or "").strip()
        member = normalize_member(
            last=m.findtext("Last") or "",
            first=m.findtext("First") or "",
            prefix=m.findtext("Prefix") or "",
            suffix=m.findtext("Suffix") or "",
        )
        if ft.upper() == "P":
            url = ptr_pdf_url(year, doc_id)
        else:
            url = f"{HOUSE_BASE}/public_disc/financial-pdfs/{year}/{doc_id}.pdf"
        out.append(
            FilingMeta(
                member=member,
                chamber="house",
                source_url=url,
                doc_id=doc_id or None,
                filing_type=ft or None,
                state_district=(m.findtext("StateDst") or "").strip() or None,
                filing_date=parse_date(m.findtext("FilingDate")),
                needs_ocr=False,
            )
        )
    return out


# --- PTR PDF text (pure) -----------------------------------------------------

_ASSET_TYPE = {
    "ST": "stock", "OT": "other", "OL": "option", "OP": "option", "CS": "stock",
    "HN": "hedge_fund", "PE": "private_equity", "MF": "fund", "ET": "etf",
    "CT": "crypto", "DB": "bond", "GS": "bond", "RP": "real_property", "BA": "bank_account",
}
_TAG = re.compile(r"\[([A-Za-z]{2})\]")
_TICKER = re.compile(r"\(([A-Za-z][A-Za-z0-9.\-]{0,9})\)")
_NOT_TICKER = {"NYSE", "NASDAQ", "OTC", "USD", "LLC", "LP", "INC", "ETF", "REIT", "US", "PARTIAL"}

# A transaction's "primary" line carries: [owner + asset-start] TYPE date date [amount-start].
# pdfplumber reads the PDF in columns, so a wrapped asset and/or amount continues on the NEXT
# physical line (e.g. "(INTC) [OP] $5,000,000"). We assemble each transaction across those lines.
_PRIMARY = re.compile(
    r"^(?P<a1>.*?)\s*\b(?P<type>S\s*\(partial\)|[PSE])\s+"
    r"(?P<tdate>\d{1,2}/\d{1,2}/\d{4})\s+(?P<ndate>\d{1,2}/\d{1,2}/\d{4})\s+"
    r"(?P<amt1>.+)$",
    re.IGNORECASE,
)
_AMOUNT_COMPLETE = re.compile(
    r"\$[\d,]+\s*-\s*\$[\d,]+|Over\s+\$[\d,]+|\$[\d,]+\s+or\s+less", re.IGNORECASE)
_TRAILING_AMT = re.compile(r"(\$[\d,]+)\s*$")
# pdfplumber emits NUL/control bytes for some small-caps glyphs (e.g. "F\x00\x00\x00 S\x00\x00:" for
# "F S:"); strip them up front so noise-line, tag, and amount matching work on real PDF text.
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

# The transactions table starts at the column header (present in BOTH the 2021 layout and the
# abbreviated 2026 layout) and ends at the asset-codes footnote / certification.
_SECTION_START = "OWNER ASSET"
_TERMINATORS = ("* FOR THE COMPLETE", "I CERTIFY", "DIGITALLY SIGNED")

# Lines dropped before assembling transactions. Covers the verbose 2021 markers AND the
# single-letter 2026 ones (F S: = Filing Status, D: = Description, S O: = Subholding Of,
# L: = Location) plus the multi-line column header.
_DROP_PREFIXES = (
    "ID OWNER", "TYPE", "DATE", "NOTIFICATION", "AMOUNT", "CAP.", "GAINS", "$200",
    "FILING STATUS", "F S:", "DESCRIPTION:", "D:", "LOCATION:", "L:", "S O:",
    "SUBHOLDING", "FILING ID", "NAME:", "STATUS:", "STATE/DISTRICT:",
)


def _drop(up: str) -> bool:
    return up == "" or any(up.startswith(p) for p in _DROP_PREFIXES)


def _amount_complete(text: str) -> bool:
    return _AMOUNT_COMPLETE.search(text or "") is not None


def _build_record(asset_text: str, type_str: str, tdate: str, ndate: str, amount_str: str,
                  *, member: str, doc_id: Optional[str], source_url: str,
                  state_district: Optional[str]) -> Optional[TransactionRecord]:
    asset_text = " ".join((asset_text or "").split())
    # Owner code (JT/SP/DC) leads the asset chunk; otherwise self.
    owner = "self"
    toks = asset_text.split()
    if toks and toks[0].upper() in ("JT", "SP", "DC"):
        owner = parse_owner(toks[0])
        asset_text = asset_text[len(toks[0]):].strip()
    # Asset-type tag [XX].
    asset_type = None
    tag = _TAG.search(asset_text)
    if tag:
        asset_type = _ASSET_TYPE.get(tag.group(1).upper(), "other")
        asset_text = (asset_text[: tag.start()] + asset_text[tag.end():]).strip()
    # Ticker (uppercased to repair the small-caps font); CUSIPs (start with a digit) won't match.
    ticker = None
    tk = _TICKER.search(asset_text)
    if tk:
        cand = tk.group(1).upper().strip(".-")
        if cand and cand not in _NOT_TICKER:
            ticker = cand
        asset_text = (asset_text[: tk.start()] + asset_text[tk.end():]).strip()
    asset_clean = asset_text.strip().strip(",").strip()
    amin, amax, atext = parse_amount_range(amount_str)
    low = (amount_str or "").lower()
    cap_flag = True if "gfedcb" in low else (False if "gfedc" in low else None)
    return TransactionRecord(
        member=member, chamber="house", source_url=source_url,
        state_district=state_district, owner=owner,
        asset=asset_clean or None, ticker=ticker, asset_type=asset_type,
        transaction_type=parse_transaction_type(type_str),
        amount_min=amin, amount_max=amax, amount_range_text=atext,
        transaction_date=parse_date(tdate), disclosure_date=parse_date(ndate),
        doc_id=doc_id, cap_gains_over_200=cap_flag, needs_ocr=False,
    )


def _parse_table(text: str, *, member: str, doc_id: Optional[str], source_url: str,
                 state_district: Optional[str] = None) -> list[TransactionRecord]:
    """Column-aware parser for pdfplumber's House PTR text.

    Each transaction starts on a 'primary' line (owner+asset, type, two dates, amount-start) and may
    continue on following lines (wrapped asset and/or the rest of the amount). A transaction is
    'done' once its asset carries an [XX] type tag AND its amount is a complete range; further
    non-primary lines then belong to the next transaction. Handles both the 2021 layout (asset on
    lines before the type) and the 2026 layout (asset on the type line, amount wrapping in columns).
    """
    lines = [ln.strip() for ln in text.splitlines()]
    start = next((i for i, ln in enumerate(lines) if _SECTION_START in ln.upper()), None)
    if start is None:
        return []
    end = len(lines)
    for i in range(start + 1, len(lines)):
        up = lines[i].upper()
        if up == "I V D" or any(up.startswith(t) for t in _TERMINATORS):
            end = i
            break
    section = [ln for ln in lines[start + 1:end] if not _drop(ln.upper())]

    records: list[TransactionRecord] = []
    cur: Optional[dict] = None
    pending: list[str] = []

    def _done(c: dict) -> bool:
        return _TAG.search(c["asset"]) is not None and _amount_complete(c["amount"])

    def _flush() -> None:
        if cur is not None:
            rec = _build_record(cur["asset"], cur["type"], cur["tdate"], cur["ndate"],
                                cur["amount"], member=member, doc_id=doc_id,
                                source_url=source_url, state_district=state_district)
            if rec:
                records.append(rec)

    for ln in section:
        m = _PRIMARY.match(ln)
        if m:
            _flush()
            cur = {"asset": (" ".join(pending) + " " + (m.group("a1") or "")).strip(),
                   "type": m.group("type"), "tdate": m.group("tdate"),
                   "ndate": m.group("ndate"), "amount": m.group("amt1")}
            pending = []
        elif cur is not None and not _done(cur):
            a2 = ln
            if not _amount_complete(cur["amount"]):
                tm = _TRAILING_AMT.search(ln)
                if tm:
                    cur["amount"] = cur["amount"] + " " + tm.group(1)
                    a2 = ln[: tm.start()].strip()
            if a2:
                cur["asset"] = (cur["asset"] + " " + a2).strip()
        else:
            pending.append(ln)
    _flush()
    return records


# Ordered registry of House PDF parsers (the connector reads PDFs with pdfplumber). _parse_table
# handles the digital-era columnar layouts (2021 and 2026). As older/variant formats are sampled,
# add era-specific parsers here; parse_ptr_text returns the first parser that yields transactions,
# else [] so the caller flags needs_ocr (e.g. pre-digital scanned filings).
_PARSERS = (_parse_table,)


def parse_ptr_text(text: str, *, member: str, doc_id: Optional[str], source_url: str,
                   state_district: Optional[str] = None) -> list[TransactionRecord]:
    """Parse a House PTR PDF's text into transactions, dispatching across format-era parsers."""
    text = _CTRL.sub("", text or "")
    for parser in _PARSERS:
        recs = parser(text, member=member, doc_id=doc_id, source_url=source_url,
                      state_district=state_district)
        if recs:
            return recs
    return []


# --- I/O (runs on the user's machine; needs network + pdfplumber) ------------


def download_index(year: str | int, *, session=None, timeout: int = 60) -> bytes:
    """Download <YEAR>FD.xml bytes from the annual ZIP. Requires `requests`."""
    import requests  # local import: only needed at runtime

    s = session or requests.Session()
    r = s.get(index_zip_url(year), timeout=timeout, headers={"User-Agent": _ua()})
    r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        name = next((n for n in zf.namelist() if n.lower().endswith(".xml")), None)
        if not name:
            raise ValueError(f"No XML index found in {index_zip_url(year)}")
        return zf.read(name)


def fetch_ptr_pdf(year: str | int, doc_id: str, *, session=None, timeout: int = 60) -> bytes:
    import requests

    s = session or requests.Session()
    r = s.get(ptr_pdf_url(year, doc_id), timeout=timeout, headers={"User-Agent": _ua()})
    r.raise_for_status()
    return r.content


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract text with pdfplumber. Empty string => no text layer (needs OCR)."""
    import pdfplumber  # local import: only needed at runtime

    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts).strip()


def get_ptr_transactions(filing: FilingMeta, *, session=None) -> tuple[list[TransactionRecord], bool]:
    """Fetch + parse one PTR. Returns (records, needs_ocr).

    If the PDF has no text layer, returns ([], True) so the caller can emit a
    filing-level record flagged needs_ocr.
    """
    year = (filing.filing_date or "")[:4] or _year_from_url(filing.source_url)
    pdf = fetch_ptr_pdf(year, filing.doc_id, session=session)
    text = extract_pdf_text(pdf)
    if not text:
        return [], True
    recs = parse_ptr_text(
        text, member=filing.member, doc_id=filing.doc_id,
        source_url=filing.source_url, state_district=filing.state_district,
    )
    return recs, (len(recs) == 0)


def _year_from_url(url: str) -> str:
    m = re.search(r"/ptr-pdfs/(\d{4})/", url)
    return m.group(1) if m else ""


def _ua() -> str:
    import os
    return os.environ.get("CONGRESS_PTR_USER_AGENT", "IIF congress-ptr (Peter <pfouge@gmail.com>)")
