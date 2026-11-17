"""IATA airport code -> IANA timezone name. Covers the airports that
appear in PMX itineraries plus common ones. Falls back to None if unknown
(the upload / filter will then treat times as HH:MM only)."""
from __future__ import annotations

IATA_TZ: dict[str, str] = {
    # USA
    "ELP": "America/Denver",        # El Paso, TX (MST/MDT)
    "LAX": "America/Los_Angeles",   # Los Angeles, CA
    "SFO": "America/Los_Angeles",   # San Francisco
    "SAN": "America/Los_Angeles",   # San Diego
    "PHX": "America/Phoenix",       # Arizona (no DST)
    "AUS": "America/Chicago",       # Austin, TX
    "DFW": "America/Chicago",       # Dallas/Fort Worth
    "IAH": "America/Chicago",       # Houston
    "ORD": "America/Chicago",       # Chicago O'Hare
    "MDW": "America/Chicago",       # Chicago Midway
    "MSP": "America/Chicago",       # Minneapolis
    "ATL": "America/New_York",      # Atlanta
    "JFK": "America/New_York",      # New York JFK
    "EWR": "America/New_York",      # Newark
    "LGA": "America/New_York",      # LaGuardia
    "BOS": "America/New_York",      # Boston
    "MIA": "America/New_York",      # Miami
    "FLL": "America/New_York",      # Fort Lauderdale
    "SEA": "America/Los_Angeles",   # Seattle
    "PDX": "America/Los_Angeles",   # Portland
    "DEN": "America/Denver",        # Denver
    "ANC": "America/Anchorage",     # Anchorage
    "HNL": "Pacific/Honolulu",      # Honolulu

    # Mexico / Central America
    "MEX": "America/Mexico_City",   # Mexico City
    "CJS": "America/Chihuahua",     # Ciudad Juárez (MX)
    "GDL": "America/Mexico_City",   # Guadalajara
    "MTY": "America/Monterrey",     # Monterrey
    "TIJ": "America/Tijuana",       # Tijuana
    "SJD": "America/Mazatlan",      # Los Cabos
    "CUN": "America/Cancun",        # Cancún

    # Asia
    "TPE": "Asia/Taipei",           # Taipei Taoyuan
    "TSA": "Asia/Taipei",           # Taipei Songshan
    "PEK": "Asia/Shanghai",         # Beijing Capital
    "PKX": "Asia/Shanghai",         # Beijing Daxing
    "SHA": "Asia/Shanghai",         # Shanghai Hongqiao
    "PVG": "Asia/Shanghai",         # Shanghai Pudong
    "CAN": "Asia/Shanghai",         # Guangzhou
    "HKG": "Asia/Hong_Kong",        # Hong Kong
    "MFM": "Asia/Macau",            # Macau
    "NRT": "Asia/Tokyo",            # Tokyo Narita
    "HND": "Asia/Tokyo",            # Tokyo Haneda
    "KIX": "Asia/Tokyo",            # Osaka Kansai
    "ICN": "Asia/Seoul",            # Seoul Incheon
    "GMP": "Asia/Seoul",            # Seoul Gimpo
    "MNL": "Asia/Manila",           # Manila
    "CEB": "Asia/Manila",           # Cebu
    "DXB": "Asia/Dubai",            # Dubai
    "AUH": "Asia/Dubai",            # Abu Dhabi
    "DOH": "Asia/Qatar",            # Doha
    "MAA": "Asia/Kolkata",          # Chennai
    "BOM": "Asia/Kolkata",          # Mumbai
    "DEL": "Asia/Kolkata",          # Delhi
    "BLR": "Asia/Kolkata",          # Bengaluru
    "BKK": "Asia/Bangkok",          # Bangkok
    "SIN": "Asia/Singapore",        # Singapore
    "KUL": "Asia/Kuala_Lumpur",     # Kuala Lumpur
    "CGK": "Asia/Jakarta",          # Jakarta

    # Europe
    "LHR": "Europe/London",         # London Heathrow
    "LGW": "Europe/London",         # London Gatwick
    "CDG": "Europe/Paris",          # Paris Charles de Gaulle
    "ORY": "Europe/Paris",          # Paris Orly
    "FRA": "Europe/Berlin",         # Frankfurt
    "MUC": "Europe/Berlin",         # Munich
    "AMS": "Europe/Amsterdam",      # Amsterdam
    "BCN": "Europe/Madrid",         # Barcelona
    "MAD": "Europe/Madrid",         # Madrid
    "FCO": "Europe/Rome",           # Rome Fiumicino
    "ZRH": "Europe/Zurich",         # Zurich
    "VIE": "Europe/Vienna",         # Vienna

    # Oceania
    "SYD": "Australia/Sydney",      # Sydney
    "MEL": "Australia/Melbourne",   # Melbourne
    "AKL": "Pacific/Auckland",      # Auckland
}


def tz_for(iata: str) -> str | None:
    """IATA -> IANA timezone name, or None."""
    return IATA_TZ.get((iata or "").upper().strip())
