"""Mandi prices from data.gov.in (Agmarknet). Verified resources and quirks: docs/DATA_SOURCES.md.

- Today's prices: the "current daily price" resource (lowercase field names, numeric prices).
- History (trend, conservative price, backtest): the "variety-wise" resource (Capitalised
  fields, prices as strings). It lags by a day, so it never has today's rows.
"""

import asyncio
from datetime import date, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlencode

from pydantic import BaseModel

from app.clock import today_ist
from app.config import settings
from app.data.cache import Sourced, cached
from app.data.synonyms import normalize_market
from app.http import request_json

CURRENT_ID = "9ef84268-d588-465a-a308-a864a43d0070"
HISTORY_ID = "35985678-0d79-46b4-9ed6-6f13308a1d24"
BASE = "https://api.data.gov.in/resource/"
PAGE = 1000


class PriceRow(BaseModel):
    market: str
    district: str
    commodity: str
    variety: str
    grade: str
    arrival_date: date
    min_price: float
    max_price: float
    modal_price: float
    source: Literal["current", "history"]

    @property
    def key(self) -> tuple[str, str]:
        """Each yard is its own mandi: (normalised market, district)."""
        return normalize_market(self.market), self.district.strip().lower()


def public_url(resource: str, filters: dict[str, str]) -> str:
    """The request URL we show users, without the API key."""
    params = {"format": "json", **{f"filters[{k}]": v for k, v in filters.items()}}
    return f"{BASE}{resource}?{urlencode(params)}"


def parse_row(r: dict[str, Any], source: Literal["current", "history"]) -> PriceRow | None:
    """Both resources -> one shape. Returns None for rows we can't parse (never guess a value)."""

    def get(k: str) -> Any:
        # history uses 'Arrival_Date', 'Modal_Price', ...; current uses 'arrival_date', ...
        return r.get(k if source == "current" else k.title())

    try:
        return PriceRow(
            market=str(get("market")),
            district=str(get("district")),
            commodity=str(get("commodity")),
            variety=str(get("variety")),
            grade=str(get("grade")),
            arrival_date=datetime.strptime(str(get("arrival_date")), "%d/%m/%Y").date(),
            min_price=float(get("min_price")),
            max_price=float(get("max_price")),
            modal_price=float(get("modal_price")),
            source=source,
        )
    except (TypeError, ValueError):
        return None


async def _fetch_all(resource: str, filters: dict[str, str]) -> list[dict[str, Any]]:
    """Page through every matching record."""
    records: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = {
            "api-key": settings.data_gov_in_api_key,
            "format": "json",
            "limit": PAGE,
            "offset": offset,
            **{f"filters[{k}]": v for k, v in filters.items()},
        }
        # data.gov.in normally answers in ~1 s but sometimes hangs indefinitely. A short timeout
        # plus the retry in request_json beats waiting on a hung request (measured in M2).
        body = await request_json("GET", BASE + resource, params=params, timeout=20)
        batch = body.get("records", [])
        records += batch
        offset += PAGE
        if len(batch) < PAGE or offset >= int(body.get("total", 0)):
            return records


def _parse_all(
    records: list[dict[str, Any]], source: Literal["current", "history"]
) -> list[PriceRow]:
    return [row for r in records if (row := parse_row(r, source))]


async def current_prices(commodity: str, state: str = settings.state) -> Sourced[list[PriceRow]]:
    filters = {"state.keyword": state, "commodity": commodity}
    today = today_ist().isoformat()
    res = await cached(
        f"mandi:current:{state}:{commodity}:{today}",
        public_url(CURRENT_ID, filters),
        timedelta(minutes=30),
        lambda: _fetch_all(CURRENT_ID, filters),
    )
    return res.map(lambda recs: _parse_all(recs, "current"))


async def history_day(
    commodity: str, day: date, state: str = settings.state
) -> Sourced[list[PriceRow]]:
    filters = {"State": state, "Commodity": commodity, "Arrival_Date": day.strftime("%d/%m/%Y")}
    # Late reports can still arrive for recent days. Older days are final, so cache forever.
    ttl = None if (today_ist() - day).days > 3 else timedelta(hours=2)
    res = await cached(
        f"mandi:history:{state}:{commodity}:{day.isoformat()}",
        public_url(HISTORY_ID, filters),
        ttl,
        lambda: _fetch_all(HISTORY_ID, filters),
    )
    return res.map(lambda recs: _parse_all(recs, "history"))


async def history(
    commodity: str, days: int, end: date | None = None, state: str = settings.state
) -> list[Sourced[list[PriceRow]]]:
    """One cached call per day, so a 90-day window costs data.gov.in 90 calls once, then 0."""
    end = end or today_ist() - timedelta(days=1)
    sem = asyncio.Semaphore(4)  # be polite to data.gov.in

    async def one(d: date) -> Sourced[list[PriceRow]]:
        async with sem:
            return await history_day(commodity, d, state)

    return await asyncio.gather(*(one(end - timedelta(days=i)) for i in range(days)))
