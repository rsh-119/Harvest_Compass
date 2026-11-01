"""FastAPI entry point. Routes stay thin; logic lives in agent/, tools/ and scoring/."""

import base64
import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.agent.graph import graph
from app.agent.state import AskRequest
from app.backtest import run_backtest as backtest
from app.config import settings
from app.data import request_log
from app.data.cache import close_pool
from app.faults import FAULTS
from app.health import status as health_status
from app.http import client
from app.languages import LANGS, LangCode
from app.ratelimit import limit
from app.tools import voice

logging.basicConfig(level=logging.INFO)
# httpx logs every request URL at INFO, and data.gov.in URLs carry our api-key.
logging.getLogger("httpx").setLevel(logging.WARNING)
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
async def health() -> dict[str, object]:
    """Live status of each source (real tiny calls, remembered 60 s). Also the warm-up ping."""
    sources = await health_status()
    return {
        "status": "ok" if all(v["ok"] for v in sources.values()) else "degraded",
        "sources": sources,
        "llm_model": settings.llm_model,
        "test_switches": FAULTS,
    }


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


async def run_agent(req: AskRequest) -> AsyncIterator[str]:
    """Stream trace events as they happen, then one 'final' event with the answer."""
    final: dict[str, Any] = {}
    events: list[dict[str, Any]] = []
    start = time.monotonic()
    try:
        async for mode, chunk in graph.astream({"request": req}, stream_mode=["custom", "values"]):
            if mode == "custom":
                events.append(dict(chunk))  # type: ignore[arg-type]
                yield _sse(events[-1])
            else:
                final = dict(chunk)  # type: ignore[arg-type]
    except Exception:  # show the failure in the trace instead of a silent broken stream
        log.exception("agent failed")
        err = {
            "event": "error",
            # Details go to the server log (log.exception above), not to the farmer.
            "en": "Something went wrong while working on this question. Please try again.",
            "hi": "कुछ गड़बड़ हो गई। कृपया फिर से पूछें।",
        }
        await request_log.record(int((time.monotonic() - start) * 1000), [*events, err], {})
        yield _sse(err)
        return
    await request_log.record(int((time.monotonic() - start) * 1000), events, final)
    yield _sse(
        {
            "event": "final",
            "clarify": final.get("clarify"),
            "answer": final.get("answer"),
            "result": final.get("result"),
            "intent": final["intent"].model_dump(mode="json") if final.get("intent") else None,
            # The UI resends this with edited costs, so a recalculation skips village matching.
            "place": final["place"].model_dump() if final.get("place") else None,
        }
    )
    # Speak only what the agent itself said (no public TTS endpoint to drain credits).
    # Sent after "final", so the farmer reads the text while the audio is made.
    spoken = final.get("answer") or (final.get("clarify") or {}).get("text")
    if spoken and req.speak and LANGS[req.lang].voice:
        audio = await voice.speak(spoken, req.lang)
        if audio.data:
            yield _sse({"event": "audio", "wav_b64": base64.b64encode(audio.data).decode()})
        else:
            yield _sse({"event": "audio_failed", "en": f"The spoken reply failed: {audio.error}"})


@app.post("/ask", dependencies=[Depends(limit)])
async def ask(req: AskRequest) -> StreamingResponse:
    return StreamingResponse(
        run_agent(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },  # don't let proxies buffer
    )


@app.post("/transcribe", dependencies=[Depends(limit)])
async def transcribe(audio: UploadFile, lang: Annotated[LangCode, Form()] = "en") -> dict[str, str]:
    """Speech -> text in the chosen language. The UI puts the text in the box to fix."""
    data = await audio.read()
    if not data:
        raise HTTPException(400, "empty audio")
    if len(data) > 5_000_000:  # Sarvam's REST endpoint is for clips under 30 s
        raise HTTPException(413, "recording too long")
    res = await voice.transcribe(
        data,
        audio.filename or "audio.webm",
        audio.content_type or "application/octet-stream",
        lang,
    )
    if res.data is None:
        if res.error and res.error.startswith(("daily voice limit", "voice is switched off")):
            raise HTTPException(429, "voice limit for today reached")
        raise HTTPException(502, f"speech-to-text failed: {res.error}")
    return {"text": res.data}


@app.get("/backtest")
async def backtest_results() -> list[dict[str, Any]]:
    """Latest stored backtest run per crop (run offline with app.backtest.run_backtest)."""
    return await backtest.latest()


@app.get("/stats")
async def stats() -> dict[str, Any]:
    """Real per-request numbers from request_log (last 7 days): p50/p95 time, fallback rate."""
    return await request_log.stats()
