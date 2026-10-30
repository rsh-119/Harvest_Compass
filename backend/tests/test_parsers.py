"""Parsers for real API response shapes (field layout as observed live, values inline)."""

from datetime import date

from app.agent.nodes.explain import allowed_numbers, invented_numbers
from app.data.synonyms import market_town, normalize_crop, normalize_market
from app.tools.mandi import parse_row
from app.tools.weather import parse


def test_weather_two_models_suffixed_and_clamped() -> None:
    body = {
        "daily": {
            "time": ["2026-11-01"],
            "precipitation_sum_a": [-0.1],
            "precipitation_probability_max_a": [5],
            "precipitation_sum_b": [2.0],
        }
    }
    a = parse(body, "a")
    assert a[0].precip_mm == 0.0 and a[0].precip_prob == 5
    assert parse(body, "b")[0].precip_prob is None


def test_weather_single_model_has_no_suffix() -> None:
    body = {
        "daily": {
            "time": ["2026-11-01"],
            "precipitation_sum": [0.1],
            "precipitation_probability_max": [23],
        }
    }
    d = parse(body, "gfs_seamless", only_model=True)
    assert d[0].precip_mm == 0.1 and d[0].precip_prob == 23


def test_mandi_rows_from_both_resources() -> None:
    cur = {
        "market": "Sanwer APMC",
        "district": "Indore",
        "commodity": "Soyabean",
        "variety": "Soyabeen",
        "grade": "FAQ",
        "arrival_date": "30/10/2026",
        "min_price": 2200,
        "max_price": 7223,
        "modal_price": 6900,
    }
    r = parse_row(cur, "current")
    assert r and r.arrival_date == date(2026, 10, 30) and r.modal_price == 6900
    hist = {k.title(): str(v) for k, v in cur.items()}  # history: Capitalised keys, string prices
    h = parse_row(hist, "history")
    assert h and h.modal_price == 6900 and h.key == ("sanwer apmc", "indore")
    assert parse_row({**cur, "modal_price": "NR"}, "current") is None


def test_names() -> None:
    assert normalize_market("Ashta  APMC") == "ashta apmc"
    assert market_town("Mhow (Ambedkar Nagar) (F&V) APMC") == "Mhow"
    assert normalize_crop("Pyaaz") == "Onion" and normalize_crop("सोयाबीन") == "Soyabean"
    assert normalize_crop("gehu") is None


def test_number_validator() -> None:
    facts = {"net": 6830, "total": 273200, "day": "2 नवंबर", "price": 6925.0}
    ok = allowed_numbers(facts)
    assert invented_numbers("शुद्ध 6830 रुपये, कुल 2,73,200, २ नवंबर", ok) == []
    assert invented_numbers("भाव 7000 रुपये", ok) == ["7000"]
