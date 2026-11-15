"""Feed registry for the border + aviation news crawler.

Every URL in this file was verified with a real HTTP GET on 2026-11-14 and
returned a valid RSS/Atom document (HTTP 200, XML body, fresh items).

Substitutions are documented inline: the original outlet was unreachable, has
no public RSS endpoint, or has no usable feed at all.
"""

# topic: 'border' | 'aviation'   (must match the news_items.topic CHECK constraint)
# lang : 'en' | 'es'             (language the feed publishes in; drives DeepL)
FEEDS = [
    # ---------------- Border: El Paso / Juárez ----------------
    # Verified replacement for "El Paso Tribune" (elpasotribune.com/feed/ now
    # serves a parked-domain /lander redirect, i.e. the outlet is dead).
    # El Paso Matters is a non-profit El Paso newsroom with a clean RSS feed.
    {
        "name": "El Paso Matters",
        "url": "https://elpasomatters.org/feed/",
        "topic": "border",
        "lang": "en",
    },
    # Verified replacement for "El Paso Times": every Gannett RSS endpoint
    # (elpasotimes.com/rss/, rssfeeds.elpasotimes.com/gmg-elpaso/home) answers
    # HTTP 402 Payment Required for non-browser clients. KVIA ABC-7 is the
    # El Paso broadcast-news outlet and publishes a full RSS feed.
    {
        "name": "KVIA ABC-7 El Paso",
        "url": "https://www.kvia.com/rss",
        "topic": "border",
        "lang": "en",
    },
    # "Norte en El Paso" -> Norte Digital, the Juárez/El Paso border digital
    # daily (nortedigital.mx), verified RSS.
    {
        "name": "Norte Digital",
        "url": "https://nortedigital.mx/feed/",
        "topic": "border",
        "lang": "es",
    },
    # Verified replacement for "El Vigía Juárez": elvigia.net returns HTTP 403
    # for every RSS path (/rss/, /rss.xml, /feed/) behind the corporate proxy.
    # La Verdad Juárez is a Juárez daily with a working WordPress feed.
    {
        "name": "La Verdad Juárez",
        "url": "https://laverdadjuarez.com/feed/",
        "topic": "border",
        "lang": "es",
    },
    # Verified replacement for "El Diario de Juárez": diario.mx is now a Nuxt
    # SPA with no RSS endpoint (all /rss, /rss.xml, /feed/ paths return HTML).
    # El Fronterizo is a Juárez newspaper with a working RSS feed.
    {
        "name": "El Fronterizo",
        "url": "https://www.elfronterizo.com/feed/",
        "topic": "border",
        "lang": "es",
    },
    # Verified replacement for "La Opinión El Paso": laopinion.com/seccion/
    # el-paso/feed/ exists but is an empty WordPress "Comments on:" feed (1
    # item, no dates). Juárez Noticias is a Juárez news portal with a fresh feed.
    {
        "name": "Juárez Noticias",
        "url": "https://juareznoticias.com/feed/",
        "topic": "border",
        "lang": "es",
    },
    # ---------------- Aviation: global ----------------
    {
        "name": "Simple Flying",
        "url": "https://simpleflying.com/feed/",
        "topic": "aviation",
        "lang": "en",
    },
    # Aviation Pros has no /rss path; the site's own <link rel="alternate">
    # points at this Omeda/Ellington RSS endpoint.
    {
        "name": "Aviation Pros",
        "url": (
            "https://www.aviationpros.com/__rss/website-scheduled-content.xml"
            '?input=%7B%22sectionAlias%22%3A%22home%22%7D'
        ),
        "topic": "aviation",
        "lang": "en",
    },
    {
        "name": "The Aviationist",
        "url": "https://theaviationist.com/feed/",
        "topic": "aviation",
        "lang": "en",
    },
    # blog.flightaware.com/feed/ 404s; the HubSpot blog advertises /rss.xml.
    {
        "name": "FlightAware Blog",
        "url": "https://blog.flightaware.com/rss.xml",
        "topic": "aviation",
        "lang": "en",
    },
    {
        "name": "The Air Current",
        "url": "https://theaircurrent.com/feed/",
        "topic": "aviation",
        "lang": "en",
    },
]

__all__ = ["FEEDS"]
