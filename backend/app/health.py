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
from app.http import plain, request_json
from app.tools import mandi, routing, voice, weather

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
        timeout=5,
    )
    if "records" not in body:
        raise RuntimeError("no records field")


async def _mandi_cache_age_h() -> float | None:
    """Hours since the daily warm last stored today's prices. data.gov.in refuses cloud IPs,
    so the hosted backend answers from this cache."""
    pool = await get_pool()
    if pool is None:
        return None
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT EXTRACT(EPOCH FROM now() - max(fetched_at)) / 3600 FROM api_cache"
            " WHERE key LIKE 'mandi:current:%'"
        )
        row = await cur.fetchone()
    return None if row is None or row[0] is None else float(row[0])


async def _mandi_status() -> dict[str, Any]:
    live = await _check(_mandi)
    if live["ok"]:
        return live
    try:
        age = await _mandi_cache_age_h()
    except Exception:
        age = None
    if age is not None and age <= 30:  # warm runs daily at 4 am IST
        note = f"live API blocks cloud servers; using prices stored {age:.0f} h ago"
        return {"ok": True, "note": note}
    return live


async def _weather() -> None:
    params = {"latitude": settings.center_lat, "longitude": settings.center_lon}
    await request_json(
        "GET",
        weather.URL,
        params={**params, "daily": "precipitation_sum", "forecast_days": 1},
        retries=0,
        timeout=5,
    )


async def _routing() -> None:
    a = f"{settings.center_lon},{settings.center_lat}"
    await request_json("GET", f"{routing.BASE}{a};{a}?sources=0", retries=0, timeout=5)


async def _check(fn: Any) -> dict[str, Any]:
    t0 = time.monotonic()
    try:
        await fn()
        return {"ok": True, "ms": int((time.monotonic() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "error": plain(e)}


async def status() -> dict[str, Any]:
    global _memo
    if _memo and time.monotonic() - _memo[0] < 60:
        return _memo[1]
    names = ("database", "mandi_prices", "weather", "routing")
    results = await asyncio.gather(_check(_db), _mandi_status(), _check(_weather), _check(_routing))
    out: dict[str, Any] = dict(zip(names, results, strict=True))
    out["geocoding"] = {"ok": True, "note": "not probed (Nominatim policy); cached lookups"}
    out["llm"] = {"ok": bool(settings.openrouter_api_key), "note": "configured, not probed"}
    try:
        used = await voice.voice_used_today()
        left = max(settings.voice_daily_limit - used, 0)
        out["voice"] = {
            "ok": bool(settings.sarvam_api_key) and left > 0,
            "note": f"not probed; {used} of {settings.voice_daily_limit} live calls used today",
        }
    except Exception:
        out["voice"] = {"ok": bool(settings.sarvam_api_key), "note": "usage count unavailable"}
    _memo = (time.monotonic(), out)
    return out
