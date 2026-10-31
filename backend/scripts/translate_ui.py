"""Generate the site's page text for every language from frontend/locales/en.json.

English and Hindi are written by hand. The other 21 languages are machine-translated once by
the LLM and saved as files, so the site never translates at runtime. Each chunk is checked:
same keys, same {placeholders}, every number kept. A chunk that fails twice stays English.

    uv run python -m scripts.translate_ui            # every language: add keys missing from its file
    uv run python -m scripts.translate_ui ta bn      # only these languages
"""

import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

from app.http import client
from app.languages import LANGS, numbers_kept
from app.llm import chat

LOCALES = Path(__file__).resolve().parents[2] / "frontend" / "locales"
KEEP = (
    "Harvest Compass, data.gov.in, Open-Meteo, ECMWF, GFS, OSRM, OpenStreetMap, Nominatim, "
    "Sarvam, OpenRouter, LangGraph, APMC, FORGE '26, ODbL, CC BY 4.0, API, URL, km, median, p95"
)
PLACEHOLDER = re.compile(r"\{\w+\}")
DEVANAGARI = re.compile("[ऀ-ॣ०-ॿ]")  # not the danda "।", shared by other scripts
DEVANAGARI_LANGS = {"hi", "mr", "mai", "ne", "kok", "doi", "brx", "sa"}


def strings(x: Any) -> list[str]:
    if isinstance(x, dict):
        return [s for v in x.values() for s in strings(v)]
    if isinstance(x, list):
        return [s for v in x for s in strings(v)]
    return [x]


def shape(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: shape(v) for k, v in x.items()}
    if isinstance(x, list):
        return [shape(v) for v in x]
    return "s"


def ok(src: Any, out: Any, lang: str) -> bool:
    if shape(src) != shape(out):
        return False
    for a, b in zip(strings(src), strings(out), strict=True):
        if not isinstance(b, str) or not b.strip():
            return False
        if sorted(PLACEHOLDER.findall(a)) != sorted(PLACEHOLDER.findall(b)):
            return False
        if not numbers_kept(PLACEHOLDER.sub("", a), PLACEHOLDER.sub("", b)):
            return False
        if lang not in DEVANAGARI_LANGS and DEVANAGARI.search(b):  # Hindi leaking into Tamil etc.
            return False
    return True


def chunks(section: dict[str, Any], size: int = 1800) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [{}]
    for k, v in section.items():
        if out[-1] and len(json.dumps(out[-1] | {k: v}, ensure_ascii=False)) > size:
            out.append({})
        out[-1][k] = v
    return out


async def translate(part: dict[str, Any], lang: str, sem: asyncio.Semaphore) -> dict[str, Any]:
    name = f"{LANGS[lang].english} ({LANGS[lang].native})"
    msgs: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": f"Translate the JSON values into simple, natural {name} for farmers, in "
            "its usual script. Return only the JSON object, same keys and structure. Keep {words} "
            f"in braces unchanged, keep every number as digits, and keep these in Latin: {KEEP}.",
        },
        {"role": "user", "content": json.dumps(part, ensure_ascii=False)},
    ]
    async with sem:
        for _ in range(2):
            try:
                text = str((await chat(msgs, max_tokens=8000)).get("content") or "")
                text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
                out = json.loads(text)
                if ok(part, out, lang):
                    return dict(out)
            except Exception as e:
                print(f"  {lang}: retry ({type(e).__name__})", flush=True)
    print(f"  {lang}: kept English for {list(part)[:3]}", flush=True)
    return part


async def one_language(lang: str, en: dict[str, Any], sem: asyncio.Semaphore) -> None:
    """Translates only keys the language file doesn't have yet, so edits to en.json are cheap."""
    path = LOCALES / f"{lang}.json"
    result: dict[str, Any] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for sec, body in en.items():
        have = result.get(sec, {})
        missing = {k: v for k, v in body.items() if k not in have}
        if not missing:
            continue
        parts = await asyncio.gather(*(translate(c, lang, sem) for c in chunks(missing)))
        result[sec] = have | {k: v for p in parts for k, v in p.items()}
    (LOCALES / f"{lang}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{lang}: done", flush=True)


async def main(only: list[str]) -> None:
    en = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))
    todo = only or [c for c in LANGS if c not in ("en", "hi")]
    sem = asyncio.Semaphore(8)
    try:
        await asyncio.gather(*(one_language(lang, en, sem) for lang in todo))
    finally:
        await client.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
