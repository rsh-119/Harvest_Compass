"""Road distance and drive time from the public OSRM server (rate-limited, so cache everything).

The table service gives one origin -> many mandis in a single request. Each pair is cached
on its own (road distances don't change), so a repeat question costs OSRM nothing.
"""

import asyncio
import math
from typing import Any

from pydantic import BaseModel

from app.data.cache import Sourced, cached
from app.http import request_json

BASE = "https://router.project-osrm.org/table/v1/driving/"


class Route(BaseModel):
    km: float
    minutes: float


def _pt(lat: float, lon: float) -> str:
    return f"{lon:.5f},{lat:.5f}"  # OSRM wants lon,lat


def parse_table(body: dict[str, Any], n: int) -> list[Route | None]:
    """Row 0 of the table is origin -> each destination. null = OSRM found no road."""
    if body.get("code") != "Ok":
        raise ValueError(f"OSRM code {body.get('code')}")
    dist, dur = body["distances"][0], body["durations"][0]
    return [
        None if dist[i] is None or dur[i] is None else Route(km=dist[i] / 1000, minutes=dur[i] / 60)
        for i in range(1, n + 1)
    ]


async def road_distances(
    origin: tuple[float, float], dests: list[tuple[float, float]]
) -> list[Sourced[Route | None]]:
    """One result per destination, same order."""
    coords = ";".join([_pt(*origin)] + [_pt(*d) for d in dests])
    url = f"{BASE}{coords}?sources=0&annotations=distance,duration"
    table: list[Route | None] | None = None
    lock = asyncio.Lock()

    async def fetch_table() -> list[Route | None]:
        nonlocal table
        async with lock:  # first cache miss pays for the whole table, the rest reuse it
            if table is None:
                table = parse_table(await request_json("GET", url), len(dests))
        return table

    async def one(i: int, d: tuple[float, float]) -> Sourced[Route | None]:
        pair_url = f"{BASE}{_pt(*origin)};{_pt(*d)}?sources=0&annotations=distance,duration"

        async def fetch() -> Any:
            r = (await fetch_table())[i]
            return None if r is None else r.model_dump()

        res = await cached(f"osrm:{_pt(*origin)}:{_pt(*d)}", pair_url, None, fetch)
        return res.map(lambda v: None if v is None else Route(**v))

    return list(await asyncio.gather(*(one(i, d) for i, d in enumerate(dests))))


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Straight-line distance. Only a cheap pre-filter; ranking uses OSRM road km."""
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))
