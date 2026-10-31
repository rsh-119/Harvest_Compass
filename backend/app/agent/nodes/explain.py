"""Short answer in the farmer's language, written by the LLM ONLY from computed facts, then checked: every number
in the text must exist in the facts. One retry, then a fixed template. Invented numbers are
counted and logged."""

import json
import logging
import re
from datetime import date
from typing import Any

from app.agent.state import AgentState
from app.agent.trace import emit
from app.languages import LANGS, localise
from app.llm import chat

log = logging.getLogger("explain")
# \d matches digits in every Indian script, and float() reads them, so the check works in any language.
NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
MONTHS_HI = [
    "जनवरी",
    "फ़रवरी",
    "मार्च",
    "अप्रैल",
    "मई",
    "जून",
    "जुलाई",
    "अगस्त",
    "सितंबर",
    "अक्टूबर",
    "नवंबर",
    "दिसंबर",
]

PROMPT = """You are speaking to a farmer in simple {language}. Use ONLY the facts in the JSON.
Max 60 words (about 20 seconds spoken). Say: best mandi, net rupees per quintal and total, safest
harvest days if given (if there are none, don't mention harvest days), confidence. Write every number with digits, copied exactly from the facts.
Do not add any other number. If "wait" is present, say it is a trend, not a forecast.
The net figure is the money in hand after transport and charges, NOT profit (cultivation cost is
not subtracted), so never call it profit. Write month names and the confidence word in the
farmer's language too.{extra}
Write mandi names exactly as given in the facts, in Latin letters. Never translate them."""
HINDI_EXTRA = """ Say "खर्च काटकर आपके हाथ में" or "शुद्ध भाव". Never say "लाभ" or "मुनाफ़ा"."""


def hi_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {MONTHS_HI[d.month - 1]}"


def en_date(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%d %b").lstrip("0")


def facts_for(result: dict[str, Any], lang: str = "hi") -> dict[str, Any]:
    """The small set of facts the LLM may use (never raw payloads)."""
    b = result["best"]
    day = hi_date if lang == "hi" else en_date
    conf = (
        {"high": "ऊँचा", "medium": "मध्यम", "low": "कम"}
        if lang == "hi"
        else {"high": "high", "medium": "medium", "low": "low"}
    )
    f: dict[str, Any] = {
        "crop": result["crop"],
        "quantity_quintal": result["quantity_q"],
        "best_mandi": b["market"],
        "road_km": b["road_km"],
        "modal_price_today": b["modal_price"],
        "price_used_7day_median": b["price_used"],
        "price_date": day(b["arrival_date"]),
        "net_per_quintal": b["net_per_quintal"],
        "net_total": b["net_total"],
        "transport_total": b["transport_total"],
        "confidence": conf[result["confidence"]],
    }
    if r := result.get("runner_up"):
        f["runner_up"] = r["market"]
        f["runner_up_net_per_quintal"] = r["net_per_quintal"]
    if np := result.get("nearer_pick"):
        f["farther_mandi_skipped"] = np["skipped"]
        f["farther_mandi_extra_per_quintal"] = np["extra_per_quintal"]
        f["farther_mandi_extra_km"] = np["extra_km"]
    if days := result.get("harvest_days"):
        f["safest_days"] = [day(d["day"]) for d in days[:2]]
    if w := result.get("wait"):
        f["wait_days"] = w["days"]
        if w["trend_change_per_quintal"] is not None:
            f["trend_change_per_quintal_if_wait"] = w["trend_change_per_quintal"]
    return f


def allowed_numbers(facts: Any) -> set[float]:
    """Every number that appears anywhere in the facts (including inside date strings)."""
    out: set[float] = set()
    if isinstance(facts, bool):
        return out
    if isinstance(facts, int | float):
        out |= {float(facts), float(round(facts)), abs(float(facts))}
    elif isinstance(facts, str):
        out |= {float(n.replace(",", "")) for n in NUM.findall(facts)}
    elif isinstance(facts, dict):
        for v in facts.values():
            out |= allowed_numbers(v)
    elif isinstance(facts, list):
        for v in facts:
            out |= allowed_numbers(v)
    return out


def invented_numbers(text: str, allowed: set[float]) -> list[str]:
    bad = []
    for n in NUM.findall(text):
        v = float(n.replace(",", "").rstrip("."))
        if not any(abs(v - a) <= 0.5 for a in allowed):
            bad.append(n)
    return bad


def template(f: dict[str, Any]) -> str:
    s = (
        f"{f['best_mandi']} मंडी सबसे अच्छी है। खर्च काटकर {f['net_per_quintal']} रुपये प्रति क्विंटल, "
        f"कुल {f['net_total']} रुपये मिलेंगे।"
    )
    if "safest_days" in f:
        s += f" कटाई के लिए सबसे सुरक्षित दिन: {', '.join(f['safest_days'])}।"
    return s + f" भरोसा: {f['confidence']}।"


def template_en(f: dict[str, Any]) -> str:
    s = (
        f"{f['best_mandi']} is the best mandi. After transport you get {f['net_per_quintal']} rupees "
        f"per quintal, {f['net_total']} rupees in all."
    )
    if "safest_days" in f:
        s += f" Safest days to harvest: {', '.join(f['safest_days'])}."
    return s + f" Confidence: {f['confidence']}."


async def explain(state: AgentState) -> dict[str, Any]:
    result = state["result"]
    lang = state["request"].lang
    if result.get("best") is None:
        answer = await localise(
            "Sorry, no mandi with trustworthy prices was found right now. Please ask again a little later.",
            "माफ़ कीजिए, अभी भरोसेमंद भाव वाली कोई मंडी नहीं मिली। थोड़ी देर बाद फिर पूछिए।",
            lang,
        )
        emit("explain", "No recommendation possible", answer, invented=0)
        return {"answer": answer, "result": {**result, "invented_numbers": 0}}
    facts = facts_for(result, lang)
    language = f"{LANGS[lang].english} ({LANGS[lang].native}), in its usual script"
    prompt = PROMPT.format(language=language, extra=HINDI_EXTRA if lang == "hi" else "")
    allowed = allowed_numbers(facts)
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
    ]
    invented_total = 0
    answer = ""
    for attempt in range(2):
        try:
            text = str((await chat(messages)).get("content") or "").strip()
        except Exception as e:  # LLM down: the template still gives a correct answer
            log.warning("explain llm failed: %s", e)
            break
        bad = invented_numbers(text, allowed)
        invented_total += len(bad)
        # A transliterated name can turn into a different town (Badnagar -> "बदनावर" = Badnawar).
        name_ok = facts["best_mandi"] in text
        if text and not bad and name_ok:
            answer = text
            break
        problem = (
            f"numbers not in the facts {bad}"
            if bad
            else "empty answer"
            if not text
            else f"mandi name '{facts['best_mandi']}' missing or changed"
        )
        nxt = "retrying" if attempt == 0 else "using template"
        emit(
            "explain",
            f"LLM answer rejected: {problem}; {nxt}",
            "जवाब जाँच में फेल हुआ, दोबारा बनाया जा रहा है",
            invented=bad,
        )
        fix = (
            f"These numbers are not in the facts: {bad}. Rewrite using only fact numbers."
            if bad
            else "Answer now, briefly."
            if not text
            else f"Write the mandi name exactly as '{facts['best_mandi']}'."
        )
        messages += [{"role": "assistant", "content": text}, {"role": "user", "content": fix}]
    if not answer:
        answer = template(facts) if lang == "hi" else await localise(template_en(facts), "", lang)
    log.info("invented_numbers=%d", invented_total)
    emit(
        "explain",
        f"Answer ready (invented numbers caught: {invented_total})",
        answer,
        invented=invented_total,
    )
    return {
        "answer": answer,
        "result": {**result, "invented_numbers": invented_total, "facts": facts},
    }
