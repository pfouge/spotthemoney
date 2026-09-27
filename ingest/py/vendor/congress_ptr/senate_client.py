"""Senate eFD client for congress-ptr.

Two layers:
  * Pure parser (stdlib only — unit-tested offline against a fixture):
      parse_ptr_html(html, ...) -> list[TransactionRecord]
  * I/O (runs on the user's residential machine; needs network + requests):
      SenateSession (prohibition-agreement handshake), search_ptrs, fetch_report_html

Senate eFD sits behind Akamai bot protection: datacenter IPs get 403, residential IPs
(the user's machine, where the MCP runs) work after POSTing the prohibition agreement.
Every session must GET /search/home/, read the CSRF token, then POST prohibition_agreement=1.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Optional

from normalize import (
    TransactionRecord,
    parse_amount_range,
    parse_date,
    parse_owner,
    parse_transaction_type,
)

SENATE_BASE = "https://efdsearch.senate.gov"
HOME_URL = f"{SENATE_BASE}/search/home/"
SEARCH_URL = f"{SENATE_BASE}/search/"
SEARCH_DATA_URL = f"{SENATE_BASE}/search/report/data/"


# --- stdlib HTML table extraction -------------------------------------------


class _TableExtractor(HTMLParser):
    """Collect every <table> as a list of rows; each row is a list of cell strings."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: Optional[list] = None
        self._row: Optional[list] = None
        self._cell: Optional[list] = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _clean_ticker(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = text.strip()
    if t in ("--", "-", "", "N/A"):
        return None
    return t.upper()


# Header label -> normalized field key.
_COLS = {
    "transaction date": "transaction_date",
    "owner": "owner",
    "ticker": "ticker",
    "asset name": "asset",
    "asset type": "asset_type",
    "type": "transaction_type",
    "amount": "amount",
    "comment": "comment",
}


def parse_ptr_html(html: str, *, member: str, source_url: str,
                   disclosure_date: Optional[str] = None,
                   state: Optional[str] = None) -> list[TransactionRecord]:
    """Parse a Senate electronic PTR detail page into transaction records.

    Locates the transactions table by its header row, maps columns by name (so it is
    robust to column-order changes), and builds one record per data row.
    """
    ex = _TableExtractor()
    ex.feed(html)
    records: list[TransactionRecord] = []
    for table in ex.tables:
        if not table:
            continue
        header = [h.strip().lower() for h in table[0]]
        colmap = {_COLS[h]: i for i, h in enumerate(header) if h in _COLS}
        if "asset" not in colmap or "transaction_type" not in colmap:
            continue  # not the transactions table
        for row in table[1:]:
            if len(row) < len(header):
                continue

            def cell(key):
                idx = colmap.get(key)
                return row[idx] if idx is not None and idx < len(row) else None

            amin, amax, atext = parse_amount_range(cell("amount"))
            asset = cell("asset")
            records.append(
                TransactionRecord(
                    member=member, chamber="senate", source_url=source_url,
                    state_district=state,
                    owner=parse_owner(cell("owner")),
                    asset=asset or None,
                    ticker=_clean_ticker(cell("ticker")),
                    asset_type=(cell("asset_type") or None),
                    transaction_type=parse_transaction_type(cell("transaction_type")),
                    amount_min=amin, amount_max=amax, amount_range_text=atext,
                    transaction_date=parse_date(cell("transaction_date")),
                    disclosure_date=disclosure_date,
                    doc_id=_doc_id_from_url(source_url),
                    needs_ocr=False,
                )
            )
    return records


def _doc_id_from_url(url: str) -> Optional[str]:
    m = re.search(r"/ptr/([0-9a-f\-]+)/?", url)
    return m.group(1) if m else None


# --- I/O (runs on the user's machine; needs network + requests) -------------

_CSRF = re.compile(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"')


class SenateSession:
    """Authenticated eFD session: handshake the prohibition agreement, then query."""

    def __init__(self, *, timeout: int = 30):
        # curl_cffi impersonates Chrome's TLS/JA3 handshake, which plain `requests` cannot —
        # required to get past efdsearch's Akamai bot protection.
        from curl_cffi import requests  # local import: runtime only

        self.timeout = timeout
        self.s = requests.Session(impersonate="chrome")
        # Senate eFD is behind Akamai, which refuses non-browser clients. Present a full,
        # realistic browser header set (the contact UA used for House would be 403'd here).
        self.s.headers.update({
            "User-Agent": _ua(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
                      "image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Cache-Control": "max-age=0",
        })

    def agree(self) -> None:
        r = self.s.get(HOME_URL, timeout=self.timeout)
        r.raise_for_status()
        m = _CSRF.search(r.text)
        if not m:
            raise RuntimeError("Could not find CSRF token on eFD home (blocked or layout changed).")
        token = m.group(1)
        r2 = self.s.post(
            HOME_URL,
            data={"prohibition_agreement": "1", "csrfmiddlewaretoken": token},
            headers={"Referer": HOME_URL, "Origin": SENATE_BASE},
            timeout=self.timeout,
        )
        r2.raise_for_status()
        # Land on the search page so the session/cookies are in the state the data XHR expects.
        self.s.get(SEARCH_URL, headers={"Referer": HOME_URL}, timeout=self.timeout)

    def search_ptrs(self, *, start: str = "", end: str = "", name: str = "",
                    length: int = 100, start_index: int = 0) -> list[dict]:
        """Query the DataTables endpoint for Periodic Transaction Reports (filer type 1).

        start_index is the DataTables paging offset; loop it (0, length, 2*length, ...) to pull
        more than one page when a date window holds more reports than `length`.
        """
        token = self.s.cookies.get("csrftoken") or ""
        payload = {
            "draw": "1", "start": str(start_index), "length": str(length),
            "report_types": "[11]",          # 11 = Periodic Transaction Report
            "filer_types": "[]",
            "submitted_start_date": f"{start} 00:00:00" if start else "",
            "submitted_end_date": f"{end} 23:59:59" if end else "",
            "candidate_state": "", "senator_state": "", "office_id": "",
            "first_name": "", "last_name": name,
        }
        r = self.s.post(
            SEARCH_DATA_URL, data=payload,
            headers={"X-CSRFToken": token, "Referer": SEARCH_URL, "Origin": SENATE_BASE,
                     "X-Requested-With": "XMLHttpRequest",
                     "Accept": "application/json, text/javascript, */*; q=0.01",
                     "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors",
                     "Sec-Fetch-Dest": "empty"},
            timeout=self.timeout,
        )
        r.raise_for_status()
        rows = r.json().get("data", [])
        out = []
        for row in rows:
            # row = [first, last, filer-display, report-link-html, date-received]
            link = re.search(r'href="([^"]+)"', row[3]) if len(row) > 3 else None
            out.append({
                "member": f"{(row[1] or '').strip()}, {(row[0] or '').strip()}".strip(", "),
                "url": SENATE_BASE + link.group(1) if link else None,
                "date": parse_date(row[4]) if len(row) > 4 else None,
            })
        return out

    def fetch_report_html(self, url: str) -> str:
        r = self.s.get(url, timeout=self.timeout, headers={"Referer": HOME_URL})
        r.raise_for_status()
        return r.text


def _ua() -> str:
    import os
    # A current desktop-Chrome UA. Akamai blocks tool-style UAs; override via env if needed.
    return os.environ.get(
        "CONGRESS_PTR_SENATE_USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    )
