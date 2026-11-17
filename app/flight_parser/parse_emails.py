"""Parse PMX flight itinerary emails (.msg) and emit a CSV ready for the
PMX Life News flight tracker.

Source folder: D:\\00_OneDrive\\...\\PMX - Flight Itinerary\\data\\flight itinerary
Output CSV   : ../../report/flight_itinerary_from_emails_<YYYYMMDD>.csv
Template     : C:\\Users\\Jacky2_Wang\\Desktop\\flights_template.csv
              (columns: flight_date, dep_airport, arr_airport, airline_code,
               flight_number, airline_name, aircraft_type,
               scheduled_dep, scheduled_arr)

Usage (from project root):
    python app/flight_parser/parse_emails.py
    python app/flight_parser/parse_emails.py --src "<other msg folder>" --out report/custom.csv

Design notes
------------
* Two .msg body formats are supported:
  - "concise":  1.WN3037 11Nov ELPAUS 0635 0905
                (digits, airline+number, day+mon, dep+arr IATA, dep time, arr time)
  - "table":    01 埃爾帕索(ELP)-洛杉磯(LAX) 27NOV 五 0600 0721 AA6427 AWIWSB ...
                (segment #, dep_city(dep)-arr_city(arr), day+mon, weekday,
                 dep time, arr time, flight, pnr, class, status, airline-zh)
* Year is inferred from the email subject's date range, e.g. "26/11/11~11/14",
  "2026/11/13~11/30", "26/12/18 ~ 27/01/14" (year wrap Dec→Jan handled).
* airline_name is filled from the IATA code; aircraft_type is left blank
  for later enrichment (web lookup / OpenSky ICAO typecode).
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Force UTF-8 stdout so the Windows console doesn't choke on box-drawing /
# check marks / Chinese chars in email subjects.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass

import extract_msg  # type: ignore

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_SRC = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Flight Itinerary\data\flight itinerary"
)
PROJECT_ROOT = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Life News"
)
# Canonical cumulative CSV (the file the project maintains across runs).
# Lives under the Flight Itinerary project's report/ folder.
CUMULATIVE_CSV = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Flight Itinerary\report\flights_template.csv"
)
# Legacy desktop template (kept for backward compatibility; no longer the
# source of truth).
TEMPLATE_PATH = Path(r"C:\Users\Jacky2_Wang\Desktop\flights_template.csv")

# IATA -> airline full name. Mirrors app/webui/src/lib/utils.ts AIRLINE_NAMES
# plus the codes that appear in PMX itineraries.
AIRLINE_NAMES: dict[str, str] = {
    "AA": "American Airlines",
    "AC": "Air Canada",
    "AF": "Air France",
    "AM": "Aeromexico",
    "AR": "Aerolineas Argentinas",
    "AS": "Alaska Airlines",
    "AY": "Finnair",
    "BA": "British Airways",
    "BR": "EVA Air",
    "CA": "Air China",
    "CI": "China Airlines",
    "CM": "Copa Airlines",
    "CX": "Cathay Pacific",
    "DL": "Delta Air Lines",
    "EI": "Aer Lingus",
    "EK": "Emirates",
    "ET": "Ethiopian Airlines",
    "F9": "Frontier Airlines",
    "FI": "Icelandair",
    "GA": "Garuda Indonesia",
    "HA": "Hawaiian Airlines",
    "HU": "Hainan Airlines",
    "IB": "Iberia",
    "JL": "Japan Airlines",
    "KE": "Korean Air",
    "KLM": "KLM",
    "LA": "LATAM Airlines",
    "LH": "Lufthansa",
    "LO": "LOT Polish Airlines",
    "MU": "China Eastern",
    "NH": "All Nippon Airways",
    "NK": "Spirit Airlines",
    "NZ": "Air New Zealand",
    "OA": "Olympic Air",
    "OS": "Austrian Airlines",
    "OZ": "Asiana Airlines",
    "PR": "Philippine Airlines",
    "QF": "Qantas",
    "QR": "Qatar Airways",
    "SA": "South African Airways",
    "SK": "SAS",
    "SN": "Brussels Airlines",
    "SQ": "Singapore Airlines",
    "SU": "Aeroflot",
    "SV": "Saudia",
    "SW": "SkyWest",
    "TG": "Thai Airways",
    "TK": "Turkish Airlines",
    "UA": "United Airlines",
    "UL": "SriLankan Airlines",
    "US": "US Airways",
    "VA": "Virgin Australia",
    "VS": "Virgin Atlantic",
    "VN": "Vietnam Airlines",
    "WN": "Southwest Airlines",
    "XE": "JSX",
    "Y4": "Volaris",
}

MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

CSV_COLUMNS = [
    "flight_date", "dep_airport", "arr_airport",
    "airline_code", "flight_number",
    "airline_name", "aircraft_type",
    "scheduled_dep", "scheduled_arr",
]


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class FlightSeg:
    """One segment (one takeoff, one landing) extracted from an email body
    or a PDF itinerary. Optional ISO fields carry full datetime with TZ
    when the source provides them (PDFs do; email bodies do not)."""
    flight_date: str            # M/D/YYYY (e.g., 11/13/2026)
    dep_airport: str            # 3-letter IATA
    arr_airport: str            # 3-letter IATA
    airline_code: str           # 2-letter IATA
    flight_number: str          # digits as string
    scheduled_dep: str          # HH:MM local at dep airport (for CSV)
    scheduled_arr: str          # HH:MM local at arr airport, may carry "+1" (for CSV)
    src_file: str = ""
    raw_line: str = ""
    aircraft_type: str = ""     # filled by PDF parser; left blank by body parser
    # Full ISO datetime with offset, populated by the PDF parser. Used for
    # Supabase upload (and for the expiry filter when present).
    scheduled_dep_iso: str = ""
    scheduled_arr_iso: str = ""
    # Optional enrichment fields populated by the PDF parser.
    pnr: str = ""
    ticket_number: str = ""
    cabin_class: str = ""
    seat: str = ""

    def to_row(self) -> dict[str, str]:
        airline = AIRLINE_NAMES.get(self.airline_code.upper(), self.airline_code)
        return {
            "flight_date":    self.flight_date,
            "dep_airport":    self.dep_airport,
            "arr_airport":    self.arr_airport,
            "airline_code":   self.airline_code,
            "flight_number":  self.flight_number,
            "airline_name":   airline,
            "aircraft_type":  self.aircraft_type,
            "scheduled_dep":  self.scheduled_dep,
            "scheduled_arr":  self.scheduled_arr,
        }


@dataclass
class EmailMeta:
    src_file: str
    subject: str
    start_year: int
    start_month: int
    end_year: int
    end_month: int
    segments: list[FlightSeg] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_subject_range(subject: str) -> tuple[int, int, int, int, int] | None:
    """Parse e.g. '26/11/11~11/14' or '2026/11/27~12/11' or '26/10/23' (one-way)
    or '26/12/18 ~ 27/01/14' (year-wrap Dec→Jan).

    Returns (sy, sm, sd, ey, em) where ed==sd if one-way; returns None if no match.
    """
    s = subject.replace("～", "~").replace("—", "-").replace("–", "-")

    # Range with explicit year on BOTH ends — try this first because it's most
    # specific and avoids the next regex from eating the second year prefix.
    m = re.search(r"(\d{2,4})/(\d{1,2})/(\d{1,2})\s*[~\-]\s*(\d{2,4})/(\d{1,2})/(\d{1,2})", s)
    if m:
        sy = _norm_year(m.group(1)); sm = int(m.group(2)); sd = int(m.group(3))
        ey = _norm_year(m.group(4)); em = int(m.group(5)); ed = int(m.group(6))
        return (sy, sm, sd, ey, em)
    # Range with year on left only: YYYY/MM/DD~MM/DD
    m = re.search(r"(\d{2,4})/(\d{1,2})/(\d{1,2})\s*[~\-]\s*(\d{1,2})/(\d{1,2})", s)
    if m:
        sy = _norm_year(m.group(1)); sm = int(m.group(2)); sd = int(m.group(3))
        ey = sy; em = int(m.group(4)); ed = int(m.group(5))
        return (sy, sm, sd, ey, em)
    # Single date (one-way)
    m = re.search(r"(\d{2,4})/(\d{1,2})/(\d{1,2})", s)
    if m:
        sy = _norm_year(m.group(1)); sm = int(m.group(2)); sd = int(m.group(3))
        return (sy, sm, sd, sy, sm)
    return None


def _norm_year(y: str) -> int:
    y = int(y)
    return 2000 + y if y < 100 else y


def year_for_segment(
    seg_month: int, seg_day: int,
    sy: int, sm: int, sd: int, ey: int, em: int, ed: int,
) -> int:
    """Pick the year for a (month, day) using the email's date range as context.

    Strategy: if (month, day) >= (start_month, start_day) in calendar order,
    use start_year. Otherwise use end_year. Handles Dec→Jan wrap correctly
    because end_year is taken from the explicit end (e.g. 2027/01/14).
    """
    # Compare (month, day) pairs
    def gte(a_m: int, a_d: int, b_m: int, b_d: int) -> bool:
        return (a_m, a_d) >= (b_m, b_d)
    # If start_month <= end_month (no wrap), simple compare to start.
    if sm <= em:
        if gte(seg_month, seg_day, sm, sd):
            return sy
        return ey
    # Wraps: Dec -> Jan. Segments in Dec or before Jan in start_month use sy,
    # segments in Jan or before Dec in end_month use ey.
    if seg_month >= sm:
        return sy
    return ey


def format_date(month: int, day: int, year: int) -> str:
    """M/D/YYYY (no zero padding) — matches flights_template.csv."""
    return f"{month}/{day}/{year}"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

# Concise pattern: "1.WN3037 11Nov ELPAUS 0635 0905" or with "+1" → "1300+1".
# Trailing content (e.g. "——0PC No luggage allowance") is allowed.
RE_CONCISE = re.compile(
    r"^\s*\d+\s*\.\s*"
    r"(?P<code>[A-Z]{2})(?P<num>\d+)\s+"
    r"(?P<day>\d{1,2})(?P<mon>JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+"
    r"(?P<dep>[A-Z]{3})(?P<arr>[A-Z]{3})\s+"
    r"(?P<t1>\d{4})(?P<plus1>\+\d)?\s+"
    r"(?P<t2>\d{4})(?:\+\d)?",
    re.IGNORECASE,
)

# Table pattern (email 5 — Chinese itinerary with city names + IATA codes).
# Example: "01 埃爾帕索(ELP)-洛杉磯(LAX) 27NOV 五 0600 0721 AA6427 AWIWSB O 機位OK 美國航空公司"
RE_TABLE = re.compile(
    r"^\s*(?P<num>\d{2})\s+"
    r"(?P<city1>[^\s()]+)\((?P<dep>[A-Z]{3})\)"
    r"-(?P<city2>[^\s()]+)\((?P<arr>[A-Z]{3})\)\s+"
    r"(?P<day>\d{1,2})(?P<mon>JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+"
    r"\S+\s+"  # weekday (e.g. 五)
    r"(?P<t1>\d{4})(?:\+\d)?\s+"
    r"(?P<t2>\d{4})(?:\+\d)?\s+"
    r"(?P<code>[A-Z]{2})(?P<numf>\d+)\s+",
    re.IGNORECASE,
)

# Alt-table pattern for airline-style e-tickets embedded in email bodies
# (e.g. Southwest / EVA / American Airlines PDF text extracted into the body).
# Captures the same fields as RE_TABLE but without the leading segment number
# and city-name parenthetical — relies on a 3-letter IATA + 4-digit time sequence.
RE_TABLE_LOOSE = re.compile(
    r"(?P<dep>[A-Z]{3})\s+"
    r"(?P<day>\d{1,2})(?P<mon>JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+"
    r"(?P<year>\d{4})\s+"
    r"(?P<t1>\d{4})(?:\+\d)?\s+"
    r"(?P<arr>[A-Z]{3})\s+",
    re.IGNORECASE,
)


def parse_concise_line(line: str, meta: EmailMeta) -> FlightSeg | None:
    m = RE_CONCISE.match(line)
    if not m:
        return None
    day = int(m.group("day"))
    mon = MONTHS[m.group("mon").upper()]
    year = year_for_segment(mon, day,
                            meta.start_year, meta.start_month, 1,
                            meta.end_year, meta.end_month, 28)
    seg = FlightSeg(
        flight_date=format_date(mon, day, year),
        dep_airport=m.group("dep").upper(),
        arr_airport=m.group("arr").upper(),
        airline_code=m.group("code").upper(),
        flight_number=m.group("num"),
        scheduled_dep=f"{m.group('t1')[:2]}:{m.group('t1')[2:]}",
        scheduled_arr=f"{m.group('t2')[:2]}:{m.group('t2')[2:]}" + (m.group("plus1") or ""),
        src_file=meta.src_file,
        raw_line=line.strip(),
    )
    return seg


def parse_table_line(line: str, meta: EmailMeta) -> FlightSeg | None:
    m = RE_TABLE.match(line)
    if not m:
        return None
    day = int(m.group("day"))
    mon = MONTHS[m.group("mon").upper()]
    year = year_for_segment(mon, day,
                            meta.start_year, meta.start_month, 1,
                            meta.end_year, meta.end_month, 28)
    seg = FlightSeg(
        flight_date=format_date(mon, day, year),
        dep_airport=m.group("dep").upper(),
        arr_airport=m.group("arr").upper(),
        airline_code=m.group("code").upper(),
        flight_number=m.group("numf"),
        scheduled_dep=f"{m.group('t1')[:2]}:{m.group('t1')[2:]}",
        scheduled_arr=f"{m.group('t2')[:2]}:{m.group('t2')[2:]}",
        src_file=meta.src_file,
        raw_line=line.strip(),
    )
    return seg


def extract_segments(body: str, meta: EmailMeta) -> list[FlightSeg]:
    """Walk the entire body and extract every flight segment that appears.

    PMX policy: track every flight that was offered / proposed, even if it
    was later cancelled or replaced. Cancelled/replacement lines are kept
    so the tracker can show the full history of an itinerary.

    Dedup: per email, keep only the FIRST occurrence of each
    (date, dep, arr, code, num) tuple. Multiple mentions of the same flight
    in the same email (e.g. body restating the itinerary) collapse to one row.
    """
    out: list[FlightSeg] = []
    seen: set[tuple[str, str, str]] = set()
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        seg = parse_concise_line(line, meta) or parse_table_line(line, meta)
        if seg is None:
            continue
        # PMX dedup policy: same flight on the same date = same row,
        # regardless of passenger. First occurrence wins.
        key = (seg.flight_date, seg.airline_code, seg.flight_number)
        if key in seen:
            continue
        seen.add(key)
        out.append(seg)
    return out


def parse_email(msg_path: Path) -> EmailMeta | None:
    m = extract_msg.Message(str(msg_path))
    subject = (m.subject or "").strip()
    rng = parse_subject_range(subject)
    if rng is None:
        print(f"  ! {msg_path.name}: no date range in subject — skipped")
        return None
    sy, sm, sd, ey, em = rng
    meta = EmailMeta(
        src_file=msg_path.name,
        subject=subject,
        start_year=sy, start_month=sm,
        end_year=ey, end_month=em,
    )
    meta.segments = extract_segments(m.body or "", meta)
    return meta


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def write_csv(metas: list[EmailMeta], out_path: Path,
              append: bool = False, dedup: bool = False,
              sort_desc: bool = True) -> int:
    """Write segments to CSV.

    - append=False (default): overwrite the file with a fresh header + rows.
      Use for the first run on a brand-new file.
    - append=True: append to the existing file (no header). Existing rows are
      preserved; new rows are added at the bottom.
    - dedup=True: when appending, skip rows whose
      (flight_date, airline_code, flight_number) is already present in the
      existing file. PMX policy: same flight number on the same date is the
      same physical flight regardless of passenger, so we collapse duplicates.
      If route parsing produced different routes for the same flight, the
      first occurrence wins.
    - sort_desc=True (default): after writing, the whole file is re-sorted by
      arrival date+time descending — newest arrivals first. PMX review order.

    Returns number of rows actually written (after dedup).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    existing: set[tuple[str, str, str]] = set()
    if append and dedup and out_path.exists():
        with out_path.open("r", encoding="utf-8", newline="") as f:
            r = csv.DictReader(f)
            for row in r:
                existing.add((row.get("flight_date", ""),
                              row.get("airline_code", ""),
                              row.get("flight_number", "")))

    mode = "a" if append else "w"
    with out_path.open(mode, newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        if not append:
            w.writeheader()
        n = 0
        for meta in metas:
            for seg in meta.segments:
                key = (seg.flight_date, seg.airline_code, seg.flight_number)
                if key in existing:
                    continue
                w.writerow(seg.to_row())
                existing.add(key)
                n += 1

    if sort_desc and out_path.exists():
        _sort_csv_desc(out_path)
    return n


def _sort_csv_desc(csv_path: Path) -> None:
    """Re-sort the CSV by arrival datetime DESC (newest first).

    Sort key = (flight_date DESC, scheduled_arr DESC, scheduled_dep DESC).
    Header is preserved. Empty / unparseable date/time values sort last.
    """
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        rows = list(r)

    def key(row: dict) -> tuple[int, int, int, str, str, str]:
        # Negate the parsed tuple components so Python's ascending sort gives
        # descending order. Use big sentinels (9999..) for empty fields so
        # blanks sink to the bottom.
        d = row.get("flight_date", "")
        try:
            mo, da, y = d.split("/")
            ymd = (int(y), int(mo), int(da))
            ymd_key = (-int(y), -int(mo), -int(da))  # DESC
        except ValueError:
            ymd_key = (9999, 9999, 9999)
        arr = row.get("scheduled_arr", "") or "00:00"
        dep = row.get("scheduled_dep", "") or "00:00"
        # Compare "HH:MM" or "HH:MM+N" — strip the suffix.
        def hhmm(s: str) -> tuple[int, int]:
            m = re.match(r"^(\d{1,2}):(\d{2})", s)
            return (int(m.group(1)), int(m.group(2))) if m else (-1, -1)
        ah, ami = hhmm(arr)
        dh, dmi = hhmm(dep)
        # DESC by arrival then departure
        return (*ymd_key, -ah if ah >= 0 else 9999, -ami if ami >= 0 else 99,
                -dh if dh >= 0 else 9999, -dmi if dmi >= 0 else 99)

    rows.sort(key=key)

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        w.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--src", type=Path, default=DEFAULT_SRC,
        help=f"Folder with .msg files (default: {DEFAULT_SRC})",
    )
    ap.add_argument(
        "--out", type=Path,
        default=CUMULATIVE_CSV,
        help=f"Output CSV path (default: {CUMULATIVE_CSV})",
    )
    ap.add_argument(
        "--append", action="store_true",
        help="Append to existing CSV instead of overwriting (no header)",
    )
    ap.add_argument(
        "--dedup", action="store_true",
        help="When appending, skip rows whose key already exists in the file",
    )
    ap.add_argument(
        "--also-append-template", action="store_true",
        help=f"Append produced rows to legacy {TEMPLATE_PATH} (keeps existing rows)",
    )
    args = ap.parse_args(argv)

    src: Path = args.src
    if not src.exists():
        print(f"Source folder not found: {src}", file=sys.stderr)
        return 2

    msg_files = sorted(p for p in src.glob("*.msg"))
    if not msg_files:
        print(f"No .msg files in {src}", file=sys.stderr)
        return 2

    print(f"Source : {src}")
    print(f"Output : {args.out}  (mode={'append' if args.append else 'overwrite'}, dedup={args.dedup})")
    print(f"Files  : {len(msg_files)}")

    metas: list[EmailMeta] = []
    for p in msg_files:
        meta = parse_email(p)
        if meta is None:
            continue
        print(f"  [OK] {p.name}: {len(meta.segments)} segment(s) -- {meta.subject}")
        metas.append(meta)

    n = write_csv(metas, args.out, append=args.append, dedup=args.dedup)
    mode_word = "appended" if args.append else "wrote"
    print(f"\n{mode_word.capitalize()} {n} rows -> {args.out}")

    if args.also_append_template:
        if not TEMPLATE_PATH.exists():
            print(f"Template not found: {TEMPLATE_PATH}", file=sys.stderr)
        else:
            # Append produced rows (skip header from intermediate CSV)
            with args.out.open("r", encoding="utf-8") as src_f, \
                 TEMPLATE_PATH.open("a", encoding="utf-8", newline="") as dst_f:
                rdr = csv.DictReader(src_f, fieldnames=CSV_COLUMNS)
                next(rdr)  # drop header
                w = csv.DictWriter(dst_f, fieldnames=CSV_COLUMNS)
                for row in rdr:
                    w.writerow(row)
            print(f"Appended {n} rows to {TEMPLATE_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
