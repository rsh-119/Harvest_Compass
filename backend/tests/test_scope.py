import asyncio
from typing import Any

import pytest

from app.agent.state import AskRequest, Intent


def run_understand(
    monkeypatch: pytest.MonkeyPatch, said: Intent, selling: bool, calls: list[str] | None = None
) -> dict[str, Any]:
    from app.agent.nodes import understand as u

    async def fake_extract(text: str, question: str | None = None) -> Intent:
        return said

    async def fake_scope(text: str, question: str | None = None) -> bool:
        if calls is not None:
            calls.append(text)
        return selling

    monkeypatch.setattr(u, "extract", fake_extract)
    monkeypatch.setattr(u, "about_selling", fake_scope)
    req = AskRequest(text="x", lang="en")
    return asyncio.run(u.understand({"request": req}))  # type: ignore[typeddict-item]


def test_off_topic_question_gets_the_scope_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    """ "Which crops should I grow?" used to loop on "Which crop are you selling?"."""
    c = run_understand(monkeypatch, Intent(), selling=False)["clarify"]
    assert c["unsupported"] and "sell a crop you have" in c["en"]
    # a crop named, but a fertiliser question: same reply, not "how much do you have?"
    c = run_understand(monkeypatch, Intent(crop="Soyabean"), selling=False)["clarify"]
    assert "sell a crop you have" in c["en"]


def test_sell_question_is_never_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    # a quantity was said: the scope check isn't even called
    calls: list[str] = []
    said = Intent(crop="Wheat", quantity=20, unit="quintal")
    c = run_understand(monkeypatch, said, selling=False, calls=calls)
    assert calls == [] and "sell a crop you have" not in c["clarify"]["en"]
    # "where do I sell?" with nothing else yet: still asks for the crop
    c = run_understand(monkeypatch, Intent(), selling=True)["clarify"]
    assert c["en"] == "Which crop are you selling?"
