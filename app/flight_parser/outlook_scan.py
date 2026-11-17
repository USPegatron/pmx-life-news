"""Scan the user's local Outlook inbox for flight-itinerary emails.

Uses the outlook-agent skill's COM CLI (`company_mail_cli.py`) to read
messages directly from the signed-in Outlook profile. No IMAP credentials
required.

Workflow:
  1. List recent inbox messages via the CLI.
  2. Filter by subject (default: contains "Air Ticket" or "Flight Itinerary"
     or contains the Chinese words "機票" / "航班").
  3. For each matching message, fetch its full body via the CLI.
  4. Hand (subject, body) to `parse_email_text()` (an Outlook-flavoured
     wrapper around the body parser in `parse_emails.py`).
  5. Persist a JSON cache of processed EntryIDs so re-scans don't
     re-import the same flight.

Cache file: <project>/mail_cache/outlook_processed.json
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
except Exception:
    pass

import parse_emails                # noqa: E402

OUTLOOK_CLI = Path(
    r"C:\Users\Jacky2_Wang\.config\opencode\skills\outlook-agent\scripts\company_mail_cli.py"
)

DEFAULT_SUBJECT_PATTERNS = [
    re.compile(r"Air\s*Ticket", re.IGNORECASE),
    re.compile(r"Flight\s*Itinerary", re.IGNORECASE),
    re.compile(r"機票"),
    re.compile(r"航班"),
    re.compile(r"Itinerary"),
]


@dataclass
class MailHit:
    entry_id: str
    subject: str
    sender: str
    received_time: datetime
    body: str


def _run_cli(args: list[str], output_path: Optional[Path] = None,
             timeout: int = 60):
    """Invoke the outlook CLI. Returns parsed JSON (dict or list) or None."""
    cmd = ["python", str(OUTLOOK_CLI)] + args
    if output_path:
        cmd += ["--output", str(output_path)]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               encoding="utf-8", timeout=timeout)
        except Exception as e:
            print(f"  CLI error: {e}", file=sys.stderr)
            return None
        if r.returncode != 0:
            print(f"  CLI failed ({r.returncode}): {r.stderr[:200]}", file=sys.stderr)
            return None
        try:
            return json.loads(output_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  Parse error: {e}", file=sys.stderr)
            return None
    else:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               encoding="utf-8", timeout=timeout)
        except Exception as e:
            print(f"  CLI error: {e}", file=sys.stderr)
            return None
        if r.returncode != 0:
            print(f"  CLI failed ({r.returncode}): {r.stderr[:200]}", file=sys.stderr)
            return None
        try:
            return json.loads(r.stdout)
        except Exception:
            return None


def _coerce_messages(payload) -> list[dict]:
    """The CLI sometimes returns a list directly, sometimes a dict with
    a 'messages' key. Normalise to a list of dicts."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("messages") or payload.get("items") or []
    return []


def list_inbox(since: Optional[datetime] = None,
               limit: int = 100) -> list[dict]:
    """List inbox messages, optionally filtered by date.

    The CLI returns messages from today by default; passing --all gives the
    full inbox. We then client-side filter by `since` if provided.
    """
    tmp = Path(os.environ.get("TEMP", "C:\\Windows\\Temp")) / "opencode" / "outlook_list.json"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    args = ["--all", "--json", "--show-total",
            f"--limit", str(limit),
            "--output", str(tmp)]
    payload = _run_cli(args, output_path=tmp)
    msgs = _coerce_messages(payload)
    if since is not None:
        out = []
        for m in msgs:
            t = _parse_received_time(m.get("received_time"))
            if t is None:
                continue
            if t.tzinfo is None and since.tzinfo is not None:
                t = t.replace(tzinfo=since.tzinfo)
            elif t.tzinfo is not None and since.tzinfo is None:
                since = since.replace(tzinfo=t.tzinfo)
            if t >= since:
                out.append(m)
        return out
    return msgs


def fetch_body(entry_id: str) -> str:
    """Fetch the full body of a message by EntryID. Returns "" on failure.

    Workaround: the CLI doesn't expose a single-message read; we list
    recent messages (default 200) and pluck by EntryID. For very large
    inboxes the EntryID might be missed — fall back to a wider list then.
    """
    tmp = Path(os.environ.get("TEMP", "C:\\Windows\\Temp")) / "opencode" / "outlook_body.json"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    args = ["--all", "--json", f"--limit", "300"]
    payload = _run_cli(args, output_path=tmp)
    msgs = _coerce_messages(payload)
    for m in msgs:
        if m.get("entry_id") == entry_id:
            return m.get("body") or ""
    return ""


def filter_flight_emails(messages: list[dict],
                         patterns: list[re.Pattern] = None) -> list[dict]:
    """Return messages whose subject matches any flight-itinerary pattern."""
    pats = patterns or DEFAULT_SUBJECT_PATTERNS
    out = []
    for m in messages:
        subj = m.get("subject") or ""
        if any(p.search(subj) for p in pats):
            out.append(m)
    return out


def parse_email_text(subject: str, body: str, src_label: str) -> list[parse_emails.FlightSeg]:
    """Parse (subject, body) just like `parse_emails.parse_email` does for a .msg file.

    Subject is used to extract the date range; body is scanned for flight
    segment lines. Returns a list of FlightSeg objects (may be empty).
    """
    # Subject → EmailMeta
    rng = parse_emails.parse_subject_range(subject)
    if rng is None:
        return []
    sy, sm, sd, ey, em = rng
    meta = parse_emails.EmailMeta(
        src_file=src_label,
        subject=subject,
        start_year=sy, start_month=sm,
        end_year=ey, end_month=em,
    )
    meta.segments = parse_emails.extract_segments(body, meta)
    return meta.segments


# ---- Processed-cache helpers ----

def load_processed_cache(cache_path: Path) -> set[str]:
    if not cache_path.exists():
        return set()
    try:
        return set(json.loads(cache_path.read_text(encoding="utf-8")).get("entry_ids", []))
    except Exception:
        return set()


def save_processed_cache(cache_path: Path, entry_ids: set[str]) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "entry_ids": sorted(entry_ids),
    }
    cache_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _parse_received_time(s) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


# ---- High-level scan ----

def scan_inbox_for_flights(
    since: Optional[datetime] = None,
    limit: int = 200,
    cache_path: Optional[Path] = None,
) -> tuple[list[parse_emails.FlightSeg], list[MailHit]]:
    """List inbox, filter, fetch bodies, parse flights, return (segs, hits)."""
    msgs = list_inbox(since=since, limit=limit)
    flight_msgs = filter_flight_emails(msgs)
    if cache_path is None:
        cache_path = Path(__file__).parent / "mail_cache" / "outlook_processed.json"
    processed = load_processed_cache(cache_path)

    hits: list[MailHit] = []
    all_segs: list[parse_emails.FlightSeg] = []
    new_processed = set(processed)

    for m in flight_msgs:
        eid = m.get("entry_id") or ""
        if not eid:
            continue
        if eid in processed:
            continue  # already imported
        body = fetch_body(eid)
        if not body:
            continue
        subj = m.get("subject") or ""
        segs = parse_email_text(subj, body, src_label=eid[:12])
        if segs:
            hits.append(MailHit(
                entry_id=eid,
                subject=subj,
                sender=m.get("sender") or "",
                received_time=_parse_received_time(m.get("received_time")) or datetime.now(),
                body=body,
            ))
            all_segs.extend(segs)
        new_processed.add(eid)

    save_processed_cache(cache_path, new_processed)
    return all_segs, hits
