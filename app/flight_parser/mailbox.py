"""IMAP mailbox connector for PMX flight itinerary scanning.

Connects to a corporate IMAP mailbox (e.g. Office 365 / Outlook), searches
for messages matching a subject pattern, fetches matching .msg files into a
local cache folder, and returns the list of saved paths.

Configuration (env vars or passed to connect()):
    MAILBOX_HOST       imap host, e.g. outlook.office365.com
    MAILBOX_PORT       993 (default; IMAP SSL)
    MAILBOX_USER       full email address
    MAILBOX_PASSWORD   password or app password
    MAILBOX_FOLDER     INBOX (default)

Search criteria (search_emails):
    subject_contains   case-insensitive substring of subject, e.g. "Air Ticket"
    since              ISO date 'YYYY-MM-DD'; only messages since that date
    before             ISO date 'YYYY-MM-DD'; only messages before that date
    unseen_only        if True, only UNSEEN messages

Returned .msg files are saved into <cache_dir>/<message_id>.msg so the
parser can read them with extract_msg.
"""
from __future__ import annotations

import email
import imaplib
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from pathlib import Path


@dataclass
class MailHit:
    msg_path: Path           # path to the saved .msg-like file
    subject: str
    from_: str
    date: datetime | None
    message_id: str


def _connect(host: str, user: str, password: str, port: int = 993,
             folder: str = "INBOX") -> imaplib.IMAP4_SSL:
    imap = imaplib.IMAP4_SSL(host, port)
    imap.login(user, password)
    imap.select(folder)
    return imap


def _decode_subject(raw: str) -> str:
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def search_emails(
    host: str, user: str, password: str,
    subject_contains: str | None = None,
    since: str | None = None,
    before: str | None = None,
    unseen_only: bool = False,
    folder: str = "INBOX",
    port: int = 993,
    cache_dir: Path | None = None,
    limit: int = 100,
) -> list[MailHit]:
    """Search IMAP mailbox and fetch matching messages to local cache.

    Each hit's raw RFC822 message is saved as <cache_dir>/<uid>.eml.
    The parser (extract_msg) can read .eml via extract_msg.Message(path).
    """
    cache_dir = Path(cache_dir) if cache_dir else Path.cwd() / "mail_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    imap = _connect(host, user, password, port=port, folder=folder)

    # Build IMAP search criteria
    criteria: list[str] = []
    if subject_contains:
        # RFC3501: SUBJECT "phrase" is server-side literal; we use TEXT for a
        # broader match, then filter by subject client-side. (Different IMAP
        # servers vary in SUBJECT support.)
        criteria += [f'TEXT "{subject_contains}"']
    if since:
        d = datetime.strptime(since, "%Y-%m-%d").date()
        criteria += [f'SINCE {d.strftime("%d-%b-%Y")}']
    if before:
        d = datetime.strptime(before, "%Y-%m-%d").date()
        # IMAP BEFORE is exclusive, so use day-1 as BEFORE to include `before`.
        criteria += [f'BEFORE {d.strftime("%d-%b-%Y")}']
    if unseen_only:
        criteria += ["UNSEEN"]

    typ, data = imap.uid("SEARCH", None, *criteria) if criteria else imap.uid("SEARCH", None, "ALL")
    if typ != "OK":
        imap.logout()
        return []
    uids = (data[0] or b"").split()
    if not uids:
        imap.logout()
        return []

    out: list[MailHit] = []
    for uid in uids[:limit]:
        typ, msg_data = imap.uid("FETCH", uid, "(RFC822 BODY[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)])")
        if typ != "OK" or not msg_data or not msg_data[0]:
            continue
        # msg_data[0][0] is the metadata bytes; msg_data[0][1] is the header bytes.
        # In some servers it's msg_data[1] for the full body.
        # Try to find the RFC822 part robustly.
        raw: bytes | None = None
        for part in msg_data:
            if isinstance(part, tuple) and len(part) >= 2 and isinstance(part[1], (bytes, bytearray)):
                raw = bytes(part[1])
                break
        if raw is None:
            continue

        # Parse with stdlib email
        msg = email.message_from_bytes(raw)
        subject = _decode_subject(msg.get("Subject", ""))
        from_ = _decode_subject(msg.get("From", ""))
        date_raw = msg.get("Date", "")
        dt: datetime | None = None
        try:
            dt = parsedate_to_datetime(date_raw) if date_raw else None
        except Exception:
            dt = None
        msg_id = msg.get("Message-ID", f"uid-{uid.decode()}")

        # Filter by subject_contains client-side (most reliable across IMAPs)
        if subject_contains and subject_contains.lower() not in subject.lower():
            continue

        # Save full RFC822 as .eml (extract_msg.Message can read this)
        safe_id = uid.decode(errors="replace")
        path = cache_dir / f"{safe_id}.eml"
        path.write_bytes(raw)

        out.append(MailHit(
            msg_path=path,
            subject=subject,
            from_=from_,
            date=dt,
            message_id=msg_id,
        ))

    imap.logout()
    return out


# ---- Settings loader ------------------------------------------------------

def load_settings_from_env() -> dict:
    return {
        "host":     os.environ.get("MAILBOX_HOST", ""),
        "port":     int(os.environ.get("MAILBOX_PORT", "993")),
        "user":     os.environ.get("MAILBOX_USER", ""),
        "password": os.environ.get("MAILBOX_PASSWORD", ""),
        "folder":   os.environ.get("MAILBOX_FOLDER", "INBOX"),
    }


def load_settings_from_env_file(env_path: Path) -> dict:
    """Read MAILBOX_* from .env (same format as app/crawler/.env)."""
    settings = load_settings_from_env()
    if not env_path.exists():
        return settings
    for ln in env_path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#") or "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        k = k.strip()
        if k.startswith("MAILBOX_") and k not in os.environ:
            settings[k[len("MAILBOX_"):].lower()] = v.strip()
    return settings
