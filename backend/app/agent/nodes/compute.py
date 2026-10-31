"""All numbers in the answer come from here: pure scoring functions, no LLM."""

from datetime import date, timedelta
from typing import Any

from app.agent.state import AgentState, Mandi
from app.agent.trace import emit
from app.clock import today_ist
from app.data.synonyms import PERISHABLE
from app.scoring.harvest_window import Day, risk, score_window
from app.scoring.net_profit import (
    Candidate,
    Costs,
    conservative_price,
    net_profit,
    rank,
    ranking_price,
)
from app.scoring.trend import slope_per_day
from app.tools.mandi import PriceRow

# MP Krishi Upaj Mandi Adhiniyam 1972, Sec 19(2): the market fee is payable by the BUYER and
# "shall not be deducted from the price payable to the seller". So the farmer's fee rate is 0.
SELLER_FEE_RATE = 0.0
# Judgement call, not data: if a farther mandi beats a nearer one by at most this much per
# quintal, recommend the nearer one (less fuel risk, less time, price may move by arrival).
NEAR_TIE_PER_Q = 50.0


def _series(history: list[PriceRow], m: Mandi, since: date) -> list[tuple[date, float]]:
    if m.row is None:
        return []
    return [
        (r.arrival_date, r.modal_price)
        for r in history
        if r.key == m.row.key
        and (r.variety, r.grade) == (m.row.variety, m.row.grade)
        and r.arrival_date >= since
    ]


def confidence(
    top_age_days: int, usable: int, has_conservative: bool, day_uncertain: bool | None
) -> tuple[str, list[str]]:
    """Rule-based: count what's weak. 0 → high, 1 → medium, 2+ → low."""
    weak = []
    if top_age_days > 1:
        weak.append(f"best price is {top_age_days} days old")
    if usable < 3:
        weak.append(f"only {usable} usable mandis to compare")
    if not has_conservative:
        weak.append("not enough recent history for a bad-day price")
    if day_uncertain:
        weak.append("weather models disagree or one is missing")
    level = "high" if not weak else "medium" if len(weak) == 1 else "low"
    return level, weak


def compute_result(state: AgentState, today: date) -> dict[str, Any]:
    i, p, qty = state["intent"], state["request"].params, state["quantity_q"]
    assert p.rate_per_km and p.capacity_q  # understand asks until both are known
    costs = Costs(qty, p.capacity_q, p.rate_per_km, SELLER_FEE_RATE, p.other_charges_per_q)
    usable = [m for m in state["mandis"] if m.usable and m.row and m.route]
    history = state["history"]
    rows: dict[str, dict[str, Any]] = {}
    cands = []
    for m in usable:
        assert m.row and m.route
        week = dict(_series(history, m, today - timedelta(days=6)))
        if m.row.arrival_date >= today - timedelta(days=6):
            week[m.row.arrival_date] = m.row.modal_price  # today's report isn't in history yet
        price = ranking_price(list(week.values()), m.row.modal_price)
        res = net_profit(price, m.route.km, costs)
        cp = conservative_price([v for _, v in _series(history, m, today - timedelta(days=14))])
        cons_net = None if cp is None else net_profit(cp, m.route.km, costs).net_per_quintal
        cands.append(Candidate(m.key, res.net_per_quintal, cons_net, m.route.km))
        rows[m.key] = {
            "market": m.market,
            "district": m.district,
            "variety": m.row.variety,
            "grade": m.row.grade,
            "modal_price": m.row.modal_price,
            "price_used": round(price),
            "price_days": len(week) if len(week) >= 3 else 1,
            "min_price": m.row.min_price,
            "max_price": m.row.max_price,
            "arrival_date": m.row.arrival_date.isoformat(),
            "age_days": (today - m.row.arrival_date).days,
            "price_source": m.row.source,
            "road_km": round(m.route.km, 1),
            "drive_min": round(m.route.minutes),
            "lat": m.location.lat if m.location else None,
            "lon": m.location.lon if m.location else None,
            "trips": res.trips,
            "transport_total": round(res.transport_total),
            "mandi_charges": round(res.mandi_charges),
            "net_per_quintal": round(res.net_per_quintal),
            "net_total": round(res.net_total),
            "conservative_price": None if cp is None else round(cp),
            "conservative_net_per_quintal": None if cons_net is None else round(cons_net),
            "info": [f.en for f in m.findings],
        }
    order = rank(cands, NEAR_TIE_PER_Q)
    ranked = [rows[c.key] for c in order]
    excluded = [
        {
            "market": m.market,
            "district": m.district,
            "reasons": [f.en for f in m.findings if f.severity != "info"],
            "reasons_hi": [f.hi for f in m.findings if f.severity != "info"],
        }
        for m in state["mandis"]
        if not m.usable
    ]
    out: dict[str, Any] = {
        "crop": i.crop,
        "quantity_q": qty,
        "group": state.get("group"),
        "ranking": ranked[:10],
        "excluded": excluded,
        "radius_km": state["radius_km"],
        "notes": state["notes"],
        "costs": {
            "rate_per_km": p.rate_per_km,
            "capacity_q": p.capacity_q,
            "other_charges_per_q": p.other_charges_per_q,
            "seller_fee_rate": SELLER_FEE_RATE,
            # The fee rule above is cited for MP only; elsewhere the UI says it isn't included.
            "fee_rule_state": "Madhya Pradesh",
        },
        "region": state.get("region"),
    }
    if not ranked:
        out["best"] = None
        return out
    best = ranked[0]
    out["best"] = best
    top = max(ranked, key=lambda r: r["net_per_quintal"])
    if top is not best:
        out["nearer_pick"] = {
            "skipped": top["market"],
            "extra_per_quintal": top["net_per_quintal"] - best["net_per_quintal"],
            "extra_km": round(top["road_km"] - best["road_km"]),
        }
    if len(ranked) > 1:
        r = ranked[1]
        out["runner_up"] = r
        out["runner_up_gap"] = {
            "net_per_quintal": best["net_per_quintal"] - r["net_per_quintal"],
            "price": best["price_used"] - r["price_used"],
            "transport_per_quintal": round((r["transport_total"] - best["transport_total"]) / qty),
        }

    best_mandi = next(m for m in usable if m.key == order[0].key)
    slope = slope_per_day(_series(history, best_mandi, today - timedelta(days=14)))
    out["trend_per_day"] = None if slope is None else round(slope, 1)

    day_uncertain: bool | None = None
    wx = state.get("weather")
    if wx is not None and wx.data:
        models = {
            m: [Day(date.fromisoformat(d["day"]), d["precip_mm"], d["precip_prob"]) for d in days]
            for m, days in wx.data.items()
        }
        start = max(i.ready_from or today, today)
        end = i.ready_to or start + timedelta(days=6)
        scored, uncovered = score_window(models, start, end, i.crop in PERISHABLE)
        out["harvest_days"] = [
            {
                "day": s.day.isoformat(),
                "score": round(s.score, 2),
                "both_dry": s.both_dry,
                "uncertain": s.uncertain,
                "reasons": s.reasons,
            }
            for s in scored[:3]
        ]
        out["beyond_forecast"] = [d.isoformat() for d in uncovered]
        day_uncertain = scored[0].uncertain if scored else None

        if any(s["step"] == "wait" for s in state["plan"]):
            n = i.wait_days or 3
            wait_days = [today + timedelta(days=k) for k in range(1, n + 1)]
            risks = [risk(d) for days in models.values() for d in days if d.day in wait_days]
            known = [r for r in risks if r is not None]
            out["wait"] = {
                "days": n,
                "trend_change_per_quintal": None if slope is None else round(slope * n),
                "max_rain_risk": None if not known else round(max(known), 2),
                "label": "trend, not forecast",
            }
    out["confidence"], out["confidence_reasons"] = confidence(
        best["age_days"],
        len(ranked),
        best["conservative_net_per_quintal"] is not None,
        day_uncertain,
    )
    cur = state.get("current")
    out["sources"] = {
        "prices_today": None
        if cur is None
        else {
            "url": cur.source_url,
            "status": cur.status,
            "fetched_at": cur.fetched_at.isoformat() if cur.fetched_at else None,
        },
        "weather": None
        if wx is None
        else {
            "url": wx.source_url,
            "status": wx.status,
            "fetched_at": wx.fetched_at.isoformat() if wx.fetched_at else None,
            "attribution": "Weather data by Open-Meteo.com (CC BY 4.0)",
        },
        "routing": "OSRM (router.project-osrm.org), OpenStreetMap data © OSM contributors (ODbL)",
        "history": "data.gov.in Variety-wise Daily Market Prices (resource 35985678-0d79-46b4-9ed6-6f13308a1d24)",
    }
    return out


async def compute(state: AgentState) -> dict[str, Any]:
    result = compute_result(state, today_ist())
    best = result.get("best")
    if best is None:
        emit(
            "decision",
            "No usable mandi found: not enough trustworthy data to recommend",
            "भरोसेमंद डेटा वाली कोई मंडी नहीं मिली",
            result=None,
        )
    else:
        if np := result.get("nearer_pick"):
            emit(
                "decision",
                f"{np['skipped']} is only ₹{np['extra_per_quintal']}/q better but "
                f"{np['extra_km']} km farther, so the nearer {best['market']} is recommended",
                f"{np['skipped']} सिर्फ़ ₹{np['extra_per_quintal']}/क्विं. ज़्यादा देती है पर "
                f"{np['extra_km']} km दूर है, इसलिए पास वाली {best['market']}",
            )
        emit(
            "decision",
            f"Best: {best['market']} — net ₹{best['net_per_quintal']}/q, total ₹{best['net_total']} "
            f"(confidence {result['confidence']})",
            f"सबसे अच्छी: {best['market']} — ₹{best['net_per_quintal']} प्रति क्विंटल शुद्ध",
            best=best["market"],
        )
    return {"result": result}
