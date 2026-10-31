import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_every_source(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_status() -> dict[str, dict[str, bool]]:  # no network in unit tests
        names = ("mandi_prices", "voice", "llm", "database", "weather", "routing", "geocoding")
        return {n: {"ok": True} for n in names}

    monkeypatch.setattr("app.main.health_status", fake_status)
    r = TestClient(app).get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert set(body["sources"]) == {
        "mandi_prices",
        "voice",
        "llm",
        "database",
        "weather",
        "routing",
        "geocoding",
    }


def test_transcribe_rejects_empty_audio_without_calling_sarvam() -> None:
    r = TestClient(app).post("/transcribe", files={"audio": ("a.webm", b"", "audio/webm")})
    assert r.status_code == 400


def test_rate_limit_blocks_the_eleventh_call_in_a_minute() -> None:
    from app.ratelimit import _allow

    assert all(_allow("t", 10, 60, now=100 + i) for i in range(10))
    assert not _allow("t", 10, 60, now=110)
    assert _allow("t", 10, 60, now=161)  # first call has left the window
