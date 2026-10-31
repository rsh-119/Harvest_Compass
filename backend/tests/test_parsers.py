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


def test_town_matches_its_tahsil_name_but_villages_do_not() -> None:
    from app.agent.nodes.understand import _score
    from app.tools.geocode import Place

    town = Place(
        name="Dr. Ambedkar Nagar",
        display_name="Dr. Ambedkar Nagar, Mhow Tahsil, Indore, Madhya Pradesh, India",
        lat=22.55,
        lon=75.76,
        kind="town",
    )
    village = town.model_copy(update={"name": "Kodariya", "kind": "village"})
    assert _score("Mhow", town) == 100
    assert _score("Mhow", village) < 60


def test_number_check_reads_every_indian_script() -> None:
    allowed = allowed_numbers({"net": 6900, "total": 276000})
    assert invented_numbers("৬৯০০ টাকা, মোট ২৭৬০০০", allowed) == []  # Bengali digits
    assert invented_numbers("௬௯௦௦ ரூபாய்", allowed) == []  # Tamil digits
    assert invented_numbers("৭০০০ টাকা", allowed) == ["৭০০০"]  # an invented price is still caught


def test_english_and_hindi_need_no_translation() -> None:
    import asyncio

    from app.languages import LANGS, localise

    assert asyncio.run(localise("Which village?", "आपका गाँव?", "en")) == "Which village?"
    assert asyncio.run(localise("Which village?", "आपका गाँव?", "hi")) == "आपका गाँव?"
    assert len(LANGS) == 23  # English + the 22 scheduled languages


def test_translation_must_keep_numbers() -> None:
    from app.languages import numbers_kept

    assert numbers_kept("Do you really have 50000 quintals?", "क्या सच में 50000 क्विंटल?")
    assert not numbers_kept("Do you really have 50000 quintals?", "क्या सच में 5000 क्विंटल?")
    assert numbers_kept("How many quintals does one trip carry?", "1 চক্করে কত কুইন্টাল?")
    assert not numbers_kept("How many quintals?", "40 কুইন্টাল?")


def test_state_from_osm_address() -> None:
    from app.data.regions import agmark, state_of

    assert (
        state_of("Sanwer, Sanwer Tahsil, Indore, Madhya Pradesh, 453551, India") == "Madhya Pradesh"
    )
    assert state_of("Lasalgaon, Niphad, Nashik, Maharashtra, 422306, India") == "Maharashtra"
    assert state_of("Model Town, Lahore, Punjab, Pakistan") is None
    assert state_of("Kathmandu, Bagmati, Nepal") is None
    assert agmark("Kerala") == "Keralam" and agmark("Gujarat") == "Gujarat"
