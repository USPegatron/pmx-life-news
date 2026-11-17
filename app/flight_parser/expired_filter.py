"""Filter out expired (already-arrived) flight segments.

PMX policy: a flight is considered expired if its destination arrival time
has already passed (i.e. the plane has already landed). Concretely:

  expired :=  flight_date < today
           OR (flight_date == today AND scheduled_arr < now)

If `scheduled_arr` is missing/empty we fall back to the date-only check
(the previous behaviour) and assume "still active" for flights on today's
date — better to over-track than to silently drop something we can't reason
about. The PMX "enricher" later fills in scheduled_arr with full ISO+offset.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from parse_emails import FlightSeg
from iata_tz import tz_for

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python < 3.9 fallback (not used; we target 3.13)
    ZoneInfo = None  # type: ignore


_HHMM_PLUS = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*(?:\+(\d+))?\s*$")
_ISO_OFFSET = re.compile(
    r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2}|Z)?\s*$"
)


def parse_mdY(s: str) -> Optional[date]:
    """Parse 'M/D/YYYY' (American, no zero pad) -> date. Returns None on failure."""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s.strip())
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None


def parse_hhmm_plus(s: str) -> Optional[tuple[int, int, int]]:
    """Parse 'HH:MM' or 'HH:MM+N' -> (hour, minute, day_offset)."""
    if not s:
        return None
    m = _HHMM_PLUS.match(s)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    plus = int(m.group(3) or 0)
    if not (0 <= h <= 23 and 0 <= mi <= 59):
        return None
    return h, mi, plus


def _arrival_datetime(seg: FlightSeg) -> Optional[datetime]:
    """Build a full arrival datetime from seg.scheduled_arr.

    Accepts (in priority order):
      1. ISO 8601 string with offset (seg.scheduled_arr_iso from PDF)
      2. 'HH:MM' + flight_date combined in seg.dep_airport's timezone
      3. 'HH:MM' + flight_date as naive (no TZ; used only as last resort)

    Returns timezone-aware datetime if a TZ could be resolved, otherwise naive.
    """
    iso = getattr(seg, "scheduled_arr_iso", None) or ""
    if iso:
        m = _ISO_OFFSET.match(iso)
        if m:
            try:
                yy, mo, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
                hh, mi = int(m.group(4)), int(m.group(5))
                ss = int(m.group(6) or 0)
                off_raw = m.group(7) or ""
                if off_raw == "Z":
                    off = timedelta(0)
                elif off_raw:
                    sign = 1 if off_raw[0] == "+" else -1
                    body = off_raw[1:].replace(":", "")
                    off = timedelta(hours=int(body[:2]), minutes=int(body[2:])) * sign
                else:
                    off = timedelta(0)
                return datetime(yy, mo, dd, hh, mi, ss, tzinfo=__import__("datetime").timezone(off))
            except (ValueError, TypeError):
                pass

    d = parse_mdY(seg.flight_date)
    if d is None:
        return None
    arr = parse_hhmm_plus(seg.scheduled_arr)
    if arr is None:
        return None
    h, mi, plus = arr
    base = datetime(d.year, d.month, d.day, h, mi)
    base = base + timedelta(days=plus)

    tz_name = tz_for(seg.arr_airport) if seg.arr_airport else None
    if tz_name and ZoneInfo is not None:
        try:
            return base.replace(tzinfo=ZoneInfo(tz_name))
        except Exception:
            return base
    return base  # naive


def is_expired(seg: FlightSeg,
               today: Optional[date] = None,
               now:   Optional[datetime] = None) -> bool:
    """True if the flight's arrival has already passed.

    Order of checks (most specific first):
      1. If we can build a full arrival datetime and it's in the past -> expired.
      2. Else if flight_date is strictly before today -> expired.
      3. Else (flight_date >= today, no arrival time available) -> not expired.
    """
    today = today or date.today()
    now = now or datetime.now()

    arrival = _arrival_datetime(seg)
    if arrival is not None:
        # If arrival is TZ-aware, compare in absolute terms using that TZ.
        # If naive, compare against naive now.
        if arrival.tzinfo is not None and now.tzinfo is None:
            from datetime import timezone as _tz
            # Compare in the arrival's own timezone so DST and offsets align.
            now = datetime.now(tz=arrival.tzinfo)
        return arrival < now

    d = parse_mdY(seg.flight_date)
    if d is None:
        return False  # unknown date -> keep
    return d < today


def filter_expired(segs: Iterable[FlightSeg],
                   today: Optional[date] = None,
                   now:   Optional[datetime] = None,
                   ) -> tuple[list[FlightSeg], list[FlightSeg]]:
    """Split segs into (kept, expired)."""
    kept, expired = [], []
    for s in segs:
        (expired if is_expired(s, today, now) else kept).append(s)
    return kept, expired
