"""Pick the steps for THIS farmer's situation, each with a reason the UI shows.
Deterministic rules, not the LLM: the plan has to be predictable and explainable."""

from typing import Any

from app.agent.state import AgentState
from app.agent.trace import emit
from app.config import settings
from app.data.synonyms import PERISHABLE


def make_plan(state: AgentState) -> list[dict[str, str]]:
    i = state["intent"]
    p = state["request"].params
    perishable = i.crop in PERISHABLE
    steps = [
        {
            "step": "prices",
            "why": "today's mandi prices (data.gov.in); a mandi missing today uses its latest report, with its age",
        },
        {
            "step": "history",
            "why": "last 30 days of prices to spot suspect prices, see the trend and a bad-day price",
        },
        {
            "step": "mandis",
            "why": f"locate mandis within {state['radius_km']:.0f} km and get real road distance",
        },
    ]
    if i.already_harvested:
        why = (
            "already harvested and perishable: sell soon, nearer mandis"
            if perishable
            else "already harvested: no harvest window needed"
        )
        steps.append({"step": "skip_weather", "why": why})
    else:
        steps.append(
            {
                "step": "weather",
                "why": "7-day rain forecast from two models to choose harvest/transport days",
            }
        )
    if i.wait_days or (i.has_storage and not perishable):
        steps.append(
            {
                "step": "wait",
                "why": "compare selling now vs waiting, using the recent price trend and rain risk",
            }
        )
    cap = settings.max_drive_min_perishable if perishable else settings.max_drive_min
    steps.append(
        {
            "step": "drive_cap",
            "why": f"ignore mandis more than {cap / 60:.1f} h away"
            + (" (perishable)" if perishable else ""),
        }
    )
    if (
        p.rate_per_km == settings.default_rate_per_km
        and p.capacity_q == settings.default_capacity_q
    ):
        steps.append(
            {
                "step": "assume_vehicle",
                "why": f"no vehicle details given: assuming ₹{p.rate_per_km:.0f}/km and {p.capacity_q:.0f} q per trip (editable)",
            }
        )
    return steps


async def plan(state: AgentState) -> dict[str, Any]:
    steps = make_plan(state)
    emit("plan", " → ".join(s["step"] for s in steps), "योजना बनाई", steps=steps)
    return {"plan": steps}
