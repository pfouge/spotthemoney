"""senate_import.py — Senate periodic transaction reports, from saved exports.

The Senate's disclosure site (efdsearch.senate.gov) refuses automated clients, and this
project does not disguise its crawler as a browser (ingest/py/README.md, docs/04 #21). So the
Senate path has no fetcher here. Instead the reports are read in a real browser session — a
person accepts the site's agreement, the report list and each report page are saved — and the
result is committed as an export file under ingest/data/senate_ptr/:

    export-YYYY-MM-DD.json = {
      "exported_at": "...", "source": "efdsearch.senate.gov",
      "filings": [ { "id": "<uuid>", "first": "Thomas H", "last": "Tuberville",
                     "filer": "Tuberville, Tommy (Senator)",
                     "title": "Periodic Transaction Report for 09/15/2026",
                     "url": "https://efdsearch.senate.gov/search/view/ptr/<uuid>/",
                     "date_received": "09/20/2026", "kind": "ptr" | "paper",
                     "html": "<the report page's tables>" } ] }

congress_ptr_job.py calls process_senate_exports() after the House loop. Each export filing
becomes one `filings` row (source senate_ptr, external_id = the report's uuid) and its
transactions, parsed by the vendored IIF `senate_client.parse_ptr_html` — the same contract
as the House rows. Paper filings (scanned images) are stored as needs_ocr with no rows.

Amendments: eFD issues an amended report as a new, complete report ("… (Amendment 1)"). Only
the latest version of a report keeps its transactions; earlier versions are stored with
payload.superseded_by and no rows, so a trade is never counted twice.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent
EXPORT_DIR = HERE.parent / "data" / "senate_ptr"
SENATE_BASE = "https://efdsearch.senate.gov"

_UUID = re.compile(r"/(ptr|paper)/([0-9a-fA-F-]{16,})/?")
_TITLE = re.compile(r"for\s+(\d{1,2}/\d{1,2}/\d{4})(?:\s*\(Amendment\s+(\d+)\))?", re.I)
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


# ──────────────────────────────────────────────────────────────────────────
# Pure helpers
# ──────────────────────────────────────────────────────────────────────────
def fold(s: Optional[str]) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]+", " ", s)).strip()


def surname_tokens(last: str) -> list[str]:
    return [t for t in fold(last).split(" ") if t and t not in _SUFFIXES]


def kind_and_id(url: str) -> tuple[Optional[str], Optional[str]]:
    m = _UUID.search(url or "")
    return (m.group(1).lower(), m.group(2).lower()) if m else (None, None)


def report_key(title: Optional[str]) -> tuple[Optional[str], int]:
    """('09/15/2026', 0) for the original, ('09/15/2026', 1) for Amendment 1."""
    m = _TITLE.search(title or "")
    return (m.group(1), int(m.group(2) or 0)) if m else (None, 0)


def load_exports(directory: Path = EXPORT_DIR) -> list[dict[str, Any]]:
    """Every filing from every export file, one entry per report id (later files win)."""
    by_id: dict[str, dict[str, Any]] = {}
    for path in sorted(directory.glob("export-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for f in data.get("filings", []):
            kind, rid = kind_and_id(f.get("url") or "")
            rid = (f.get("id") or rid or "").lower()
            if not rid:
                continue
            entry = dict(f)
            entry["id"] = rid
            entry["kind"] = f.get("kind") or kind or "ptr"
            entry["export_file"] = path.name
            by_id[rid] = entry
    return sorted(by_id.values(), key=lambda e: (e.get("date_iso") or e.get("date_received") or "", e["id"]))


def mark_superseded(filings: list[dict[str, Any]], rows_of=None) -> int:
    """Set superseded_by on the report each amendment replaces. Returns how many amendments
    could not be tied to one earlier version (left alone, nothing superseded).

    Checked against eFD on 2026-10-06: an amendment is a complete copy of the report with the
    corrected rows changed (Boozman 12/08/2025: 14 rows, Amendment 1: 14 rows, 13 identical).
    A senator can also file two separate reports on one day, so "same filer, same report date"
    is not enough: among several earlier versions the amendment replaces the one whose rows it
    shares most (`rows_of(filing)` → set of row signatures), or failing that the only one with
    the same number of rows. An amendment whose original is not in the exports replaces nothing.
    """
    rows_of = rows_of or (lambda f: set())
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for f in filings:
        date, _n = report_key(f.get("title"))
        if date:
            groups.setdefault((fold(f.get("first")), fold(f.get("last")), date), []).append(f)
    unmatched = 0
    for group in groups.values():
        amendments = sorted((f for f in group if report_key(f.get("title"))[1] > 0),
                            key=lambda f: (report_key(f.get("title"))[1], f.get("date_iso") or "", f["id"]))
        for a in amendments:
            n = report_key(a.get("title"))[1]
            earlier = [f for f in group if f is not a and not f.get("superseded_by") and report_key(f.get("title"))[1] < n]
            if not earlier:
                continue
            target = earlier[0] if len(earlier) == 1 else None
            if target is None:
                mine = rows_of(a)
                scored = sorted(((len(mine & rows_of(f)), f) for f in earlier), key=lambda x: -x[0])
                if scored[0][0] > 0 and scored[0][0] > scored[1][0]:
                    target = scored[0][1]
                else:
                    same = [f for f in earlier if len(rows_of(f)) == len(mine)]
                    target = same[0] if len(same) == 1 else None
            if target is None:
                unmatched += 1
                continue
            target["superseded_by"] = a["id"]
    return unmatched


# Legal first names on eFD against the names senators go by on the roster.
_NICKNAMES = {
    "tommy": "thomas", "tom": "thomas", "jim": "james", "jimmy": "james", "bill": "william", "billy": "william",
    "mike": "michael", "ted": "edward", "ed": "edward", "bob": "robert", "rob": "robert", "dick": "richard",
    "rick": "richard", "chuck": "charles", "jack": "john", "joe": "joseph", "ben": "benjamin", "dan": "daniel",
    "dave": "david", "pete": "peter", "pat": "patrick", "liz": "elizabeth", "beth": "elizabeth", "maggie": "margaret",
    "peggy": "margaret", "katie": "katherine", "kate": "katherine", "cindy": "cynthia", "debbie": "deborah",
    "jeff": "jeffrey", "greg": "gregory", "steve": "steven", "tony": "anthony", "andy": "andrew", "bernie": "bernard",
    "josh": "joshua", "ron": "ronald", "don": "donald", "tim": "timothy", "chris": "christopher", "mitch": "mitchell",
}


def first_names_agree(efd_first: str, roster_given: list[str]) -> bool:
    """Could the eFD first name ("A. Mitchell", "Rafael E", "Thomas H") be this roster person
    ("Mitch", "Ted", "Tommy")? True on a shared name, a name that is the start of the other
    (three letters or more), a known nickname, or a nickname whose formal name starts with one
    of the filer's initials (Ted = Edward, filed as "Rafael E")."""
    mine = [t for t in fold(efd_first).split(" ") if t]
    theirs = [t for t in roster_given if t]
    if not mine or not theirs:
        return False
    for a in mine:
        for b in theirs:
            if len(a) > 1 and len(b) > 1:
                if a == b or (min(len(a), len(b)) >= 3 and (a.startswith(b) or b.startswith(a))):
                    return True
                if _NICKNAMES.get(a) == b or _NICKNAMES.get(b) == a or (_NICKNAMES.get(a) and _NICKNAMES.get(a) == _NICKNAMES.get(b)):
                    return True
            formal = _NICKNAMES.get(b)
            if len(a) == 1 and formal and formal.startswith(a):
                return True
    return False


def pick_senator(candidates: list[tuple[int, str]], first: str, last: str) -> Optional[int]:
    """Choose the roster row for a filer. candidates = (person_id, full_name) of sitting senators.

    The surname must be in the roster name AND the first names must agree. Surname alone is not
    enough: on 2026-10-06 the first import gave the late Lindsey Graham's reports to Darline
    Graham, who was appointed to his seat in July 2026 — same surname, same state. Returns None
    when nobody fits or more than one person does; the caller then keeps the filer as their own
    person rather than guess.
    """
    want = surname_tokens(last)
    if not want:
        return None
    hits = []
    for pid, full in candidates:
        tokens = [t for t in fold(full).split(" ") if t not in _SUFFIXES]
        if all(w in tokens for w in want):
            given = [t for t in tokens if t not in want]
            if first_names_agree(first, given):
                hits.append(pid)
    return hits[0] if len(hits) == 1 else None


# ──────────────────────────────────────────────────────────────────────────
# DB side (called from congress_ptr_job.main; `job` is that module)
# ──────────────────────────────────────────────────────────────────────────
def resolve_senator(conn, job, first: str, last: str, ctx) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            select p.id, p.full_name from people p
              join person_roles r on r.person_id = p.id and r.role_kind = 'congress' and r.chamber = 'senate'
             where r.valid_to is null or r.valid_to >= current_date
             order by (p.bioguide_id is null), p.id
            """
        )
        candidates = [(r[0], r[1]) for r in cur.fetchall()]
    pid = pick_senator(candidates, first, last)
    if pid is not None:
        return pid
    ctx.bump("senate_people_not_on_roster")
    # Former senator or a name the roster spells differently: fall back to the shared resolver,
    # which matches on the exact name or creates the person (no state, no party).
    return job.resolve_person(conn, f"{last}, {first}", "senate", None)


def process_senate_exports(conn, Json, job, ctx, *, dry_run: bool, reprocess: bool, archive=None,
                           directory: Path = EXPORT_DIR) -> None:
    import normalize  # type: ignore  (vendored)
    import senate_client  # type: ignore  (vendored; parser only — its network client is not used)

    filings = load_exports(directory)
    ctx.set_extra("senate_export_filings", len(filings))
    if not filings:
        return
    for f in filings:
        f["date_iso"] = normalize.parse_date(f.get("date_received")) or f.get("date_iso")

    def rows_of(f: dict[str, Any]) -> set:
        if "_rows" not in f:
            recs = [] if f.get("kind") == "paper" or not f.get("html") else senate_client.parse_ptr_html(
                f["html"], member="", source_url=f.get("url") or "")
            f["_rows"] = {(r.transaction_date, r.owner, r.ticker, r.asset, r.transaction_type, r.amount_min, r.amount_max) for r in recs}
        return f["_rows"]

    ctx.set_extra("senate_amendments_unmatched", mark_superseded(filings, rows_of))

    existing: set[str] = set()
    if conn is not None and not reprocess:
        with conn.cursor() as cur:
            cur.execute(
                "select external_id, coalesce(payload->>'superseded_by', '') from filings where source = 'senate_ptr' and external_id = any(%s)",
                ([f["id"] for f in filings],),
            )
            stored = {r[0]: r[1] for r in cur.fetchall()}
        conn.commit()
        # Skip what is already stored — except a report that has since been amended and is
        # not yet marked: it is processed once more so its rows are removed.
        existing = {f["id"] for f in filings if f["id"] in stored and (not f.get("superseded_by") or stored[f["id"]])}
    ctx.set_extra("senate_skipped_existing", len(existing))

    for f in filings:
        rid = f["id"]
        if rid in existing:
            continue
        ctx.rows_seen += 1
        try:
            _process_one(conn, Json, job, senate_client, f, ctx, dry_run=dry_run, archive=archive)
        except job.SystemicFailureError:
            raise
        except Exception as exc:  # noqa: BLE001
            if conn is not None:
                conn.rollback()
            ctx.quarantine(f"senate:{rid}", f"{type(exc).__name__}: {exc}")

    # Securities created from a malformed ticker cell and no longer referenced by any row.
    if conn is not None and not dry_run:
        with conn.cursor() as cur:
            cur.execute(
                """
                delete from securities s
                 where (position(' ' in s.ticker) > 0 or left(s.ticker, 2) = '--')
                   and not exists (select 1 from transactions t where t.security_id = s.id)
                """
            )
            ctx.set_extra("senate_bad_tickers_removed", cur.rowcount)
        conn.commit()


def _process_one(conn, Json, job, senate_client, f: dict[str, Any], ctx, *, dry_run: bool, archive) -> None:
    rid, url = f["id"], f.get("url") or f"{SENATE_BASE}/search/view/{f.get('kind', 'ptr')}/{f['id']}/"
    first, last = (f.get("first") or "").strip(), (f.get("last") or "").strip()
    member = f"{last}, {first}".strip(", ")
    filed = f.get("date_iso")
    html = f.get("html") or ""
    superseded_by = f.get("superseded_by")
    is_paper = f.get("kind") == "paper"

    records = [] if is_paper or not html else senate_client.parse_ptr_html(
        html, member=member, source_url=url, disclosure_date=filed)
    needs_ocr = is_paper or not records
    if not is_paper and not records:
        ctx.bump("senate_parsed_empty")
    conf = job.assign_confidence_review(needs_ocr, "senate")

    if dry_run:
        state = "paper (needs_ocr)" if is_paper else "needs_ocr" if needs_ocr else f"{len(records)} transactions"
        print(f"[dry-run] senate {filed} {rid[:8]} {member}: {state}{' — superseded' if superseded_by else ''}")
        return

    person_id = resolve_senator(conn, job, first, last, ctx)
    payload = {
        "member": member, "filer": f.get("filer"), "title": f.get("title"), "filing_date": filed,
        "needs_ocr": needs_ocr, "kind": f.get("kind"), "export_file": f.get("export_file"),
        "superseded_by": superseded_by, "records": [r.to_dict() for r in records],
    }
    filing_id, inserted = job.upsert_filing(conn, Json, {
        "source": "senate_ptr", "external_id": rid, "filer_person_id": person_id,
        "filed_at": filed, "source_url": url,
        "confidence": conf["confidence"], "review": conf["review"], "is_published": conf["is_published"],
        "payload": payload,
    })
    ctx.bump("senate_filings_inserted" if inserted else "senate_filings_updated")

    if archive is not None and html:
        try:
            res = archive.archive_bytes(conn, source="senate_ptr", source_url=url, data=html.encode("utf-8"),
                                        content_type="text/html", filing_id=filing_id)
            if res.get("stored"):
                ctx.bump("documents_archived")
            with conn.cursor() as cur:
                cur.execute("update filings set raw_document_id = %s where id = %s", (res.get("raw_document_id"), filing_id))
        except Exception as exc:  # noqa: BLE001
            ctx.warn(f"archive failed for senate {rid}: {exc}")

    rows = []
    if not conf["defer_transactions_to_ocr"] and not superseded_by:
        for r in records:
            d = r.to_dict()
            d["ticker"] = clean_ticker(d.get("ticker"))
            security_id = job.resolve_security(conn, d.get("ticker"), d.get("asset"), job_asset_type(d.get("asset_type")))
            d["asset_type"] = job_asset_type(d.get("asset_type"))
            row = job.map_transaction_record(d, filing_id, person_id, security_id, conf, filed_at=filed)
            if report_key(f.get("title"))[1] > 0:
                # An amendment is dated when the correction was filed, not when the trade was first
                # disclosed — a lag measured to it would mark the senator late by months or years.
                row["disclosure_lag_days"] = None
            rows.append(row)
    written = job.reingest_transactions(conn, filing_id, rows)
    ctx.rows_changed += written + 1
    if superseded_by:
        ctx.bump("senate_superseded")
    if conf["defer_transactions_to_ocr"]:
        with conn.cursor() as cur:
            cur.execute("select 1 from review_queue where filing_id = %s and reason = 'needs_ocr'", (filing_id,))
            if cur.fetchone() is None:
                cur.execute(
                    "insert into review_queue (filing_id, reason, confidence, status) values (%s, 'needs_ocr', %s, 'pending')",
                    (filing_id, conf["confidence"]),
                )
        ctx.bump("senate_needs_ocr")
    conn.commit()


_TICKER = re.compile(r"^[A-Z][A-Z0-9]{0,5}([.\-][A-Z0-9]{1,3})?$")


def clean_ticker(text: Optional[str]) -> Optional[str]:
    """The ticker cell as one usable symbol, or None.

    An exchange row lists what was given up and what was received; when only one side has a
    symbol eFD shows "-- AMCR", which went through as the ticker "-- AMCR" and produced a page
    at /stocks/-- amcr/ (the deploy's link check failed on it, 2026-10-06). Exactly one valid
    symbol in the cell is used; none, or two different ones, means no ticker.
    """
    symbols = {t for t in (text or "").upper().split() if _TICKER.match(t)}
    return symbols.pop() if len(symbols) == 1 else None


# eFD's "Asset Type" column is free text ("Stock", "Corporate Bond", "Stock Option", …); the rest
# of the pipeline expects the House parser's short codes.
_ASSET = [
    ("option", "option"), ("stock", "stock"), ("etf", "etf"), ("exchange traded", "etf"),
    ("bond", "bond"), ("municipal", "bond"), ("treasur", "bond"), ("note", "bond"),
    ("mutual fund", "fund"), ("fund", "fund"), ("crypto", "crypto"), ("virtual currency", "crypto"),
]


def job_asset_type(text: Optional[str]) -> str:
    t = (text or "").strip().lower()
    for needle, code in _ASSET:
        if needle in t:
            return code
    return "other"
