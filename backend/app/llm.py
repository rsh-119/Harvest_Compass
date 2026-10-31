"""OpenRouter chat completions (OpenAI-compatible). Model comes from LLM_MODEL."""

import logging
from typing import Any

from app.config import settings
from app.http import request_json

URL = "https://openrouter.ai/api/v1/chat/completions"
log = logging.getLogger("llm")


async def chat(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | None = None,
    # The model reasons before answering, and reasoning counts against max_tokens. Measured in
    # M4: 642 of 700 tokens went to reasoning, leaving an empty answer. So: low effort + headroom.
    max_tokens: int = 1500,
    retries: int = 1,
) -> dict[str, Any]:
    """Returns the assistant message. Temperature 0: we want extraction, not creativity."""
    body: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": 0,
        "max_tokens": max_tokens,
        "reasoning": {"effort": "low"},
    }
    if tools:
        body["tools"] = tools
    if tool_choice:
        body["tool_choice"] = tool_choice
    resp = await request_json(
        "POST",
        URL,
        json=body,
        # Measured over 7 days of real requests: the answer step's median is 3.5 s, p95 10.5 s.
        # 10 s keeps most answers written by the model; a timeout falls back to the template.
        timeout=10,
        retries=retries,
        headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
    )
    usage = resp.get("usage", {})
    log.info(
        "llm tokens=%s reasoning=%s cost=%s",
        usage.get("total_tokens"),
        (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
        usage.get("cost"),
    )
    return dict(resp["choices"][0]["message"])
