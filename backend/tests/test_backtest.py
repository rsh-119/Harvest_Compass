from app.backtest.run_backtest import summarise


def _rec(gain: float, regret: float = 0.0) -> dict[str, object]:
    d = {
        "chosen": "A",
        "chosen_km": 10.0,
        "price_t": 100.0,
        "price_t1": 90.0,
        "baseline": "B",
        "baseline_km": 5.0,
        "gain": gain,
        "regret": regret,
    }
    return {"village": "V", "day": "2026-10-01", "by_c": {("today", 1.0): d}}


def test_summary_counts_gains_regret_and_unrealisable() -> None:
    recs = [_rec(g, r) for g, r in [(-50, 80), (0, 30), (20, 10), (40, 0)]]
    recs.append({"village": "V", "day": "x", "by_c": {("today", 1.0): {"unrealisable": True}}})
    s = summarise(recs, "today", 1.0)
    assert s["decisions"] == 4 and s["unrealisable"] == 1
    assert s["pct_positive"] == 50.0 and s["pct_same_as_nearest"] == 25.0
    assert s["mean_gain"] == 2.5 and s["mean_regret"] == 30.0
    assert s["losing_examples"][0]["gain"] == -50


def test_summary_refuses_tiny_samples() -> None:
    assert "note" in summarise([_rec(10)], "today", 1.0)


def test_request_log_summary() -> None:
    from app.data.request_log import summarise

    ev = [{"event": "plan"}, {"event": "repair"}]
    assert summarise(ev, {"answer": "x", "result": {"invented_numbers": 0}}) == {
        "outcome": "answer",
        "fallback": True,
        "invented": 0,
    }
    assert summarise([], {"clarify": {"hi": "?"}})["outcome"] == "clarify"
    assert summarise([], {})["outcome"] == "error"
