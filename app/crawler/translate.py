"""DeepL translation client (free-tier friendly, batch oriented).

Quota notes: DeepL Free allows 500k characters/month and ~1 request/second.
We therefore send one request per (source -> target) language pair for all
pending items, chunked to <= 50 text segments per request, and sleep 1.1s
between requests.
"""

from __future__ import annotations

import logging
import os
import time

import requests

log = logging.getLogger(__name__)

DEEPL_FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate"
DEEPL_PRO_ENDPOINT = "https://api.deepl.com/v2/translate"

MAX_SEGMENTS_PER_REQUEST = 50
REQUEST_INTERVAL_SECONDS = 1.1
RETRY_AFTER_429_SECONDS = 60
REQUEST_TIMEOUT = 30

# source language -> languages that need to be produced
TRANSLATION_TARGETS: dict[str, tuple[str, ...]] = {
    "en": ("zh", "es"),
    "es": ("en", "zh"),
}
ALL_LANGUAGES = ("en", "zh", "es")

# Internal language code -> DeepL target_lang code.
# "zh" maps to ZH-HANT so Chinese output is Traditional, not Simplified.
DEEPL_TARGET_CODES = {"en": "EN", "es": "ES", "zh": "ZH-HANT"}


class DeepLTranslator:
    """Thin DeepL wrapper that mutates item dicts in place."""

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = (api_key or os.getenv("DEEPL_API_KEY") or "").strip()
        self.enabled = bool(self.api_key)
        self.endpoint = (
            DEEPL_FREE_ENDPOINT
            if self.api_key.endswith(":fx")
            else DEEPL_PRO_ENDPOINT
        )
        self.translated_chars = 0
        self.request_count = 0
        self.failed_chunks = 0
        self._quota_exhausted = False
        self._last_request_at = 0.0

    # ------------------------------------------------------------------ #
    # HTTP
    # ------------------------------------------------------------------ #
    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        remaining = REQUEST_INTERVAL_SECONDS - elapsed
        if remaining > 0:
            time.sleep(remaining)

    def _post(self, texts: list[str], source_lang: str, target_lang: str) -> list[str]:
        """POST one translation request, honouring the 1 req/s free-tier limit."""
        if self._quota_exhausted:
            raise RuntimeError("DeepL quota exhausted earlier in this run")

        payload = {
            "text": texts,
            "target_lang": DEEPL_TARGET_CODES.get(target_lang, target_lang.upper()),
            "source_lang": source_lang.upper(),
        }
        # DeepL removed the legacy form `auth_key` parameter (now returns HTTP 403);
        # authentication must be sent in the Authorization header.
        headers = {"Authorization": f"DeepL-Auth-Key {self.api_key}"}

        for attempt in (1, 2):
            self._throttle()
            self._last_request_at = time.monotonic()
            self.request_count += 1
            response = requests.post(
                self.endpoint, data=payload, headers=headers, timeout=REQUEST_TIMEOUT
            )

            if response.status_code == 429:
                if attempt == 1:
                    log.warning(
                        "DeepL 429 rate limit, waiting %ss before retry",
                        RETRY_AFTER_429_SECONDS,
                    )
                    time.sleep(RETRY_AFTER_429_SECONDS)
                    continue
                raise RuntimeError("DeepL 429 rate limit persisted after retry")

            if response.status_code == 456:
                self._quota_exhausted = True
                raise RuntimeError("DeepL quota exceeded (HTTP 456)")

            if response.status_code >= 400:
                raise RuntimeError(
                    f"DeepL HTTP {response.status_code}: {response.text[:200]}"
                )

            data = response.json()
            translations = data.get("translations") or []
            if len(translations) != len(texts):
                raise RuntimeError(
                    f"DeepL returned {len(translations)} translations for {len(texts)} texts"
                )
            self.translated_chars += sum(len(text) for text in texts)
            return [item.get("text", "") for item in translations]

        raise RuntimeError("DeepL request failed")  # pragma: no cover

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def translate_items(self, items: list[dict]) -> None:
        """Fill title_<lang>/summary_<lang> for every item. Never raises."""
        if not items:
            return

        if not self.enabled:
            log.warning(
                "DEEPL_API_KEY not set - skipping translation, originals will be reused"
            )
            self._ensure_filled(items)
            return

        # (source_lang, target_lang) -> list of (item_index, field, text)
        groups: dict[tuple[str, str], list[tuple[int, str, str]]] = {}

        for index, item in enumerate(items):
            source_lang = (item.get("language_original") or "").strip().lower()
            if source_lang not in TRANSLATION_TARGETS:
                continue
            original_title = (
                item.get(f"title_{source_lang}") or item.get("title_en") or ""
            ).strip()
            original_summary = (
                item.get(f"summary_{source_lang}") or item.get("summary_en") or ""
            ).strip()

            for target_lang in TRANSLATION_TARGETS[source_lang]:
                if target_lang == source_lang:
                    continue
                bucket = groups.setdefault((source_lang, target_lang), [])
                if original_title:
                    bucket.append((index, "title", original_title))
                if original_summary:
                    bucket.append((index, "summary", original_summary))

        for (source_lang, target_lang), segments in groups.items():
            self._run_group(items, source_lang, target_lang, segments)

        self._ensure_filled(items)

    def _run_group(
        self,
        items: list[dict],
        source_lang: str,
        target_lang: str,
        segments: list[tuple[int, str, str]],
    ) -> None:
        total = len(segments)
        log.info(
            "DeepL %s->%s: %d segments (%d chars) in %d request(s)",
            source_lang,
            target_lang,
            total,
            sum(len(text) for _, _, text in segments),
            (total + MAX_SEGMENTS_PER_REQUEST - 1) // MAX_SEGMENTS_PER_REQUEST,
        )

        for start in range(0, total, MAX_SEGMENTS_PER_REQUEST):
            chunk = segments[start : start + MAX_SEGMENTS_PER_REQUEST]
            texts = [text for _, _, text in chunk]
            try:
                translated = self._post(texts, source_lang, target_lang)
            except Exception as exc:  # noqa: BLE001 - fall back to originals
                self.failed_chunks += 1
                log.error(
                    "DeepL %s->%s chunk %d-%d failed (%s); keeping originals",
                    source_lang,
                    target_lang,
                    start,
                    start + len(chunk) - 1,
                    exc,
                )
                if self._quota_exhausted:
                    return
                continue

            for (item_index, field, _original), value in zip(chunk, translated):
                value = (value or "").strip()
                if not value:
                    continue
                items[item_index][f"{field}_{target_lang}"] = value

    # ------------------------------------------------------------------ #
    # Guarantees
    # ------------------------------------------------------------------ #
    def _ensure_filled(self, items: list[dict]) -> None:
        """UI fields must never be empty: fall back to the original text."""
        for item in items:
            source_lang = (item.get("language_original") or "").strip().lower()
            original_title = (
                item.get(f"title_{source_lang}") or item.get("title_en") or ""
            ).strip()
            original_summary = (
                item.get(f"summary_{source_lang}") or item.get("summary_en") or ""
            ).strip()

            for lang in ALL_LANGUAGES:
                field = f"title_{lang}"
                if not (item.get(field) or "").strip():
                    if original_title:
                        item[field] = original_title

                summary_field = f"summary_{lang}"
                if original_summary and not (item.get(summary_field) or "").strip():
                    item[summary_field] = original_summary

            # schema: title_en is NOT NULL
            if not (item.get("title_en") or "").strip():
                item["title_en"] = original_title


def describe_plan(items: list[dict]) -> list[str]:
    """Dry-run helper: what would be sent to DeepL, without any API call."""
    lines: list[str] = []
    for index, item in enumerate(items, start=1):
        source_lang = (item.get("language_original") or "").strip().lower()
        targets = TRANSLATION_TARGETS.get(source_lang, ())
        title = (item.get(f"title_{source_lang}") or item.get("title_en") or "")
        summary = (item.get(f"summary_{source_lang}") or item.get("summary_en") or "")
        chars = len(title) + len(summary)
        lines.append(
            f"  [{index}] {source_lang}->{'+'.join(targets) or 'none'} "
            f"({chars} chars) {title[:80]}"
        )
    total_chars = 0
    for item in items:
        source_lang = (item.get("language_original") or "").strip().lower()
        if source_lang not in TRANSLATION_TARGETS:
            continue
        title = (item.get(f"title_{source_lang}") or item.get("title_en") or "")
        summary = (item.get(f"summary_{source_lang}") or item.get("summary_en") or "")
        total_chars += (len(title) + len(summary)) * len(TRANSLATION_TARGETS[source_lang])
    lines.append(f"  total billable characters: {total_chars}")
    return lines
