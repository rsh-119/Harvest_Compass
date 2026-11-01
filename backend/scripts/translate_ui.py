"""Generate the site's page text for every language from frontend/locales/en.json.

English and Hindi are written by hand. The other 21 languages are machine-translated once by
the LLM and saved as files, so the site never translates at runtime. Every string is checked
on its own: same {placeholders}, every number kept, no Hindi script leaking into another
script. Strings that fail are retried; any that still fail stay English.

Strings missing from a language file, or still identical to English, are (re)translated, so
running it again after editing en.json only costs the new strings.

    uv run python -m scripts.translate_ui            # every language
    uv run python -m scripts.translate_ui ta bn      # only these languages
"""

import asyncio
import json
import re
import sys
from collections import Counter
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
DEVANAGARI = re.compile("[ऀ-ॣ०-ॿ]")  # not the danda, shared by other scripts
DEVANAGARI_LANGS = {"hi", "mr", "mai", "ne", "kok", "doi", "brx", "sa"}
reasons: Counter[str] = Counter()


def flat(x: Any, path: str = "") -> dict[str, str]:
    """{"home": {"steps": [{"t": "..."}]}} -> {"home.steps.0.t": "..."}"""
    if isinstance(x, dict):
        return {k2: v for k, v in x.items() for k2, v in flat(v, f"{path}{k}.").items()}
    if isinstance(x, list):
        return {k2: v for i, v in enumerate(x) for k2, v in flat(v, f"{path}{i}.").items()}
    # only text is translated; flags like "ai": true are copied from English by rebuild()
    return {path[:-1]: x} if isinstance(x, str) else {}


def rebuild(template: Any, values: dict[str, str], path: str = "") -> Any:
    if isinstance(template, dict):
        return {k: rebuild(v, values, f"{path}{k}.") for k, v in template.items()}
    if isinstance(template, list):
        return [rebuild(v, values, f"{path}{i}.") for i, v in enumerate(template)]
    return values.get(path[:-1], template)


def good(src: str, out: Any, lang: str) -> bool:
    why = None
    if not isinstance(out, str) or not out.strip():
        why = "empty"
    elif sorted(PLACEHOLDER.findall(src)) != sorted(PLACEHOLDER.findall(out)):
        why = "placeholder"
    elif not numbers_kept(PLACEHOLDER.sub("", src), PLACEHOLDER.sub("", out)):
        why = "number"
    elif lang not in DEVANAGARI_LANGS and DEVANAGARI.search(out):
        why = "devanagari"
    if why:
        reasons[why] += 1
    return why is None


def batches(items: dict[str, str], size: int = 1500) -> list[dict[str, str]]:
    out: list[dict[str, str]] = [{}]
    for k, v in items.items():
        if out[-1] and len(json.dumps(out[-1], ensure_ascii=False)) + len(v) > size:
            out.append({})
        out[-1][k] = v
    return out


async def translate(part: dict[str, str], lang: str, sem: asyncio.Semaphore) -> dict[str, str]:
    """Returns the strings that passed the checks (a subset of part's keys)."""
    name = f"{LANGS[lang].english} ({LANGS[lang].native})"
    msgs: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": f"Translate each JSON value into simple, natural {name} for farmers, in its "
            "usual script. Return only a JSON object with exactly the same keys. Keep {words} in "
            "braces unchanged. Keep every number as digits (0-9). Keep these in Latin letters: "
            f"{KEEP}.",
        },
        {"role": "user", "content": json.dumps(part, ensure_ascii=False)},
    ]
    async with sem:
        try:
            text = str((await chat(msgs, max_tokens=8000)).get("content") or "").strip()
            text = text.removeprefix("```json").removeprefix("```").removesuffix("```")
            out = json.loads(text)
        except Exception as e:
            reasons[f"call:{type(e).__name__}"] += 1
            return {}
    return {k: out[k] for k in part if k in out and good(part[k], out[k], lang)}


async def one_language(lang: str, en: dict[str, Any], sem: asyncio.Semaphore) -> None:
    path = LOCALES / f"{lang}.json"
    have = flat(json.loads(path.read_text(encoding="utf-8"))) if path.exists() else {}
    source = flat(en)
    todo = {k: v for k, v in source.items() if have.get(k, v) == v}  # missing or still English
    done: dict[str, str] = {}
    for _ in range(3):  # first pass, then two retries of whatever failed
        if not todo:
            break
        for got in await asyncio.gather(*(translate(b, lang, sem) for b in batches(todo))):
            done |= got
        todo = {k: v for k, v in todo.items() if k not in done}
    values = {k: v for k, v in have.items() if k in source} | done
    path.write_text(
        json.dumps(rebuild(en, values), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{lang}: {len(done)} new, {len(todo)} left in English", flush=True)


async def main(only: list[str]) -> None:
    en = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))
    langs = only or [c for c in LANGS if c not in ("en", "hi")]
    sem = asyncio.Semaphore(10)
    try:
        await asyncio.gather(*(one_language(lang, en, sem) for lang in langs))
    finally:
        await client.aclose()
    print("rejected strings by reason:", dict(reasons), flush=True)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
