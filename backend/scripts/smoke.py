"""Live smoke test: calls every real source once and prints what came back.
Run twice: the second run should be served from the Postgres cache.
    uv run python -m scripts.smoke
"""

import asyncio
import sys
import time
from collections import Counter

from app.config import settings
from app.data.cache import close_pool
from app.http import client
from app.tools import geocode, mandi, routing, voice, weather


def line(name: str, res: object, extra: str = "") -> None:
    s = getattr(res, "status", "?")
    age = getattr(res, "fetched_at", None)
    print(
        f"[{s:11}] {name:28} fetched_at={age:%Y-%m-%d %H:%M}Z {extra}"
        if age
        else f"[{s}] {name} {extra} {getattr(res, 'error', '')}"
    )


async def main() -> None:
    t0 = time.monotonic()
    rows: list[mandi.PriceRow] = []
    for crop in settings.crops:
        cur = await mandi.current_prices(crop)
        rows += cur.data or []
        sample = (cur.data or [])[:2]
        line(
            f"mandi current {crop}",
            cur,
            f"rows={len(cur.data or [])} e.g. "
            + "; ".join(
                f"{r.market} {r.variety} ₹{r.modal_price:.0f} ({r.arrival_date})" for r in sample
            ),
        )

    for crop in settings.crops:
        t = time.monotonic()
        days = await mandi.history(crop, days=90)
        statuses = Counter(d.status for d in days)
        n = sum(len(d.data or []) for d in days)
        print(
            f"[history    ] {crop:10} 90 days -> {n} rows, statuses={dict(statuses)} in {time.monotonic() - t:.1f}s"
        )

    origin = await geocode.search("Indore, Madhya Pradesh, India", limit=1)
    line("geocode Indore", origin, str(origin.data[0].lat if origin.data else None))
    assert origin.data
    o = (origin.data[0].lat, origin.data[0].lon)

    near = {}
    for r in rows:
        if r.district in {"Indore", "Ujjain", "Dewas", "Dhar"}:
            near.setdefault(r.key, r)
    located = []
    for r in list(near.values())[:8]:
        p = await geocode.locate_mandi(r.market, r.district, settings.state)
        line(
            f"locate {r.market}"[:28],
            p,
            f"{p.data.lat:.4f},{p.data.lon:.4f}" if p.data else "UNRESOLVED",
        )
        if p.data:
            located.append((r.market, (p.data.lat, p.data.lon)))

    routes = await routing.road_distances(o, [c for _, c in located])
    for (name, _), rt in zip(located, routes, strict=True):
        line(
            f"road Indore->{name}"[:28],
            rt,
            f"{rt.data.km:.1f} km, {rt.data.minutes:.0f} min" if rt.data else "no road",
        )

    fc = await weather.forecast(*o)
    for model, days in (fc.data or {}).items():
        line(
            f"weather {model}",
            fc,
            " ".join(f"{d.day:%d}:{d.precip_mm}mm/{d.precip_prob}%" for d in days),
        )

    audio = await voice.speak("सांवेर मंडी में सोयाबीन का भाव सबसे अच्छा है।")
    line("tts", audio, f"{len(audio.data or b'')} bytes")
    if audio.data:
        stt = await voice.transcribe(audio.data, "reply.wav", "audio/wav")
        line("stt (of the tts audio)", stt, stt.data or "")
    print(f"total {time.monotonic() - t0:.1f}s")
    await client.aclose()
    await close_pool()


if __name__ == "__main__":
    if sys.platform == "win32":  # psycopg async can't use Windows' default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
