"""7-day forecast from two independent models via Open-Meteo (CC BY 4.0, attribute in UI)."""

from datetime import date, timedelta
from typing import Any
from urllib.parse import urlencode

from pydantic import BaseModel

from app.clock import today_ist
from app.data.cache import Sourced, cached
from app.http import request_json

URL = "https://api.open-meteo.com/v1/forecast"
MODELS = ("ecmwf_ifs025", "gfs_seamless")


class DayForecast(BaseModel):
    day: date
    precip_mm: float | None
    precip_prob: float | None


def parse(body: dict[str, Any], model: str) -> list[DayForecast]:
    """Pull one model's columns. ECMWF has returned -0.1 mm (M0), so clamp rain at 0."""
    daily = body["daily"]
    rain = daily.get(f"precipitation_sum_{model}", [])
    prob = daily.get(f"precipitation_probability_max_{model}", [])
    out = []
    for i, d in enumerate(daily["time"]):
        mm = rain[i] if i < len(rain) else None
        out.append(
            DayForecast(
                day=date.fromisoformat(d),
                precip_mm=None if mm is None else max(0.0, mm),
                precip_prob=prob[i] if i < len(prob) else None,
            )
        )
    return out


async def forecast(
    lat: float, lon: float, models: tuple[str, ...] = MODELS
) -> Sourced[dict[str, list[DayForecast]]]:
    """Returns {model: [7 days]}. A model whose values are all missing is dropped, so callers
    can see it failed and fall back to the other one."""
    params = {
        "latitude": round(lat, 3),
        "longitude": round(lon, 3),
        "daily": "precipitation_sum,precipitation_probability_max",
        "models": ",".join(models),
        "timezone": "Asia/Kolkata",
        "forecast_days": 7,
    }
    res = await cached(
        f"weather:{params['latitude']}:{params['longitude']}:{params['models']}:{today_ist()}",
        f"{URL}?{urlencode(params)}",
        timedelta(hours=1),
        lambda: request_json("GET", URL, params=params),
    )

    def split(body: dict[str, Any]) -> dict[str, list[DayForecast]]:
        per_model = {m: parse(body, m) for m in models}
        return {
            m: days for m, days in per_model.items() if any(d.precip_mm is not None for d in days)
        }

    return res.map(split)
