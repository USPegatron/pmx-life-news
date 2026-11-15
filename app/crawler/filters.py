"""Relevance filtering for the border + aviation news crawler.

Goal: keep news that matters to people working / living in the
Juárez–El Paso border region, and drop obvious noise.

Rules:
  * Drop items whose title/summary hit a clear "noise" keyword
    (sports results, celebrity / entertainment gossip, horoscopes, lottery).
  * Aviation items are kept ONLY when they are about air travel itself
    (airports, flights, delays, FAA, airlines, passengers) — not general
    aviation-industry filler.

Border (local) items are kept unless they hit a noise keyword, because all
border feeds are local Juárez / El Paso outlets whose content is inherently
relevant to residents.
"""

from __future__ import annotations

# Lower-case substring matches (English + Spanish variants, accented + plain).
EXCLUDE_KEYWORDS: tuple[str, ...] = (
    # --- sports / game results ---
    "deportes", "fútbol", "futbol", "beisbol", "béisbol", "soccer",
    "nfl", "nba", "mlb", "liga mx", "torneo", "goleada", "goleó", "goleo",
    "futbol americano", "cruz azul", "bravos", "playoffs", "mundial",
    # --- entertainment / celebrity ---
    "farándula", "farandula", "horóscopo", "horoscopo", "reality show",
    "telenovela", "concierto", "cantante", "celebridad", "celebrity",
    "farandulero", "espectáculos", "espectaculos", "entretenimiento",
    "netflix", "película", "pelicula", "taquilla", "alfombra roja",
    "kardashian", "actor ", "actriz",
    # --- lottery / pure noise ---
    "lotería", "loteria", "melate",
)

# For aviation items: require at least one travel/region signal.
AVIATION_RELEVANCE_KEYWORDS: tuple[str, ...] = (
    "el paso", "juárez", "juarez", "airport", "aeropuerto", "aerolinea",
    "aerolínea", "airline", "vuelo", "flight", "faa", "delay", "retraso",
    "cancel", "ground stop", "aviación", "aviacion", "pasajero", "passenger",
    "terminal", "volar",
)


def _searchable_text(item: dict) -> str:
    title = item.get("title") or ""
    summary = item.get("summary") or ""
    return f"{title} {summary}".lower()


def is_relevant(item: dict) -> bool:
    """Return True if the item should be kept for the border region audience."""
    text = _searchable_text(item)

    if any(keyword in text for keyword in EXCLUDE_KEYWORDS):
        return False

    if (item.get("topic") or "") == "aviation":
        return any(keyword in text for keyword in AVIATION_RELEVANCE_KEYWORDS)

    # border (local) news: relevant unless excluded above
    return True


__all__ = ["is_relevant", "EXCLUDE_KEYWORDS", "AVIATION_RELEVANCE_KEYWORDS"]
