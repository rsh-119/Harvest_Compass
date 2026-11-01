"""Supervisor agent (multi-agent mode). An LLM that decides which specialist agents run and
whether the market search needs another round, inside hard guardrails:

- It sees a status board of counts only (no farmer text, no prices), so it can't be steered by
  the question and has no numbers to leak into the answer.
- Its tools allow only these moves: dispatch(weather, wait), widen_search(radius_km), proceed.
- Any LLM error, timeout or out-of-bounds move falls back to the pipeline's rule
  (plan.make_plan / audit.needs_repair) and says so in the trace.
Money is never decided here: the calculator computes it, as in pipeline mode."""

import asyncio
import json
import logging
from typing import Any

from app.agent.nodes.audit import needs_repair
from app.agent.nodes.plan import make_plan
from app.agent.state import AgentState
from app.agent.trace import emit
from app.config import settings
from app.data.crops import PERISHABLE
from app.llm import chat

log = logging.getLogger("supervisor")
DECISION_TIMEOUT_S = 6.0
MAX_TURNS = 4

ROLE = (
    "You are the supervisor of a team of agents that helps an Indian farmer choose a mandi "
    "and harvest days. Specialists: market agent (prices, mandis, road distances), weather "
    "agent (rain forecast for harvest days), auditor (rejects stale or odd prices), calculator "
    "(money in hand; you never compute money). You see a status board of counts only. Choose "
    "exactly one tool. Keep the reason short and plain."
)

DISPATCH_TOOL = {
    "type": "function",
    "function": {
        "name": "dispatch",
        "description": "Choose which specialists run now. The market agent always runs.",
        "parameters": {
            "type": "object",
            "properties": {
                "weather": {
                    "type": "boolean",
                    "description": "Run the weather agent. Not needed if the crop is already harvested.",
                },
                "wait": {
                    "type": "boolean",
                    "description": "Compare selling now vs waiting (farmer asked to wait, or can store a non-perishable crop).",
                },
                "reason": {"type": "string"},
            },
            "required": ["weather", "wait", "reason"],
        },
    },
}

REVIEW_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "widen_search",
            "description": "Send the market agent out again with a larger radius, when too few mandis are usable and a wider area could help.",
            "parameters": {
                "type": "object",
                "properties": {"radius_km": {"type": "number"}, "reason": {"type": "string"}},
                "required": ["radius_km", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "proceed",
            "description": "The data is good enough (or more searching can't help): hand over to the calculator.",
            "parameters": {
                "type": "object",
                "properties": {"reason": {"type": "string"}},
                "required": ["reason"],
            },
        },
    },
]


def dispatch_board(state: AgentState) -> dict[str, Any]:
    i = state["intent"]
    return {
        "crop_perishable": i.crop in PERISHABLE,
        "already_harvested": bool(i.already_harvested),
        "farmer_asked_to_wait_days": i.wait_days or 0,
        "has_storage": bool(i.has_storage),
    }


def review_board(state: AgentState) -> dict[str, Any]:
    mandis = state.get("mandis", [])
    rejected: dict[str, int] = {}
    for m in mandis:
        for f in m.findings:
            if f.severity != "info":
                rejected[f.rule] = rejected.get(f.rule, 0) + 1
    return {
        "price_rows_in_state": len(state.get("rows", [])),
        "mandis_checked": len(mandis),
        "mandis_usable": sum(m.usable for m in mandis),
        "problems_by_rule": rejected,
        "radius_km": state["radius_km"],
        "max_radius_km": settings.max_radius_km,
        "search_rounds_done": state["repairs"],
        "max_extra_rounds": 2,
    }


async def _decide(
    board: dict[str, Any], tools: list[dict[str, Any]], forced: str | None
) -> dict[str, Any]:
    msgs = [
        {"role": "system", "content": ROLE},
        {"role": "user", "content": json.dumps(board)},
    ]
    choice = {"type": "function", "function": {"name": forced}} if forced else "required"
    msg = await asyncio.wait_for(
        chat(msgs, tools=tools, tool_choice=choice, max_tokens=600, retries=0),  # type: ignore[arg-type]
        DECISION_TIMEOUT_S,
    )
    call = msg["tool_calls"][0]["function"]
    return {"name": call["name"], **json.loads(call["arguments"] or "{}")}


def _fallback(why: str) -> None:
    emit(
        "decision",
        f"Supervisor fell back to the fixed rules ({why})",
        "सुपरवाइज़र ने तय नियम अपनाए",
        agent="supervisor",
    )


async def supervisor_dispatch(state: AgentState) -> dict[str, Any]:
    steps = make_plan(state)  # the rule plan: also the fallback
    turns = state.get("supervisor_turns", 0) + 1
    try:
        d = await _decide(dispatch_board(state), [DISPATCH_TOOL], "dispatch")
        if not isinstance(d.get("weather"), bool) or not isinstance(d.get("wait"), bool):
            raise ValueError("dispatch without weather/wait choice")
        has = {s["step"] for s in steps}
        if d["weather"] and "weather" not in has:
            steps = [s for s in steps if s["step"] != "skip_weather"]
            steps.insert(
                3, {"step": "weather", "why": d.get("reason", "supervisor asked for weather")}
            )
        elif not d["weather"] and "weather" in has:
            steps = [
                {"step": "skip_weather", "why": d.get("reason", "supervisor skipped weather")}
                if s["step"] == "weather"
                else s
                for s in steps
            ]
        if d["wait"] and "wait" not in has:
            steps.insert(
                4, {"step": "wait", "why": d.get("reason", "supervisor asked to compare waiting")}
            )
        elif not d["wait"]:
            steps = [s for s in steps if s["step"] != "wait"]
        team = "market agent" + (" + weather agent, in parallel" if d["weather"] else "")
        emit(
            "plan",
            f"Supervisor: send {team}. {d.get('reason', '')}".strip(),
            "सुपरवाइज़र ने एजेंट भेजे",
            steps=steps,
            agent="supervisor",
        )
    except Exception as e:  # LLM down, slow or off-script: the rule plan is always valid
        log.warning("dispatch fell back: %s", e)
        _fallback(type(e).__name__)
        emit(
            "plan",
            " → ".join(s["step"] for s in steps),
            "योजना बनाई",
            steps=steps,
            agent="supervisor",
        )
    return {"plan": steps, "supervisor_turns": turns}


async def supervisor_review(state: AgentState) -> dict[str, Any]:
    """After the auditor: one more market round with a wider radius, or hand over."""
    turns = state.get("supervisor_turns", 0) + 1
    can_widen = (
        bool(state.get("rows"))
        and state["repairs"] < 2
        and state["radius_km"] < settings.max_radius_km
        and turns <= MAX_TURNS
    )
    widen_to: float | None = None
    reason = ""
    try:
        if not can_widen:
            d = {"name": "proceed", "reason": "no wider search possible"}
        else:
            d = await _decide(review_board(state), REVIEW_TOOLS, None)
        if d["name"] == "widen_search":
            r = float(d["radius_km"])
            if not state["radius_km"] < r <= settings.max_radius_km:
                raise ValueError(f"radius {r} out of bounds")
            widen_to = r
        elif d["name"] != "proceed":
            raise ValueError(f"unknown move {d['name']}")
        reason = str(d.get("reason", ""))
    except Exception as e:
        log.warning("review fell back: %s", e)
        _fallback(type(e).__name__)
        if needs_repair(state):
            widen_to = min(state["radius_km"] + 50, settings.max_radius_km)
        reason = "fixed rule"
    if widen_to is None:
        emit(
            "decision",
            f"Supervisor: hand over to the calculator. {reason}".strip(),
            "सुपरवाइज़र: गणना के लिए भेजा",
            agent="supervisor",
        )
        return {"supervisor_turns": turns, "widen": False}
    usable = sum(m.usable for m in state["mandis"])
    emit(
        "repair",
        f"Supervisor: only {usable} usable mandis; market agent searches again out to {widen_to:.0f} km. {reason}".strip(),
        f"सुपरवाइज़र: दायरा {widen_to:.0f} किमी किया",
        round=state["repairs"] + 1,
        agent="supervisor",
    )
    return {
        "supervisor_turns": turns,
        "widen": True,
        "radius_km": widen_to,
        "repairs": state["repairs"] + 1,
        "notes": [*state["notes"], f"search widened to {widen_to:.0f} km"],
    }
