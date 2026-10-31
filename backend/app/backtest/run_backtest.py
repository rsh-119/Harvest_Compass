"""Backtest on real history: would following Harvest Compass have paid?

For each real OSM village and each day t in the window:
  decide   using only rows dated <= t, with the agent's own audit and ranking (audit_mandis, rank)
  realise  the chosen mandi's modal price on t+1, same variety and grade (the farmer arrives
           next day). No t+1 report there -> the decision is counted as "unrealisable" and skipped.
  baseline nearest mandi (by road) that reports on t+1, same group
  oracle   best net mandi in hindsight on t+1
Transport is a run parameter swept over several values (₹ per quintal per road-km, one way;
it doubles for the round trip). It is NOT a measured local rate, and the report says so.

Run:  uv run python -m app.backtest.run_backtest [--days 60] [--crop Soyabean]
Results are stored in Postgres (table backtest_runs) with parameters and sources.
"""

import argparse
import asyncio
import json
import statistics
import sys
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.agent.nodes.audit import audit_mandis
from app.agent.nodes.compute import NEAR_TIE_PER_Q
from app.agent.nodes.execute import latest_rows
from app.agent.state import Mandi
from app.clock import today_ist
from app.config import settings
from app.data.cache import close_pool, get_pool
from app.data.synonyms import PERISHABLE
from app.http import client
from app.scoring.net_profit import Candidate, rank, ranking_price
from app.tools import geocode, mandi, routing
from app.tools.mandi import PriceRow

# Real villages and small towns around Indore, Ujjain, Dewas and Dhar (names only; coordinates
# come from OpenStreetMap, and any name OSM can't resolve is dropped and listed in the report).
VILLAGES = [
    "Sanwer",
    "Depalpur",
    "Hatod",
    "Betma",
    "Gautampura",
    "Manpur",
    "Simrol",
    "Kshipra",
    "Tarana",
    "Ghatiya",
    "Khachrod",
    "Badnagar",
    "Mahidpur",
    "Sonkatch",
    "Tonk Khurd",
    "Bagli",
    "Kannod",
    "Badnawar",
    "Sardarpur",
    "Dharampuri",
    "Kukshi",
    "Barwaha",
    "Sanawad",
    "Kasrawad",
    "Ichhawar",
    "Shujalpur",
    "Maksi",
    "Agar",
    "Nalkheda",
    "Pithampur",
]
TRANSPORT_SWEEP = (0.5, 1.0, 2.0)  # ₹ per quintal per km; e.g. ₹30/km for 25 q = 1.2
# What price a mandi is ranked on. "today" = latest modal (what the agent did first);
# "median7" = median of the mandi's own modal prices over the last 7 days (needs 3+ reports,
# else its latest modal), which damps one-day spikes that don't last until tomorrow.
# "median7_near" = median7 plus the near-tie rule (what the live agent does).
STRATEGIES = ("today", "median7", "median7_near")


def _net(price: float, km: float, c: float) -> float:
    return price - 2 * km * c


async def _setup(crop: str, days: int, end: date) -> dict[str, Any]:
    chunks = await mandi.history(crop, days + 31, end)  # +31 so day one has 30 days behind it
    hist = [r for s in chunks for r in (s.data or [])]
    keys = {(r.market, r.district) for r in hist}
    places = await asyncio.gather(*(geocode.locate_mandi(m, d, settings.state) for m, d in keys))
    located = {
        f"{m.lower()}|{d.lower()}": (m, d, p.data)
        for (m, d), p in zip(keys, places, strict=True)
        if p.data
    }
    villages = []
    for name in VILLAGES:  # sequential: Nominatim allows 1 request/second
        res = await geocode.search(f"{name}, {settings.state}, India", limit=1)
        if res.data:
            villages.append((name, res.data[0]))
    out = []
    for name, v in villages:
        near = [
            (k, m, d, p)
            for k, (m, d, p) in located.items()
            if routing.haversine_km((v.lat, v.lon), (p.lat, p.lon)) <= settings.radius_km
        ]
        routes = await routing.road_distances((v.lat, v.lon), [(p.lat, p.lon) for *_, p in near])
        out.append(
            (name, v, [(k, m, d, p, r.data) for (k, m, d, p), r in zip(near, routes, strict=True)])
        )
    return {
        "hist": hist,
        "villages": out,
        "dropped_villages": [n for n in VILLAGES if n not in {x for x, _ in villages}],
    }


def _decide(setup: dict[str, Any], crop: str, t: date) -> list[dict[str, Any]]:
    """One record per village for day t (or none if it can't be realised)."""
    hist: list[PriceRow] = setup["hist"]
    upto = [r for r in hist if t - timedelta(days=30) <= r.arrival_date <= t]
    own: dict[tuple[str, str, str], list[tuple[date, float]]] = {}
    for r in upto:
        own.setdefault(("|".join(r.key), r.variety, r.grade), []).append(
            (r.arrival_date, r.modal_price)
        )
    rows_t = latest_rows([], upto)
    nxt: dict[tuple[str, str, str], float] = {
        ("|".join(r.key), r.variety, r.grade): r.modal_price
        for r in hist
        if r.arrival_date == t + timedelta(days=1)
    }
    out = []
    for vname, _, near in setup["villages"]:
        ms = [Mandi(key=k, market=m, district=d, location=p, route=rt) for k, m, d, p, rt in near]
        ms, group = audit_mandis(ms, rows_t, upto, None, crop in PERISHABLE, t)
        if group is None:
            continue
        reachable = [m for m in ms if m.route and m.location and not _too_far(m, crop)]
        tomorrow = {m.key: nxt[(m.key, *group)] for m in reachable if (m.key, *group) in nxt}
        if not tomorrow:
            continue
        km = {m.key: m.route.km for m in ms if m.route}
        nearest = min((m for m in reachable if m.key in tomorrow), key=lambda m: km[m.key])
        usable = [m for m in ms if m.usable and m.row and m.route]
        rec: dict[str, Any] = {"village": vname, "day": t.isoformat(), "group": group, "by_c": {}}
        for strat in STRATEGIES:
            for c in TRANSPORT_SWEEP:
                if not usable:
                    break
                ranked = rank(
                    [
                        Candidate(
                            m.key,
                            _net(_score_price(m, strat, own, t), km[m.key], c),
                            None,
                            km[m.key],
                        )
                        for m in usable
                    ],
                    NEAR_TIE_PER_Q if strat == "median7_near" else 0.0,
                )
                chosen = next(m for m in usable if m.key == ranked[0].key)
                if chosen.key not in tomorrow:
                    rec["by_c"][(strat, c)] = {"unrealisable": True, "chosen": chosen.market}
                    continue
                assert chosen.route and nearest.route and chosen.row
                got = _net(tomorrow[chosen.key], chosen.route.km, c)
                base = _net(tomorrow[nearest.key], nearest.route.km, c)
                oracle = max(_net(p, km[k], c) for k, p in tomorrow.items())
                rec["by_c"][(strat, c)] = {
                    "chosen": chosen.market,
                    "chosen_km": round(chosen.route.km, 1),
                    "price_t": chosen.row.modal_price,
                    "price_t1": tomorrow[chosen.key],
                    "baseline": nearest.market,
                    "baseline_km": round(nearest.route.km, 1),
                    "gain": round(got - base, 1),
                    "regret": round(oracle - got, 1),
                }
        if rec["by_c"]:
            out.append(rec)
    return out


def _score_price(
    m: Mandi, strat: str, own: dict[tuple[str, str, str], list[tuple[date, float]]], t: date
) -> float:
    assert m.row
    if strat == "today":
        return m.row.modal_price
    recent = [v for d, v in own.get((m.key, m.row.variety, m.row.grade), []) if (t - d).days < 7]
    return ranking_price(recent, m.row.modal_price)


def _too_far(m: Mandi, crop: str) -> bool:
    cap = settings.max_drive_min_perishable if crop in PERISHABLE else settings.max_drive_min
    return m.route is not None and m.route.minutes > cap


def summarise(records: list[dict[str, Any]], strat: str, c: float) -> dict[str, Any]:
    key = (strat, c)
    done = [r["by_c"][key] for r in records if key in r["by_c"]]
    real = [d for d in done if not d.get("unrealisable")]
    gains = [d["gain"] for d in real]
    if len(gains) < 4:
        return {
            "strategy": strat,
            "transport_per_q_km": c,
            "decisions": len(real),
            "note": "too few",
        }
    q1, med, q3 = statistics.quantiles(gains, n=4, method="inclusive")
    losing = sorted(
        (r | r["by_c"][key] for r in records if key in r["by_c"] and "gain" in r["by_c"][key]),
        key=lambda x: x["gain"],
    )[:3]
    return {
        "strategy": strat,
        "transport_per_q_km": c,
        "decisions": len(real),
        "unrealisable": len(done) - len(real),
        "median_gain": round(med, 1),
        "mean_gain": round(statistics.fmean(gains), 1),
        "iqr": [round(q1, 1), round(q3, 1)],
        "pct_positive": round(100 * sum(g > 0 for g in gains) / len(gains), 1),
        "pct_same_as_nearest": round(100 * sum(g == 0 for g in gains) / len(gains), 1),
        "mean_regret": round(statistics.fmean(d["regret"] for d in real), 1),
        "losing_examples": [
            {
                "village": x["village"],
                "day": x["day"],
                "chosen": f"{x['chosen']} ({x['chosen_km']} km)",
                "baseline": f"{x['baseline']} ({x['baseline_km']} km)",
                "gain": x["gain"],
                "why": f"price at {x['chosen']} moved {x['price_t']:.0f} → {x['price_t1']:.0f} overnight",
            }
            for x in losing
            if x["gain"] < 0
        ],
    }


async def run(crop: str, days: int) -> dict[str, Any]:
    end = today_ist() - timedelta(days=1)  # last day with history; t+1 must exist, so t < end
    setup = await _setup(crop, days, end)
    records = []
    for k in range(days, 0, -1):
        records += _decide(setup, crop, end - timedelta(days=k))
    result = {
        "crop": crop,
        "window": [(end - timedelta(days=days)).isoformat(), end.isoformat()],
        "villages": [n for n, _, _ in setup["villages"]],
        "dropped_villages": setup["dropped_villages"],
        "summaries": [summarise(records, s, c) for s in STRATEGIES for c in TRANSPORT_SWEEP],
        "params": {
            "radius_km": settings.radius_km,
            "transport_sweep_per_q_km": TRANSPORT_SWEEP,
            "transport_note": "assumed sweep, not measured local hire rates",
            "decision": "agent audit + rank on data dated <= t; realised at t+1",
            "strategies": STRATEGIES,
        },
        "sources": {
            "prices": mandi.public_url(
                mandi.HISTORY_ID, {"State": settings.state, "Commodity": crop}
            ),
            "places": "OpenStreetMap Nominatim",
            "roads": "OSRM router.project-osrm.org",
        },
    }
    await _store(result)
    return result


async def _store(result: dict[str, Any]) -> None:
    pool = await get_pool()
    if pool is None:
        return
    async with pool.connection() as conn:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS backtest_runs (
                   id serial PRIMARY KEY, run_at timestamptz NOT NULL, crop text NOT NULL,
                   result jsonb NOT NULL)"""
        )
        await conn.execute(
            "INSERT INTO backtest_runs (run_at, crop, result) VALUES (%s, %s, %s::jsonb)",
            (datetime.now(UTC), result["crop"], json.dumps(result)),
        )


async def latest() -> list[dict[str, Any]]:
    """Newest stored run per crop (for the UI's results card)."""
    pool = await get_pool()
    if pool is None:
        return []
    async with pool.connection() as conn:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS backtest_runs (
                   id serial PRIMARY KEY, run_at timestamptz NOT NULL, crop text NOT NULL,
                   result jsonb NOT NULL)"""
        )
        cur = await conn.execute(
            """SELECT DISTINCT ON (crop) run_at, result FROM backtest_runs
               ORDER BY crop, run_at DESC"""
        )
        return [{"run_at": r[0].isoformat(), **r[1]} for r in await cur.fetchall()]


async def _main(crops: list[str], days: int) -> None:
    for crop in crops:
        res = await run(crop, days)
        print(json.dumps({k: res[k] for k in ("crop", "window", "summaries")}, indent=1))
        print("villages:", len(res["villages"]), "dropped:", res["dropped_villages"])
    await client.aclose()
    await close_pool()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--crop", action="append")
    a = ap.parse_args()
    if sys.platform == "win32":  # psycopg async can't use Windows' default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(_main(a.crop or settings.crops, a.days))
