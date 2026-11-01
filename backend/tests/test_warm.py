import asyncio
from datetime import timedelta
from typing import Any

import pytest

from app.clock import today_ist


def test_empty_day_pull_is_not_stored_as_final(monkeypatch: pytest.MonkeyPatch) -> None:
    """data.gov.in can answer a busy day with 0 records and no error. That day must be retried
    next run, not written as "no reports" for every crop (it wiped 8 MP days on 1 Nov)."""
    from scripts import warm

    full, empty = today_ist() - timedelta(days=5), today_ist() - timedelta(days=6)
    rows = {full.strftime("%d/%m/%Y"): [{"Commodity": "Soyabean", "Modal_Price": "6900"}]}

    async def fake_fetch(resource: str, filters: dict[str, str]) -> list[dict[str, Any]]:
        return rows.get(filters["Arrival_Date"], [])

    async def no_marker(key: str) -> None:
        return None

    written: list[str] = []

    async def capture(items: list[tuple[str, str, Any, Any]]) -> None:
        written.extend(k for k, *_ in items)

    monkeypatch.setattr("app.tools.mandi._fetch_all", fake_fetch)
    monkeypatch.setattr(warm, "_read", no_marker)
    monkeypatch.setattr(warm, "write_many", capture)

    asyncio.run(warm.bulk_history("Madhya Pradesh", [full, empty]))
    assert f"mandi:history-bulk:Madhya Pradesh:{full.isoformat()}" in written
    assert f"mandi:history:Madhya Pradesh:Soyabean:{full.isoformat()}" in written
    assert not [k for k in written if k.endswith(empty.isoformat())]  # nothing stored for it


def test_old_zero_crop_marker_is_pulled_again(monkeypatch: pytest.MonkeyPatch) -> None:
    """Markers written by an empty pull before the fix (payload 0) must not block a re-pull."""
    from scripts import warm

    day = today_ist() - timedelta(days=6)
    pulled: list[str] = []

    async def fake_fetch(resource: str, filters: dict[str, str]) -> list[dict[str, Any]]:
        pulled.append(filters["Arrival_Date"])
        return [{"Commodity": "Soyabean", "Modal_Price": "6900"}]

    async def zero_marker(key: str) -> tuple[int, str, None]:
        return (0, "", None)

    async def ignore(items: list[tuple[str, str, Any, Any]]) -> None:
        return None

    monkeypatch.setattr("app.tools.mandi._fetch_all", fake_fetch)
    monkeypatch.setattr(warm, "_read", zero_marker)
    monkeypatch.setattr(warm, "write_many", ignore)
    asyncio.run(warm.bulk_history("Madhya Pradesh", [day]))
    assert pulled == [day.strftime("%d/%m/%Y")]
