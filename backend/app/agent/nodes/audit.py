"""Check every mandi's data before it can be ranked. Rules live in scoring/audit_rules.py.
A mandi is usable only if nothing rejected or flagged it ("info" findings are only shown)."""

from datetime import date, timedelta
from typing import Any

from app.agent.state import AgentState, Mandi
from app.agent.trace import emit
from app.clock import today_ist
from app.config import settings
from app.data.synonyms import PERISHABLE
from app.scoring import audit_rules as rules
from app.scoring.audit_rules import Finding
from app.tools.mandi import PriceRow


def _check_place(m: Mandi, cap_min: float) -> Finding | None:
    if m.location is None:
        return Finding(
            "unlocated",
            "reject",
            f"Could not find {m.market} on the map; excluded",
            f"{m.market} नक्शे पर नहीं मिली; छोड़ दी गई",
        )
    if m.route is None:
        return Finding(
            "no_route",
            "reject",
            f"No road route found to {m.market}; excluded",
            f"{m.market} तक सड़क का रास्ता नहीं मिला",
        )
    if m.route.minutes > cap_min:
        return Finding(
            "too_far",
            "reject",
            f"{m.route.minutes / 60:.1f} h drive is over the {cap_min / 60:.1f} h limit",
            f"{m.route.minutes / 60:.1f} घंटे का रास्ता, सीमा {cap_min / 60:.1f} घंटे",
        )
    return None


def audit_mandis(
    mandis: list[Mandi],
    rows: list[PriceRow],
    history: list[PriceRow],
    wanted_variety: str | None,
    perishable: bool,
    today: date,
) -> tuple[list[Mandi], tuple[str, str] | None]:
    """Pure function (no I/O), so it can be tested on its own."""
    cap = settings.max_drive_min_perishable if perishable else settings.max_drive_min
    keys = {m.key for m in mandis if m.location}
    by_key: dict[str, list[PriceRow]] = {}
    for r in rows:
        by_key.setdefault("|".join(r.key), []).append(r)
    fresh = [
        r
        for r in rows
        if "|".join(r.key) in keys and (today - r.arrival_date).days <= rules.MAX_AGE_DAYS
    ]
    group = rules.main_group(
        [(r.variety, r.grade) for r in fresh]
        or [(r.variety, r.grade) for r in rows if "|".join(r.key) in keys],
        wanted_variety,
    )
    regional = [r.modal_price for r in fresh if (r.variety, r.grade) == group]
    since = today - timedelta(days=30)
    own: dict[str, list[float]] = {}
    for r in history:
        if group and (r.variety, r.grade) == group and r.arrival_date >= since:
            own.setdefault("|".join(r.key), []).append(r.modal_price)

    for m in mandis:
        findings: list[Finding] = []
        if f := _check_place(m, cap):
            findings.append(f)
        mrows = by_key.get(m.key, [])
        same = [r for r in mrows if group and (r.variety, r.grade) == group]
        if same:
            m.row = max(same, key=lambda r: r.arrival_date)
        elif mrows and group:
            m.row = max(mrows, key=lambda r: r.arrival_date)
            if f := rules.check_comparable(m.row.variety, m.row.grade, group):
                findings.append(f)
        if m.row:
            r = m.row
            for f in (
                rules.check_consistency(r.min_price, r.max_price, r.modal_price),
                rules.check_stale(r.arrival_date, today),
                rules.check_outlier(r.modal_price, own.get(m.key, []), regional),
                rules.check_spread(r.min_price, r.modal_price),
            ):
                if f:
                    findings.append(f)
        m.findings = findings
        m.usable = m.row is not None and all(f.severity == "info" for f in findings)
    return mandis, group


async def audit(state: AgentState) -> dict[str, Any]:
    i = state["intent"]
    mandis, group = audit_mandis(
        state["mandis"],
        state["rows"],
        state["history"],
        i.variety,
        i.crop in PERISHABLE,
        today_ist(),
    )
    for m in mandis:
        for f in m.findings:
            if f.severity == "reject":
                emit(
                    "audit_reject",
                    f"{m.market}: {f.en}",
                    f"{m.market}: {f.hi}",
                    mandi=m.key,
                    rule=f.rule,
                )
            elif f.severity == "flag":
                emit(
                    "audit_flag",
                    f"{m.market}: {f.en}",
                    f"{m.market}: {f.hi}",
                    mandi=m.key,
                    rule=f.rule,
                )
    usable = sum(m.usable for m in mandis)
    emit(
        "compute",
        f"Audit done: {usable} usable of {len(mandis)} mandis; comparing {group}",
        f"जाँच पूरी: {len(mandis)} में से {usable} मंडियाँ भरोसेमंद",
        usable=usable,
        group=group,
    )
    return {"mandis": mandis, "group": group}


def needs_repair(state: AgentState) -> bool:
    usable = sum(m.usable for m in state["mandis"])
    return usable < 3 and state["repairs"] < 2 and state["radius_km"] < settings.max_radius_km
