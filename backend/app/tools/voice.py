"""Hindi speech in/out via Sarvam (endpoints and models verified from docs.sarvam.ai in M0).
Free credits are limited, so TTS audio is cached by its exact text."""

import base64
import hashlib
from datetime import UTC, datetime

from app.config import settings
from app.data.cache import Sourced, cached
from app.http import request_json

STT_URL = "https://api.sarvam.ai/speech-to-text"
TTS_URL = "https://api.sarvam.ai/text-to-speech"
TTS_MODEL, TTS_SPEAKER = "bulbul:v4-flash", "aditya_hi_conversational"
STT_MODEL = "saaras:v4"


def _headers() -> dict[str, str]:
    return {"api-subscription-key": settings.sarvam_api_key}


async def transcribe(audio: bytes, filename: str, mime: str) -> Sourced[str]:
    """Never cached: every recording is new."""
    try:
        body = await request_json(
            "POST",
            STT_URL,
            headers=_headers(),
            timeout=60,
            data={"model": STT_MODEL, "mode": "transcribe", "language_code": "hi-IN"},
            files={"file": (filename, audio, mime)},
        )
        text = str(body.get("transcript", "")).strip()
        if not text:
            raise ValueError("empty transcript")
        return Sourced(data=text, source_url=STT_URL, fetched_at=datetime.now(UTC), status="live")
    except Exception as e:
        return Sourced(
            data=None,
            source_url=STT_URL,
            fetched_at=None,
            status="error",
            error=f"{type(e).__name__}: {e}"[:300],
        )


async def speak(text: str) -> Sourced[bytes]:
    """Returns WAV bytes."""
    digest = hashlib.sha256(f"{TTS_MODEL}:{TTS_SPEAKER}:{text}".encode()).hexdigest()

    async def fetch() -> str:
        body = await request_json(
            "POST",
            TTS_URL,
            headers=_headers(),
            timeout=60,
            json={
                "text": text,
                "language_code": "hi-IN",
                "model": TTS_MODEL,
                "speaker": TTS_SPEAKER,
            },
        )
        return str(body["audios"][0])  # base64 WAV

    res = await cached(f"tts:{digest}", TTS_URL, None, fetch)
    return res.map(base64.b64decode)
