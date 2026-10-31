"""One row per /ask: time taken, outcome, whether the agent had to repair, and the full trace.
Gives real per-request p50/p95 and fallback rate instead of numbers from a one-off test run.
No IP or visitor id is stored."""

import json
import logging
from typing import Any

from app.data.cache import get_pool

log = logging.getLogger("request_log")
_ready = False


def summarise(events: list[dict[str, Any]], final: dict[str, Any]) -> dict[str, Any]:
    """Outcome and fallback flag from the trace. Fallback = any repair step happened."""
    outcome = (
        "error"
        if not final
        else "clarify"
        if final.get("clarify")
        else "answer"
        if final.get("answer")
        else "none"
    )
    result = final.get("result") or {}
    return {
        "outcome": outcome,
        "fallback": any(e.get("event") == "repair" for e in events),
        "invented": result.get("invented_numbers"),
    }


async def _ensure(conn: Any) -> None:
    global _ready
    if not _ready:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS request_log (
                   id bigserial PRIMARY KEY,
                   at timestamptz NOT NULL DEFAULT now(),
                   ms integer NOT NULL,
                   outcome text NOT NULL,
                   fallback boolean NOT NULL,
                   invented integer,
                   trace jsonb NOT NULL)"""
        )
        _ready = True


async def record(ms: int, events: list[dict[str, Any]], final: dict[str, Any]) -> None:
    """Best effort: a logging failure must never break the farmer's answer."""
    try:
        pool = await get_pool()
        if pool is None:
            return
        s = summarise(events, final)
        async with pool.connection() as conn:
            await _ensure(conn)
            await conn.execute(
                "INSERT INTO request_log (ms, outcome, fallback, invented, trace)"
                " VALUES (%s, %s, %s, %s, %s::jsonb)",
                (ms, s["outcome"], s["fallback"], s["invented"], json.dumps(events, default=str)),
            )
    except Exception:
        log.exception("request log failed")


async def stats(days: int = 7) -> dict[str, Any]:
    pool = await get_pool()
    if pool is None:
        return {"requests": 0}
    async with pool.connection() as conn:
        await _ensure(conn)
        cur = await conn.execute(
            """SELECT count(*),
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY ms),
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY ms),
                      avg(fallback::int),
                      count(*) FILTER (WHERE outcome = 'error'),
                      coalesce(sum(invented), 0)
               FROM request_log WHERE at > now() - make_interval(days => %s)""",
            (days,),
        )
        row = await cur.fetchone()
    assert row
    n, p50, p95, fb, errors, invented = row
    if not n:
        return {"days": days, "requests": 0}
    return {
        "days": days,
        "requests": n,
        "p50_ms": round(p50),
        "p95_ms": round(p95),
        "fallback_rate": round(float(fb), 3),
        "errors": errors,
        "invented_numbers": invented,
    }
