"""Bounded re-planning: at most 2 rounds. Source failures are already handled where they
happen (cached real data with its age, or the other weather model). This node handles
"too few usable mandis" by widening the search radius step by step (150 → 200 → 250 km)."""

from typing import Any

from app.agent.state import AgentState
from app.agent.trace import emit
from app.config import settings


async def repair(state: AgentState) -> dict[str, Any]:
    usable = sum(m.usable for m in state["mandis"])
    new_radius = min(state["radius_km"] + 50, settings.max_radius_km)
    emit(
        "repair",
        f"Only {usable} usable mandis; widening search from {state['radius_km']:.0f} to {new_radius:.0f} km",
        f"सिर्फ़ {usable} भरोसेमंद मंडियाँ; दायरा {state['radius_km']:.0f} से {new_radius:.0f} किमी किया",
        round=state["repairs"] + 1,
    )
    notes = [*state["notes"], f"search widened to {new_radius:.0f} km"]
    return {"radius_km": new_radius, "repairs": state["repairs"] + 1, "notes": notes}
