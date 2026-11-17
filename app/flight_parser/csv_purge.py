"""Remove expired rows from the cumulative CSV in place.

Reads the CSV, filters rows through `expired_filter.is_expired`, then writes
back the kept rows. Backs up the original before mutating.

PMX policy: a row is expired if its destination arrival time (flight_date +
scheduled_arr) has already passed. Falls back to flight_date-only when
scheduled_arr is missing.
"""
from __future__ import annotations

import csv
import sys
from datetime import date, datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
except Exception:
    pass

import parse_emails                # noqa: E402
import expired_filter              # noqa: E402

CSV_COLUMNS = parse_emails.CSV_COLUMNS


def purge_expired(csv_path: Path,
                  today: date | None = None,
                  now:   datetime | None = None,
                  backup: bool = True) -> tuple[int, int]:
    """Drop expired rows from the cumulative CSV.

    Returns (kept, removed) row counts. The CSV is rewritten with only the
    kept rows; a .bak_<ts> backup is created first if `backup=True`.
    """
    csv_path = Path(csv_path)
    today = today or date.today()
    now   = now or datetime.now()

    if not csv_path.exists():
        return 0, 0

    # Read all rows
    rows: list[dict] = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(row)

    # Build FlightSegs and split
    kept_rows: list[dict] = []
    removed = 0
    for row in rows:
        seg = parse_emails.FlightSeg(
            flight_date=row.get("flight_date", ""),
            dep_airport=row.get("dep_airport", ""),
            arr_airport=row.get("arr_airport", ""),
            airline_code=row.get("airline_code", ""),
            flight_number=row.get("flight_number", ""),
            scheduled_dep=row.get("scheduled_dep", ""),
            scheduled_arr=row.get("scheduled_arr", ""),
        )
        if expired_filter.is_expired(seg, today=today, now=now):
            removed += 1
        else:
            kept_rows.append(row)

    if removed == 0:
        return len(kept_rows), 0

    if backup:
        bk = csv_path.with_suffix(
            csv_path.suffix + f".bak_{datetime.now():%Y%m%d_%H%M%S}"
        )
        bk.write_bytes(csv_path.read_bytes())

    # Write back kept rows
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        w.writerows(kept_rows)

    return len(kept_rows), removed
