"""Everything the agent knows during one question. Nodes read it and return updates."""

from datetime import date
from typing import Any, Literal, TypedDict

from pydantic import BaseModel, Field

from app.config import settings
from app.data.cache import Sourced
from app.languages import LangCode
from app.scoring.audit_rules import Finding
from app.tools.geocode import Place
from app.tools.mandi import PriceRow
from app.tools.routing import Route


class Intent(BaseModel):
    crop: str | None = None  # data.gov.in commodity name, e.g. "Soyabean"
    crop_word: str | None = None  # what the farmer said
    variety: str | None = None
    quantity: float | None = None
    unit: Literal["quintal", "bori", "kg", "ton"] | None = None
    village: str | None = None  # Latin script
    village_as_said: str | None = None  # original script, e.g. "खाचरौद" (OSM has Hindi names too)
    district: str | None = None
    ready_from: date | None = None
    ready_to: date | None = None
    already_harvested: bool = False
    has_storage: bool = False
    wait_days: int | None = None
    rate_per_km: float | None = None  # vehicle hire the farmer said
    capacity_q: float | None = None  # quintals per trip the farmer said


class Params(BaseModel):
    """Farmer-editable numbers from the UI's edit boxes. Vehicle hire has no default: if the
    farmer hasn't given it here or in words, the agent asks (no made-up rates)."""

    rate_per_km: float | None = Field(default=None, gt=0)
    capacity_q: float | None = Field(default=None, gt=0)
    other_charges_per_q: float = Field(
        default=0, ge=0
    )  # hammali/weighing, set per mandi by bye-law
    bori_kg: float | None = Field(default=None, gt=0)  # no default: we ask
    qty_confirmed: bool = False  # farmer confirmed an unusually large quantity
    radius_km: float = Field(default=settings.radius_km, gt=0, le=300)


class AskRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    previous: Intent | None = None  # intent from the last turn, when answering a clarification
    question: str | None = Field(default=None, max_length=300)  # the question being answered
    place: Place | None = None  # village the farmer confirmed
    params: Params = Params()
    faults: list[str] = []
    recalc: bool = False  # "Change your numbers": the edit boxes win over the words
    speak: bool = False  # also send the reply as audio (if the language has a voice)
    lang: LangCode = "en"  # language of questions, answer and voice
    mode: Literal["pipeline", "multi"] | None = None  # override AGENT_MODE for this question


class Mandi(BaseModel):
    key: str  # "market|district"
    market: str
    district: str
    row: PriceRow | None = None  # the price we judge (latest like-for-like row)
    location: Place | None = None
    route: Route | None = None
    findings: list[Finding] = []
    usable: bool = False


class AgentState(TypedDict, total=False):
    request: AskRequest
    faults: set[str]
    intent: Intent
    quantity_q: float
    place: Place
    region: str  # the farmer's state, as OpenStreetMap names it
    clarify: dict[str, Any]
    plan: list[dict[str, str]]
    radius_km: float
    current: Sourced[list[PriceRow]]
    history: list[PriceRow]
    weather: Sourced[dict[str, Any]]
    rows: list[PriceRow]  # latest row per (mandi, variety, grade): today's, else newest history
    no_prices: str  # "not_loaded" / "no_reports" when nothing is stored for this state and crop
    mandis: list[Mandi]
    group: tuple[str, str]
    repairs: int
    notes: list[str]
    result: dict[str, Any]
    answer: str
    supervisor_turns: int  # multi-agent mode: supervisor decisions so far
    widen: bool  # multi-agent mode: supervisor sent the market agent out again
