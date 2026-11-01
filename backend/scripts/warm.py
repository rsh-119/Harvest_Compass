"""Fill the cache for every state that reports our crops, so a farmer's first question from a
new state doesn't wait minutes for mandi geocoding (Nominatim allows 1 request a second).
Real calls only; everything lands in the same cache the agent reads.

    uv run python -m scripts.warm                 # all states with data today
    uv run python -m scripts.warm Maharashtra     # one state (OSM spelling)
    uv run python -m scripts.warm --all-crops     # every supported crop, not just settings.crops

data.gov.in refuses cloud servers, so the hosted backend answers from this cache: run it daily
(4 am task) from a machine in India. Every state gets BULK_DAYS of history for every crop, one
request per state and day (the history resource can be filtered by state and date alone), split
into the per-crop keys mandi.history_day reads. settings.crops also keep their 30 days. History
older than 3 days is cached for good, so after the first run each refresh only re-pulls the last
few days.

It also fetches every state x crop a farmer asked about that had no stored prices (the
refresh_queue table the hosted backend fills), then clears those rows.
"""

import asyncio
import sys
import time
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.agent.nodes.execute import HISTORY_DAYS
from app.clock import today_ist
from app.config import settings
from app.data.cache import _read, close_pool, refresh_done, take_refresh_queue, write_many
from app.data.crops import COMMODITIES
from app.data.regions import AGMARK, STATES, agmark
from app.data.synonyms import DISTRICT_ALIASES
from app.http import client, plain
from app.tools import geocode, mandi

OSM_NAME = {v: k for k, v in AGMARK.items()}  # 'Keralam' -> 'Kerala'
BULK_DAYS = 14
FINAL_AFTER_DAYS = 3  # same rule as mandi.history_day: older days get no late reports


def split_by_crop(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in records:
        out[str(r.get("Commodity"))].append(r)
    return dict(out)


async def bulk_history(state: str, days: list[date]) -> list[dict[str, Any]]:
    """Every crop's history for one state (data.gov.in spelling), one request per day. Returns
    the raw records pulled this run (final days stored earlier are skipped). Crops seen in the
    window but missing on a day get [] so the agent reads "no reports" from the cache instead
    of trying data.gov.in from the cloud. A day that fails is skipped and retried next run."""
    sem = asyncio.Semaphore(4)  # be polite to data.gov.in
    today = today_ist()

    async def one(d: date) -> dict[str, list[dict[str, Any]]] | None:
        marker = f"mandi:history-bulk:{state}:{d.isoformat()}"
        stored = await _read(marker)
        # final day already stored; a marker of 0 crops is an old empty pull, so pull it again
        if (today - d).days > FINAL_AFTER_DAYS and stored and stored[0]:
            return None
        async with sem:
            try:
                recs = await mandi._fetch_all(
                    mandi.HISTORY_ID, {"State": state, "Arrival_Date": d.strftime("%d/%m/%Y")}
                )
            except Exception as e:
                print(f"{state} {d}: history pull failed, retry next run: {plain(e)}", flush=True)
                return None
        if not recs:
            # data.gov.in sometimes answers a busy day with 0 records and no error. Storing that
            # as final wiped 8 days of Madhya Pradesh (thousands of rows) on 1 Nov. Never trust
            # an empty day: skip it and pull again next run (states that never report cost
            # one request a day).
            print(f"{state} {d}: 0 records, not stored, retry next run", flush=True)
            return None
        return split_by_crop(recs)

    pulled = dict(zip(days, await asyncio.gather(*(one(d) for d in days)), strict=True))
    crops = {c for g in pulled.values() if g for c in g}
    now = datetime.now(UTC)
    for d, groups in pulled.items():
        if groups is None:
            continue
        items: list[tuple[str, str, datetime, Any]] = []
        for crop in crops:
            f = {"State": state, "Commodity": crop, "Arrival_Date": d.strftime("%d/%m/%Y")}
            items.append(
                (
                    f"mandi:history:{state}:{crop}:{d.isoformat()}",
                    mandi.public_url(mandi.HISTORY_ID, f),
                    now,
                    groups.get(crop, []),
                )
            )
        # marker last, so a half-written day is pulled again
        items.append((f"mandi:history-bulk:{state}:{d.isoformat()}", "", now, len(groups)))
        await write_many(items)
    return [r for g in pulled.values() if g for recs in g.values() for r in recs]


async def warm_state(state: str, crops: list[str]) -> None:
    t0 = time.monotonic()
    end = today_ist() - timedelta(days=1)  # history lags a day
    bulk = await bulk_history(agmark(state), [end - timedelta(days=i) for i in range(BULK_DAYS)])
    rows = mandi._parse_all(bulk, "history")
    for crop in crops:  # crops in today's feed
        cur = await mandi.current_prices(crop, agmark(state))
        rows += cur.data or []
    traded = set(crops) | {r.commodity for r in rows}
    # Backtested crops keep 30 days where the state trades them; the first BULK_DAYS are hits.
    for crop in (c for c in settings.crops if c in traded):
        hist = await mandi.history(crop, HISTORY_DAYS, end=end, state=agmark(state))
        rows += [r for h in hist for r in h.data or []]
    districts = sorted({r.district for r in rows})
    for d in districts:
        await geocode.search(f"{DISTRICT_ALIASES.get(d, d)} district, {state}, India", limit=1)
    mandis = sorted({(r.market, r.district) for r in rows})
    found = 0
    for m, d in mandis:
        found += (await geocode.locate_mandi(m, d, state)).data is not None
    print(f"{state}: {len(crops)} crops today, {len(bulk)} history rows, {len(districts)} districts, {found}/{len(mandis)} mandis located, "
          f"{time.monotonic() - t0:.0f} s", flush=True)  # fmt: skip


async def main(only: list[str], all_crops: bool) -> None:
    # From India data.gov.in answers, but big pages can be slow: allow more than live questions.
    mandi.TIMEOUT_S, mandi.RETRIES = 30.0, 2
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
    queued = await take_refresh_queue()  # agmark state spelling, crop
    for st, crop in queued:
        by_state.setdefault(OSM_NAME.get(st, st), set()).add(crop)
    # Every state, busiest first: a crop missing from today's feed can still have history.
    states = only or sorted(STATES, key=lambda s: -len(by_state.get(s, set())))
    states += [OSM_NAME.get(st, st) for st, _ in queued if OSM_NAME.get(st, st) not in states]
    print("states:", states, "queued:", queued, flush=True)
    try:
        for s in states:
            await warm_state(s, sorted(by_state.get(s, set())))
            for st, crop in queued:
                if OSM_NAME.get(st, st) == s:
                    await refresh_done(st, crop)
    finally:
        await client.aclose()
        await close_pool()


if __name__ == "__main__":
    if sys.platform == "win32":  # psycopg async can't use Windows' default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    args = sys.argv[1:]
    asyncio.run(main([a for a in args if a != "--all-crops"], "--all-crops" in args))
