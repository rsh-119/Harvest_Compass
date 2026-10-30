"""FastAPI entry point. Routes stay thin; logic lives in agent/, tools/ and scoring/."""

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.agent.graph import graph
from app.agent.state import AskRequest
from app.config import settings
from app.data.cache import close_pool
from app.faults import FAULTS
from app.http import client

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await client.aclose()
    await close_pool()


app = FastAPI(title="Harvest Compass", lifespan=lifespan)
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
        "test_switches": FAULTS,
    }


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


async def run_agent(req: AskRequest) -> AsyncIterator[str]:
    """Stream trace events as they happen, then one 'final' event with the answer."""
    final: dict[str, Any] = {}
    try:
        async for mode, chunk in graph.astream({"request": req}, stream_mode=["custom", "values"]):
            if mode == "custom":
                yield _sse(dict(chunk))  # type: ignore[arg-type]
            else:
                final = dict(chunk)  # type: ignore[arg-type]
    except Exception as e:  # show the failure in the trace instead of a silent broken stream
        log.exception("agent failed")
        yield _sse(
            {"event": "error", "en": f"Agent error: {type(e).__name__}: {e}", "hi": "कुछ गड़बड़ हो गई"}
        )
        return
    yield _sse(
        {
            "event": "final",
            "clarify": final.get("clarify"),
            "answer": final.get("answer"),
            "result": final.get("result"),
            "intent": final["intent"].model_dump(mode="json") if final.get("intent") else None,
        }
    )


@app.post("/ask")
async def ask(req: AskRequest) -> StreamingResponse:
    return StreamingResponse(
        run_agent(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },  # don't let proxies buffer
    )
