"""Filter out expired (already-departed) flight segments.

A flight is considered expired if its flight_date is strictly before today
(local time, server clock). Flights happening today are kept (the user may
still want to track them on the day of travel).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Iterable

from parse_emails import FlightSeg


def parse_mdY(s: str) -> date | None:
    """Parse 'M/D/YYYY' (American, no zero pad) -> date. Returns None on failure."""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s.strip())
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None


def is_expired(seg: FlightSeg, today: date | None = None) -> bool:
    """True if seg.flight_date is strictly before today (default: today UTC date)."""
    d = parse_mdY(seg.flight_date)
    if d is None:
        return False  # unknown date -> keep (don't silently drop)
    return d < (today or date.today())


def filter_expired(segs: Iterable[FlightSeg],
                   today: date | None = None) -> tuple[list[FlightSeg], list[FlightSeg]]:
    """Split segs into (kept, expired). Kept = non-expired + unknown-date."""
    kept, expired = [], []
    for s in segs:
        (expired if is_expired(s, today) else kept).append(s)
    return kept, expired
