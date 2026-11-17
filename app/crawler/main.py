"""Hourly crawler entry point.

Usage:
    python main.py [--dry-run] [--limit N]

    --dry-run   Run the whole pipeline except Supabase reads/writes and DeepL
                calls; prints the rows and the translation plan.
    --limit N   Cap the number of NEW rows processed in this run (smoke tests).

Exit codes:
    0  normal run (even when individual feeds failed)
    1  the Supabase insert step failed completely
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow `python crawler/main.py` from the repo root as well as `python main.py`
# from inside crawler/ (GitHub Actions uses working-directory: app/crawler).
CRAWLER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CRAWLER_DIR))

from feeds import FEEDS
from fetch import fetch_feed, normalize_url, url_hash
from filters import is_relevant
from translate import DeepLTranslator, describe_plan

try:  # optional locally; in GitHub Actions the vars come from secrets
    from dotenv import load_dotenv

    load_dotenv(CRAWLER_DIR / ".env")
except ImportError:  # pragma: no cover
    pass

LOG_FORMAT = "%(asctime)s %(levelname)-7s %(message)s"
log = logging.getLogger(__name__)
MAX_ITEMS_PER_FEED = 15
MAX_AGE_HOURS = 72
# Final layout: <project-root>/app/crawler/ -> <project-root>/log
# (two levels above the crawler directory). Override with LOG_DIR.
DEFAULT_LOG_DIR = CRAWLER_DIR.parents[1] / "log"


def resolve_log_dir() -> Path:
    """LOG_DIR env var if set, else <project-root>/log."""
    override = (os.getenv("LOG_DIR") or "").strip()
    if override:
        return Path(override).expanduser()
    return DEFAULT_LOG_DIR


def setup_logging() -> Path | None:
    """Log to stdout and to <log dir>/crawler_YYYYMMDD_HHMMSS.log."""
    formatter = logging.Formatter(LOG_FORMAT, datefmt="%Y-%m-%dT%H:%M:%SZ")
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    log_path: Path | None = None
    try:
        log_dir = resolve_log_dir()
        log_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        log_path = log_dir / f"crawler_{stamp}.log"
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except OSError as exc:  # read-only FS etc. - stdout logging still works
        logging.getLogger(__name__).warning("file logging disabled: %s", exc)
        log_path = None

    return log_path


# --------------------------------------------------------------------------- #
# Pipeline helpers
# --------------------------------------------------------------------------- #
def filter_entries(
    entries: list[dict],
    now: datetime,
    max_items: int = MAX_ITEMS_PER_FEED,
    max_age_hours: int = MAX_AGE_HOURS,
) -> list[dict]:
    """Keep items from the last `max_age_hours`, newest first, capped."""
    cutoff = now - timedelta(hours=max_age_hours)
    fresh: list[dict] = []
    for entry in entries:
        published = entry.get("published_at") or now
        if published < cutoff:
            continue
        entry["published_at"] = published
        fresh.append(entry)
    fresh.sort(key=lambda item: item["published_at"], reverse=True)
    return fresh[:max_items]


def build_row(entry: dict) -> dict:
    """Map a parsed entry onto the news_items columns (see supabase/schema.sql).

    The original title/summary goes into the field matching its own language;
    the translator fills the other two, and falls back to the original text on
    failure (title_en must stay NOT NULL).
    """
    lang = entry["lang"]
    summary = entry.get("summary") or ""
    published = entry.get("published_at")

    row = {
        "url_hash": url_hash(entry["url"]),
        "url": normalize_url(entry["url"]),
        "topic": entry["topic"],
        "source": entry["source"],
        "language_original": lang,
        "title_en": None,
        "title_zh": None,
        "title_es": None,
        "summary_en": None,
        "summary_zh": None,
        "summary_es": None,
        "image_url": entry.get("image_url"),
        "image_urls": entry.get("image_urls") or [],
        "content_original": (entry.get("content") or summary or None),
        "published_at": published.isoformat() if published else None,
    }
    row[f"title_{lang}"] = entry["title"]
    if summary:
        row[f"summary_{lang}"] = summary

    # title_en is NOT NULL in the schema; seed it for English sources only.
    if lang == "en":
        row["title_en"] = entry["title"]
    return row


def crawl(now: datetime) -> tuple[list[dict], int, int]:
    """Fetch every feed. One broken feed is logged and skipped."""
    entries: list[dict] = []
    feeds_ok = 0
    feeds_failed = 0

    for feed in FEEDS:
        try:
            raw_items = fetch_feed(feed)
            fresh = filter_entries(raw_items, now)
            kept = [item for item in fresh if is_relevant(item)]
            log.info(
                "%-22s kept=%d (of %d fresh, <=%dh, relevant only)",
                feed["name"],
                len(kept),
                len(fresh),
                MAX_AGE_HOURS,
            )
            entries.extend(kept)
            feeds_ok += 1
        except Exception as exc:  # noqa: BLE001 - never abort the whole run
            feeds_failed += 1
            log.error("feed failed: %s (%s): %s", feed["name"], feed["url"], exc)

    return entries, feeds_ok, feeds_failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Border + aviation news crawler")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="full pipeline without Supabase/DeepL side effects; prints rows + plan",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="process at most N new rows in this run (for smoke tests)",
    )
    args = parser.parse_args(argv)

    setup_logging()
    started = datetime.now(timezone.utc)
    log.info("crawl start (dry_run=%s, limit=%s)", args.dry_run, args.limit)
    log.info("log dir: %s", resolve_log_dir())

    entries, feeds_ok, feeds_failed = crawl(started)
    log.info(
        "feeds: %d ok, %d failed; items after 72h filter: %d",
        feeds_ok,
        feeds_failed,
        len(entries),
    )

    # in-run dedupe (same article can appear in several feeds)
    rows: list[dict] = []
    seen: set[str] = set()
    for entry in entries:
        row = build_row(entry)
        if row["url_hash"] in seen:
            continue
        seen.add(row["url_hash"])
        rows.append(row)
    log.info("unique items in this run: %d", len(rows))

    existing: set[str] = set()
    if not args.dry_run:
        try:
            from supabase_store import get_existing_hashes

            existing = get_existing_hashes()
        except Exception as exc:  # noqa: BLE001
            log.error("could not read existing hashes from Supabase: %s", exc)
            return 1

    new_rows = [row for row in rows if row["url_hash"] not in existing]
    log.info("new rows after dedupe vs DB: %d", len(new_rows))

    if args.limit is not None:
        new_rows = new_rows[: max(args.limit, 0)]
        log.info("limit applied, processing %d rows", len(new_rows))

    if not new_rows:
        log.info("nothing new, exiting")
        return 0

    if args.dry_run:
        print("\n=== translation plan ===")
        for line in describe_plan(new_rows):
            print(line)
        print("\n=== rows (translation not performed in dry-run) ===")
        for row in new_rows:
            print(json.dumps(row, ensure_ascii=False, indent=2))
        log.info("dry-run complete: %d rows would be inserted", len(new_rows))
        return 0

    translator = DeepLTranslator()
    translator.translate_items(new_rows)
    log.info(
        "DeepL: chars=%d requests=%d failed_chunks=%d",
        translator.translated_chars,
        translator.request_count,
        translator.failed_chunks,
    )

    try:
        from supabase_store import insert_rows

        inserted = insert_rows(new_rows)
    except Exception as exc:  # noqa: BLE001
        log.error("insert step failed: %s", exc)
        return 1

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    log.info(
        "crawl done: inserted=%d translated_chars=%d feeds_ok=%d feeds_failed=%d in %.1fs",
        inserted,
        translator.translated_chars,
        feeds_ok,
        feeds_failed,
        elapsed,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
