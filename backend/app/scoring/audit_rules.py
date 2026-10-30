"""Deterministic data checks. Each returns findings with a reason a farmer can read.
"reject" = never ranked. "flag" = shown with a warning and kept out of the top pick,
except "wide spread", which is information only."""

import statistics
from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Literal

MAX_AGE_DAYS = 3
# Modified z-score threshold (Iglewicz & Hoaglin): |0.6745·(x−median)/MAD| > 3.5 is an outlier.
ROBUST_Z = 3.5


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: Literal["reject", "flag", "info"]
    en: str
    hi: str


def check_consistency(min_p: float, max_p: float, modal: float) -> Finding | None:
    if min_p > max_p or not (min_p <= modal <= max_p):
        return Finding(
            "inconsistent",
            "reject",
            f"Price row is self-contradictory (min {min_p:.0f}, max {max_p:.0f}, modal {modal:.0f})",
            f"भाव का डेटा आपस में मेल नहीं खाता (न्यूनतम {min_p:.0f}, अधिकतम {max_p:.0f}, मॉडल {modal:.0f})",
        )
    return None


def check_stale(arrival: date, today: date) -> Finding | None:
    age = (today - arrival).days
    if age > MAX_AGE_DAYS:
        return Finding(
            "stale",
            "flag",
            f"Price is {age} days old (limit {MAX_AGE_DAYS})",
            f"भाव {age} दिन पुराना है (सीमा {MAX_AGE_DAYS} दिन)",
        )
    return None


def check_spread(min_p: float, modal: float) -> Finding | None:
    if modal > 0 and min_p < 0.5 * modal:
        return Finding(
            "wide_spread",
            "info",
            f"Wide price spread (min {min_p:.0f} vs modal {modal:.0f}): mixed-quality lots",
            f"भाव में बड़ा अंतर (न्यूनतम {min_p:.0f}, मॉडल {modal:.0f}): अलग-अलग गुणवत्ता का माल",
        )
    return None


def robust_z(x: float, sample: list[float], min_n: int = 5) -> float | None:
    """How unusual x is against sample, in a way one bad value can't distort.
    Returns None when the sample is too small to judge."""
    if len(sample) < min_n:
        return None
    med = statistics.median(sample)
    mad = statistics.median(abs(v - med) for v in sample)
    if mad == 0:
        # All prices identical: any 20%+ move counts as extreme, a smaller one doesn't.
        return 0.0 if abs(x - med) <= 0.2 * med else float("inf")
    return 0.6745 * (x - med) / mad


def check_outlier(
    modal: float, own_30d: list[float], regional_today: list[float]
) -> Finding | None:
    """Suspect only if unusual against BOTH the mandi's own last 30 days AND today's regional
    prices. If one comparison is impossible (too little data), the other decides alone."""
    zs = [z for z in (robust_z(modal, own_30d), robust_z(modal, regional_today)) if z is not None]
    if zs and all(abs(z) > ROBUST_Z for z in zs):
        ref = statistics.median(regional_today or own_30d)
        return Finding(
            "outlier",
            "flag",
            f"Modal {modal:.0f} is far from usual (median {ref:.0f}); treated as suspect",
            f"मॉडल भाव {modal:.0f} सामान्य से बहुत अलग है (मध्य {ref:.0f}); संदिग्ध माना गया",
        )
    return None


def main_group(
    rows: list[tuple[str, str]], wanted_variety: str | None = None
) -> tuple[str, str] | None:
    """The (variety, grade) we rank on. The farmer's variety if given and present, else the
    most-reported one. Others are 'not directly comparable'."""
    if not rows:
        return None
    if wanted_variety:
        match = [r for r in rows if r[0].lower() == wanted_variety.lower()]
        if match:
            return Counter(match).most_common(1)[0][0]
    return Counter(rows).most_common(1)[0][0]


def check_comparable(variety: str, grade: str, group: tuple[str, str]) -> Finding | None:
    if (variety, grade) != group:
        return Finding(
            "not_comparable",
            "flag",
            f"{variety}/{grade} is not directly comparable with {group[0]}/{group[1]}",
            f"{variety}/{grade} की तुलना सीधे {group[0]}/{group[1]} से नहीं हो सकती",
        )
    return None
