"""Live source status for /health. Cheap real calls, run together, remembered for 60 s, so a
10-minute warm-up ping costs each free API one tiny request.

Nominatim isn't probed (its policy discourages needless calls), and neither are the paid LLM
and voice APIs: those report "configured" only.
"""

import asyncio
import time
from typing import Any

from app.config import settings
from app.data.cache import get_pool
from app.http import request_json
from app.tools import mandi, routing, weather

_memo: tuple[float, dict[str, Any]] | None = None


async def _db() -> None:
    pool = await get_pool()
    if pool is None:
        raise RuntimeError("DATABASE_URL not set")
    async with pool.connection() as conn:
        await conn.execute("SELECT 1")


async def _mandi() -> None:
    body = await request_json(
        "GET",
        mandi.BASE + mandi.CURRENT_ID,
        params={"api-key": settings.data_gov_in_api_key, "format": "json", "limit": 1},
        retries=0,
        timeout=8,
    )
    if "records" not in body:
        raise RuntimeError("no records field")


async def _weather() -> None:
    params = {"latitude": settings.center_lat, "longitude": settings.center_lon}
    await request_json(
        "GET",
        weather.URL,
        params={**params, "daily": "precipitation_sum", "forecast_days": 1},
        retries=0,
        timeout=8,
    )


async def _routing() -> None:
    a = f"{settings.center_lon},{settings.center_lat}"
    await request_json("GET", f"{routing.BASE}{a};{a}?sources=0", retries=0, timeout=8)


async def _check(fn: Any) -> dict[str, Any]:
    t0 = time.monotonic()
    try:
        await fn()
        return {"ok": True, "ms": int((time.monotonic() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}


async def status() -> dict[str, Any]:
    global _memo
    if _memo and time.monotonic() - _memo[0] < 60:
        return _memo[1]
    names = ("database", "mandi_prices", "weather", "routing")
    results = await asyncio.gather(*(_check(f) for f in (_db, _mandi, _weather, _routing)))
    out: dict[str, Any] = dict(zip(names, results, strict=True))
    out["geocoding"] = {"ok": True, "note": "not probed (Nominatim policy); cached lookups"}
    out["llm"] = {"ok": bool(settings.openrouter_api_key), "note": "configured, not probed"}
    out["voice"] = {"ok": bool(settings.sarvam_api_key), "note": "configured, not probed"}
    _memo = (time.monotonic(), out)
    return out
