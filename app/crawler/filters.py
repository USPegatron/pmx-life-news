"""Relevance filtering for the border + aviation news crawler.

Goal: keep news that matters to people working / living in the
Juárez–El Paso border region, and drop obvious noise.

Strategy
--------
1. Drop items whose title/summary hit a "noise" keyword (sports results,
   celebrity / entertainment gossip, horoscopes, lottery) — EN + ES.
2. Aviation items are kept ONLY when they are about air travel itself
   (airports, flights, delays, FAA, airlines, passengers).
3. Border items from *purely local* outlets (El Paso Matters, Norte Digital,
   La Verdad Juárez, El Fronterizo, Juárez Noticias) are kept (they are
   inherently local) unless a noise keyword hits.
4. For *mixed* outlets that syndicate national wire copy (e.g. KVIA carries
   CNN), a border item must contain at least one LOCAL_SIGNAL keyword;
   otherwise it is dropped (this removes CNN national politics, out-of-area
   sports, etc.).
"""

from __future__ import annotations

# Lower-case substring matches (English + Spanish variants, accented + plain).
EXCLUDE_KEYWORDS: tuple[str, ...] = (
    # --- sports / game results ---
    "deportes", "fútbol", "futbol", "soccer", "football", "basketball",
    "baseball", "beisbol", "béisbol", "nfl", "nba", "mlb", "nhl", "liga mx",
    "torneo", "goleada", "goleó", "goleo", "halftime", "touchdown",
    "quarterback", "field goal", "home run", "innings", "pitcher",
    "playoff", "playoffs", "wide receiver", "running back", "utep miners",
    "miners football", "aggies", "cruz azul", "bravos", "mundial",
    "copa america", "copa mundial", "world cup",
    # --- golf (usually out-of-area national copy on these feeds) ---
    "golf course", "campo de golf", "golf tournament",
    # --- entertainment / celebrity ---
    "farándula", "farandula", "horóscopo", "horoscopo", "reality show",
    "telenovela", "concierto", "cantante", "celebridad", "celebrity",
    "farandulero", "espectáculos", "espectaculos", "entretenimiento",
    "netflix", "película", "pelicula", "taquilla", "alfombra roja",
    "kardashian", "actor ", "actriz",
    # --- lottery / pure noise ---
    "lotería", "loteria", "melate",
)

# Outlets that are purely local — their border items are trusted as relevant.
LOCAL_SOURCES: frozenset[str] = frozenset({
    "el paso matters",
    "norte digital",
    "la verdad juárez",
    "la verdad juarez",
    "el fronterizo",
    "juárez noticias",
    "juarez noticias",
})

# For border items from mixed / syndicating outlets: require a local signal.
LOCAL_SIGNALS: tuple[str, ...] = (
    "el paso", "juárez", "juarez", "frontera", "border", "migra", "inmigra",
    "aduana", "deporta", "asilo", "cruce", "las cruces", "santa teresa",
    "san elizario", "socorro", "horizon city", "paso del norte", "chamizal",
    "ciudad juárez", "el paso county", "texas border", "río grande",
    "rio grande", "puerto de entrada", "port of entry", "consulado",
    "consulate", "maquila", "maquiladora", "nearshoring", "cbp", "uscis",
)

# For aviation items: require at least one travel signal.
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

    topic = (item.get("topic") or "").strip().lower()

    if topic == "aviation":
        return any(keyword in text for keyword in AVIATION_RELEVANCE_KEYWORDS)

    # border news
    source = (item.get("source") or "").strip().lower()
    if source in LOCAL_SOURCES:
        return True
    # mixed / syndicating outlet -> must show a local signal
    return any(keyword in text for keyword in LOCAL_SIGNALS)


__all__ = [
    "is_relevant",
    "EXCLUDE_KEYWORDS",
    "LOCAL_SOURCES",
    "LOCAL_SIGNALS",
    "AVIATION_RELEVANCE_KEYWORDS",
]
