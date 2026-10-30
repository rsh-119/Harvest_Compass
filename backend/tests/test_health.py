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
