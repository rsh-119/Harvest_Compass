"""TEST SWITCH ONLY. Lets the UI pretend a source is down for one request, to show the agent
recovering. A disabled source is simply not called. Nothing is ever fabricated in its place."""

FAULTS = {
    "mandi_current": "Today's mandi price API",
    "weather_ecmwf": "Weather model A (ECMWF)",
    "weather_gfs": "Weather model B (GFS)",
}


def clean(requested: list[str]) -> set[str]:
    return {f for f in requested if f in FAULTS}
