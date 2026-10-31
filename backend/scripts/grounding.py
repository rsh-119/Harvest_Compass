"""Grounding + Hindi check: 20 varied questions through the full agent, counting numbers in the
spoken answer that aren't in the computed facts (target 0). Run per model to pick the demo model.

uv run python -m scripts.grounding [--model anthropic/claude-sonnet-5.5]
"""

import argparse
import asyncio
import json
import re
import statistics
import sys
import time

from app.agent.state import AskRequest
from app.config import settings
from app.data.cache import close_pool
from app.http import client
from app.main import run_agent

V = "किराया 35 रुपये किलोमीटर, गाड़ी में 30 क्विंटल।"
QUESTIONS = [
    f"मेरे पास 40 क्विंटल सोयाबीन है, गाँव सांवेर, इंदौर। कहाँ बेचूँ? {V}",
    f"25 क्विंटल प्याज़ है, देपालपुर, इंदौर। {V}",
    f"soybean ready hai 60 quintal, Hatod Indore, mandi kaunsi achhi? {V}",
    f"अगर तीन दिन रुकूँ तो भाव बढ़ेगा क्या? 50 क्विंटल सोयाबीन, उज्जैन। रखने की जगह है। {V}",
    f"15 क्विंटल प्याज़ निकल चुका है, महू, इंदौर। {V}",
    f"कांदा बेचना है 20 क्विंटल, गाँव बेटमा, इंदौर। {V}",
    f"सोयाबीन 10 क्विंटल, देवास। फसल 3 नवंबर से 6 नवंबर के बीच तैयार। {V}",
    f"मेरे पास 100 क्विंटल सोयाबीन है, शाजापुर। {V}",
    f"प्याज़ 35 क्विंटल, बड़नगर, उज्जैन, अगले हफ्ते कटाई। {V}",
    f"soyabean 45 quintal, Tarana Ujjain, 5 din ruk jaun to? storage hai. {V}",
    f"सोयाबीन 8 क्विंटल, गौतमपुरा, इंदौर। {V}",
    f"प्याज़ 50 क्विंटल, सोनकच्छ, देवास। बारिश तो नहीं होगी? {V}",
    f"सोयाबीन 30 क्विंटल, बदनावर, धार। {V}",
    f"onion 12 quintal, Pithampur Dhar, already harvested. {V}",
    f"सोयाबीन 75 क्विंटल, खाचरौद, उज्जैन। {V}",
    f"प्याज़ 18 क्विंटल, सांवेर, इंदौर। रखने की जगह नहीं है। {V}",
    f"सोयाबीन 22 क्विंटल, आष्टा, सीहोर। {V}",
    f"सोयाबीन 40 क्विंटल, महिदपुर, उज्जैन। 2 दिन बाद तैयार होगी। {V}",
    f"प्याज़ 28 क्विंटल, कसरावद, खरगोन। {V}",
    f"सोयाबीन 55 क्विंटल, सोनकच्छ, देवास, 4 दिन रुकूँ तो? गोदाम है। {V}",
]


async def one(q: str) -> dict[str, object]:
    t0 = time.monotonic()
    final: dict[str, object] = {}
    async for line in run_agent(AskRequest(text=q)):
        ev = json.loads(line.removeprefix("data: "))
        if ev["event"] == "final":
            final = ev
    answer = str(final.get("answer") or "")
    result = final.get("result") or {}
    assert isinstance(result, dict)
    return {
        "q": q[:60],
        "answered": bool(answer),
        "clarify": (final.get("clarify") or {}).get("en") if final.get("clarify") else None,  # type: ignore[union-attr]
        "invented": result.get("invented_numbers"),
        "words": len(answer.split()),
        "devanagari": bool(re.search(r"[ऀ-ॿ]", answer)),
        "says_profit": any(w in answer for w in ("लाभ", "मुनाफ")),
        "s": round(time.monotonic() - t0, 1),
        "answer": answer,
    }


async def main(model: str | None) -> None:
    if model:
        settings.llm_model = model
    rows = []
    for q in QUESTIONS:
        r = await one(q)
        rows.append(r)
        print(json.dumps({k: v for k, v in r.items() if k != "answer"}, ensure_ascii=False))
    ans = [r for r in rows if r["answered"]]
    times = sorted(float(r["s"]) for r in rows)  # type: ignore[arg-type]
    print(
        json.dumps(
            {
                "model": settings.llm_model,
                "questions": len(rows),
                "answered": len(ans),
                "invented_total": sum(int(r["invented"] or 0) for r in ans),  # type: ignore[call-overload]
                "answers_with_invented": sum(1 for r in ans if r["invented"]),
                "non_hindi": sum(1 for r in ans if not r["devanagari"]),
                "says_profit": sum(1 for r in ans if r["says_profit"]),
                "over_60_words": sum(1 for r in ans if int(r["words"]) > 60),  # type: ignore[call-overload]
                "p50_s": statistics.median(times),
                "p95_s": times[int(0.95 * (len(times) - 1))],
            },
            ensure_ascii=False,
        )
    )
    for r in ans[:3]:
        print("  sample:", r["answer"])
    await client.aclose()
    await close_pool()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model")
    a = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(a.model))
