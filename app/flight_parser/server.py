"""FastAPI server for PMX flight itinerary email scanning.

Endpoints
---------
GET  /healthz                                  -- liveness
POST /api/scan-folder                          -- scan a folder of .msg files,
                                                  parse, filter expired, optionally upload
POST /api/scan-mailbox                         -- search IMAP mailbox for flight
                                                  emails, save to local cache,
                                                  parse, filter, optionally upload
GET  /api/flights                              -- list tracked flights (Supabase)
POST /api/run-schedule                         -- run the daily-scheduled scan
                                                  once on demand (uses the same
                                                  default src + mailbox settings)

Run locally:
    python -m uvicorn app.flight_parser.server:app --host 0.0.0.0 --port 8765

The server uses the same parser pipeline as parse_and_upload.py:
    msg files  ->  FlightSeg  ->  filter_expired  ->  Supabase upsert
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Optional

# Force UTF-8 stdout for Windows console
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
except Exception:
    pass

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Local modules (this folder is on sys.path when run as a module; we also
# add it explicitly so `python server.py` works).
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import parse_emails                # noqa: E402
import parse_and_upload            # noqa: E402
import mailbox as mbx              # noqa: E402
import expired_filter              # noqa: E402
import iata_tz                     # noqa: E402

import requests                    # noqa: E402

PROJECT_ROOT = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Life News"
)
DEFAULT_MSG_DIR = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Flight Itinerary\data\flight itinerary"
)
# Canonical cumulative CSV lives under the Flight Itinerary project.
DEFAULT_CUMULATIVE_CSV = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Flight Itinerary\report\flights_template.csv"
)
# Legacy desktop template (kept for back-compat; not the source of truth).
DEFAULT_LEGACY_TEMPLATE = Path(
    r"C:\Users\Jacky2_Wang\Desktop\flights_template.csv"
)
ENV_FILE = PROJECT_ROOT / "app" / "crawler" / ".env"
MAIL_CACHE = HERE / "mail_cache"


app = FastAPI(
    title="PMX Flight Itinerary Server",
    description=(
        "Scans .msg files (local folder or IMAP mailbox) for PMX flight "
        "itinerary emails, parses flight segments, filters out already-"
        "departed (expired) flights, and uploads the remainder to the "
        "PMX Life News flight tracker (Supabase)."
    ),
    version="0.1.0",
)


# ---------- Pydantic models ----------

class ScanFolderRequest(BaseModel):
    src: Optional[str] = None
    filter_expired: bool = True
    upload: bool = True
    append_cumulative: bool = True
    cumulative_path: Optional[str] = None
    append_legacy_template: bool = False
    template_path: Optional[str] = None


class ScanMailboxRequest(BaseModel):
    subject_contains: str = "Air Ticket"
    since: Optional[str] = None            # ISO 'YYYY-MM-DD'
    before: Optional[str] = None           # ISO 'YYYY-MM-DD'
    lookback_days: Optional[int] = None    # shortcut: set since=today-N
    unseen_only: bool = False
    filter_expired: bool = True
    upload: bool = True
    append_cumulative: bool = True
    cumulative_path: Optional[str] = None
    append_legacy_template: bool = False
    template_path: Optional[str] = None


class ScanOutlookRequest(BaseModel):
    """Scan the signed-in Outlook inbox via COM (no IMAP credentials needed)."""
    limit: int = 200
    lookback_days: Optional[int] = None    # if set, filter to >= today-N
    filter_expired: bool = True
    upload: bool = True
    append_cumulative: bool = True
    cumulative_path: Optional[str] = None
    append_legacy_template: bool = False
    template_path: Optional[str] = None


class BackfillRequest(BaseModel):
    """Convenience: process all flight emails from the last N days.
    Default 180 days = ~6 months for the one-time backfill."""
    days: int = 180
    subject_contains: str = "Air Ticket"
    upload: bool = True
    append_cumulative: bool = True
    append_legacy_template: bool = False


class DailyCheckRequest(BaseModel):
    """Convenience: process flight emails received in the last 7 days."""
    days: int = 7
    subject_contains: str = "Air Ticket"
    upload: bool = True
    append_cumulative: bool = True
    append_legacy_template: bool = False


class ScanResult(BaseModel):
    src: str
    parsed_total: int
    expired_total: int
    kept_total: int
    uploaded_total: int = 0
    sources: list[dict] = Field(default_factory=list)


class RemoveExpiredRequest(BaseModel):
    """Archive (soft-delete) or hard-delete flights whose destination arrival
    has already passed.

    PMX policy: tracked flights that have already arrived are moved to the
    history view (archived_at is set) — they no longer appear in the main
    tracking UI but remain queryable.

    Set hard_delete=True to actually DELETE the rows instead of archiving.
    """
    dry_run: bool = True
    today: Optional[str] = None   # ISO 'YYYY-MM-DD'; defaults to today
    hard_delete: bool = False     # default: archive (UPDATE archived_at)


class HistoryQuery(BaseModel):
    """Fetch archived (history) flights from Supabase."""
    from_date: Optional[str] = None   # ISO 'YYYY-MM-DD'
    to_date: Optional[str] = None
    limit: int = 200


class FlightsQuery(BaseModel):
    from_date: Optional[str] = None        # ISO 'YYYY-MM-DD'
    to_date: Optional[str] = None
    status: Optional[str] = None
    limit: int = 200


# ---------- Core scan logic ----------

def _scan_paths(paths: list[Path], filter_expired: bool) -> tuple[
    list[parse_emails.FlightSeg], list[parse_emails.FlightSeg], list[dict]
]:
    """Run the parser on each path. Return (kept, expired, per-source stats)."""
    kept_all: list[parse_emails.FlightSeg] = []
    expired_all: list[parse_emails.FlightSeg] = []
    sources: list[dict] = []

    for p in paths:
        try:
            meta = parse_emails.parse_email(p)
        except Exception as e:
            sources.append({"src": str(p), "error": f"{type(e).__name__}: {e}"})
            continue
        if meta is None:
            sources.append({"src": str(p), "skipped": "no date range in subject"})
            continue
        if filter_expired:
            kept, expired = expired_filter.filter_expired(meta.segments)
        else:
            kept, expired = meta.segments, []
        kept_all.extend(kept)
        expired_all.extend(expired)
        sources.append({
            "src":        str(p),
            "subject":    meta.subject,
            "segments":   len(meta.segments),
            "kept":       len(kept),
            "expired":    len(expired),
        })
    return kept_all, expired_all, sources


def _upload_segs(segs: list[parse_emails.FlightSeg]) -> int:
    """Upload a list of FlightSeg to Supabase via the same path as
    parse_and_upload.upload_to_supabase(). Returns upserted count.

    Uses whatever schedule data we have:
      1. seg.scheduled_dep_iso / scheduled_arr_iso if the source (PDF)
         provided full ISO datetime with offset — these win.
      2. Otherwise, combine seg.scheduled_dep (HH:MM) with seg.flight_date
         and seg.dep_airport's IANA timezone, then emit ISO 8601 with offset.
      3. Fall back to null when we can't build a datetime (unknown airport).
    """
    if not segs:
        return 0
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["flight_date", "dep_airport", "arr_airport",
                "airline_code", "flight_number",
                "scheduled_dep", "scheduled_arr"])
    for s in segs:
        md = s.flight_date
        try:
            mo, d, y = md.split("/")
            iso = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
        except ValueError:
            continue
        dep_iso = _to_iso_datetime(s.flight_date, s.scheduled_dep_iso or s.scheduled_dep, s.dep_airport)
        arr_iso = _to_iso_datetime(s.flight_date, s.scheduled_arr_iso or s.scheduled_arr, s.arr_airport,
                                   plus_days_from_dep=True, dep_iso=dep_iso)
        w.writerow([iso, s.dep_airport, s.arr_airport,
                    s.airline_code, s.flight_number, dep_iso or "", arr_iso or ""])

    env = {}
    for ln in ENV_FILE.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#") or "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        env[k.strip()] = v.strip()
    url = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    ca = env.get("REQUESTS_CA_BUNDLE")

    rows = []
    buf.seek(0)
    r = csv.DictReader(buf)
    for row in r:
        rows.append({
            "flight_date":   row["flight_date"],
            "dep_airport":   row["dep_airport"].upper(),
            "arr_airport":   row["arr_airport"].upper(),
            "airline_code":  row["airline_code"].upper(),
            "flight_number": row["flight_number"].upper(),
            "scheduled_dep": row["scheduled_dep"] or None,
            "scheduled_arr": row["scheduled_arr"] or None,
            "status":        "scheduled",
            "updated_by":    "import",
        })
    if not rows:
        return 0
    endpoint = (
        f"{url}/rest/v1/flights_to_track"
        "?on_conflict=flight_date,dep_airport,arr_airport,airline_code,flight_number"
    )
    resp = requests.post(
        endpoint,
        params={"select": "id"},
        headers={
            "apikey":        key,
            "Authorization": f"Bearer {key}",
            "Content-Type":  "application/json",
            "Prefer":        "resolution=merge-duplicates,return=representation",
        },
        json=rows,
        verify=ca if ca else True,
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(f"Supabase upsert failed: {resp.status_code} {resp.text[:200]}")
    return len(resp.json())


def _to_iso_datetime(flight_date: str, time_str: str, airport: str,
                     plus_days_from_dep: bool = False,
                     dep_iso: str = "") -> str | None:
    """Build an ISO 8601 string with timezone offset from an HH:MM time
    + flight_date + airport IATA code. Returns None if not buildable.

    If `time_str` already looks like an ISO 8601 string (starts with year,
    contains 'T' or has offset), it's returned as-is.

    `plus_days_from_dep`: when arrival crosses midnight, infer the +1 day
    by comparing to dep_iso.
    """
    if not time_str:
        return None

    # Already ISO?
    import re as _re
    if _re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", time_str):
        return time_str

    # HH:MM (+ optional +N day suffix)
    m = _re.match(r"^(\d{1,2}):(\d{2})(?:\+(\d+))?$", time_str.strip())
    if not m:
        return None
    hh, mi = int(m.group(1)), int(m.group(2))
    explicit_plus = int(m.group(3) or 0)

    md = _re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", flight_date.strip())
    if not md:
        return None
    mo, d, y = int(md.group(1)), int(md.group(2)), int(md.group(3))

    tz_name = iata_tz.tz_for(airport)
    if not tz_name:
        return None
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
    except Exception:
        return None

    from datetime import datetime, timedelta
    base = datetime(y, mo, d, hh, mi)
    # Auto-detect +1 day rollover from explicit dep arrival comparison.
    plus_days = explicit_plus
    if plus_days_from_dep and dep_iso:
        try:
            dep_dt = datetime.fromisoformat(dep_iso)
            arr_naive = base
            # If arrival is earlier than dep in clock terms, assume next day.
            # Only apply if the user didn't already specify +1 explicitly.
            # Strip tz from dep_dt so naive/native comparisons work.
            if explicit_plus == 0:
                if dep_dt.tzinfo is not None:
                    dep_compare = dep_dt.replace(tzinfo=None)
                else:
                    dep_compare = dep_dt
                if arr_naive < dep_compare:
                    plus_days = 1
        except ValueError:
            pass
    dt = base + timedelta(days=plus_days)
    dt = dt.replace(tzinfo=tz)
    return dt.isoformat()


def _append_template(segs: list[parse_emails.FlightSeg], template: Path) -> int:
    if not template.exists():
        return 0
    import csv
    backup = Path(str(template) + f".bak_{datetime.now():%Y%m%d_%H%M%S}")
    backup.write_bytes(template.read_bytes())
    appended = 0
    with template.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        for s in segs:
            w.writerow([s.flight_date, s.dep_airport, s.arr_airport,
                        s.airline_code, s.flight_number,
                        parse_emails.AIRLINE_NAMES.get(s.airline_code, s.airline_code),
                        s.aircraft_type, s.scheduled_dep, s.scheduled_arr])
            appended += 1
    return appended


def _append_cumulative(segs: list[parse_emails.FlightSeg], csv_path: Path) -> int:
    """Append non-expired segments to the cumulative CSV with dedup by
    (flight_date, airline_code, flight_number). After writing, re-sorts
    the whole file by arrival datetime DESC (newest first)."""
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    import csv
    existing: set[tuple[str, str, str]] = set()
    if csv_path.exists():
        with csv_path.open("r", encoding="utf-8", newline="") as f:
            r = csv.DictReader(f)
            for row in r:
                existing.add((row.get("flight_date", ""),
                              row.get("airline_code", ""),
                              row.get("flight_number", "")))
    appended = 0
    new_file = not csv_path.exists()
    with csv_path.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["flight_date", "dep_airport", "arr_airport",
                        "airline_code", "flight_number",
                        "airline_name", "aircraft_type",
                        "scheduled_dep", "scheduled_arr"])
        for s in segs:
            key = (s.flight_date, s.airline_code, s.flight_number)
            if key in existing:
                continue
            w.writerow([s.flight_date, s.dep_airport, s.arr_airport,
                        s.airline_code, s.flight_number,
                        parse_emails.AIRLINE_NAMES.get(s.airline_code, s.airline_code),
                        s.aircraft_type, s.scheduled_dep, s.scheduled_arr])
            existing.add(key)
            appended += 1
    # Re-sort the whole file by arrival datetime DESC (PMX review order).
    if csv_path.exists():
        parse_emails._sort_csv_desc(csv_path)
    return appended


# ---------- Routes ----------

@app.get("/healthz")
def healthz():
    return {"status": "ok", "time": datetime.now().isoformat(timespec="seconds")}


@app.post("/api/scan-folder", response_model=ScanResult)
def api_scan_folder(req: ScanFolderRequest):
    src = Path(req.src) if req.src else DEFAULT_MSG_DIR
    if not src.exists():
        raise HTTPException(404, f"folder not found: {src}")
    paths = sorted(src.glob("*.msg"))
    if not paths:
        return ScanResult(src=str(src), parsed_total=0, expired_total=0,
                          kept_total=0, sources=[])
    kept, expired, sources = _scan_paths(paths, req.filter_expired)
    uploaded = 0
    if req.upload and kept:
        uploaded = _upload_segs(kept)
    appended_cum = 0
    if req.append_cumulative and kept:
        cum = Path(req.cumulative_path) if req.cumulative_path else DEFAULT_CUMULATIVE_CSV
        appended_cum = _append_cumulative(kept, cum)
    appended_tpl = 0
    if req.append_legacy_template and kept:
        tpl = Path(req.template_path) if req.template_path else DEFAULT_LEGACY_TEMPLATE
        appended_tpl = _append_template(kept, tpl)
    summary = list(sources)
    if appended_cum or appended_tpl:
        summary.append({
            "appended_to_cumulative_csv": appended_cum,
            "appended_to_legacy_template": appended_tpl,
        })
    return ScanResult(
        src=str(src),
        parsed_total=len(kept) + len(expired),
        expired_total=len(expired),
        kept_total=len(kept),
        uploaded_total=uploaded,
        sources=summary,
    )


@app.post("/api/scan-mailbox", response_model=ScanResult)
def api_scan_mailbox(req: ScanMailboxRequest):
    settings = mbx.load_settings_from_env_file(ENV_FILE)
    missing = [k for k in ("host", "user", "password") if not settings.get(k)]
    if missing:
        raise HTTPException(
            400,
            f"mailbox not configured (missing: {missing}). "
            f"Set MAILBOX_HOST / MAILBOX_USER / MAILBOX_PASSWORD in app/crawler/.env.",
        )
    since = req.since
    if req.lookback_days and not since:
        since = (date.today().toordinal() - req.lookback_days)
        since = date.fromordinal(since).isoformat()
    hits = mbx.search_emails(
        host=settings["host"],
        user=settings["user"],
        password=settings["password"],
        port=settings.get("port", 993),
        folder=settings.get("folder", "INBOX"),
        subject_contains=req.subject_contains,
        since=since,
        before=req.before,
        unseen_only=req.unseen_only,
        cache_dir=MAIL_CACHE,
    )
    paths = [h.msg_path for h in hits]
    if not paths:
        return ScanResult(src="<mailbox>", parsed_total=0, expired_total=0,
                          kept_total=0, sources=[])
    kept, expired, sources = _scan_paths(paths, req.filter_expired)
    uploaded = 0
    if req.upload and kept:
        uploaded = _upload_segs(kept)
    appended_cum = 0
    if req.append_cumulative and kept:
        cum = Path(req.cumulative_path) if req.cumulative_path else DEFAULT_CUMULATIVE_CSV
        appended_cum = _append_cumulative(kept, cum)
    appended_tpl = 0
    if req.append_legacy_template and kept:
        tpl = Path(req.template_path) if req.template_path else DEFAULT_LEGACY_TEMPLATE
        appended_tpl = _append_template(kept, tpl)
    summary = list(sources)
    if appended_cum or appended_tpl:
        summary.append({
            "appended_to_cumulative_csv": appended_cum,
            "appended_to_legacy_template": appended_tpl,
        })
    return ScanResult(
        src="<mailbox>",
        parsed_total=len(kept) + len(expired),
        expired_total=len(expired),
        kept_total=len(kept),
        uploaded_total=uploaded,
        sources=summary,
    )


@app.post("/api/backfill", response_model=ScanResult)
def api_backfill(req: BackfillRequest):
    """One-time backfill: scan all flight emails from the last N days
    (default 180 = 6 months). Expired flights are filtered out before upload."""
    req2 = ScanMailboxRequest(
        subject_contains=req.subject_contains,
        lookback_days=req.days,
        filter_expired=True,
        upload=req.upload,
        append_cumulative=req.append_cumulative,
        append_legacy_template=req.append_legacy_template,
    )
    return api_scan_mailbox(req2)


@app.post("/api/daily-check", response_model=ScanResult)
def api_daily_check(req: DailyCheckRequest):
    """Daily scheduled scan: process flight emails received in the last N
    days (default 7 = 1 week). Expired flights are filtered out."""
    req2 = ScanMailboxRequest(
        subject_contains=req.subject_contains,
        lookback_days=req.days,
        filter_expired=True,
        upload=req.upload,
        append_cumulative=req.append_cumulative,
        append_legacy_template=req.append_legacy_template,
    )
    return api_scan_mailbox(req2)


@app.get("/api/flights")
def api_flights(from_date: Optional[str] = None,
                to_date: Optional[str] = None,
                status: Optional[str] = None,
                limit: int = 200):
    env = {}
    for ln in ENV_FILE.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#") or "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        env[k.strip()] = v.strip()
    url = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    ca = env.get("REQUESTS_CA_BUNDLE")

    params: dict = {
        "select": "id,flight_date,airline_code,flight_number,dep_airport,arr_airport,status,scheduled_dep,scheduled_arr,airline_name,aircraft_type,archived_at",
        "order":  "flight_date.asc",
        "limit":  str(limit),
    }
    # Build PostgREST AND filter (note the parentheses around the value).
    # By default, exclude archived flights (use /api/history for those).
    flt: list[str] = ["archived_at.is.null"]
    if from_date: flt.append(f"flight_date.gte.{from_date}")
    if to_date:   flt.append(f"flight_date.lte.{to_date}")
    if status:    flt.append(f"status.eq.{status}")
    if flt:
        params["and"] = "(" + ",".join(flt) + ")"

    resp = requests.get(
        f"{url}/rest/v1/flights_to_track",
        params=params,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        verify=ca if ca else True,
        timeout=15,
    )
    if not resp.ok:
        raise HTTPException(resp.status_code, resp.text[:200])
    return {"flights": resp.json(), "count": len(resp.json())}


@app.post("/api/scan-outlook", response_model=ScanResult)
def api_scan_outlook(req: ScanOutlookRequest):
    """Scan the signed-in Outlook inbox (Windows COM, no IMAP setup needed).

    Lists recent inbox messages, filters by flight-itinerary keywords,
    parses flight segments, filters expired, and (optionally) uploads to
    Supabase + appends to the cumulative CSV. Re-scans are deduped via a
    per-EntryID cache at app/flight_parser/mail_cache/outlook_processed.json.
    """
    import outlook_scan
    since = None
    if req.lookback_days:
        from datetime import date as _date, timedelta as _td
        since = datetime.combine(
            _date.today() - _td(days=req.lookback_days), datetime.min.time())

    segs, hits = outlook_scan.scan_inbox_for_flights(since=since, limit=req.limit)
    sources = [
        {
            "subject": h.subject,
            "sender":  h.sender,
            "received_time": h.received_time.isoformat(timespec="seconds"),
            "entry_id": h.entry_id[:16] + "...",
            "src": "outlook_inbox",
        }
        for h in hits
    ]
    kept, expired = [], []
    if req.filter_expired:
        kept, expired = expired_filter.filter_expired(segs)
    else:
        kept, expired = segs, []

    uploaded = 0
    if req.upload and kept:
        uploaded = _upload_segs(kept)
    appended_cum = 0
    if req.append_cumulative and kept:
        cum = Path(req.cumulative_path) if req.cumulative_path else DEFAULT_CUMULATIVE_CSV
        appended_cum = _append_cumulative(kept, cum)
    appended_tpl = 0
    if req.append_legacy_template and kept:
        tpl = Path(req.template_path) if req.template_path else DEFAULT_LEGACY_TEMPLATE
        appended_tpl = _append_template(kept, tpl)
    summary = list(sources)
    if appended_cum or appended_tpl:
        summary.append({
            "appended_to_cumulative_csv": appended_cum,
            "appended_to_legacy_template": appended_tpl,
        })
    return ScanResult(
        src="<outlook>",
        parsed_total=len(kept) + len(expired),
        expired_total=len(expired),
        kept_total=len(kept),
        uploaded_total=uploaded,
        sources=summary,
    )


@app.post("/api/remove-expired")
def api_remove_expired(req: RemoveExpiredRequest):
    """Archive (soft-delete) flights whose destination arrival has already
    passed. PMX policy: tracked flights that have already arrived are
    moved to the history view — they no longer appear in the main tracking
    UI but remain queryable.

    Concretely:
      archive := flight_date < today
              OR (flight_date == today AND scheduled_arr < now)

    Flights on today's date with NULL scheduled_arr are kept (we cannot
    reason about their arrival time).

    dry_run=True (default): returns the list of flights that would be
    archived without modifying anything.

    hard_delete=True: actually DELETE the rows instead of archiving.
    """
    from datetime import date as _date, datetime as _dt
    today = _date.today()
    if req.today:
        try:
            today = _date.fromisoformat(req.today)
        except ValueError:
            raise HTTPException(400, f"invalid today date: {req.today}")
    now = _dt.now()

    env = {}
    for ln in ENV_FILE.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#") or "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        env[k.strip()] = v.strip()
    url = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    ca = env.get("REQUESTS_CA_BUNDLE")

    # Select candidate rows: flight_date <= today AND archived_at IS NULL.
    sel = requests.get(
        f"{url}/rest/v1/flights_to_track",
        params={
            "select": "id,flight_date,airline_code,flight_number,dep_airport,arr_airport,status,scheduled_arr,archived_at",
            "flight_date": f"lte.{today.isoformat()}",
            "archived_at": "is.null",
            "limit": "500",
        },
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        verify=ca if ca else True,
        timeout=15,
    )
    if not sel.ok:
        raise HTTPException(sel.status_code, sel.text[:200])
    candidates = sel.json()

    # Filter client-side using the same rule as expired_filter.is_expired.
    import expired_filter as ef
    expired_ids: list[str] = []
    expired_rows: list[dict] = []
    for row in candidates:
        d_str = row.get("flight_date") or ""
        try:
            y, mo, da = d_str.split("-")
            mdY = f"{int(mo)}/{int(da)}/{y}"
        except (ValueError, AttributeError):
            continue
        sa_iso = row.get("scheduled_arr")
        sa_mdY = ""
        if sa_iso:
            try:
                dt = _dt.fromisoformat(sa_iso.replace("Z", "+00:00"))
                dt_local = dt.astimezone(_dt.now().astimezone().tzinfo)
                hh, mi = dt_local.hour, dt_local.minute
                offset_days = (dt_local.date() - _dt.fromisoformat(d_str).date()).days
                if offset_days > 0:
                    sa_mdY = f"{hh:02d}:{mi:02d}+{offset_days}"
                else:
                    sa_mdY = f"{hh:02d}:{mi:02d}"
            except (ValueError, TypeError):
                sa_mdY = ""
        seg = parse_emails.FlightSeg(
            flight_date=mdY,
            dep_airport=row.get("dep_airport") or "",
            arr_airport=row.get("arr_airport") or "",
            airline_code=row.get("airline_code") or "",
            flight_number=str(row.get("flight_number") or ""),
            scheduled_dep="",
            scheduled_arr=sa_mdY,
        )
        if ef.is_expired(seg, today=today, now=now):
            expired_ids.append(row["id"])
            expired_rows.append({
                "id":           row["id"],
                "flight_date":  row["flight_date"],
                "airline_code": row["airline_code"],
                "flight_number": row["flight_number"],
                "dep_airport":  row["dep_airport"],
                "arr_airport":  row["arr_airport"],
                "scheduled_arr": row.get("scheduled_arr"),
                "status":       row["status"],
            })

    op = "hard_delete" if req.hard_delete else "archive"
    if req.dry_run:
        return {"dry_run": True, "today": today.isoformat(),
                "now": now.isoformat(timespec="seconds"),
                "operation": op,
                "would_process": len(expired_rows),
                "flights": expired_rows}

    if not expired_ids:
        return {"dry_run": False, "today": today.isoformat(),
                "now": now.isoformat(timespec="seconds"),
                "operation": op, "processed": 0, "flights": []}

    processed = 0
    archive_ts = now.isoformat(timespec="seconds")
    for i in range(0, len(expired_ids), 100):
        batch = expired_ids[i:i + 100]
        ids = ",".join(batch)
        if req.hard_delete:
            r = requests.delete(
                f"{url}/rest/v1/flights_to_track",
                params={"id": f"in.({ids})"},
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "Prefer": "return=representation"},
                verify=ca if ca else True,
                timeout=30,
            )
            if not r.ok:
                raise HTTPException(r.status_code, r.text[:200])
            processed += len(r.json())
        else:
            r = requests.patch(
                f"{url}/rest/v1/flights_to_track",
                params={"id": f"in.({ids})"},
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "Content-Type": "application/json",
                         "Prefer": "return=representation"},
                json={"archived_at": archive_ts},
                verify=ca if ca else True,
                timeout=30,
            )
            if not r.ok:
                raise HTTPException(r.status_code, r.text[:200])
            processed += len(r.json())
    return {"dry_run": False, "today": today.isoformat(),
            "now": now.isoformat(timespec="seconds"),
            "operation": op, "processed": processed,
            "flights": expired_rows}


@app.get("/api/history")
def api_history(from_date: Optional[str] = None,
                to_date: Optional[str] = None,
                limit: int = 200):
    """List archived flights (history view)."""
    env = {}
    for ln in ENV_FILE.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#") or "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        env[k.strip()] = v.strip()
    url = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    ca = env.get("REQUESTS_CA_BUNDLE")

    params: dict = {
        "select": "id,flight_date,airline_code,flight_number,dep_airport,arr_airport,status,scheduled_dep,scheduled_arr,actual_dep,actual_arr,airline_name,aircraft_type,archived_at",
        "order":  "archived_at.desc,flight_date.desc",
        "limit":  str(limit),
    }
    flt: list[str] = ["archived_at.not.is.null"]
    if from_date: flt.append(f"flight_date.gte.{from_date}")
    if to_date:   flt.append(f"flight_date.lte.{to_date}")
    if flt:
        params["and"] = "(" + ",".join(flt) + ")"

    resp = requests.get(
        f"{url}/rest/v1/flights_to_track",
        params=params,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        verify=ca if ca else True,
        timeout=15,
    )
    if not resp.ok:
        raise HTTPException(resp.status_code, resp.text[:200])
    return {"flights": resp.json(), "count": len(resp.json())}


@app.post("/api/run-schedule", response_model=ScanResult)
def api_run_schedule():
    """Equivalent to the daily-scheduled task: scan default folder + (if
    configured) unseen mailbox messages, filter expired, upload."""
    # 1) Folder scan
    folder_paths = sorted(DEFAULT_MSG_DIR.glob("*.msg"))
    kept1, expired1, sources1 = _scan_paths(folder_paths, filter_expired=True)
    # 2) Mailbox scan (if configured)
    kept2, expired2, sources2 = [], [], []
    settings = mbx.load_settings_from_env_file(ENV_FILE)
    if all(settings.get(k) for k in ("host", "user", "password")):
        hits = mbx.search_emails(
            host=settings["host"], user=settings["user"],
            password=settings["password"],
            port=settings.get("port", 993),
            folder=settings.get("folder", "INBOX"),
            subject_contains="Air Ticket",
            unseen_only=True,
            cache_dir=MAIL_CACHE,
        )
        kept2, expired2, sources2 = _scan_paths(
            [h.msg_path for h in hits], filter_expired=True,
        )

    kept = kept1 + kept2
    expired = expired1 + expired2
    uploaded = _upload_segs(kept) if kept else 0
    appended_cum = _append_cumulative(kept, DEFAULT_CUMULATIVE_CSV) if kept else 0
    summary = list(sources1) + list(sources2)
    if appended_cum:
        summary.append({"appended_to_cumulative_csv": appended_cum})
    return ScanResult(
        src="<schedule>",
        parsed_total=len(kept) + len(expired),
        expired_total=len(expired),
        kept_total=len(kept),
        uploaded_total=uploaded,
        sources=summary,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.flight_parser.server:app",
                host="0.0.0.0", port=8765, reload=False)
