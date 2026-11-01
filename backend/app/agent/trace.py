"""Trace events streamed live to the UI (over SSE) as the agent works."""

import time
from contextvars import ContextVar
from typing import Any, Literal

from langgraph.config import get_stream_writer

Event = Literal[
    "understand",
    "clarify",
    "plan",
    "tool_call",
    "tool_result",
    "audit_reject",
    "audit_flag",
    "repair",
    "compute",
    "decision",
    "explain",
    "error",
]


# Multi-agent mode: the agent whose node is running, so its tool events carry its name.
current_agent: ContextVar[str | None] = ContextVar("current_agent", default=None)


def emit(event: Event, en: str, hi: str = "", **data: Any) -> None:
    """Every event has a short English and Hindi message plus a timestamp (ms)."""
    payload = {"event": event, "en": en, "hi": hi, "t": int(time.time() * 1000), **data}
    if (agent := current_agent.get()) and "agent" not in payload:
        payload["agent"] = agent
    try:
        get_stream_writer()(payload)
    except RuntimeError:  # called outside a graph run (e.g. a unit test): nothing to stream to
        pass
