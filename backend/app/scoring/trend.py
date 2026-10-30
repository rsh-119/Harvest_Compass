"""Recent price direction per mandi. This is a TREND, not a forecast; the UI must say so."""

import statistics
from datetime import date


def slope_per_day(points: list[tuple[date, float]], min_points: int = 5) -> float | None:
    """Least-squares slope of modal price over time, in ₹/quintal per day.
    Returns None with too few distinct days to say anything."""
    by_day: dict[date, list[float]] = {}
    for d, p in points:
        by_day.setdefault(d, []).append(p)
    if len(by_day) < min_points:
        return None
    days = sorted(by_day)
    xs = [float((d - days[0]).days) for d in days]
    ys = [statistics.median(by_day[d]) for d in days]
    return statistics.linear_regression(xs, ys).slope
