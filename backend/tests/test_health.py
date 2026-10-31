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


def test_voice_budget_refuses_after_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from app.tools import voice

    async def no_db() -> None:
        return None

    monkeypatch.setattr(voice, "get_pool", no_db)
    monkeypatch.setattr(voice.settings, "voice_daily_limit", 2)
    voice._used.clear()

    async def spend_three() -> int:
        ok = 0
        for _ in range(3):
            try:
                await voice._spend()
                ok += 1
            except voice.VoiceLimit:
                pass
        return ok

    assert asyncio.run(spend_three()) == 2
