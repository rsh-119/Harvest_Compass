"""Settings read from the repo-root .env (never committed) or real env vars on the host."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_ENV, extra="ignore")

    data_gov_in_api_key: str = ""
    sarvam_api_key: str = ""
    openrouter_api_key: str = ""
    llm_model: str = "deepseek/deepseek-v4.1-flash"
    database_url: str = ""
    # data.gov.in returns an empty 502 to httpx's default UA, so every client must send this.
    nominatim_user_agent: str = "HarvestCompass/0.1"
    frontend_origin: str = "http://localhost:3000"

    # Region and crops chosen by the M0 coverage query (67 soybean / 42 onion mandis near Indore).
    crops: list[str] = ["Soyabean", "Onion"]
    state: str = "Madhya Pradesh"
    center_lat: float = 22.7196
    center_lon: float = 75.8577
    radius_km: float = 150


settings = Settings()
