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
from app.data.crops import normalize_crop
from app.data.regions import state_of
from app.faults import clean
from app.languages import localise
from app.llm import chat
from app.tools.geocode import Place, search, search_settlements
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
            "description": "plain English crop name, e.g. Soybean, Onion, Wheat, Paddy, Potato, Chickpea",
        },
        "variety": {"type": ["string", "null"]},
        "quantity": {"type": ["number", "null"]},
        "unit": {"type": ["string", "null"], "enum": ["quintal", "bori", "kg", "ton", None]},
        "village": {
            "type": ["string", "null"],
            "description": "village/town name transliterated to Latin script",
        },
        "village_as_said": {
            "type": ["string", "null"],
            "description": "village exactly as the farmer said it, in the original script",
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

LARGE_QTY_Q = 2000  # 200 tonnes: far above a typical MP farm's harvest, worth a check

PROMPT = """You extract a farmer's request into the set_intent tool. It may be in English, Hindi,
Hinglish or any Indian language, in any script. Put the crop word as the farmer said it in crop_word.
Today is {today}. Convert relative dates (aaj, kal, parson, agle hafte, 5 din baad) to ISO dates.
Number words and native-script digits count: "chalis" = 40. "bori"/"bora"/sack = unit bori.
Transliterate the village to Latin using its usual English spelling where you know it
(महू = Mhow, खाचरौद = Khachrod).
Only fill what the farmer actually said; use null otherwise. Never guess."""


def is_new_question(old: Intent | None, new: Intent) -> bool:
    """A different crop, or a different village said together with a crop or quantity, is a new
    question: nothing from the old one (vehicle, place, dates) may carry over. A bare village
    name is an answer to "which village?", so it isn't."""
    if old is None:
        return False
    if new.crop and old.crop and new.crop != old.crop:
        return True
    moved = bool(
        new.village and old.village and new.village.strip().lower() != old.village.strip().lower()
    )
    return moved and bool(new.crop or new.quantity)


def _merge(old: Intent | None, new: Intent) -> Intent:
    """A clarification answer only fills gaps. It doesn't wipe what we already knew. Values in
    the new message always win; a new question starts from scratch."""
    if old is None or is_new_question(old, new):
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
        village_as_said=args.get("village_as_said"),
        district=args.get("district"),
        ready_from=args.get("ready_from") or None,
        ready_to=args.get("ready_to") or None,
        already_harvested=bool(args.get("already_harvested")),
        has_storage=bool(args.get("has_storage")),
        wait_days=args.get("wait_days"),
        rate_per_km=args.get("rate_per_km") or None,
        capacity_q=args.get("capacity_q") or None,
    )


def summary(i: Intent) -> str:
    """'soybean, 40 quintal, Sanwer (Indore), ₹30/km, 40 q per trip' for the trace."""
    dates = None
    if i.ready_from:
        dates = f"ready {i.ready_from}" + (f" to {i.ready_to}" if i.ready_to else "")
    parts = [
        i.crop_word or i.crop,
        f"{i.quantity:g} {i.unit or 'quintal'}" if i.quantity else None,
        f"{i.village} ({i.district})" if i.village and i.district else i.village or i.district,
        dates,
        f"₹{i.rate_per_km:g}/km" if i.rate_per_km else None,
        f"{i.capacity_q:g} q per trip" if i.capacity_q else None,
        "has storage" if i.has_storage else None,
        f"wait {i.wait_days} days" if i.wait_days else None,
    ]
    return ", ".join(x for x in parts if x) or "nothing yet"


def to_quintals(i: Intent, bori_kg: float | None) -> float | None:
    if i.quantity is None or i.quantity <= 0:
        return None
    factor = {"quintal": 1.0, "kg": 0.01, "ton": 10.0, None: 1.0}.get(i.unit)
    if i.unit == "bori":
        return None if bori_kg is None else i.quantity * bori_kg / 100
    return None if factor is None else i.quantity * factor


def _tahsil(p: Place) -> str:
    """'Dr. Ambedkar Nagar, Mhow Tahsil, Indore, ...' -> 'mhow'."""
    part = next((x for x in p.display_name.split(", ") if x.endswith(" Tahsil")), "")
    return part.removesuffix(" Tahsil").lower()


def _score(name: str, p: Place) -> float:
    # A town is also known by its tahsil's name (OSM: "Dr. Ambedkar Nagar" is Mhow). Only for
    # towns: every village in Mhow Tahsil would match "Mhow" otherwise.
    s = fuzz.WRatio(name.lower(), p.name.lower())
    if p.kind in ("city", "town") and _tahsil(p):
        s = max(s, fuzz.WRatio(name.lower(), _tahsil(p)))
    return float(s)


def _plausible(scored: list[tuple[float, Place]]) -> list[Place]:
    """Distinct good matches: score 90+, and more than 10 km from each other (OSM often lists
    one place twice, as the town and its tahsil area)."""
    out: list[Place] = []
    for s, p in scored:
        if s >= 90 and all(haversine_km((p.lat, p.lon), (q.lat, q.lon)) > 10 for q in out):
            out.append(p)
    return out


async def match_village(
    name: str, district: str | None, as_said: str | None = None
) -> tuple[Place | None, list[Place]]:
    """(confident match, candidates to confirm). Confident = fuzzy score ≥ 90 and at least 10
    points ahead of the runner-up."""
    # Try in order until OSM returns a real settlement:
    #   Latin name; the farmer's own words (OSM also indexes Hindi names); and, with no district,
    #   "Shajapur, Shajapur" (alone, "Shajapur" finds only the district).
    queries = [", ".join(p for p in (name, district, "India") if p)]
    if as_said and as_said != name:
        queries.append(", ".join(p for p in (as_said, district, "India") if p))
    if not district:
        queries.append(f"{name}, {name}, India")
    found: dict[str, Place] = {}
    for q in queries:
        res = await search_settlements(q, limit=10)
        for pl in res.data or []:
            found.setdefault(pl.display_name, pl)
        # With a district the first hit is the answer. Without one, "Rampur, India" returns
        # only the best-known Rampur; the other queries surface the rest, so we try them all.
        if found and district:
            break
    emit(
        "tool_call",
        f"Looking up village '{name}' on OpenStreetMap",
        f"गाँव '{name}' खोजा जा रहा है",
        tool="geocode",
        status=res.status,
        source_url=res.source_url,
    )
    cands = [p for p in found.values() if state_of(p.display_name)]  # anywhere in India
    scored = sorted(((_score(name, p), p) for p in cands), key=lambda x: -x[0])
    if not scored:
        # Some towns exist in OSM only as their tahsil (Badnagar, Mahidpur). Offer the tahsil
        # as a question, never as a silent answer: its point can be a few km from the town.
        tahsils = await search(f"{name} Tahsil, {district or ''}, India", limit=3)
        opts = [
            p
            for p in tahsils.data or []
            if p.name.endswith(" Tahsil") and fuzz.WRatio(name.lower(), p.name[:-7].lower()) >= 90
        ]
        return None, opts
    best_score, best = scored[0]
    # OSM often returns one place twice (town + tahsil area). Entries within 10 km of the best
    # are the same place, so they don't make the answer ambiguous.
    others = [s for s, p in scored[1:] if haversine_km((best.lat, best.lon), (p.lat, p.lon)) > 10]
    runner = others[0] if others else 0
    # Two places with equally good names (India has many "Rampur"s) are ambiguous: ask, don't pick.
    if best_score >= 90 and best_score - runner >= 10:
        return best, []
    plausible = _plausible(scored)
    return None, plausible[:5] if len(plausible) > 1 else [p for s, p in scored[:3] if s >= 60]


async def _ask(
    question_hi: str, question_en: str, intent: Intent, lang: str, **extra: Any
) -> dict[str, Any]:
    emit("clarify", question_en, question_hi)
    return {
        "clarify": {
            "hi": question_hi,
            "en": question_en,
            "text": await localise(question_en, question_hi, lang),
            "intent": intent.model_dump(mode="json"),
            **extra,
        }
    }


async def understand(state: AgentState) -> dict[str, Any]:
    req = state["request"]
    said = await extract(req.text, req.question)
    fresh = is_new_question(req.previous, said)
    intent = _merge(req.previous, said)
    emit(
        "understand",
        f"Understood: {summary(intent)}",
        "आपकी बात समझी",
        intent=intent.model_dump(mode="json"),
    )
    if intent.crop is None:
        if intent.crop_word:
            return await _ask(
                f"माफ़ कीजिए, '{intent.crop_word}' मंडी भाव की सूची में नहीं मिला। फसल का दूसरा नाम बताइए।",
                f"Sorry, I couldn't find '{intent.crop_word}' in the mandi price list. Try another name for the crop.",
                intent,
                req.lang,
                unsupported=True,
            )
        return await _ask(
            "कौन सी फसल बेचनी है?",
            "Which crop are you selling?",
            intent,
            req.lang,
        )
    qty = to_quintals(intent, req.params.bori_kg)
    if qty is None:
        if intent.unit == "bori" and intent.quantity:
            return await _ask(
                "एक बोरी में कितने किलो माल है?",
                "How many kg are in one sack?",
                intent,
                req.lang,
                needs="bori_kg",
            )
        return await _ask(
            "कितना माल है? (क्विंटल में)", "How much do you have, in quintals?", intent, req.lang
        )
    if qty > LARGE_QTY_Q and not req.params.qty_confirmed:
        # Often "kilo" heard as "quintal". Confirm instead of planning 400 truck trips.
        return await _ask(
            f"क्या सच में {qty:g} क्विंटल माल है? सही है तो 'हाँ' दबाएँ, नहीं तो सही मात्रा बताएँ।",
            f"Do you really have {qty:g} quintals? Tap 'Yes' if that's right, or tell me the correct amount.",
            intent,
            req.lang,
            needs="confirm_qty",
        )
    place: Place | None = None if fresh else req.place
    if place is None and not intent.village and intent.district:
        # "सोयाबीन है, शाजापुर": a lone town name lands in district; it's where they are.
        intent = intent.model_copy(update={"village": intent.district})
    if place is None:
        if not intent.village:
            return await _ask("आपका गाँव कौन सा है?", "Which village are you in?", intent, req.lang)
        place, options = await match_village(
            intent.village, intent.district, intent.village_as_said
        )
        if place is None and len(options) > 1:
            n, n_hi = intent.village, intent.village_as_said or intent.village
            return await _ask(
                f"कौन सा {n_hi}? अपना गाँव चुनिए (ज़िला और तहसील साथ में लिखे हैं)।",
                f"Which {n}? Pick your village (district and tahsil are shown).",
                intent,
                req.lang,
                options=[p.model_dump() for p in options],
            )
        if place is None and options:
            o = options[0]
            return await _ask(
                f"क्या आपका गाँव {o.name} है? ({o.display_name})",
                f"Is your village {o.name}? ({o.display_name})",
                intent,
                req.lang,
                options=[p.model_dump() for p in options],
            )
        if place is None:
            return await _ask(
                "आपका गाँव नहीं मिला। गाँव और ज़िले का नाम बताइए।",
                "I couldn't find your village. Please tell me the village and the district.",
                intent,
                req.lang,
            )
        emit("understand", f"Village matched: {place.display_name}", f"गाँव मिला: {place.name}")
    region = state_of(place.display_name)
    if region is None:
        return await _ask(
            "यह जगह भारत के किसी राज्य में नहीं मिली। गाँव और ज़िले का नाम बताइए।",
            "That place isn't in an Indian state I can recognise. Please tell me the village and district.",
            intent,
            req.lang,
        )
    # Words in this message win, then the edit boxes, then what was said earlier. Only
    # "Change your numbers" (recalc) lets the edit boxes beat the words, since it resends the
    # original question. Neither given -> ask; we never assume a hire rate.
    p = req.params
    if req.recalc:
        rate = p.rate_per_km or intent.rate_per_km
        cap = p.capacity_q or intent.capacity_q
    else:
        rate = said.rate_per_km or p.rate_per_km or intent.rate_per_km
        cap = said.capacity_q or p.capacity_q or intent.capacity_q
    if rate is None or cap is None:
        q_hi, q_en = {
            (True, True): (
                "गाड़ी का किराया कितने रुपये प्रति किलोमीटर है, और एक चक्कर में कितने क्विंटल आता है?",
                "What does your vehicle cost per km in rupees, and how many quintals does one trip carry?",
            ),
            (True, False): (
                "गाड़ी का किराया कितने रुपये प्रति किलोमीटर है?",
                "What does your vehicle cost per km, in rupees?",
            ),
            (False, True): (
                "एक चक्कर में गाड़ी में कितने क्विंटल आता है?",
                "How many quintals does one trip carry?",
            ),
        }[(rate is None, cap is None)]
        # The confirmed place goes back with the question, so it isn't matched again.
        return await _ask(q_hi, q_en, intent, req.lang, needs="vehicle", place=place.model_dump())
    params = req.params.model_copy(update={"rate_per_km": rate, "capacity_q": cap})
    return {
        "request": req.model_copy(update={"params": params}),
        "intent": intent,
        "quantity_q": qty,
        "place": place,
        "region": region,
        "faults": clean(req.faults),
        "radius_km": req.params.radius_km,
        "repairs": 0,
        "notes": [],
    }
