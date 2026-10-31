"""One shared HTTP client for every tool.

data.gov.in answers httpx's default User-Agent with an empty 502 (found in M0), and
Nominatim's policy requires an identifying UA, so the UA is set here once.
"""

import asyncio
import re
from typing import Any

import httpx

from app.config import settings

# 5 s per external call: a slow source must fail fast and let the agent fall back, so no
# question waits on one hung request. (The LLM sets its own, longer limit in llm.py.)
client = httpx.AsyncClient(
    headers={"User-Agent": settings.nominatim_user_agent},
    timeout=httpx.Timeout(5),
)


# Error text from httpx includes the request URL, and data.gov.in takes its key in the URL.
_SECRET = re.compile(r"((?:api[-_]?key|key|token)=)[^&\s'\"]+", re.IGNORECASE)


def describe(e: BaseException) -> str:
    """'ErrorType: message' with any key in a URL masked, safe to show in /health and the trace."""
    return _SECRET.sub(r"\g<1>***", f"{type(e).__name__}: {e}")


def plain(e: BaseException) -> str:
    """A short reason a farmer can read, for the trace and /health. No URLs, no exception names.
    The full text (describe) goes to the server log only."""
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        if code == 403:
            return "the source refused this server"
        if code == 429:
            return "the source is busy (too many requests)"
        return f"the source answered with an error (code {code})"
    if isinstance(e, httpx.TimeoutException):
        return "no answer within 5 seconds"
    if isinstance(e, httpx.ConnectError):
        return "could not connect to the source"
    if isinstance(e, httpx.TransportError):
        return "the connection dropped"
    if isinstance(e, ValueError):
        return "the source sent a reply we could not read"
    return str(e)[:120] if isinstance(e, RuntimeError) else "unexpected error"


async def request_json(method: str, url: str, *, retries: int = 1, **kwargs: Any) -> Any:
    """Send a request and parse JSON. Retry once with backoff on network errors, 5xx or bad JSON."""
    for attempt in range(retries + 1):
        try:
            r = await client.request(method, url, **kwargs)
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()  # 4xx is our bug, retrying won't help
                return r.json()
            r.raise_for_status()
        except (httpx.TransportError, httpx.HTTPStatusError, ValueError) as e:
            is_client_error = (
                isinstance(e, httpx.HTTPStatusError)
                and e.response.status_code < 500
                and e.response.status_code != 429
            )
            if is_client_error or attempt == retries:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))
    raise AssertionError("unreachable")
