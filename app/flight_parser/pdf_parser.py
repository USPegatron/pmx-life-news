"""Parse flight data from PDF itinerary / e-ticket attachments.

PMX itineraries come in several shapes:

  Format A — Mandarin Travel "Itinerary Receipt":
    Tabular itinerary with date, route, flight, dep_time, arr_time,
    duration, baggage, class. HH:MM only (no timezone).

  Format B — Southwest Airlines "Flight Itinerary":
    Block per segment with city names, full English month dates, flight
    number, dep/arr times, PNR.

  Format C — Airline e-ticket (EVA / American / Southwest):
    Plain-text "ELECTRONIC TICKET" / "PASSENGER ITINERARY/RECEIPT" with
    DAY DATE FLIGHT DEP/ARR CITY TIME CLASS/STATUS. May include "+1" for
    next-day arrival.

  Format D — PMX Chinese ticket receipt (華翔旅行社):
    Mixed Chinese / English: weekday 月日 出發/抵達 [城市]([IATA]) [機場]
    [HH:MM] [CODE][NUM] [直飛] [艙等] [機型] [座位]
    Has aircraft type ("波音 777-300ER", "CANADAIR REGIONAL 700") — the
    richest source.

All parsers return a list of `PdfFlight` objects that the caller merges
into existing FlightSeg records (PDF wins for fields it has).
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
except Exception:
    pass

import pdfplumber  # type: ignore

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore


MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
    # Long English months used in some PDFs
    "JANUARY": 1, "FEBRUARY": 2, "MARCH": 3, "APRIL": 4, "MAY": 5,
    "JUNE": 6, "JULY": 7, "AUGUST": 8, "SEPTEMBER": 9, "OCTOBER": 10,
    "NOVEMBER": 11, "DECEMBER": 12,
}

# IATA airport code -> city name fragment (case-insensitive substring match
# against airport / city names that appear in PDFs). Used for Format B / D.
CITY_TO_IATA: dict[str, str] = {
    "ElPaso": "ELP",
    "LosAngeles": "LAX",
    "SanFrancisco": "SFO",
    "Phoenix": "PHX",
    "Tucson": "TUS",
    "Denver": "DEN",
    "LasVegas": "LAS",
    "Dallas": "DFW",
    "FortWorth": "DFW",
    "Houston": "IAH",
    "Austin": "AUS",
    "Chicago": "ORD",
    "Taipei": "TPE",
    "Taoyuan": "TPE",
    "Beijing": "PEK",
    "Shanghai": "SHA",
    "HongKong": "HKG",
    "Manila": "MNL",
    "Tokyo": "NRT",
    "Osaka": "KIX",
    "Seoul": "ICN",
    "Dubai": "DXB",
    "Chennai": "MAA",
    "Madras": "MAA",
    "Mumbai": "BOM",
    "Delhi": "DEL",
    "Bangkok": "BKK",
    "Singapore": "SIN",
    "KualaLumpur": "KUL",
    "Jakarta": "CGK",
    "Bangkok": "BKK",
    "London": "LHR",
    "Paris": "CDG",
    "Frankfurt": "FRA",
    "Amsterdam": "AMS",
    "Barcelona": "BCN",
    "Madrid": "MAD",
    "Rome": "FCO",
    "Sydney": "SYD",
    "Melbourne": "MEL",
    "Auckland": "AKL",
    "Mexico": "MEX",
    "Juarez": "CJS",
    "CiudadJuarez": "CJS",
    "BenitoJuarez": "MEX",   # Mexico City airport name
    "AbrahamGonzalez": "CJS", # Ciudad Juárez airport name
}


@dataclass
class PdfFlight:
    """One segment parsed from a PDF. Optional fields are filled only if
    the PDF carries them; merging into FlightSeg leaves blanks alone."""
    flight_date: str = ""             # M/D/YYYY (normalised)
    dep_airport: str = ""             # IATA
    arr_airport: str = ""             # IATA
    airline_code: str = ""
    flight_number: str = ""
    scheduled_dep_iso: str = ""       # ISO 8601 with offset (preferred)
    scheduled_arr_iso: str = ""
    scheduled_dep: str = ""           # HH:MM (local)
    scheduled_arr: str = ""           # HH:MM (local), may carry "+1"
    aircraft_type: str = ""
    pnr: str = ""
    ticket_number: str = ""
    cabin_class: str = ""
    seat: str = ""
    src_pdf: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_text(pdf_path: Path) -> str:
    chunks: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            chunks.append(page.extract_text() or "")
    return "\n".join(chunks)


def _to_mdY(y: int, mo: int, d: int) -> str:
    return f"{mo}/{d}/{y}"


def _to_iso(y: int, mo: int, d: int, hh: int, mi: int, tz_name: str) -> str:
    """Build a TZ-aware ISO 8601 string for the given IANA timezone."""
    if ZoneInfo is None:
        return ""
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        return ""
    dt = datetime(y, mo, d, hh, mi, tzinfo=tz)
    return dt.isoformat()


def _guess_iata_from_name(name: str) -> str:
    """Try to map a city/airport name fragment to an IATA code."""
    s = re.sub(r"[^A-Za-z]", "", name)
    if not s:
        return ""
    # Try longest match first
    for key in sorted(CITY_TO_IATA.keys(), key=len, reverse=True):
        if key.lower() in s.lower():
            return CITY_TO_IATA[key]
    return ""


def _airport_to_iata(name: str) -> str:
    """Pull IATA from '(IATA)' parenthetical, falling back to city guess."""
    m = re.search(r"\(([A-Z]{3})\)", name)
    if m:
        return m.group(1)
    return _guess_iata_from_name(name)


# ---------------------------------------------------------------------------
# Format A — Mandarin Travel "Itinerary Receipt"
# ---------------------------------------------------------------------------

# Example (after re.sub("\s+", " ")):
#   2026-11-13 Intl(CJS)-BenitoJuarez 2hr.43m Econo AM120 19:12 22:55 1PC -
#   2026-11-14 12:40[+ 17hr.45 Econo HU7926 Intl(MEX)1-CapitalIntl(PEK)T2 04:55 2PC TIJ
# Times appear as "HH:MM" (with colon). The "[+1day]" indicator lives on the
# arrival column when the flight arrives after midnight.
RE_MT_SEG = re.compile(
    r"(?P<date>\d{4}-\d{1,2}-\d{1,2})"
    r"(?P<middle>[\s\S]*?)"
    r"(?P<code>[A-Z]{2})(?P<num>\d+)\s+"
    r"(?P<t1>\d{2}:\d{2})\s+"
    r"(?P<t2>\d{2}:\d{2})(?:\[?\+1?day?\])?\s+"
    r"(?P<bag>\d+PC|——\d+PC|\d+KG|\d+KG/PC)",
    re.DOTALL,
)


def parse_mandarin_travel(text: str) -> list[PdfFlight]:
    """Parse a Mandarin Travel 'Itinerary Receipt' PDF."""
    out: list[PdfFlight] = []
    # Collapse whitespace so multi-line entries match.
    flat = re.sub(r"\s+", " ", text)
    # Pull passenger name (first line of "PassengerInformation")
    pn = ""
    m_pn = re.search(r"Passenger\s+TicketNumber\s+CertNo\s*\n?\s*([^\s]+/[\w/]+)", text)
    if m_pn:
        pn = m_pn.group(1).strip()

    for m in RE_MT_SEG.finditer(flat):
        d_str = m.group("date")
        try:
            y, mo, da = (int(x) for x in d_str.split("-"))
        except ValueError:
            continue
        middle = m.group("middle") or ""
        # Find the dep IATA in the middle (first "(IATA)" parenthetical).
        dep_m = re.search(r"\(([A-Z]{3})\)", middle)
        if not dep_m:
            continue
        dep_iata = dep_m.group(1)
        # Arrival IATA — second "(IATA)" in middle, else guess from rest.
        all_codes = re.findall(r"\(([A-Z]{3})\)", middle)
        if len(all_codes) >= 2:
            arr_iata = all_codes[1]
        else:
            # Look at text after the dep code's paren for a city name.
            rest = middle[middle.index(f"({dep_iata})") + len(dep_iata) + 2:]
            arr_iata = _guess_iata_from_name(rest)
        if not arr_iata:
            continue

        code = m.group("code")
        num = m.group("num")
        # Times are already "HH:MM" — keep them as-is. If the middle text
        # contains a "[+1day]" hint on the arrival column, add the suffix.
        t1 = m.group("t1")
        t2 = m.group("t2")
        plus = ""
        if re.search(r"\[?\+1\s*day\]?", middle):
            plus = "+1"

        out.append(PdfFlight(
            flight_date=_to_mdY(y, mo, da),
            dep_airport=dep_iata,
            arr_airport=arr_iata,
            airline_code=code,
            flight_number=num,
            scheduled_dep=t1,
            scheduled_arr=t2 + plus,
            ticket_number=pn,
            src_pdf="ItineraryReceipt",
        ))
    return out


# ---------------------------------------------------------------------------
# Format B — Southwest "Flight Itinerary"
# ---------------------------------------------------------------------------

RE_SW_SEG = re.compile(
    r"Departure\s+(?P<dep_name>[A-Za-z\s]+?)-[A-Za-z]+/(?P<t1>\d{2}:\d{2}),\s+"
    r"(?P<mon>[A-Za-z]+)\s+(?P<day>\d{1,2}),\s+(?P<year>\d{4})"
    r".*?Arrival\s+info\s+(?P<arr_name>[A-Za-z\s]+?)-[A-Za-z]+/(?P<t2>\d{2}:\d{2}),\s+"
    r"(?P<mon2>[A-Za-z]+)\s+(?P<day2>\d{1,2}),\s+(?P<year2>\d{4})"
    r".*?Date\s+(?P<t1b>\d{2}:\d{2}),\s+(?P<monb>[A-Za-z]+)\s+(?P<dayb>\d{1,2}),\s+(?P<yearb>\d{4})\s+"
    r"(?P<code>[A-Z]{2})(?P<num>\d+)",
    re.DOTALL,
)


def parse_southwest(text: str) -> list[PdfFlight]:
    """Parse a Southwest Airlines 'Flight Itinerary' PDF (page 1)."""
    out: list[PdfFlight] = []
    flat = re.sub(r"\s+", " ", text)
    pnr = ""
    m_pnr = re.search(r"PNR\s+([A-Z0-9]{4,8})", flat)
    if m_pnr:
        pnr = m_pnr.group(1)
    for m in RE_SW_SEG.finditer(flat):
        try:
            mo = MONTHS[m.group("mon")[:3].upper()]
            day = int(m.group("day"))
            year = int(m.group("year"))
        except (KeyError, ValueError):
            continue
        dep_iata = _guess_iata_from_name(m.group("dep_name"))
        arr_iata = _guess_iata_from_name(m.group("arr_name"))
        if not dep_iata or not arr_iata:
            continue
        out.append(PdfFlight(
            flight_date=_to_mdY(year, mo, day),
            dep_airport=dep_iata,
            arr_airport=arr_iata,
            airline_code=m.group("code"),
            flight_number=m.group("num"),
            scheduled_dep=m.group("t1"),
            scheduled_arr=m.group("t2"),
            pnr=pnr,
            src_pdf="Southwest",
        ))
    return out


# ---------------------------------------------------------------------------
# Format C — Airline e-ticket (EVA / American / Southwest electronic ticket)
# ---------------------------------------------------------------------------

# Example line:
#   FRI 27NOV BR5 DEP LOS ANGELES INTL 1040 PREMIUM ...
#   28NOV ARR TAIPEI TAOYUAN,TPE 1720 OK
# Has a "+1" indicator in the next-day arrival column.
RE_EVT_SEG = re.compile(
    r"(?P<day1>[A-Z]{{3}})\s+(?P<date1>\d{{1,2}}(?:[A-Z]{{3}}))\s+"
    r"(?P<code>[A-Z]{{2}})(?P<num>\d+)\s+"
    r"DEP\s+(?P<dep_city>[A-Z][A-Z\s,]+?)(?:\s+TERMINAL\s+\d)?\s+(?P<t1>\d{{4}})"
    r"(?:[\s\S]+?)"
    r"(?P<date2>\d{{1,2}}(?:[A-Z]{{3}}))\s+ARR\s+(?P<arr_city>[A-Z][A-Z\s,]+?)(?:\s+TERMINAL\s+\d)?\s+(?P<t2>\d{{4}})",
)


def _parse_evt_date(day_month: str, base_year: int) -> tuple[int, int, int]:
    """Parse '27NOV' or '28NOV' -> (year, month, day). Year wraps Dec->Jan."""
    m = re.match(r"(\d{1,2})([A-Z]{3})", day_month.upper())
    if not m:
        raise ValueError(day_month)
    d = int(m.group(1))
    mo = MONTHS[m.group(2)]
    return base_year, mo, d


def parse_airline_eticket(text: str) -> list[PdfFlight]:
    """Parse a generic airline e-ticket PDF (EVA / AA / etc.)."""
    out: list[PdfFlight] = []
    flat = re.sub(r"[ \t]+", " ", text)

    # Issue date sets the year (e.g. "Issue Date: 28OCT26" -> 2026).
    issue_y = 2026
    m_iss = re.search(r"Issue\s+Date:\s*\d{1,2}([A-Z]{3})(\d{2,4})", flat)
    if m_iss:
        y = int(m_iss.group(2))
        issue_y = 2000 + y if y < 100 else y

    pnr = ""
    m_pnr = re.search(r"Booking\s+Ref:\s+([A-Z0-9]+)", flat)
    if m_pnr:
        pnr = m_pnr.group(1)
    tkt = ""
    m_tkt = re.search(r"Ticket\s+Number:\s+([\d-]+)", flat)
    if m_tkt:
        tkt = m_tkt.group(1)

    for m in RE_EVT_SEG.finditer(flat):
        try:
            y1, mo1, d1 = _parse_evt_date(m.group("date1"), issue_y)
            y2, mo2, d2 = _parse_evt_date(m.group("date2"), issue_y)
        except (ValueError, KeyError):
            continue
        # Year wrap for January departure on Dec-issued ticket.
        if (y2, mo2) < (y1, mo1):
            y2 += 1
        dep_iata = _guess_iata_from_name(m.group("dep_city"))
        arr_iata = _airport_to_iata(m.group("arr_city"))
        if not dep_iata or not arr_iata:
            continue
        t1 = m.group("t1")
        t2 = m.group("t2")
        out.append(PdfFlight(
            flight_date=_to_mdY(y1, mo1, d1),
            dep_airport=dep_iata,
            arr_airport=arr_iata,
            airline_code=m.group("code"),
            flight_number=m.group("num"),
            scheduled_dep=f"{t1[:2]}:{t1[2:]}",
            scheduled_arr=f"{t2[:2]}:{t2[2:]}",
            pnr=pnr,
            ticket_number=tkt,
            src_pdf="ETicket",
        ))
    return out


# ---------------------------------------------------------------------------
# Format D — PMX Chinese ticket receipt (華翔旅行社)
# ---------------------------------------------------------------------------

# Example line:
#   五 11月27日 出發 埃爾帕索(ELP)埃爾帕索國際機場 0600 AA6427 直飛
#   抵達 洛杉磯(LAX)洛杉磯國際機場 0721 經濟艙(O) CANADAIR REGIONAL
#   700
RE_PMX_SEG = re.compile(
    r"[一二三四五六日]\s+(?P<mon>\d{1,2})月(?P<day>\d{1,2})日\s+"
    r"出發\s+(?P<dep_city>[^()\s]+)\((?P<dep>[A-Z]{3})\)[^0-9]+?\s+(?P<t1>\d{4})\s+"
    r"(?P<code>[A-Z]{2})(?P<num>\d+)\s+"
    r"(?:直飛|轉機)[^0-9]+?"
    r"抵達\s+(?P<arr_city>[^()\s]+)\((?P<arr>[A-Z]{3})\)[^0-9]+?\s+(?P<t2>\d{4})\s+"
    r"(?P<class>[^()]+?)\(\s*(?P<cls_code>[A-Z])\s*\)\s+"
    r"(?P<ac>[^\n]+?)(?:\n|$)",
    re.DOTALL,
)


# Aircraft-name -> ICAO typecode mapping for the few models that appear in
# the PMX ticket receipts.
AIRCRAFT_NAME_TO_TYPE: dict[str, str] = {
    "BOEING 777-300ER": "B77W",
    "BOEING 777-300": "B773",
    "BOEING 777-200": "B772",
    "BOEING 787-9": "B789",
    "BOEING 787-8": "B788",
    "BOEING 737-800": "B738",
    "BOEING 737-700": "B737",
    "AIRBUS A320": "A320",
    "AIRBUS A321": "A321",
    "AIRBUS A330": "A333",
    "AIRBUS A350": "A359",
    "CANADAIR REGIONAL 700": "CRJ7",
    "CANADAIR REGIONAL 900": "CRJ9",
    "EMBRAER E175": "E175",
}


def _aircraft_to_typecode(name: str) -> str:
    s = re.sub(r"\s+", " ", name.upper()).strip()
    # Direct hit
    if s in AIRCRAFT_NAME_TO_TYPE:
        return AIRCRAFT_NAME_TO_TYPE[s]
    # Loose match
    for k, v in AIRCRAFT_NAME_TO_TYPE.items():
        if k in s or s in k:
            return v
    # Pass-through if already an ICAO typecode
    s = s.replace(" ", "")
    if re.match(r"^[A-Z]?\d{3}$", s):
        return s
    return ""


def parse_pmx_chinese(text: str) -> list[PdfFlight]:
    """Parse a 華翔旅行社 / PMX Chinese ticket receipt PDF."""
    out: list[PdfFlight] = []
    flat = re.sub(r"[ \t]+", " ", text)

    pnr = ""
    m_pnr = re.search(r"訂位代號[：:]\s*([A-Z0-9]+)", flat)
    if m_pnr:
        pnr = m_pnr.group(1)

    for m in RE_PMX_SEG.finditer(flat):
        try:
            mo = int(m.group("mon"))
            day = int(m.group("day"))
        except ValueError:
            continue
        # Issue date / year inferred from PDF metadata. Default to current year.
        # Most PMX tickets are within a year of issue.
        year = 2026
        out.append(PdfFlight(
            flight_date=_to_mdY(year, mo, day),
            dep_airport=m.group("dep"),
            arr_airport=m.group("arr"),
            airline_code=m.group("code"),
            flight_number=m.group("num"),
            scheduled_dep=f"{m.group('t1')[:2]}:{m.group('t1')[2:]}",
            scheduled_arr=f"{m.group('t2')[:2]}:{m.group('t2')[2:]}",
            aircraft_type=_aircraft_to_typecode(m.group("ac")),
            cabin_class=m.group("cls_code"),
            pnr=pnr,
            src_pdf="PMX",
        ))
    return out


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def parse_pdf(pdf_path: Path) -> list[PdfFlight]:
    """Detect the PDF format and parse accordingly. Returns [] on failure."""
    try:
        text = _extract_text(pdf_path)
    except Exception:
        return []
    if not text:
        return []

    # Try richer formats first; fall back to a generic route scan.
    if "華翔旅行社" in text or "PMX派駐" in text or "出發" in text and "抵達" in text:
        flights = parse_pmx_chinese(text)
        if flights:
            return flights
    if "ELECTRONIC TICKET" in text or "PASSENGER ITINERARY" in text:
        flights = parse_airline_eticket(text)
        if flights:
            return flights
    if "Itinerary Receipt" in text:
        flights = parse_mandarin_travel(text)
        if flights:
            return flights
    if "Flight Itinerary" in text and "Booking details" in text:
        flights = parse_southwest(text)
        if flights:
            return flights
    return []


def merge_into_segs(pdf_flights: list[PdfFlight],
                    segs: list) -> list:
    """For each FlightSeg in `segs`, look up a matching PdfFlight by
    (flight_date, airline_code, flight_number, dep_airport). When matched,
    copy non-empty PDF fields over (PDF wins). Returns the segs list
    (mutated in place; also returned for chaining).
    """
    # Build a key -> PdfFlight map
    pdf_idx: dict[tuple, PdfFlight] = {}
    for pf in pdf_flights:
        k = (pf.flight_date, pf.airline_code, pf.flight_number, pf.dep_airport)
        pdf_idx[k] = pf

    out = []
    for seg in segs:
        key = (seg.flight_date, seg.airline_code, seg.flight_number, seg.dep_airport)
        pf = pdf_idx.get(key)
        if pf is None:
            out.append(seg)
            continue
        if pf.dep_airport and not seg.dep_airport:
            seg.dep_airport = pf.dep_airport
        if pf.arr_airport and not seg.arr_airport:
            seg.arr_airport = pf.arr_airport
        if pf.scheduled_dep and not seg.scheduled_dep:
            seg.scheduled_dep = pf.scheduled_dep
        if pf.scheduled_arr and not seg.scheduled_arr:
            seg.scheduled_arr = pf.scheduled_arr
        if pf.scheduled_dep_iso and not seg.scheduled_dep_iso:
            seg.scheduled_dep_iso = pf.scheduled_dep_iso
        if pf.scheduled_arr_iso and not seg.scheduled_arr_iso:
            seg.scheduled_arr_iso = pf.scheduled_arr_iso
        if pf.aircraft_type and not seg.aircraft_type:
            seg.aircraft_type = pf.aircraft_type
        if pf.pnr and not seg.pnr:
            seg.pnr = pf.pnr
        if pf.ticket_number and not seg.ticket_number:
            seg.ticket_number = pf.ticket_number
        if pf.cabin_class and not seg.cabin_class:
            seg.cabin_class = pf.cabin_class
        if pf.seat and not seg.seat:
            seg.seat = pf.seat
        out.append(seg)
    return out
