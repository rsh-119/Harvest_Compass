"""Ask the agent a question from the terminal and print the live trace.
uv run python -m scripts.ask "मेरे पास 40 क्विंटल सोयाबीन है..." [--fault weather_ecmwf]
"""

import argparse
import asyncio
import json
import sys

from app.agent.state import AskRequest
from app.data.cache import close_pool
from app.http import client
from app.main import run_agent


async def main(text: str, faults: list[str]) -> None:
    async for line in run_agent(AskRequest(text=text, faults=faults)):
        ev = json.loads(line.removeprefix("data: "))
        if ev["event"] == "final":
            print("\n=== ANSWER:", ev.get("answer") or ev.get("clarify"))
            r = ev.get("result") or {}
            for k in (
                "confidence",
                "confidence_reasons",
                "trend_per_day",
                "wait",
                "harvest_days",
                "invented_numbers",
            ):
                if k in r:
                    print(f"  {k}: {r[k]}")
            for i, m in enumerate(r.get("ranking", [])[:5], 1):
                print(
                    f"  #{i} {m['market']:28} modal ₹{m['modal_price']:.0f} ({m['age_days']}d) "
                    f"{m['road_km']} km → net ₹{m['net_per_quintal']}/q, bad-day ₹{m['conservative_net_per_quintal']}"
                )
            print(f"  excluded: {len(r.get('excluded', []))}")
        else:
            extra = f" [{ev.get('status')}]" if ev.get("status") else ""
            print(f"{ev['event']:13}{extra} {ev['en'][:160]}")
    await client.aclose()
    await close_pool()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("--fault", action="append", default=[])
    a = ap.parse_args()
    if sys.platform == "win32":  # psycopg async can't use Windows' default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(a.text, a.fault))
