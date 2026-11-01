"""Coordinates from Nominatim. Policy: max 1 request/second, identifying User-Agent,
cache results. "Not found" is cached too, and we never guess coordinates."""

import asyncio
import difflib
import re
import time
from typing import Any
from urllib.parse import urlencode

from pydantic import BaseModel

from app.data.cache import Sourced, cached
from app.data.synonyms import DISTRICT_ALIASES, MANDI_TOWN_ALIASES, market_town, sub_yard_town
from app.http import request_json

URL = "https://nominatim.openstreetmap.org/search"
_lock = asyncio.Lock()
_last_call = 0.0


class Place(BaseModel):
    name: str
    display_name: str
    lat: float
    lon: float
    kind: str = ""  # OSM place type (town, village...) when known


async def _rate_limited_get(params: dict[str, Any]) -> Any:
    global _last_call
    async with _lock:  # one request at a time, at least 1.1 s apart
        wait = _last_call + 1.1 - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            return await request_json("GET", URL, params=params)
        finally:
            _last_call = time.monotonic()


async def search(query: str, limit: int = 5) -> Sourced[list[Place]]:
    """Candidates for a free-text place query (village matching picks among these)."""
    # English names so fuzzy matching against a transliterated village name works.
    params = {
        "q": query,
        "format": "json",
        "limit": limit,
        "countrycodes": "in",
        "accept-language": "en",
    }

    async def fetch() -> list[dict[str, Any]]:
        body = await _rate_limited_get(params)
        return [
            {
                "name": p.get("name", ""),
                "display_name": p["display_name"],
                "lat": float(p["lat"]),
                "lon": float(p["lon"]),
            }
            for p in body
        ]

    res = await cached(f"geo:en:{query.lower()}:{limit}", f"{URL}?{urlencode(params)}", None, fetch)
    return res.map(lambda ps: [Place(**p) for p in ps])


SETTLEMENTS = {"city", "town", "village", "hamlet"}


async def search_settlements(query: str, limit: int = 5) -> Sourced[list[Place]]:
    """Like search(), but only real places people live in (OSM category "place"): no district
    boundaries, roads or railway stations. A district's centre can be 35 km from its town."""
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": limit,
        "countrycodes": "in",
        "accept-language": "en",
    }

    async def fetch() -> list[dict[str, Any]]:
        body = await _rate_limited_get(params)
        return [
            {
                "name": p.get("name", ""),
                "display_name": p["display_name"],
                "lat": float(p["lat"]),
                "lon": float(p["lon"]),
                "kind": p["type"],
            }
            for p in body
            if p.get("category") == "place" and p.get("type") in SETTLEMENTS
        ]

    res = await cached(
        f"geo:settle2:{query.lower()}:{limit}", f"{URL}?{urlencode(params)}", None, fetch
    )
    return res.map(lambda ps: [Place(**p) for p in ps])


def _letters(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def close_name(a: str, b: str, contain: bool = True) -> bool:
    """Same place name despite data.gov.in spelling: 'Thirssur'~'Thrissur', 'Udhamsinghnagar'~
    'Udham Singh Nagar', 'Dehradoon'~'Dehradun'. Letters only, then containment or 80% similar."""
    a, b = _letters(a), _letters(b)
    if not (a and b):
        return False
    return (contain and a in b) or difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def spelling_variant(town: str) -> str:
    return re.sub(r"([a-z])\1", r"\1", re.sub(r"oo", "u", town, flags=re.I), flags=re.I)


def in_district(p: Place, town: str, district: str) -> bool:
    """Exact district text in the address, or a similar district name plus a similar place name
    (the name check stops a road or hospital that merely mentions the town)."""
    if district.lower() in p.display_name.lower():
        return True
    parts = p.display_name.split(",")
    return any(close_name(district, x) for x in parts) and any(
        close_name(town, x, contain=False) for x in p.name.split(",")
    )


async def locate_mandi(market: str, district: str, state: str) -> Sourced[Place | None]:
    """Try 'town, district, state'. If that finds nothing, try 'town, state' and accept the
    result only if it lies in the right district. data=None means unresolved: the mandi is
    excluded and named, never guessed."""
    sub = sub_yard_town(market)
    town = sub[0] if sub else market_town(market)
    town, dist_fix = MANDI_TOWN_ALIASES.get(town, (town, sub[1] if sub else None))
    dist = dist_fix or DISTRICT_ALIASES.get(district, district)
    first = await search(f"{town}, {dist}, {state}, India", limit=1)
    if first.data:
        return first.map(lambda ps: ps[0])
    second = await search(f"{town}, {state}, India", limit=3)
    match = next((p for p in second.data or [] if in_district(p, town, dist)), None)
    if match is None and (alt := spelling_variant(town)) != town:
        # feed spellings double letters: 'Haathras' -> Hathras, 'Dehradoon' -> Dehradun
        third = await search(f"{alt}, {state}, India", limit=3)
        match = next((p for p in third.data or [] if in_district(p, alt, dist)), None)
        return third.map(lambda _: match)
    return second.map(lambda _: match)
