"""Which days inside the farmer's readiness window are safest to harvest (day d) and
transport (day d+1), judged by two independent weather models.

Rain risk for one model on one day = the larger of
  rain probability (0–1) and rain amount / 5 mm (capped at 1).
# ponytail: 5 mm "wet enough to spoil a cut crop" is a heuristic, tune with agronomist input.
A day's score = harvest-day risk + weight × next-day (transport) risk, worst model taken.
Perishables (onion) weight the transport day fully, grains by half.
A day is also uncertain if the transport day has no forecast.
Models disagree on a day when one calls it dry and the other doesn't, or their risks differ by 0.3+.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

DRY_MM, DRY_PROB = 1.0, 40.0
WET_MM = 5.0
DISAGREE = 0.3


@dataclass(frozen=True)
class Day:
    day: date
    mm: float | None
    prob: float | None


@dataclass
class DayScore:
    day: date
    score: float
    both_dry: bool
    uncertain: bool
    reasons: list[str] = field(default_factory=list)
    transport_known: bool = True


def risk(d: Day) -> float | None:
    parts = [
        p
        for p in (
            None if d.prob is None else d.prob / 100,
            None if d.mm is None else min(d.mm / WET_MM, 1.0),
        )
        if p is not None
    ]
    return max(parts) if parts else None


def is_dry(d: Day) -> bool:
    return d.mm is not None and d.mm < DRY_MM and (d.prob is None or d.prob < DRY_PROB)


def score_window(
    models: dict[str, list[Day]], start: date, end: date, perishable: bool
) -> tuple[list[DayScore], list[date]]:
    """Returns (scored days best first, window days with no forecast). Days the forecast doesn't
    cover are listed, never scored."""
    by_model = {m: {d.day: d for d in days} for m, days in models.items()}
    weight = 1.0 if perishable else 0.5
    scored, uncovered = [], []
    day = start
    while day <= end:
        today = {
            m: dd[day] for m, dd in by_model.items() if day in dd and risk(dd[day]) is not None
        }
        if not today:
            uncovered.append(day)
            day += timedelta(days=1)
            continue
        reasons: list[str] = []
        per_model = {}
        missing_next = False
        for m, d in today.items():
            r = risk(d) or 0.0
            nxt = by_model[m].get(day + timedelta(days=1))
            nr = risk(nxt) if nxt else None
            if nr is None:  # unknown is not the same as dry: don't let it look safe
                missing_next = True
                reasons.append(f"{m}: no forecast for transport day")
            per_model[m] = r + weight * (nr or 0.0)
        dry = [is_dry(d) for d in today.values()]
        disagree = len(today) >= 2 and (
            any(dry) != all(dry) or max(per_model.values()) - min(per_model.values()) >= DISAGREE
        )
        if len(today) < 2:
            reasons.append("only one weather model available")
        if disagree:
            reasons.append("weather models disagree")
        uncertain = missing_next or len(today) < 2 or disagree
        scored.append(
            DayScore(
                day,
                max(per_model.values()),
                all(dry) and len(today) >= 2,
                uncertain,
                reasons,
                transport_known=not missing_next,
            )
        )
        day += timedelta(days=1)
    # Prefer days both models call dry, then confident days, then days whose transport-day
    # forecast exists (its unknown risk was counted as 0), then lowest risk, then earliest.
    scored.sort(
        key=lambda s: (not s.both_dry, s.uncertain, not s.transport_known, round(s.score, 3), s.day)
    )
    return scored, uncovered
