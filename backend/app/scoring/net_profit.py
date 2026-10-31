"""Net rupees per quintal after transport and mandi charges. Pure maths, no I/O, no LLM."""

import math
import statistics
from dataclasses import dataclass


@dataclass(frozen=True)
class Costs:
    quantity_q: float  # quintals the farmer is selling
    capacity_q: float  # quintals one vehicle trip carries
    rate_per_km: float  # ₹ per km for the vehicle (farmer-editable)
    fee_rate: float  # mandi fee the SELLER pays, as a fraction of sale value. 0 in MP (Sec 19(2))
    other_per_q: float = 0.0  # hammali/weighing ₹ per quintal, as the farmer enters it


@dataclass(frozen=True)
class NetResult:
    trips: int
    transport_total: float
    mandi_charges: float
    gross_total: float
    net_total: float
    net_per_quintal: float


def net_profit(price: float, road_km: float, c: Costs) -> NetResult:
    """trips = ceil(qty / capacity). Transport is a round trip: trips × 2 × km × rate.
    Mandi charges = price × qty × fee_rate + other charges × qty.
    Net/q = price − (transport + charges) / qty."""
    if c.quantity_q <= 0 or c.capacity_q <= 0:
        raise ValueError("quantity and vehicle capacity must be positive")
    if min(price, road_km, c.rate_per_km, c.fee_rate, c.other_per_q) < 0:
        raise ValueError("price, distance, rate and fee must not be negative")
    trips = math.ceil(c.quantity_q / c.capacity_q)
    transport = trips * 2 * road_km * c.rate_per_km
    charges = price * c.quantity_q * c.fee_rate + c.other_per_q * c.quantity_q
    gross = price * c.quantity_q
    net_total = gross - transport - charges
    return NetResult(trips, transport, charges, gross, net_total, net_total / c.quantity_q)


def conservative_price(recent_modals: list[float], min_days: int = 5) -> float | None:
    """25th percentile of this mandi's own modal prices over the last 14 days:
    "a bad day at this mandi recently". With fewer than `min_days` days we don't guess."""
    if len(recent_modals) < min_days:
        return None
    return statistics.quantiles(recent_modals, n=4, method="inclusive")[0]


def ranking_price(last7: list[float], latest: float) -> float:
    """Median of the mandi's own modal prices over the last 7 days (3+ reports), else the latest.
    The backtest showed one-day spikes often don't last until the farmer arrives."""
    return statistics.median(last7) if len(last7) >= 3 else latest


@dataclass(frozen=True)
class Candidate:
    key: str
    net_per_quintal: float
    conservative_net_per_quintal: float | None
    road_km: float = 0.0


def rank(cands: list[Candidate], near_tie: float = 0.0) -> list[Candidate]:
    """Best net first. Conservative net only breaks exact ties (a missing one sorts last).
    Then, among mandis within `near_tie` ₹/q of the best, the nearest goes first:
    a long trip for a few rupees isn't worth the risk."""
    s = sorted(
        cands,
        key=lambda c: (
            -round(c.net_per_quintal, 2),
            -(
                c.conservative_net_per_quintal
                if c.conservative_net_per_quintal is not None
                else -math.inf
            ),
        ),
    )
    if not s:
        return s
    pick = min(
        (c for c in s if s[0].net_per_quintal - c.net_per_quintal <= near_tie),
        key=lambda c: c.road_km,
    )
    return [pick, *(c for c in s if c is not pick)]
