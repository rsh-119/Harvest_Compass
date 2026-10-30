"""Small inline inputs only (allowed in tests/). No recorded API payloads."""

from datetime import date, timedelta

import pytest

from app.scoring.audit_rules import (
    check_comparable,
    check_consistency,
    check_outlier,
    check_spread,
    check_stale,
    main_group,
    robust_z,
)
from app.scoring.harvest_window import Day, risk, score_window
from app.scoring.net_profit import Candidate, Costs, conservative_price, net_profit, rank
from app.scoring.trend import slope_per_day

D0 = date(2026, 11, 1)
C = Costs(quantity_q=40, capacity_q=25, rate_per_km=30, fee_rate=0.02)


# --- net profit ---
def test_net_profit_worked_example() -> None:
    r = net_profit(price=6900, road_km=50, c=C)
    assert r.trips == 2  # 40 q / 25 q per trip -> 2 trips
    assert r.transport_total == 2 * 2 * 50 * 30  # 6000
    assert r.mandi_charges == pytest.approx(6900 * 40 * 0.02)  # 5520
    assert r.net_total == pytest.approx(276000 - 6000 - 5520)
    assert r.net_per_quintal == pytest.approx((276000 - 11520) / 40)


@pytest.mark.parametrize("qty,cap", [(0, 25), (40, 0), (-1, 25)])
def test_net_profit_rejects_zero_or_negative_quantity(qty: float, cap: float) -> None:
    with pytest.raises(ValueError):
        net_profit(6900, 50, Costs(qty, cap, 30, 0.02))


def test_other_charges_per_quintal() -> None:
    r = net_profit(6900, 0, Costs(40, 25, 30, 0.0, other_per_q=15))
    assert r.mandi_charges == 600 and r.net_per_quintal == 6885


def test_net_profit_rejects_negative_inputs() -> None:
    with pytest.raises(ValueError):
        net_profit(-1, 50, C)


def test_very_large_quantity_scales_trips() -> None:
    assert net_profit(6900, 10, Costs(10_000, 25, 30, 0.02)).trips == 400


def test_conservative_price_needs_five_days() -> None:
    assert conservative_price([6000, 6100, 6200, 6300]) is None
    assert conservative_price([]) is None  # missing history
    assert conservative_price([6000, 6100, 6200, 6300, 6400]) == 6100


def test_rank_by_net_then_conservative() -> None:
    a = Candidate("a", 6500, 6200)
    b = Candidate("b", 6500, 6300)  # same net, better bad-day price -> wins tie
    c = Candidate("c", 6600, None)  # best net even without history
    d = Candidate("d", 6500, None)  # missing conservative sorts after known ones
    assert [x.key for x in rank([a, b, c, d])] == ["c", "b", "a", "d"]


# --- trend ---
def test_trend_slope() -> None:
    pts = [(D0 + timedelta(days=i), 6000 + 10 * i) for i in range(6)]
    assert slope_per_day(pts) == pytest.approx(10)


def test_trend_uses_median_per_day_and_needs_five_days() -> None:
    pts = [(D0, 6000), (D0, 6200), (D0 + timedelta(days=1), 6100)]
    assert slope_per_day(pts) is None


# --- audit ---
def test_min_greater_than_max_rejected() -> None:
    f = check_consistency(7000, 6000, 6500)
    assert f and f.severity == "reject"


def test_modal_outside_range_rejected() -> None:
    assert check_consistency(6000, 7000, 7100) is not None
    assert check_consistency(6000, 7000, 6500) is None


def test_stale() -> None:
    assert check_stale(D0 - timedelta(days=3), D0) is None
    f = check_stale(D0 - timedelta(days=4), D0)
    assert f and f.rule == "stale" and "4" in f.en


def test_all_mandis_stale() -> None:
    rows = [D0 - timedelta(days=n) for n in (5, 6, 9)]
    assert all(check_stale(d, D0) for d in rows)


def test_wide_spread_is_info_only() -> None:
    f = check_spread(2151, 6900)  # Khachrod, 30 Oct 2026
    assert f and f.severity == "info"
    assert check_spread(6000, 6900) is None


def test_robust_z_edge_cases() -> None:
    assert robust_z(1, [1, 2]) is None
    assert robust_z(100, [100] * 5) == 0
    assert robust_z(130, [100] * 5) == float("inf")


def test_outlier_needs_both_references() -> None:
    usual = [6800, 6850, 6900, 6950, 7000, 6900]
    assert check_outlier(9900, usual, usual) is not None
    # unusual for the region but normal for this mandi -> not suspect
    assert check_outlier(9900, [9800, 9900, 9950, 9850, 9900], usual) is None
    # no mandi history: regional comparison decides alone
    assert check_outlier(9900, [], usual) is not None
    assert check_outlier(6900, usual, usual) is None


def test_variety_grouping() -> None:
    rows = [("Soyabeen", "FAQ")] * 3 + [("Yellow", "FAQ")]
    assert main_group(rows) == ("Soyabeen", "FAQ")
    assert main_group(rows, "yellow") == ("Yellow", "FAQ")
    assert main_group(rows, "black") == ("Soyabeen", "FAQ")
    assert main_group([]) is None
    assert check_comparable("Yellow", "FAQ", ("Soyabeen", "FAQ")) is not None
    assert check_comparable("Soyabeen", "FAQ", ("Soyabeen", "FAQ")) is None


# --- harvest window ---
def days(spec: list[tuple[float, float]]) -> list[Day]:
    return [Day(D0 + timedelta(days=i), mm, p) for i, (mm, p) in enumerate(spec)]


def test_risk() -> None:
    assert risk(Day(D0, 10, 20)) == 1.0
    assert risk(Day(D0, 0, 30)) == 0.3
    assert risk(Day(D0, None, None)) is None


def test_prefers_day_both_models_call_dry() -> None:
    a = days([(8, 90), (0, 5), (0, 5), (0, 5)])
    b = days([(6, 80), (0, 3), (3, 60), (0, 2)])
    best, uncovered = score_window({"a": a, "b": b}, D0, D0 + timedelta(days=3), perishable=False)
    # Day 1: both dry, transport day 2 forecast known. Day 3 is dry too, but its transport
    # day is beyond the forecast, so it must not win.
    assert best[0].day == D0 + timedelta(days=1)
    assert best[0].both_dry and not best[0].uncertain
    day3 = next(s for s in best if s.day == D0 + timedelta(days=3))
    assert day3.uncertain and "weather models disagree" not in day3.reasons
    assert uncovered == []


def test_model_disagreement_marks_uncertain() -> None:
    a = days([(0, 5), (0, 5)])
    b = days([(4, 70), (0, 5)])
    scored, _ = score_window({"a": a, "b": b}, D0, D0, perishable=True)
    assert scored[0].uncertain and "disagree" in scored[0].reasons[0]


def test_single_model_is_uncertain_and_days_beyond_forecast_listed() -> None:
    a = days([(0, 5)])
    scored, uncovered = score_window({"a": a}, D0, D0 + timedelta(days=2), perishable=False)
    assert scored[0].uncertain and not scored[0].both_dry
    assert "only one weather model available" in scored[0].reasons
    assert any("transport day" in r for r in scored[0].reasons)
    assert uncovered == [D0 + timedelta(days=1), D0 + timedelta(days=2)]


def test_perishable_weights_transport_day_more() -> None:
    m = {"a": days([(0, 0), (0, 60)]), "b": days([(0, 0), (0, 60)])}
    grain, _ = score_window(m, D0, D0, perishable=False)
    onion, _ = score_window(m, D0, D0, perishable=True)
    assert onion[0].score > grain[0].score
