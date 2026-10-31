"""Turn the farmer's words into a structured intent, or ask ONE short clarifying question.

The LLM only extracts what was said (strict schema). Crop names go through our synonym
table, and villages are matched against real OpenStreetMap places. Nothing is geocoded from
an unconfirmed guess.
"""

import json
from typing import Any

from rapidfuzz import fuzz

from app.agent.state import AgentState, Intent
from app.agent.trace import emit
from app.clock import today_ist
from app.config import settings
from app.data.synonyms import normalize_crop
from app.faults import clean
from app.llm import chat
from app.tools.geocode import Place, search
from app.tools.routing import haversine_km

SCHEMA = {
    "type": "object",
    "properties": {
        "crop_word": {
            "type": ["string", "null"],
            "description": "crop exactly as the farmer said it",
        },
        "crop_english": {
            "type": ["string", "null"],
            "description": "English crop name, e.g. Soybean, Onion",
        },
        "variety": {"type": ["string", "null"]},
        "quantity": {"type": ["number", "null"]},
        "unit": {"type": ["string", "null"], "enum": ["quintal", "bori", "kg", "ton", None]},
        "village": {
            "type": ["string", "null"],
            "description": "village/town name transliterated to Latin script",
        },
        "district": {"type": ["string", "null"], "description": "district in Latin script if said"},
        "ready_from": {
            "type": ["string", "null"],
            "description": "ISO date the crop is ready from",
        },
        "ready_to": {"type": ["string", "null"], "description": "ISO date of the last ready day"},
        "already_harvested": {"type": "boolean"},
        "has_storage": {"type": "boolean"},
        "wait_days": {
            "type": ["integer", "null"],
            "description": "if asked 'what if I wait N days'",
        },
        "rate_per_km": {
            "type": ["number", "null"],
            "description": "vehicle hire in rupees per km, if said",
        },
        "capacity_q": {
            "type": ["number", "null"],
            "description": "quintals one vehicle trip carries, if said",
        },
    },
    "required": ["crop_word", "quantity", "unit", "village", "already_harvested", "has_storage"],
}

PROMPT = """You extract a farmer's request (Hindi, Hinglish or English) into the set_intent tool.
Today is {today}. Convert relative dates (aaj, kal, parson, agle hafte, 5 din baad) to ISO dates.
Number words count: "chalis" = 40. "bori"/"bora" = unit bori. Transliterate the village to Latin.
Only fill what the farmer actually said; use null otherwise. Never guess."""


def _merge(old: Intent | None, new: Intent) -> Intent:
    """A clarification answer only fills gaps. It doesn't wipe what we already knew."""
    if old is None:
        return new
    data = old.model_dump()
    data.update({k: v for k, v in new.model_dump().items() if v not in (None, False)})
    return Intent(**data)


async def extract(text: str, question: str | None = None) -> Intent:
    # "30, 25" only makes sense next to the question it answers.
    user = text if question is None else f"Assistant asked: {question}\nFarmer answered: {text}"
    msg = await chat(
        [
            {"role": "system", "content": PROMPT.format(today=today_ist().isoformat())},
            {"role": "user", "content": user},
        ],
        tools=[{"type": "function", "function": {"name": "set_intent", "parameters": SCHEMA}}],
        tool_choice={"type": "function", "function": {"name": "set_intent"}},
    )
    args: dict[str, Any] = json.loads(msg["tool_calls"][0]["function"]["arguments"])
    crop = normalize_crop(args.get("crop_word") or "") or normalize_crop(
        args.get("crop_english") or ""
    )
    unit = args.get("unit") if args.get("unit") in ("quintal", "bori", "kg", "ton") else None
    return Intent(
        crop=crop,
        crop_word=args.get("crop_word"),
        variety=args.get("variety"),
        quantity=args.get("quantity"),
        unit=unit,
        village=args.get("village"),
        district=args.get("district"),
        ready_from=args.get("ready_from") or None,
        ready_to=args.get("ready_to") or None,
        already_harvested=bool(args.get("already_harvested")),
        has_storage=bool(args.get("has_storage")),
        wait_days=args.get("wait_days"),
        rate_per_km=args.get("rate_per_km") or None,
        capacity_q=args.get("capacity_q") or None,
    )


def to_quintals(i: Intent, bori_kg: float | None) -> float | None:
    if i.quantity is None or i.quantity <= 0:
        return None
    factor = {"quintal": 1.0, "kg": 0.01, "ton": 10.0, None: 1.0}.get(i.unit)
    if i.unit == "bori":
        return None if bori_kg is None else i.quantity * bori_kg / 100
    return None if factor is None else i.quantity * factor


async def match_village(name: str, district: str | None) -> tuple[Place | None, list[Place]]:
    """(confident match, candidates to confirm). Confident = fuzzy score ≥ 90 and at least 10
    points ahead of the runner-up."""
    q = ", ".join(p for p in (name, district, settings.state, "India") if p)
    res = await search(q, limit=5)
    emit(
        "tool_call",
        f"Looking up village '{name}' on OpenStreetMap",
        f"गाँव '{name}' खोजा जा रहा है",
        tool="geocode",
        status=res.status,
        source_url=res.source_url,
    )
    cands = [p for p in res.data or [] if settings.state.lower() in p.display_name.lower()]
    scored = sorted(
        ((fuzz.WRatio(name.lower(), p.name.lower()), p) for p in cands), key=lambda x: -x[0]
    )
    if not scored:
        return None, []
    best_score, best = scored[0]
    # OSM often returns one place twice (town + tahsil area). Entries within 10 km of the best
    # are the same place, so they don't make the answer ambiguous.
    others = [s for s, p in scored[1:] if haversine_km((best.lat, best.lon), (p.lat, p.lon)) > 10]
    runner = others[0] if others else 0
    # Two places with equally good names (MP has many "Rampur"s) are ambiguous: ask, don't pick.
    if best_score >= 90 and best_score - runner >= 10:
        return best, []
    return None, [p for s, p in scored[:3] if s >= 60]


def _ask(question_hi: str, question_en: str, intent: Intent, **extra: Any) -> dict[str, Any]:
    emit("clarify", question_en, question_hi)
    return {
        "clarify": {
            "hi": question_hi,
            "en": question_en,
            "intent": intent.model_dump(mode="json"),
            **extra,
        }
    }


async def understand(state: AgentState) -> dict[str, Any]:
    req = state["request"]
    intent = _merge(req.previous, await extract(req.text, req.question))
    emit(
        "understand",
        f"Understood: {intent.model_dump(mode='json', exclude_none=True, exclude_defaults=True)}",
        "आपकी बात समझी",
        intent=intent.model_dump(mode="json"),
    )
    crops_hi = "सोयाबीन या प्याज़"
    if intent.crop is None:
        if intent.crop_word:
            return _ask(
                f"माफ़ कीजिए, अभी हम सिर्फ़ {crops_hi} के लिए सलाह देते हैं।",
                f"Sorry, '{intent.crop_word}' isn't supported yet. Supported: {settings.crops}",
                intent,
                unsupported=True,
            )
        return _ask(f"कौन सी फसल बेचनी है — {crops_hi}?", "Which crop?", intent)
    qty = to_quintals(intent, req.params.bori_kg)
    if qty is None:
        if intent.unit == "bori" and intent.quantity:
            return _ask(
                "एक बोरी में कितने किलो माल है?", "How many kg in one bori?", intent, needs="bori_kg"
            )
        return _ask("कितना माल है? (क्विंटल में)", "How much (quintals)?", intent)
    place: Place | None = req.place
    if place is None:
        if not intent.village:
            return _ask("आपका गाँव कौन सा है?", "Which village?", intent)
        place, options = await match_village(intent.village, intent.district)
        if place is None and options:
            o = options[0]
            return _ask(
                f"क्या आपका गाँव {o.name} है? ({o.display_name})",
                f"Is your village {o.name}?",
                intent,
                options=[p.model_dump() for p in options],
            )
        if place is None:
            return _ask(
                "आपका गाँव नहीं मिला। गाँव और ज़िले का नाम बताइए।",
                "Village not found. Please say village and district.",
                intent,
            )
        emit("understand", f"Village matched: {place.display_name}", f"गाँव मिला: {place.name}")
    # Edit boxes win over words. Neither given -> ask; we never assume a hire rate.
    rate = req.params.rate_per_km or intent.rate_per_km
    cap = req.params.capacity_q or intent.capacity_q
    if rate is None or cap is None:
        q_hi, q_en = {
            (True, True): (
                "गाड़ी का किराया कितने रुपये प्रति किलोमीटर है, और एक चक्कर में कितने क्विंटल आता है?",
                "Vehicle hire in ₹ per km, and how many quintals per trip?",
            ),
            (True, False): (
                "गाड़ी का किराया कितने रुपये प्रति किलोमीटर है?",
                "Vehicle hire in ₹ per km?",
            ),
            (False, True): ("एक चक्कर में गाड़ी में कितने क्विंटल आता है?", "Quintals per trip?"),
        }[(rate is None, cap is None)]
        # The confirmed place goes back with the question, so it isn't matched again.
        return _ask(q_hi, q_en, intent, needs="vehicle", place=place.model_dump())
    params = req.params.model_copy(update={"rate_per_km": rate, "capacity_q": cap})
    return {
        "request": req.model_copy(update={"params": params}),
        "intent": intent,
        "quantity_q": qty,
        "place": place,
        "faults": clean(req.faults),
        "radius_km": req.params.radius_km,
        "repairs": 0,
        "notes": [],
    }
