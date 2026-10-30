"""Coordinates from Nominatim. Policy: max 1 request/second, identifying User-Agent,
cache results. "Not found" is cached too, and we never guess coordinates."""

import asyncio
import time
from typing import Any
from urllib.parse import urlencode

from pydantic import BaseModel

from app.data.cache import Sourced, cached
from app.data.synonyms import DISTRICT_ALIASES, market_town
from app.http import request_json

URL = "https://nominatim.openstreetmap.org/search"
_lock = asyncio.Lock()
_last_call = 0.0


class Place(BaseModel):
    name: str
    display_name: str
    lat: float
    lon: float


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


async def locate_mandi(market: str, district: str, state: str) -> Sourced[Place | None]:
    """Try 'town, district, state'. If that finds nothing, try 'town, state' and accept the
    result only if it lies in the right district. data=None means unresolved: the mandi is
    excluded and named, never guessed."""
    town = market_town(market)
    dist = DISTRICT_ALIASES.get(district, district)
    first = await search(f"{town}, {dist}, {state}, India", limit=1)
    if first.data:
        return first.map(lambda ps: ps[0])
    second = await search(f"{town}, {state}, India", limit=3)
    match = next((p for p in second.data or [] if dist.lower() in p.display_name.lower()), None)
    return second.map(lambda _: match)
