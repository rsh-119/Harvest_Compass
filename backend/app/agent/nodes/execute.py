"""Run the planned tool calls. Independent calls run concurrently. Every call is traced with
its status (live / cache / stale_cache / error), source URL and time taken."""

import asyncio
import time
from datetime import timedelta
from typing import Any

from app.agent.state import AgentState, Mandi
from app.agent.trace import emit
from app.clock import today_ist
from app.config import settings
from app.data.cache import Sourced
from app.data.synonyms import DISTRICT_ALIASES
from app.tools import geocode, mandi, routing, weather
from app.tools.mandi import PriceRow

HISTORY_DAYS = 30


def weather_models(faults: set[str]) -> tuple[str, ...]:
    """'ecmwf_ifs025' is switched off by the 'weather_ecmwf' test switch, and so on."""
    return tuple(m for m in weather.MODELS if f"weather_{m.split('_')[0]}" not in faults)


def latest_rows(current: list[PriceRow], history: list[PriceRow]) -> list[PriceRow]:
    """One row per (mandi, variety, grade): today's report if there is one, else the newest
    history row. Its arrival_date stays attached, so the audit can judge its age."""
    best: dict[tuple[tuple[str, str], str, str], PriceRow] = {}
    for r in history + current:  # current last, so it wins over a same-date history row
        k = (r.key, r.variety, r.grade)
        if k not in best or r.arrival_date >= best[k].arrival_date:
            best[k] = r
    return list(best.values())


def _ms(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)


def _trace(tool: str, res: Sourced[Any], t0: float, en: str, hi: str) -> None:
    emit(
        "tool_result",
        en,
        hi,
        tool=tool,
        status=res.status,
        source_url=res.source_url,
        fetched_at=res.fetched_at.isoformat() if res.fetched_at else None,
        error=res.error,
        ms=_ms(t0),
    )


async def _locate(state: AgentState, rows: list[PriceRow]) -> list[Mandi]:
    place, radius = state["place"], state["radius_km"]
    origin = (place.lat, place.lon)
    # Pre-filter by district centre, so we only geocode mandis that could be in range.
    # Lookups run concurrently: cache reads overlap, and geocode's lock still spaces live calls.
    districts = sorted({r.district for r in rows})
    centres = await asyncio.gather(
        *(
            geocode.search(
                f"{DISTRICT_ALIASES.get(d, d)} district, {settings.state}, India", limit=1
            )
            for d in districts
        )
    )
    near = {
        d
        for d, c in zip(districts, centres, strict=True)
        if c.data and routing.haversine_km(origin, (c.data[0].lat, c.data[0].lon)) <= radius + 60
    }
    mandis: dict[str, Mandi] = {}
    for r in rows:
        if r.district in near:
            k = "|".join(r.key)
            mandis.setdefault(k, Mandi(key=k, market=r.market, district=r.district))
    t0 = time.monotonic()
    found_places = await asyncio.gather(
        *(geocode.locate_mandi(m.market, m.district, settings.state) for m in mandis.values())
    )
    for m, p in zip(mandis.values(), found_places, strict=True):
        m.location = p.data
    found = sum(1 for m in mandis.values() if m.location)
    emit(
        "tool_result",
        f"Located {found}/{len(mandis)} mandis on OpenStreetMap",
        f"{found} मंडियों की जगह मिली",
        tool="geocode",
        ms=_ms(t0),
    )
    in_range = [
        m
        for m in mandis.values()
        if m.location and routing.haversine_km(origin, (m.location.lat, m.location.lon)) <= radius
    ]
    if in_range:
        t0 = time.monotonic()
        emit(
            "tool_call",
            f"Road distances to {len(in_range)} mandis (OSRM)",
            "सड़क की दूरी निकाली जा रही है",
            tool="routing",
        )
        dests = [(m.location.lat, m.location.lon) for m in in_range if m.location]
        routes = await routing.road_distances(origin, dests)
        for m, rt in zip(in_range, routes, strict=True):
            m.route = rt.data
        shown = next((rt for rt in routes if rt.status == "error"), routes[0])
        ok = sum(1 for r in routes if r.data)
        _trace(
            "routing",
            shown,
            t0,
            f"Road distances found for {ok}/{len(routes)} mandis",
            f"{ok} मंडियों की सड़क दूरी मिली",
        )
    unresolved = [m for m in mandis.values() if not m.location]
    return in_range + unresolved  # unresolved mandis are kept so the audit can name them


async def execute(state: AgentState) -> dict[str, Any]:
    i, faults, place = state["intent"], state["faults"], state["place"]
    crop = i.crop or ""
    want_weather = any(s["step"] == "weather" for s in state["plan"])
    t0 = time.monotonic()

    async def prices() -> Sourced[list[PriceRow]]:
        if "mandi_current" in faults:
            return Sourced(
                data=None,
                source_url=mandi.public_url(mandi.CURRENT_ID, {}),
                fetched_at=None,
                status="error",
                error="disabled by test switch",
            )
        return await mandi.current_prices(crop)

    async def hist() -> list[Sourced[list[PriceRow]]]:
        return await mandi.history(crop, HISTORY_DAYS, end=today_ist() - timedelta(days=1))

    async def wx() -> Sourced[dict[str, Any]] | None:
        models = weather_models(faults)
        if not want_weather or not models:
            return None
        res = await weather.forecast(place.lat, place.lon, models)
        return res.map(
            lambda d: {m: [x.model_dump(mode="json") for x in days] for m, days in d.items()}
        )

    emit(
        "tool_call",
        "Fetching today's prices, 30-day history and weather in parallel",
        "आज के भाव, पिछले 30 दिन और मौसम एक साथ मंगाए जा रहे हैं",
        tool="parallel",
    )
    cur, days, wres = await asyncio.gather(prices(), hist(), wx())
    _trace(
        "mandi_current",
        cur,
        t0,
        f"Today's prices: {len(cur.data or [])} rows",
        f"आज के भाव: {len(cur.data or [])} रिकॉर्ड",
    )
    history = [r for d in days for r in d.data or []]
    emit(
        "tool_result",
        f"History: {len(history)} rows over {HISTORY_DAYS} days ({sorted({d.status for d in days})})",
        f"पिछले {HISTORY_DAYS} दिन के {len(history)} रिकॉर्ड",
        tool="mandi_history",
        source_url=days[0].source_url if days else None,
        ms=_ms(t0),
    )
    if cur.status == "error":
        emit(
            "repair",
            f"Today's price source failed ({cur.error}); using each mandi's latest reported price, with its age",
            "आज के भाव का स्रोत बंद है; हर मंडी का सबसे ताज़ा उपलब्ध भाव (उम्र के साथ) लिया",
        )
    out: dict[str, Any] = {"current": cur, "history": history}
    if wres is not None:
        got = set((wres.data or {}).keys())
        _trace("weather", wres, t0, f"Weather models received: {sorted(got)}", "मौसम पूर्वानुमान मिला")
        out["weather"] = wres
        missing = [m for m in weather.MODELS if m not in got]
        if missing and got:
            emit(
                "repair",
                f"Weather model {missing} unavailable; using {sorted(got)} only, so days are marked uncertain",
                "एक मौसम मॉडल उपलब्ध नहीं; दूसरे मॉडल से काम चलाया, दिन 'अनिश्चित' माने गए",
            )
    elif want_weather:
        emit(
            "repair",
            "No weather model available; harvest days can't be judged",
            "मौसम की जानकारी नहीं मिली",
        )
    rows = latest_rows(
        [r for r in cur.data or [] if r.commodity == crop],
        [r for r in history if r.commodity == crop],
    )
    out["rows"] = rows
    out["mandis"] = await _locate(state, rows)
    return out
