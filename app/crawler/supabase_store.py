"""Supabase persistence: dedupe lookup + batched inserts (service-role key)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Iterable

from supabase import Client, create_client

log = logging.getLogger(__name__)

TABLE = "news_items"
PAGE_SIZE = 1000
MAX_PAGES = 40  # safety stop: at most 40k hashes per run
INSERT_BATCH_SIZE = 100
# Dedupe window: the crawler only ever looks at the last 72h of articles, so
# hashes older than this cannot collide with a fresh crawl.
HASH_LOOKBACK_DAYS = 30


def get_client() -> Client:
    """Build a supabase-py client from the environment."""
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (env or .env)"
        )
    return create_client(url, key)


def get_existing_hashes(
    client: Client | None = None,
    lookback_days: int = HASH_LOOKBACK_DAYS,
) -> set[str]:
    """Return the set of url_hash values already stored."""
    client = client or get_client()
    since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()

    hashes: set[str] = set()
    for page in range(MAX_PAGES):
        start = page * PAGE_SIZE
        end = start + PAGE_SIZE - 1
        response = (
            client.table(TABLE)
            .select("url_hash")
            .gte("created_at", since)
            .range(start, end)
            .execute()
        )
        rows = response.data or []
        for row in rows:
            value = row.get("url_hash")
            if value:
                hashes.add(value)
        if len(rows) < PAGE_SIZE:
            break
    else:
        log.warning(
            "get_existing_hashes hit MAX_PAGES=%d, dedupe set may be incomplete",
            MAX_PAGES,
        )

    log.info("existing url_hash set: %d rows (lookback %dd)", len(hashes), lookback_days)
    return hashes


def insert_rows(
    rows: list[dict],
    client: Client | None = None,
    batch_size: int = INSERT_BATCH_SIZE,
) -> int:
    """Insert rows in batches of `batch_size`. Returns the number inserted.

    Raises if a batch fails; already-inserted batches stay committed.
    """
    if not rows:
        return 0

    client = client or get_client()
    inserted = 0
    batches = [rows[i : i + batch_size] for i in range(0, len(rows), batch_size)]

    for index, batch in enumerate(batches, start=1):
        try:
            client.table(TABLE).insert(batch).execute()
        except Exception:
            log.error(
                "insert batch %d/%d failed (%d rows)", index, len(batches), len(batch)
            )
            raise
        inserted += len(batch)
        log.info(
            "insert batch %d/%d ok (%d rows, total %d)",
            index,
            len(batches),
            len(batch),
            inserted,
        )

    return inserted


def chunked(values: Iterable, size: int) -> list[list]:
    """Small helper kept for tests/scripts."""
    values = list(values)
    return [values[i : i + size] for i in range(0, len(values), size)]
