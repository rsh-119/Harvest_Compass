"""FastAPI entry point. Routes stay thin; logic lives in agent/, tools/ and scoring/."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title="Harvest Compass")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, object]:
    """Which sources are configured. Live per-source checks are added in M7."""
    return {
        "status": "ok",
        "sources": {
            "mandi_prices": bool(settings.data_gov_in_api_key),
            "voice": bool(settings.sarvam_api_key),
            "llm": bool(settings.openrouter_api_key),
            "database": bool(settings.database_url),
            # Keyless public services.
            "weather": True,
            "routing": True,
            "geocoding": True,
        },
        "llm_model": settings.llm_model,
    }
