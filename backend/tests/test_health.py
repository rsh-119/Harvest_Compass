from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_every_source() -> None:
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
