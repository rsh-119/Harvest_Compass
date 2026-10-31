"""Speech in/out via Sarvam, in the farmer's chosen language (endpoints and models verified from docs.sarvam.ai in M0).
Free credits are limited, so TTS audio is cached by its exact text."""

import base64
import hashlib
from datetime import UTC, date, datetime

from app.clock import today_ist
from app.config import settings
from app.data.cache import Sourced, cached, get_pool
from app.http import plain, request_json
from app.languages import LANGS

STT_URL = "https://api.sarvam.ai/speech-to-text"
TTS_URL = "https://api.sarvam.ai/text-to-speech"
TTS_MODEL = "bulbul:v4-flash"
STT_MODEL = "saaras:v4"


class VoiceLimit(RuntimeError):
    pass


_used: dict[date, int] = {}  # fallback when there's no database


async def _spend() -> None:
    """Count one live Sarvam call against today's budget, or refuse it."""
    today, limit = today_ist(), settings.voice_daily_limit
    if limit <= 0:
        raise VoiceLimit("voice is switched off")
    pool = await get_pool()
    if pool is None:
        if _used.get(today, 0) >= limit:
            raise VoiceLimit(f"daily voice limit ({limit}) reached")
        _used[today] = _used.get(today, 0) + 1
        return
    async with pool.connection() as conn:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS voice_usage (day date PRIMARY KEY, calls integer NOT NULL)"
        )
        # One atomic statement: only increments while under the limit.
        cur = await conn.execute(
            """INSERT INTO voice_usage (day, calls) VALUES (%s, 1)
               ON CONFLICT (day) DO UPDATE SET calls = voice_usage.calls + 1
               WHERE voice_usage.calls < %s
               RETURNING calls""",
            (today, limit),
        )
        if await cur.fetchone() is None:
            raise VoiceLimit(f"daily voice limit ({limit}) reached")


async def voice_used_today() -> int:
    pool = await get_pool()
    if pool is None:
        return _used.get(today_ist(), 0)
    async with pool.connection() as conn:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS voice_usage (day date PRIMARY KEY, calls integer NOT NULL)"
        )
        cur = await conn.execute("SELECT calls FROM voice_usage WHERE day = %s", (today_ist(),))
        row = await cur.fetchone()
    return int(row[0]) if row else 0


def _headers() -> dict[str, str]:
    return {"api-subscription-key": settings.sarvam_api_key}


async def transcribe(audio: bytes, filename: str, mime: str, lang: str = "en") -> Sourced[str]:
    """Never cached: every recording is new."""
    try:
        await _spend()
        body = await request_json(
            "POST",
            STT_URL,
            headers=_headers(),
            timeout=15,  # clips are under 30 s; measured replies take 1-2 s
            data={"model": STT_MODEL, "mode": "transcribe", "language_code": LANGS[lang].stt},
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
            error=plain(e),
        )


async def speak(text: str, lang: str = "hi") -> Sourced[bytes]:
    """Returns WAV bytes. Only for languages with a v4-flash voice (see app.languages)."""
    speaker = LANGS[lang].voice
    assert speaker, f"no voice for {lang}"
    digest = hashlib.sha256(f"{TTS_MODEL}:{speaker}:{text}".encode()).hexdigest()

    async def fetch() -> str:
        await _spend()  # only cache misses cost credits
        body = await request_json(
            "POST",
            TTS_URL,
            headers=_headers(),
            timeout=15,  # clips are under 30 s; measured replies take 1-2 s
            json={
                "text": text,
                "language_code": LANGS[lang].stt,
                "model": TTS_MODEL,
                "speaker": speaker,
            },
        )
        return str(body["audios"][0])  # base64 WAV

    res = await cached(f"tts:{digest}", TTS_URL, None, fetch)
    return res.map(base64.b64decode)
