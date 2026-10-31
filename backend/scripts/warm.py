"""Fill the cache for every state that reports our crops, so a farmer's first question from a
new state doesn't wait minutes for mandi geocoding (Nominatim allows 1 request a second).
Real calls only; everything lands in the same cache the agent reads.

    uv run python -m scripts.warm                 # all states with data today
    uv run python -m scripts.warm Maharashtra     # one state (OSM spelling)
    uv run python -m scripts.warm --all-crops     # every supported crop, not just settings.crops

data.gov.in refuses cloud servers, so the hosted backend answers from this cache: run it on a
schedule from a machine in India. History older than 3 days is cached for good, so after the first
run each refresh only fetches today's prices and the last few days.
"""

import asyncio
import sys
import time
from datetime import timedelta

from app.agent.nodes.execute import HISTORY_DAYS
from app.clock import today_ist
from app.config import settings
from app.data.cache import close_pool
from app.data.crops import COMMODITIES
from app.data.regions import AGMARK, agmark
from app.data.synonyms import DISTRICT_ALIASES
from app.http import client
from app.tools import geocode, mandi

OSM_NAME = {v: k for k, v in AGMARK.items()}  # 'Keralam' -> 'Kerala'


async def warm_state(state: str, crops: list[str]) -> None:
    t0 = time.monotonic()
    rows = []
    for crop in crops:
        cur = await mandi.current_prices(crop, agmark(state))
        hist = await mandi.history(
            crop, HISTORY_DAYS, end=today_ist() - timedelta(days=1), state=agmark(state)
        )
        rows += (cur.data or []) + [r for h in hist for r in h.data or []]
    districts = sorted({r.district for r in rows})
    for d in districts:
        await geocode.search(f"{DISTRICT_ALIASES.get(d, d)} district, {state}, India", limit=1)
    mandis = sorted({(r.market, r.district) for r in rows})
    found = 0
    for m, d in mandis:
        found += (await geocode.locate_mandi(m, d, state)).data is not None
    print(f"{state}: {len(crops)} crops, {len(districts)} districts, {found}/{len(mandis)} mandis located, "
          f"{time.monotonic() - t0:.0f} s", flush=True)  # fmt: skip


async def main(only: list[str], all_crops: bool) -> None:
    wanted = COMMODITIES if all_crops else settings.crops
    # Today's feed decides which crops each state reports, busiest state first.
    by_state: dict[str, set[str]] = {}
    feeds = (
        [{}] if all_crops else [{"commodity": c} for c in wanted]
    )  # one unfiltered pull covers all
    for f in feeds:
        for r in await mandi._fetch_all(mandi.CURRENT_ID, f):
            if r["commodity"] in wanted:
                by_state.setdefault(OSM_NAME.get(r["state"], r["state"]), set()).add(r["commodity"])
    states = only or sorted(by_state, key=lambda s: -len(by_state[s]))
    print("states:", states, flush=True)
    try:
        for s in states:
            await warm_state(s, sorted(by_state.get(s, set(wanted))))
    finally:
        await client.aclose()
        await close_pool()


if __name__ == "__main__":
    if sys.platform == "win32":  # psycopg async can't use Windows' default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    args = sys.argv[1:]
    asyncio.run(main([a for a in args if a != "--all-crops"], "--all-crops" in args))
