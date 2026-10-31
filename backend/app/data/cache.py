"""Postgres cache of REAL API responses. Every row keeps source_url and fetched_at.

`cached()` is the one entry point the tools use:
  fresh cache -> return it ("cache")
  else fetch live -> store -> return ("live")
  live fails -> return the old cached copy with its age ("stale_cache"), or "error" if none.
We never fill a gap with invented data.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Generic, Literal, TypeVar

from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel

from app.config import settings
from app.http import describe

log = logging.getLogger("cache")
T = TypeVar("T")
U = TypeVar("U")
Status = Literal["live", "cache", "stale_cache", "error"]


class Sourced(BaseModel, Generic[T]):
    """A tool result plus where it came from. `data` is None only when status is "error"."""

    data: T | None
    source_url: str
    fetched_at: datetime | None
    status: Status
    error: str | None = None

    def map(self, fn: Callable[[Any], U]) -> "Sourced[U]":
        return Sourced[U](
            data=None if self.data is None else fn(self.data),
            source_url=self.source_url,
            fetched_at=self.fetched_at,
            status=self.status,
            error=self.error,
        )


_pool: AsyncConnectionPool | None = None


async def get_pool() -> AsyncConnectionPool | None:
    """Open the pool once and create the table. Returns None if no DATABASE_URL (cache off)."""
    global _pool
    if _pool is None and settings.database_url:
        # 20 connections let ~100 concurrent lookups (one per mandi) finish in under a second.
        # Bounded wait: if the database is down we skip the cache rather than make farmers wait.
        _pool = AsyncConnectionPool(
            settings.database_url, min_size=1, max_size=20, open=False, timeout=10
        )
        await _pool.open()
        async with _pool.connection() as conn:
            await conn.execute(
                """CREATE TABLE IF NOT EXISTS api_cache (
                       key text PRIMARY KEY,
                       source_url text NOT NULL,
                       fetched_at timestamptz NOT NULL,
                       payload jsonb NOT NULL)"""
            )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def _read(key: str) -> tuple[Any, str, datetime] | None:
    pool = await get_pool()
    if pool is None:
        return None
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT payload, source_url, fetched_at FROM api_cache WHERE key = %s", (key,)
        )
        row = await cur.fetchone()
    return (row[0], row[1], row[2]) if row else None


async def _write(key: str, source_url: str, fetched_at: datetime, payload: Any) -> None:
    pool = await get_pool()
    if pool is None:
        return
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO api_cache (key, source_url, fetched_at, payload)
               VALUES (%s, %s, %s, %s::jsonb)
               ON CONFLICT (key) DO UPDATE
               SET source_url = EXCLUDED.source_url, fetched_at = EXCLUDED.fetched_at,
                   payload = EXCLUDED.payload""",
            (key, source_url, fetched_at, json.dumps(payload)),
        )


async def cached(
    key: str,
    source_url: str,
    ttl: timedelta | None,
    fetch: Callable[[], Awaitable[Any]],
) -> Sourced[Any]:
    """ttl=None means the value never goes stale (geocodes, road distances, past prices)."""
    try:
        hit = await _read(key)
    except Exception as e:  # database trouble must never break an answer: just skip the cache
        log.warning("cache read failed, continuing without cache: %s", e)
        hit = None
    now = datetime.now(UTC)
    if hit and (ttl is None or now - hit[2] < ttl):
        return Sourced(data=hit[0], source_url=hit[1], fetched_at=hit[2], status="cache")
    try:
        payload = await fetch()
    except Exception as e:  # any failure -> fall back to old real data, never to made-up data
        err = describe(e)[:300]
        if hit:
            return Sourced(
                data=hit[0], source_url=hit[1], fetched_at=hit[2], status="stale_cache", error=err
            )
        return Sourced(data=None, source_url=source_url, fetched_at=None, status="error", error=err)
    try:
        await _write(key, source_url, now, payload)
    except Exception as e:
        log.warning("cache write failed, answer still served live: %s", e)
    return Sourced(data=payload, source_url=source_url, fetched_at=now, status="live")
