"""One shared HTTP client for every tool.

data.gov.in answers httpx's default User-Agent with an empty 502 (found in M0), and
Nominatim's policy requires an identifying UA, so the UA is set here once.
"""

import asyncio
import re
from typing import Any

import httpx

from app.config import settings

client = httpx.AsyncClient(
    headers={"User-Agent": settings.nominatim_user_agent},
    timeout=httpx.Timeout(30, connect=10),
)


# Error text from httpx includes the request URL, and data.gov.in takes its key in the URL.
_SECRET = re.compile(r"((?:api[-_]?key|key|token)=)[^&\s'\"]+", re.IGNORECASE)


def describe(e: BaseException) -> str:
    """'ErrorType: message' with any key in a URL masked, safe to show in /health and the trace."""
    return _SECRET.sub(r"\g<1>***", f"{type(e).__name__}: {e}")


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
