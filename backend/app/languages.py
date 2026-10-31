"""Languages the farmer can pick: English plus the 22 scheduled languages of India.

Speech-to-text (Sarvam saaras:v4) accepts all of them. Spoken replies (bulbul:v4-flash) exist
only for the languages that have v4-flash voices; the voice IDs below are from Sarvam's voice
catalogue (docs.sarvam.ai, Voices page, checked 31 Oct 2026). Malayalam and Odia have no
v4-flash voices, so those answers are text only.

Questions the agent asks are written in English and Hindi in code. For other languages the
LLM translates them, and the translation is rejected if any number changes."""

import logging
import re
from dataclasses import dataclass
from typing import Literal

from app.llm import chat

log = logging.getLogger("languages")


@dataclass(frozen=True)
class Language:
    english: str
    native: str
    stt: str  # Sarvam language_code
    voice: str | None  # bulbul:v4-flash speaker, None = no spoken reply


LANGS: dict[str, Language] = {
    "en": Language("English", "English", "en-IN", "dev_en_conversational"),
    "hi": Language("Hindi", "हिन्दी", "hi-IN", "aditya_hi_conversational"),
    "bn": Language("Bengali", "বাংলা", "bn-IN", "roopa_bn_conversational"),
    "mr": Language("Marathi", "मराठी", "mr-IN", "ishita_mr_conversational"),
    "te": Language("Telugu", "తెలుగు", "te-IN", "kavitha_te_conversation"),
    "ta": Language("Tamil", "தமிழ்", "ta-IN", "gokul_ta_narration"),
    "gu": Language("Gujarati", "ગુજરાતી", "gu-IN", "pooja_gu_conversational"),
    "kn": Language("Kannada", "ಕನ್ನಡ", "kn-IN", "chaitra_kn_conversation"),
    "pa": Language("Punjabi", "ਪੰਜਾਬੀ", "pa-IN", "anand_pa_conversation"),
    "ml": Language("Malayalam", "മലയാളം", "ml-IN", None),
    "od": Language("Odia", "ଓଡ଼ିଆ", "od-IN", None),
    "ur": Language("Urdu", "اردو", "ur-IN", None),
    "as": Language("Assamese", "অসমীয়া", "as-IN", None),
    "mai": Language("Maithili", "मैथिली", "mai-IN", None),
    "ne": Language("Nepali", "नेपाली", "ne-IN", None),
    "kok": Language("Konkani", "कोंकणी", "kok-IN", None),
    "doi": Language("Dogri", "डोगरी", "doi-IN", None),
    "sd": Language("Sindhi", "سنڌي", "sd-IN", None),
    "ks": Language("Kashmiri", "كٲشُر", "ks-IN", None),
    "mni": Language("Manipuri", "মৈতৈলোন্", "mni-IN", None),
    "brx": Language("Bodo", "बड़ो", "brx-IN", None),
    "sat": Language("Santali", "ᱥᱟᱱᱛᱟᱲᱤ", "sat-IN", None),
    "sa": Language("Sanskrit", "संस्कृतम्", "sa-IN", None),
}

LangCode = Literal[
    "en", "hi", "bn", "mr", "te", "ta", "gu", "kn", "pa", "ml", "od", "ur", "as", "mai", "ne",
    "kok", "doi", "sd", "ks", "mni", "brx", "sat", "sa",
]  # fmt: skip

NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")  # \d matches every script's digits; float() reads them


def numbers(text: str) -> list[float]:
    return sorted(float(n.replace(",", "")) for n in NUM.findall(text))


def numbers_kept(src: str, out: str) -> bool:
    """Every number in the source survives, and nothing new appears except small counting
    numbers (a translator may write "one trip" as "1 trip")."""
    have = numbers(out)
    for v in numbers(src):
        if v not in have:
            return False
        have.remove(v)
    return all(v <= 10 for v in have)


_memo: dict[tuple[str, str], str] = {}


async def localise(en: str, hi: str, lang: str) -> str:
    """The text in the farmer's language. English and Hindi are written by hand; others are
    translated by the LLM and kept only if every number survives. Falls back to English."""
    if lang == "hi":
        return hi
    if lang == "en" or lang not in LANGS:
        return en
    if (lang, en) in _memo:
        return _memo[(lang, en)]
    name = f"{LANGS[lang].english} ({LANGS[lang].native})"
    try:
        msg = await chat(
            [
                {
                    "role": "system",
                    "content": f"Translate the farmer-facing message into simple {name}, in its "
                    "usual script. Keep every number as digits, exactly. Keep names of places and "
                    "mandis in Latin letters. Reply with the translation only.",
                },
                {"role": "user", "content": en},
            ]
        )
        out = str(msg.get("content") or "").strip()
    except Exception as e:
        log.warning("translate failed: %s", e)
        return en
    if not out or not numbers_kept(en, out):
        log.warning("translation to %s dropped or changed numbers; using English", lang)
        return en
    _memo[(lang, en)] = out
    return out
