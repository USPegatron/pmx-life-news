"""RSS fetching, item parsing, image extraction and summary building."""

from __future__ import annotations

import hashlib
import html
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import urlsplit, urlunsplit

import feedparser
import requests

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (compatible; BorderAviationNewsBot/1.0; +https://github.com/)"
)
TIMEOUT = 15  # seconds
RETRIES = 2
SUMMARY_MAX_CHARS = 300
CONTENT_MAX_CHARS = 12000  # cap for stored full article text
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")

_IMG_TAG_RE = re.compile(r"<img\b[^>]*?\ssrc=[\"']([^\"']+)[\"']", re.IGNORECASE)
_SCRIPT_STYLE_RE = re.compile(
    r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL
)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def http_get(url: str, timeout: int = TIMEOUT, retries: int = RETRIES) -> requests.Response:
    """GET a URL with a small retry/backoff loop. Raises on final failure."""
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            response = requests.get(
                url,
                timeout=timeout,
                allow_redirects=True,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                    "Accept-Language": "en,es;q=0.8",
                },
            )
            response.raise_for_status()
            return response
        except Exception as exc:  # noqa: BLE001 - any transport/HTTP error is retryable
            last_error = exc
            if attempt < retries:
                backoff = 2 * (attempt + 1)
                log.warning(
                    "GET %s failed (%s), retry %d/%d in %ss",
                    url,
                    exc,
                    attempt + 1,
                    retries,
                    backoff,
                )
                time.sleep(backoff)
    raise RuntimeError(f"GET {url} failed after {retries + 1} attempts: {last_error}")


# --------------------------------------------------------------------------- #
# URL normalisation / hashing
# --------------------------------------------------------------------------- #
def normalize_url(url: str) -> str:
    """Lowercase scheme+host, drop fragment, drop trailing slash, keep path+query."""
    if not url:
        return ""
    parts = urlsplit(url.strip())
    scheme = (parts.scheme or "https").lower()
    netloc = parts.netloc.lower()
    path = parts.path or ""
    if path.endswith("/"):
        path = path.rstrip("/")
    query = parts.query
    return urlunsplit((scheme, netloc, path, query, ""))


def url_hash(url: str) -> str:
    """sha256 hex digest of the normalized URL (dedupe key in Supabase)."""
    return hashlib.sha256(normalize_url(url).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# Text helpers
# --------------------------------------------------------------------------- #
def clean_html(raw: str | None) -> str:
    """Strip tags/entities from an HTML fragment and collapse whitespace."""
    if not raw:
        return ""
    text = html.unescape(raw)
    text = _SCRIPT_STYLE_RE.sub(" ", text)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    return _WS_RE.sub(" ", text).strip()


def truncate(text: str, limit: int = SUMMARY_MAX_CHARS) -> str:
    """Truncate on a word boundary, hard cap at `limit` characters."""
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rstrip()
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut[: max(limit - 1, 0)].rstrip() + "…"


def _is_http_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.netloc)


def _looks_like_image(url: str) -> bool:
    try:
        path = urlsplit(url).path.lower()
    except ValueError:
        return False
    return path.endswith(IMAGE_EXTENSIONS)


# --------------------------------------------------------------------------- #
# Image extraction
# --------------------------------------------------------------------------- #
def extract_image(entry: Any) -> str | None:
    """media:content -> media:thumbnail -> enclosure -> first <img> in content."""

    # 1) media:content and 2) media:thumbnail
    for key in ("media_content", "media_thumbnail"):
        for media in entry.get(key) or []:
            candidate = (media.get("url") or "").strip()
            if not _is_http_url(candidate):
                continue
            mime = (media.get("type") or "").lower()
            medium = (media.get("medium") or "").lower()
            if mime.startswith("image") or medium == "image":
                return candidate
            if not mime and not medium and _looks_like_image(candidate):
                return candidate

    # 3) enclosures
    enclosure_links: Iterable[dict] = [
        link
        for link in (entry.get("links") or [])
        if (link.get("rel") or "").lower() == "enclosure"
    ]
    for link in enclosure_links:
        candidate = (link.get("href") or link.get("url") or "").strip()
        if not _is_http_url(candidate):
            continue
        mime = (link.get("type") or "").lower()
        if mime.startswith("image") or (not mime and _looks_like_image(candidate)):
            return candidate
    for enclosure in entry.get("enclosures") or []:
        candidate = (enclosure.get("href") or enclosure.get("url") or "").strip()
        if not _is_http_url(candidate):
            continue
        mime = (enclosure.get("type") or "").lower()
        if mime.startswith("image") or (not mime and _looks_like_image(candidate)):
            return candidate

    # 4) first <img> inside content:encoded / Atom content
    for block in entry.get("content") or []:
        match = _IMG_TAG_RE.search(block.get("value") or "")
        if match and _is_http_url(match.group(1).strip()):
            return match.group(1).strip()

    return None


MAX_IMAGES_PER_ITEM = 6


def extract_images(entry: Any) -> list[str]:
    """Return up to MAX_IMAGES_PER_ITEM distinct image URLs for the entry.

    Order: media:content / media:thumbnail > enclosures > every <img> in
    content:encoded / Atom content > description. Deduped by base URL
    (ignoring query string) and filtered to absolute http(s) URLs.
    """
    urls: list[str] = []
    seen: set[str] = set()

    def _add(candidate: str) -> None:
        candidate = (candidate or "").strip()
        if not candidate or not _is_http_url(candidate):
            return
        lower = candidate.lower()
        if lower.endswith(".svg"):
            return
        if "pixel" in lower or "tracker" in lower or "1x1" in lower:
            return
        base = urlsplit(candidate)._replace(query="", fragment="").geturl()
        if base in seen:
            return
        seen.add(base)
        urls.append(candidate)

    # 1) media:content and 2) media:thumbnail
    for key in ("media_content", "media_thumbnail"):
        for media in entry.get(key) or []:
            mime = (media.get("type") or "").lower()
            medium = (media.get("medium") or "").lower()
            candidate = (media.get("url") or "").strip()
            if not candidate:
                continue
            if mime.startswith("image") or medium == "image":
                _add(candidate)
            elif not mime and not medium and _looks_like_image(candidate):
                _add(candidate)
            if len(urls) >= MAX_IMAGES_PER_ITEM:
                return urls

    # 3) enclosures
    for link in (entry.get("links") or []):
        if (link.get("rel") or "").lower() != "enclosure":
            continue
        candidate = (link.get("href") or link.get("url") or "").strip()
        mime = (link.get("type") or "").lower()
        if mime.startswith("image") or (not mime and _looks_like_image(candidate)):
            _add(candidate)
        if len(urls) >= MAX_IMAGES_PER_ITEM:
            return urls
    for enclosure in entry.get("enclosures") or []:
        candidate = (enclosure.get("href") or enclosure.get("url") or "").strip()
        mime = (enclosure.get("type") or "").lower()
        if mime.startswith("image") or (not mime and _looks_like_image(candidate)):
            _add(candidate)
        if len(urls) >= MAX_IMAGES_PER_ITEM:
            return urls

    # 4) every <img> in content:encoded / Atom content
    for block in entry.get("content") or []:
        for match in _IMG_TAG_RE.finditer(block.get("value") or ""):
            _add(match.group(1))
            if len(urls) >= MAX_IMAGES_PER_ITEM:
                return urls

    # 5) description / summary as last resort
    for raw in (entry.get("summary"), entry.get("description")):
        if not raw:
            continue
        for match in _IMG_TAG_RE.finditer(raw):
            _add(match.group(1))
            if len(urls) >= MAX_IMAGES_PER_ITEM:
                return urls

    return urls


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #
def _entry_body_html(entry: Any) -> str:
    blocks = entry.get("content") or []
    for block in blocks:
        value = (block.get("value") or "").strip()
        if value:
            return value
    return ""


def _entry_published(entry: Any) -> datetime | None:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        parsed = entry.get(key)
        if parsed:
            try:
                return datetime(*parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def parse_entries(feed: dict, parsed: Any) -> list[dict]:
    """Turn a feedparser document into plain item dicts (unfiltered)."""
    raw_entries = parsed.get("entries") or []
    items: list[dict] = []

    for entry in raw_entries:
        link = (entry.get("link") or "").strip()
        if not link and entry.get("id"):
            candidate = str(entry.get("id")).strip()
            if _is_http_url(candidate):
                link = candidate
        if not _is_http_url(link):
            continue

        title = clean_html(entry.get("title"))
        if not title:
            continue

        body_html = _entry_body_html(entry)
        body_text = clean_html(body_html)
        summary = clean_html(entry.get("summary")) or body_text
        content_full = (body_text or summary).strip()

        items.append(
            {
                "title": title,
                "url": normalize_url(link),
                "summary": truncate(summary),
                "content": content_full[:CONTENT_MAX_CHARS],
                "image_url": extract_image(entry),
                "image_urls": extract_images(entry),
                "published_at": _entry_published(entry),
                "topic": feed["topic"],
                "source": feed["name"],
                "lang": feed["lang"],
            }
        )

    return items


def fetch_feed(feed: dict) -> list[dict]:
    """Fetch + parse one feed. Raises on network/parse failure (caller decides)."""
    response = http_get(feed["url"])
    parsed = feedparser.parse(response.content)
    if getattr(parsed, "bozo", 0) and not (parsed.get("entries") or []):
        raise RuntimeError(
            f"feed did not parse ({getattr(parsed, 'bozo_exception', 'unknown error')})"
        )
    items = parse_entries(feed, parsed)
    log.info("%-22s fetched=%d entries", feed["name"], len(items))
    return items
